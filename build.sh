#!/bin/bash
set -e

# ---- assemble single-file app from src/ sources ----
python3 tools/assemble_apk.py

# ---- web assets ----
[ -f package.json ] || npm init -y >/dev/null
npm i @capacitor/core@6 @capacitor/cli@6 @capacitor/android@6 >/dev/null
mkdir -p www
cp index.html www/

# ---- capacitor project (app id matches google-services.json) ----
[ -f capacitor.config.json ] || npx cap init Chess just.chess.com --web-dir www
[ -d android ] || npx cap add android
sed -i 's/<activity /<activity android:screenOrientation="portrait" /' android/app/src/main/AndroidManifest.xml

# firebase config
if [ -f google-services.json ]; then
  cp google-services.json android/app/google-services.json
fi

# ---- app icon: gold king on dark green (adaptive, Android 8+) ----
R=android/app/src/main/res
mkdir -p $R/drawable $R/values $R/mipmap-anydpi-v26
printf '%s' '<resources><color name="chess_bg">#1d211e</color></resources>' > $R/values/chess_icon.xml
cat > $R/drawable/chess_fg.xml <<'X'
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">
<path android:fillColor="#F6C945" android:pathData="M51,24H57V29H62V34H57V39H51V34H46V29H51ZM54,39C41,39 38,50 41,56H67C70,50 67,39 54,39ZM43,56H65L70,74H38ZM34,74H74V82H34Z"/>
</vector>
X
for n in ic_launcher ic_launcher_round; do
  printf '%s' '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/chess_bg"/><foreground android:drawable="@drawable/chess_fg"/></adaptive-icon>' > $R/mipmap-anydpi-v26/$n.xml
done

# ---- Custom Capacitor Plugin for Nearby Play (Hotspot & WebSocket) ----
PLUGIN_DIR="android/app/src/main/java/just/chess/com/plugin"
mkdir -p "$PLUGIN_DIR"

cat > "$PLUGIN_DIR/NearbyPlugin.java" << 'EOF'
package just.chess.com.plugin;

import android.content.Context;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Enumeration;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NearbyPlugin")
public class NearbyPlugin extends Plugin {
    private ServerSocket serverSocket;
    private ExecutorService executor = Executors.newCachedThreadPool();
    private boolean isHosting = false;
    private Object hotspotReservation = null;

    @PluginMethod
    public void startHost(PluginCall call) {
        int port = call.getInt("port", 8080);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WifiManager wifiManager = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wifiManager != null) {
                wifiManager.startLocalOnlyHotspot(new WifiManager.LocalOnlyHotspotCallback() {
                    @Override
                    public void onStarted(WifiManager.LocalOnlyHotspotReservation reservation) {
                        hotspotReservation = reservation;
                        startSocketServer(port, call);
                    }
                    @Override public void onStopped() { stopSocketServer(); }
                    @Override public void onFailed(int reason) { call.reject("Hotspot failed: " + reason); }
                }, new Handler(Looper.getMainLooper()));
            } else { call.reject("WifiManager not available"); }
        } else { startSocketServer(port, call); }
    }

    private void startSocketServer(int port, PluginCall call) {
        try {
            serverSocket = new ServerSocket(port);
            isHosting = true;
            executor.execute(() -> {
                while (isHosting) {
                    try {
                        Socket client = serverSocket.accept();
                    } catch (Exception e) { break; }
                }
            });
            JSObject ret = new JSObject();
            ret.put("ip", getLocalIpAddress());
            ret.put("port", port);
            call.resolve(ret);
        } catch (Exception e) { call.reject("Failed to start server socket", e); }
    }

    @PluginMethod
    public void stopHost(PluginCall call) {
        stopSocketServer();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && hotspotReservation != null) {
            try { ((WifiManager.LocalOnlyHotspotReservation) hotspotReservation).close(); } catch (Exception e) {}
        }
        call.resolve();
    }

    private void stopSocketServer() {
        isHosting = false;
        if (serverSocket != null) { try { serverSocket.close(); } catch (Exception e) {} }
    }

    private String getLocalIpAddress() {
        try {
            for (Enumeration<NetworkInterface> en = NetworkInterface.getNetworkInterfaces(); en.hasMoreElements();) {
                NetworkInterface intf = en.nextElement();
                for (Enumeration<InetAddress> enumIpAddr = intf.getInetAddresses(); enumIpAddr.hasMoreElements();) {
                    InetAddress inetAddress = enumIpAddr.nextElement();
                    if (!inetAddress.isLoopbackAddress() && inetAddress.getHostAddress().indexOf(':') < 0) {
                        return inetAddress.getHostAddress();
                    }
                }
            }
        } catch (Exception ex) { return "unknown"; }
        return "unknown";
    }
}
EOF

# ---- register plugin: rewrite MainActivity ----
cat > android/app/src/main/java/just/chess/com/MainActivity.java <<'EOF'
package just.chess.com;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import just.chess.com.plugin.NearbyPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NearbyPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
EOF

# Add permissions to AndroidManifest.xml for Hotspot and Network
if ! grep -q "ACCESS_WIFI_STATE" android/app/src/main/AndroidManifest.xml; then
  sed -i '/<manifest/a\    <uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />\n    <uses-permission android:name="android.permission.CHANGE_WIFI_STATE" />\n    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />\n    <uses-permission android:name="android.permission.NEARBY_WIFI_DEVICES" />' android/app/src/main/AndroidManifest.xml
fi

# ---- build ----
npx cap sync android
chmod +x android/gradlew
(cd android && ./gradlew assembleDebug --no-daemon)
cp android/app/build/outputs/apk/debug/app-debug.apk Chess.apk

# ---- release ----
TAG="v$GITHUB_RUN_NUMBER"
gh release delete "$TAG" --yes 2>/dev/null || true
git push --delete origin "refs/tags/$TAG" 2>/dev/null || true
gh release create "$TAG" Chess.apk --repo "$GITHUB_REPOSITORY" --title "Chess APK $TAG" --notes "Download Chess.apk and install it."
