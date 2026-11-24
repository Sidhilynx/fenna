# Fenna Crew for Android

Your crew from your phone, while your computer is on and Crew is open. The
design is [docs/plans/crew-mobile.md](../../docs/plans/crew-mobile.md); the
link is [`@opendeck/crew-link`](../../packages/crew-link) and the relay is
[`services/relay`](../../services/relay).

Stage: build.

## How it works

The app is React in a Capacitor WebView. `src/bridge.ts` keeps the phone link
up (`@opendeck/crew-link/phone`) and installs `window.shell` with the same
`invoke`, `send` and `on` the desktop page gets from Electron, so the
desktop's own models (`transcript.ts`, `text.ts`, the faces, markdown,
mentions) run here unchanged over the link. Screens are in `src/screens`.

| File | |
| --- | --- |
| `src/bridge.ts` | The link, the app's life (front and back, network changes), notifications |
| `src/state.tsx` | The link's state, the crew as last seen (kept for offline), the screen stack, toasts |
| `src/ui.tsx` | Header, connection bar, tabs, sheets, rows, Android's back button |
| `src/mobile.css` | Layout over Crew's tokens (`apps/crew/src/renderer/tokens.css`) and pixel frames |
| `android/` | The Capacitor Android project; `CrewPushPlugin.java` and `CrewMessagingService.java` open sealed notifications |

## Build

Needs a JDK 21 (`JAVA_HOME`) and the Android SDK with `platforms;android-36`
and `build-tools;36.0.0` (`ANDROID_HOME`).

```powershell
npm run apk -w @opendeck/crew-mobile              # debug APK
npm run apk -w @opendeck/crew-mobile -- --release # unsigned release APK
```

The APK is at `android/app/build/outputs/apk/debug/app-debug.apk`.

## Try it against a relay on this computer

```powershell
node services/relay/server.mjs 8787
$env:FENNA_RELAY_URL = "ws://127.0.0.1:8787"     # then start Crew
adb reverse tcp:8787 tcp:8787                     # the emulator or a USB phone reaches it as 127.0.0.1
```

Then Settings, Phone, Connect a phone in Crew, and Enter the code (or Scan)
on the phone.

## Notifications

Android notifications need Firebase. Create a Firebase project with an
Android app `com.sidhilynx.fenna.crew`, put its `google-services.json` in
`android/app/` (git-ignored), and give the relay the project's service account
(`services/relay/README.md`). Without them the app works and Settings says
notifications aren't available in this build.
