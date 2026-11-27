# Last Driver: Android and iOS app

The game itself is `../last-driver/index.html`. This folder wraps it as a real app with [Capacitor](https://capacitorjs.com).
In the app, the "Second chance" button shows a real AdMob rewarded video ad. The web version keeps the placeholder.

## What you need
- [Node.js](https://nodejs.org) 22 or newer
- **Android:** [Android Studio](https://developer.android.com/studio)
- **iPhone:** a Mac with Xcode and CocoaPods

## First run
```bash
cd app
npm install
npm run android
```
`npm run android` builds the game into `www/`, copies it into the Android project and opens it in Android Studio.
Plug in your phone (with USB debugging on) or start an emulator, then press **Run ▶**.
Tapping "Watch ad · Revive" should show Google's **test** ad.

On a Mac: `npm run ios` opens the project in Xcode.

## After changing the game
Every time `last-driver/index.html` changes, run `npm run sync` again (or `npm run android` / `npm run ios`).

## Switching to real ads (when your AdMob account is ready)
In AdMob, create an app for Android and one for iOS. In each one, create a **Rewarded** ad unit.
Then edit `ads.config.json`:
- `appId`: the app ID (contains `~`)
- `rewarded`: the ad unit ID (contains `/`)
- `testing`: `false`

Run `npm run sync`. The IDs are written into the page, `AndroidManifest.xml` and `Info.plist` automatically.
Keep `testing: true` while you test on your own phone. Clicking real ads on your own app can get your AdMob account banned.

## Before uploading to the stores
- `appId` in `capacitor.config.json` (`com.lastdriver.game`) is the app's permanent ID in the stores. Change it now if you want a different one (for example `com.yourname.lastdriver`); after the first upload it can't be changed.
- Icon and splash screen: `npx @capacitor/assets generate` from a 1024×1024 `assets/icon.png`.
- A privacy policy page (required when the app shows ads).
- Android: build a signed **App Bundle (.aab)** in Android Studio (Build → Generate Signed App Bundle) and keep the signing key safe.
- iOS: in Xcode, Product → Archive, then upload to App Store Connect.

## What's different from the web version
- three.js and the fonts are packed into the app, so the game works offline.
- The global leaderboard only works inside Claude. In the app, each player sees their own best until an online leaderboard is connected (for example Firebase).
- The status bar is hidden, and the Android back button pauses and resumes the game, goes back to the menu, and exits from the main menu.
- If no ad is available (offline, or no ad to show), the player is revived anyway.
