// Builds the Android app: the web part (Vite), copies it into the Android
// project (Capacitor sync), then Gradle. `npm run apk -w @opendeck/crew-mobile`
// for a debug APK, `-- --release` for an unsigned release one. Needs a JDK 21
// (JAVA_HOME) and the Android SDK (ANDROID_HOME); says which is missing.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const release = process.argv.includes("--release");
const win = process.platform === "win32";

for (const [name, hint] of [
  ["JAVA_HOME", "a JDK 21 (for example Eclipse Temurin)"],
  ["ANDROID_HOME", "the Android SDK with platforms;android-36 and build-tools;36.0.0"],
]) {
  if (!process.env[name] || !existsSync(process.env[name])) {
    console.error(`Set ${name} to ${hint}.`);
    process.exit(1);
  }
}

/** Runs one of the fixed commands below (no input from outside goes into them). */
function run(cmd, args, cwd) {
  const program = /[\\/]/.test(cmd) ? `"${cmd}"` : cmd;
  const r = win ? spawnSync([program, ...args].join(" "), { cwd, stdio: "inherit", shell: true }) : spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run("npx", ["vite", "build"], app);
run("npx", ["cap", "sync", "android"], app);
const android = path.join(app, "android");
run(path.join(android, win ? "gradlew.bat" : "gradlew"), [release ? "assembleRelease" : "assembleDebug", "--console=plain"], android);

const out = path.join(app, "android", "app", "build", "outputs", "apk", release ? "release" : "debug", release ? "app-release-unsigned.apk" : "app-debug.apk");
console.error(existsSync(out) ? `APK: ${out}` : "Gradle finished, but the APK isn't where it should be.");
