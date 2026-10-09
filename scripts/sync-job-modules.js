#!/usr/bin/env node
/**
 * Copy the modules `functions/vm_notifier_job` shares with `functions/welcome`.
 *
 * Catalyst deploys each function directory as its own package, so a job function cannot
 * `require('../welcome/vm-scan-service')` — it resolves fine locally and then throws
 * MODULE_NOT_FOUND in production, which is the worst possible place to find out. The scan engine
 * lives in `functions/welcome/` (that is where its dependencies already are, and where the UI's
 * "Run now" calls it), and this script mirrors it plus its require-graph into
 * `functions/vm_notifier_job/shared/`.
 *
 * Usage:
 *   node scripts/sync-job-modules.js            copy, reporting what changed
 *   node scripts/sync-job-modules.js --check    exit 1 if anything is out of date (predeploy)
 *
 * The copies carry a generated banner and are checked, not trusted: `--check` compares content, so
 * an edit to the copy instead of the original fails the deploy rather than shipping two behaviours.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FROM = path.join(ROOT, 'functions', 'welcome');
const TO = path.join(ROOT, 'functions', 'vm_notifier_job', 'shared');

/**
 * The transitive require-graph of vm-scan-service.js, inside functions/welcome.
 * Anything added to that graph has to be added here — `--check` will not catch a NEW file, only a
 * stale one, so the job's own smoke require is what fails loudly if this list falls behind.
 */
const MODULES = [
  'vm-scan-service.js',
  'vm-version-util.js',
  'vm-notifications-service.js',
  'tool-config-service.js',
  'tool-state-service.js',
  'connections-service.js',
  'connections-registry.js',
  'crypto-util.js',
];

const BANNER = (name) => `/* GENERATED COPY — do not edit.
 * Source: functions/welcome/${name}
 * Regenerate: node scripts/sync-job-modules.js   (npm run sync:job)
 * Why: Catalyst packages each function directory separately, so the job function cannot require
 * across into functions/welcome at runtime. See functions/vm_notifier_job/index.js.
 */
`;

const check = process.argv.includes('--check');

fs.mkdirSync(TO, { recursive: true });

const stale = [];
const written = [];

for (const name of MODULES) {
  const src = path.join(FROM, name);
  if (!fs.existsSync(src)) {
    console.error(`sync-job-modules: missing source functions/welcome/${name}`);
    process.exit(1);
  }
  const wanted = BANNER(name) + fs.readFileSync(src, 'utf8');
  const dest = path.join(TO, name);
  const current = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : null;
  if (current === wanted) continue;

  if (check) {
    stale.push(name);
  } else {
    fs.writeFileSync(dest, wanted);
    written.push(name);
  }
}

/** A file in shared/ with no source is a module that was renamed or dropped — remove it. */
for (const name of fs.readdirSync(TO)) {
  if (MODULES.includes(name)) continue;
  if (check) {
    stale.push(`${name} (orphan)`);
  } else {
    fs.unlinkSync(path.join(TO, name));
    written.push(`${name} (removed)`);
  }
}

if (check) {
  if (stale.length) {
    console.error(`sync-job-modules: out of date — ${stale.join(', ')}`);
    console.error('Run: npm run sync:job   (and commit the result)');
    process.exit(1);
  }
  console.log(`sync-job-modules: up to date (${MODULES.length} modules)`);
} else {
  console.log(written.length
    ? `sync-job-modules: updated ${written.join(', ')}`
    : `sync-job-modules: already up to date (${MODULES.length} modules)`);
}
