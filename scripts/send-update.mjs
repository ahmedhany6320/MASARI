#!/usr/bin/env node
/**
 * Publishes one update to every runtime version this project has ever built.
 *
 * WHY THIS EXISTS
 *
 * An update only reaches a phone whose runtime version matches the one it was
 * published under. That is a sound design and a miserable thing to ask a
 * person to manage: it means knowing which build is installed, reading a
 * number off a screen, and typing it in exactly — and getting it wrong is
 * silent. The update publishes, reports success, and arrives nowhere.
 *
 * So this stops asking. It reads the runtime versions off the builds that
 * actually exist in EAS, and publishes the same update to each one. Whichever
 * build is on the phone, the update is addressed to it.
 *
 * Publishing to a runtime version nobody is running costs nothing — it is a
 * row in a table that no device ever asks for.
 *
 *   npm run send-update "what changed"
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const message = process.argv.slice(2).join(' ').trim() || 'update';
const BRANCH = 'preview';
const appJsonPath = new URL('../app.json', import.meta.url);

/** Runs a command, returning stdout. Throws with readable output on failure. */
function run(args, { capture = false } = {}) {
  return execFileSync('npx', args, {
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    shell: process.platform === 'win32',
    maxBuffer: 32 * 1024 * 1024,
  });
}

console.log('Looking up which app versions exist...\n');

let builds = [];
try {
  const raw = run(
    ['eas-cli', 'build:list', '--platform', 'android', '--limit', '30', '--json', '--non-interactive'],
    { capture: true },
  );
  builds = JSON.parse(raw);
} catch (e) {
  console.error('Could not read the build list from EAS.');
  console.error('Are you logged in?  Try:  npx eas-cli login\n');
  console.error(String(e.stdout ?? e.message ?? e).slice(0, 800));
  process.exit(1);
}

/*
 * Only builds that finished are worth addressing — a build that errored was
 * never installed on anything, so publishing to its runtime version is noise.
 */
const versions = [
  ...new Set(
    builds
      .filter((b) => String(b.status ?? '').toUpperCase() === 'FINISHED')
      .map((b) => b.runtimeVersion)
      .filter((v) => typeof v === 'string' && v.trim() !== ''),
  ),
];

const config = JSON.parse(readFileSync(appJsonPath, 'utf8'));
const original = config.expo.runtimeVersion;

// The version this source would build as, in case it is not among the builds
// yet — a phone running a fresh local build still needs to be reachable.
const current = typeof original === 'string' ? original : config.expo.version;
if (!versions.includes(current)) versions.push(current);

if (versions.length === 0) {
  console.error('No finished Android builds found, so there is nothing to update.');
  console.error('Build one first:  npx eas-cli build --platform android --profile preview');
  process.exit(1);
}

console.log(`Found ${versions.length} version(s): ${versions.join(', ')}`);
console.log('Sending the update to every one of them.\n');

const failed = [];
try {
  for (const [i, v] of versions.entries()) {
    console.log(`\n--- ${i + 1}/${versions.length}  version ${v} ---`);
    config.expo.runtimeVersion = v;
    writeFileSync(appJsonPath, `${JSON.stringify(config, null, 2)}\n`);
    try {
      run(['eas-cli', 'update', '--branch', BRANCH, '--message', message, '--non-interactive']);
    } catch {
      failed.push(v);
      console.error(`  (version ${v} failed — carrying on with the rest)`);
    }
  }
} finally {
  // Always put app.json back, even if something above threw. Leaving it
  // rewritten would silently change what the next build produces.
  config.expo.runtimeVersion = original;
  writeFileSync(appJsonPath, `${JSON.stringify(config, null, 2)}\n`);
}

const sent = versions.length - failed.length;
console.log(`\n${'='.repeat(46)}`);
console.log(`Update sent to ${sent} of ${versions.length} version(s).`);
if (failed.length) console.log(`Did not send to: ${failed.join(', ')}`);
console.log('\nOn your phone: close Masari completely, open it, close it,');
console.log('and open it once more. The first open downloads, the second shows it.');
