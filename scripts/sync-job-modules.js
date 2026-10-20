#!/usr/bin/env node
/**
 * Copy the modules the job functions share with `functions/welcome`.
 *
 * Catalyst deploys each function directory as its own package, so a job function cannot
 * `require('../welcome/vm-scan-service')` — it resolves fine locally and then throws
 * MODULE_NOT_FOUND in production, which is the worst possible place to find out. The engines live
 * in `functions/welcome/` (that is where their dependencies already are, and where the UI's "Run
 * now" calls them), and this script mirrors each one plus its require-graph into that job's
 * `shared/` folder.
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

/**
 * Per job: the transitive require-graph of its entry module, inside functions/welcome.
 * Anything added to one of those graphs has to be added here — `--check` will not catch a NEW file,
 * only a stale one, so the job's own smoke require is what fails loudly if a list falls behind.
 */
/**
 * `scheduler_job` is the only job function now. `vm_notifier_job` was folded into the registry on
 * 2026-10-13 — its modules moved into this list rather than getting their own.
 *
 * The graph is the registry plus every task the registry can reach, so a new TASKS entry means
 * adding that task's modules here too.
 */
const JOBS = {
  scheduler_job: [
    'scheduled-tasks.js',
    'tool-state-service.js',
    'tool-config-service.js',
    // followup_reminders
    'followup-notify-service.js',
    'followup-service.js',
    'directory-service.js',
    // vm_dependency_scan
    'vm-scan-service.js',
    'vm-version-util.js',
    'vm-notifications-service.js',
    // shared by both
    'connections-service.js',
    'connections-registry.js',
    'crypto-util.js',
  ],
};

const BANNER = (name, job) => `/* GENERATED COPY — do not edit.
 * Source: functions/welcome/${name}
 * Regenerate: node scripts/sync-job-modules.js   (npm run sync:job)
 * Why: Catalyst packages each function directory separately, so the job function cannot require
 * across into functions/welcome at runtime. See functions/${job}/index.js.
 */
`;

const check = process.argv.includes('--check');

const stale = [];
const written = [];
let total = 0;

for (const [job, modules] of Object.entries(JOBS)) {
  const to = path.join(ROOT, 'functions', job, 'shared');
  fs.mkdirSync(to, { recursive: true });
  total += modules.length;

  for (const name of modules) {
    const src = path.join(FROM, name);
    if (!fs.existsSync(src)) {
      console.error(`sync-job-modules: missing source functions/welcome/${name}`);
      process.exit(1);
    }
    const wanted = BANNER(name, job) + fs.readFileSync(src, 'utf8');
    const dest = path.join(to, name);
    const current = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : null;
    if (current === wanted) continue;

    if (check) stale.push(`${job}/${name}`);
    else { fs.writeFileSync(dest, wanted); written.push(`${job}/${name}`); }
  }

  /** A file in shared/ with no source is a module that was renamed or dropped — remove it. */
  for (const name of fs.readdirSync(to)) {
    if (modules.includes(name)) continue;
    if (check) stale.push(`${job}/${name} (orphan)`);
    else { fs.unlinkSync(path.join(to, name)); written.push(`${job}/${name} (removed)`); }
  }
}

if (check) {
  if (stale.length) {
    console.error(`sync-job-modules: out of date — ${stale.join(', ')}`);
    console.error('Run: npm run sync:job   (and commit the result)');
    process.exit(1);
  }
  console.log(`sync-job-modules: up to date (${total} module copies)`);
} else {
  console.log(written.length
    ? `sync-job-modules: updated ${written.join(', ')}`
    : `sync-job-modules: already up to date (${total} module copies)`);
}
