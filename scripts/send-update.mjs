#!/usr/bin/env node
/**
 * Publishes one update to every runtime version this project has ever used.
 *
 * WHY THIS EXISTS
 *
 * An update only reaches a phone whose runtime version matches the one it was
 * published under. That is a sound design and a miserable thing to ask a
 * person to manage: it means knowing which build is installed, reading a
 * number off a screen, and typing it in exactly — and getting it wrong is
 * silent. The update publishes, reports success, and arrives nowhere.
 *
 * So this stops asking. It collects every runtime version the project has
 * actually used — from the builds that exist, and from the updates already
 * published — and sends the same update to each. Whichever build is on the
 * phone, the update is addressed to it.
 *
 * Publishing to a runtime version nobody runs costs nothing: it is a row in a
 * table that no device ever asks for.
 *
 *   npm run send-update "what changed"
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

/*
 * Anything that looks like a bare version number is a version to also send to,
 * not part of the message — the escape hatch for a build neither EAS list
 * knows about. Everything else is the message.
 */
const argv = process.argv.slice(2);
const extraVersions = argv.filter((a) => /^\d+\.\d+\.\d+$/.test(a));
const message = argv.filter((a) => !/^\d+\.\d+\.\d+$/.test(a)).join(' ').trim() || 'update';
const BRANCH = 'preview';
const appJsonPath = new URL('../app.json', import.meta.url);
const isWindows = process.platform === 'win32';

/*
 * Quoting, because `npx` on Windows is a .cmd file and Node will not launch it
 * without a shell — and a shell concatenates arguments rather than passing
 * them through. Unquoted, a two-word message became two arguments and EAS
 * rejected the second one: "Unexpected argument: الحسابات".
 */
function quote(arg) {
  const s = String(arg);
  if (isWindows) return `"${s.replace(/"/g, '""')}"`;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function run(args, { capture = false } = {}) {
  const command = ['npx', ...args].map(quote).join(' ');
  const res = spawnSync(command, {
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    shell: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) {
    const err = new Error(`command failed: ${command}`);
    err.stdout = res.stdout;
    err.stderr = res.stderr;
    throw err;
  }
  return res.stdout;
}

/** EAS has moved this field between releases; look everywhere it has lived. */
function runtimeOf(row) {
  const candidates = [
    row?.runtimeVersion,
    row?.metadata?.runtimeVersion,
    row?.buildProfile?.runtimeVersion,
    row?.group?.runtimeVersion,
  ];
  return candidates.find((v) => typeof v === 'string' && v.trim() !== '') ?? null;
}

/** Parses JSON that EAS sometimes prefixes with human-readable lines. */
function parseJson(raw) {
  const text = String(raw ?? '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.search(/[[{]/);
    if (start < 0) return null;
    try {
      return JSON.parse(text.slice(start));
    } catch {
      return null;
    }
  }
}

// ---- the project must be linked before anything else -----------------------
/*
 * The EAS project link lives in app.json as `extra.eas.projectId`. Unzipping a
 * fresh copy of the source over a working folder replaces app.json and takes
 * the link with it — and every EAS command then fails with a message about
 * non-interactive mode that never mentions app.json.
 */
const cfg = JSON.parse(readFileSync(appJsonPath, 'utf8'));
if (!cfg.expo?.extra?.eas?.projectId) {
  console.error('\nThis folder is not linked to your EAS project yet.\n');
  console.error('Run:   npx eas-cli init');
  console.error('and choose the EXISTING project (masari) — never create a new');
  console.error('one, since a new project has no builds and so can update');
  console.error('nothing already installed.\n');
  process.exit(1);
}

// ---- collect every runtime version this project has used --------------------
console.log('Looking up which app versions exist...\n');

const versions = new Set();
const sources = [];

try {
  const builds = parseJson(
    run(['eas-cli', 'build:list', '--platform', 'android', '--limit', '50', '--json', '--non-interactive'], {
      capture: true,
    }),
  );
  const rows = Array.isArray(builds) ? builds : (builds?.builds ?? []);
  let found = 0;
  for (const b of rows) {
    const v = runtimeOf(b);
    if (v) {
      versions.add(v);
      found++;
    }
  }
  sources.push(`${found} from builds`);
} catch (e) {
  console.error('Could not read the build list.');
  console.error(String(e.stderr || e.stdout || e.message).slice(0, 600));
  console.error('\nIf this says you are not signed in:  npx eas-cli login\n');
}

/*
 * Updates already published are the other record of which runtime versions
 * matter — and the more reliable one, because a build can age out of the list
 * while the phone running it does not.
 */
try {
  const updates = parseJson(
    run(['eas-cli', 'update:list', '--branch', BRANCH, '--limit', '50', '--json', '--non-interactive'], {
      capture: true,
    }),
  );
  const groups = Array.isArray(updates)
    ? updates
    : (updates?.currentPage ?? updates?.updateGroups ?? updates?.updates ?? []);
  let found = 0;
  for (const g of groups) {
    const rows = Array.isArray(g) ? g : [g];
    for (const r of rows) {
      const v = runtimeOf(r);
      if (v) {
        versions.add(v);
        found++;
      }
    }
  }
  sources.push(`${found} from past updates`);
} catch {
  // Not fatal: a branch with no updates yet is normal.
}

// The version this source would build as, so a phone running a build that is
// not in either list above is still reachable.
const original = cfg.expo.runtimeVersion;
versions.add(typeof original === 'string' ? original : cfg.expo.version);

for (const v of extraVersions) versions.add(v);

const list = [...versions].sort();
if (list.length === 0) {
  console.error('No runtime versions found, so there is nothing to update.');
  process.exit(1);
}

console.log(`Found ${list.length} version(s): ${list.join(', ')}`);
if (sources.length) console.log(`(${sources.join(', ')})`);
console.log('\nSending the update to every one of them.\n');

// ---- publish to each --------------------------------------------------------
const failed = [];
try {
  for (const [i, v] of list.entries()) {
    console.log(`\n--- ${i + 1}/${list.length}  version ${v} ---`);
    cfg.expo.runtimeVersion = v;
    writeFileSync(appJsonPath, `${JSON.stringify(cfg, null, 2)}\n`);
    try {
      run(['eas-cli', 'update', '--branch', BRANCH, '--message', message, '--non-interactive']);
    } catch (e) {
      failed.push(v);
      console.error(String(e.stderr || '').slice(0, 400));
      console.error(`  (version ${v} failed — carrying on with the rest)`);
    }
  }
} finally {
  // Always put app.json back, even if something above threw. Leaving it
  // rewritten would silently change what the next build produces.
  cfg.expo.runtimeVersion = original;
  writeFileSync(appJsonPath, `${JSON.stringify(cfg, null, 2)}\n`);
}

const sent = list.length - failed.length;
console.log(`\n${'='.repeat(46)}`);
console.log(`Update sent to ${sent} of ${list.length} version(s).`);
if (failed.length) console.log(`Did not send to: ${failed.join(', ')}`);
if (sent > 0) {
  console.log('\nOn your phone: close Masari completely, open it, close it,');
  console.log('and open it once more. The first open downloads, the second shows it.');
}
