#!/usr/bin/env node
/**
 * Pins `expo.runtimeVersion` to a literal string.
 *
 * An OTA update only reaches an installed app whose runtime version matches
 * the one it was published under. With `policy: "appVersion"` those are tied
 * to the display version, so every cosmetic bump silently orphans every phone
 * already carrying the app: the update publishes, reports success, and arrives
 * nowhere.
 *
 * Pinning it decouples the two. `version` can move freely for display, and the
 * runtime version changes ONLY when something native does — a new permission,
 * a new native package — which is exactly when a fresh install is genuinely
 * required anyway.
 *
 *   node scripts/pin-runtime.mjs 0.16.0
 */
import { readFileSync, writeFileSync } from 'node:fs';

const target = process.argv[2];
if (!target || !/^\d+\.\d+\.\d+$/.test(target)) {
  console.error('Usage: node scripts/pin-runtime.mjs <version>   e.g. 0.16.0');
  console.error("Use the version shown on the app's home screen.");
  process.exit(1);
}

const path = new URL('../app.json', import.meta.url);
const config = JSON.parse(readFileSync(path, 'utf8'));
const previous = JSON.stringify(config.expo.runtimeVersion);

config.expo.runtimeVersion = target;
writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);

console.log(`runtimeVersion: ${previous} -> "${target}"`);
console.log(`display version stays ${config.expo.version}`);
console.log('\nNow publish:  npx eas-cli update --branch preview --message "update"');
