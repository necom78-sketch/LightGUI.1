set -e
npm init -y >/dev/null
npm i @capacitor/core@6 @capacitor/cli@6 @capacitor/android@6 >/dev/null
mkdir -p www && cp index.html www/
npx cap init Chess com.friends.chess --web-dir www
npx cap add android
sed -i 's/<activity /<activity android:screenOrientation="portrait" /' android/app/src/main/AndroidManifest.xml
# custom app icon (gold king on dark green, adaptive icon for Android 8+)
R=android/app/src/main/res
mkdir -p $R/drawable $R/values $R/mipmap-anydpi-v26
echo '<resources><color name="chess_bg">#1d211e</color></resources>' > $R/values/chess_icon.xml
cat > $R/drawable/chess_fg.xml <<'X'
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108"><path android:fillColor="#F6C945" android:pathData="M51,24H57V29H62V34H57V39H51V34H46V29H51ZM54,39C41,39 38,50 41,56H67C70,50 67,39 54,39ZM43,56H65L70,74H38ZM34,74H74V82H34Z"/></vector>
X
for n in ic_launcher ic_launcher_round; do
  echo '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/chess_bg"/><foreground android:drawable="@drawable/chess_fg"/></adaptive-icon>' > $R/mipmap-anydpi-v26/$n.xml
done
npx cap sync android
(cd android && ./gradlew assembleDebug --no-daemon)
cp android/app/build/outputs/apk/debug/app-debug.apk Chess.apk
gh release create "v$GITHUB_RUN_NUMBER" Chess.apk --repo "$GITHUB_REPOSITORY" --title "Chess APK" --notes "Download Chess.apk and install it."
