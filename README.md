# Night Watch

Steer a boat down a river at night while a helicopter lights the way. Every run starts at a lit harbour, then it's real darkness: the chopper's spotlight is how you see.

- **Thumb on the bottom pad is a joystick.** Left and right steer; push it forward to go faster (there's no brake). Let go and the boat keeps going straight at normal speed.
- **Another finger anywhere above the pad flies the helicopter.** Its spotlight shines a little above your finger. Spots you lit stay faintly visible for a moment, so scout ahead and remember the way.
- **The river splits** around wooded islands. Often one side is blocked by rocks and a fallen log with blinking red warning lights.
- **Hit the bank, the island or the rocks and the run ends.**
- **Revive:** after a crash you can watch a short ad once per run to carry on from where you crashed, with 3 seconds of safety. In a browser a pretend 3-second ad plays instead.
- **Pause** with the button in the top-right corner (Resume, Restart, Quit). The game also pauses if you leave the app.
- **Every level the night gets darker:** faster current, narrower river, smaller spotlight, and lit spots fade sooner.

### Two ways to play

- **Levels:** 10 levels, each with its own river (the same layout every time, so you can learn it) and a dock at the end. Supply crates earn stars: finish for 1, pick up half the crates for 2, all of them for 3. Finishing a level unlocks the next one.
  Levels 1 and 2 have street lamps along a riverside road that light patches of the river, then stop, to teach you to use the chopper.
  1. First Light · 2. Gentle Bends · 3. The Split · 4. Blocked Way · 5. The Narrows · 6. Moonless Night · 7. Fast Water · 8. Island Maze · 9. Fading Memory · 10. Night Run
- **Endless:** the river never ends. Every stage is darker and faster, with a narrower river. This mode has the high scores and leaderboard.

### Coins and shop

- **Coins:** 1 per crate in both modes, plus 1 per 50 points in Endless and a first-time bonus for each level.
- **Shop:** spotlight, memory and boat-lamp upgrades (3 levels each), and 5 boats (looks only).
- **High scores:** your top 10 Endless runs on this device, plus an "Everyone" leaderboard. That leaderboard works in the web version when signed in to Claude; in the Android app it's planned for Google Play Games.

Progress (stars, coins, upgrades, boats, scores) is saved on the device.

On a computer, click and drag to use the joystick, or use the arrow keys (Up to boost); the helicopter flies ahead of the boat.

Score = distance travelled + firefly bonuses. Your best score is saved on the device.

It's written in plain HTML/JavaScript (`www/`) and packaged as an Android app with [Capacitor](https://capacitorjs.com/). You don't need Android Studio, because GitHub Actions builds the app.

## Play it in a browser

Open `www/index.html` in a browser, or run:

```bash
npm run serve
```

Then go to http://localhost:8080. On a computer, click to start, then drag with the mouse or use the arrow keys.

## How the Android build works

Every push to `main` runs `.github/workflows/android.yml`, which:

1. Copies `www/` into the Android project (`npx cap sync android`)
2. Builds a **debug APK**, which you can install straight onto an Android phone to test
3. Builds a **release bundle (`.aab`)**, which is the file you upload to Google Play

Download both from the run's page: **Actions → Build Android → latest run → Artifacts**.

## Signing (needed for Google Play)

Google Play only accepts a signed bundle. Add these four **repository secrets** under **Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | Your upload keystore file, base64-encoded |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Key alias (e.g. `upload`) |
| `ANDROID_KEY_PASSWORD` | Key password |

Create a keystore (needs Java's `keytool`):

```bash
keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

Base64-encode it for the secret (macOS/Linux):

```bash
base64 -w0 upload.jks
```

Keep `upload.jks` and its passwords somewhere safe and **never commit them**. Google Play App Signing holds the real app key, so if you lose this upload key, Google can reset it.

## Ads (watch an ad to revive)

The revive button uses rewarded video ads from AdMob, through the [`@capacitor-community/admob`](https://github.com/capacitor-community/admob) plugin. Right now it uses **Google's test ids**, which show a "Test Ad" and never pay. Before publishing:

1. Create an AdMob account at https://admob.google.com, add the app (Android), and create a **Rewarded** ad unit
2. Put your **app id** (`ca-app-pub-…~…`) in `android/app/src/main/res/values/strings.xml` (`admob_app_id`)
3. Put your **ad unit id** (`ca-app-pub-…/…`) in `www/game.js` (`AD_UNIT_ID`) and set `AD_TESTING = false`
4. In Play Console, answer **Contains ads: Yes**, and in **Data safety** declare what the Google Mobile Ads SDK collects (device or other IDs, app interactions, diagnostics, used for advertising and analytics)

Don't tap your own real ads: AdMob can ban the account. Keep `AD_TESTING = true` on your own test builds.

## Publishing to Google Play

1. Create a developer account at https://play.google.com/console ($25, one time)
2. **Create app**, name it "Night Watch", and choose Game / Free
3. Fill in the store listing: short and full description, icon (512×512), feature graphic (1024×500), at least 2 phone screenshots
4. Complete **App content**: privacy policy URL, ads (yes: the revive ad), content rating questionnaire, target audience, data safety (what the AdMob SDK collects, see above)
5. Upload the `.aab` to **Testing → Closed testing** and invite testers. New personal accounts need **12+ testers for 14 days** before they can apply for production.
6. Apply for production access, then promote the release

## Project layout

```
www/                  the game (index.html, game.js, fonts/: OFL fonts, see fonts/LICENSE.md)
android/              native Android project generated by Capacitor
capacitor.config.json app id (com.mataman03.nightwatch) and name
.github/workflows/    the cloud build
```
