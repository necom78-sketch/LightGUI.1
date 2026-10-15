set -e
npm init -y >/dev/null
npm i @capacitor/core@6 @capacitor/cli@6 @capacitor/android@6 >/dev/null
mkdir -p www && cp index.html www/
npx cap init Chess com.friends.chess --web-dir www
npx cap add android
sed -i 's/<activity /<activity android:screenOrientation="portrait" /' android/app/src/main/AndroidManifest.xml
npx cap sync android
(cd android && ./gradlew assembleDebug --no-daemon)
cp android/app/build/outputs/apk/debug/app-debug.apk Chess.apk
gh release create "v$GITHUB_RUN_NUMBER" Chess.apk --repo "$GITHUB_REPOSITORY" --title "Chess APK" --notes "Download Chess.apk and install it."
