#!/usr/bin/env node
/**
 * catalyst-cli MCP server
 *
 * Exposes a curated, non-interactive subset of the Zoho Catalyst CLI as MCP tools over stdio.
 * Every CLI call runs with `-ni` (non-interactive) and cwd = this repo's root, so it uses the
 * project's `.catalystrc` / `catalyst.json` and the CLI's existing login on this machine.
 *
 * Deliberately NOT exposed: login/logout/token:*, functions:delete, client:delete, project:reset,
 * iac:import, serve, functions:shell, init/functions:add/client:setup (interactive, destructive,
 * or long-running).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const DEPLOY_SH = path.join(REPO_ROOT, '.claude', 'skills', 'deploy', 'deploy.sh');
const CATALYST_BIN = process.env.CATALYST_BIN || 'catalyst';
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

// MCP clients often spawn servers with a minimal environment (no SSH_AUTH_SOCK), which breaks
// deploy.sh's `ssh-add --apple-load-keychain` / git push. Recover the agent socket from launchd.
if (!process.env.SSH_AUTH_SOCK && process.platform === 'darwin') {
  try {
    const sock = execFileSync('launchctl', ['getenv', 'SSH_AUTH_SOCK'], { encoding: 'utf8' }).trim();
    if (sock) process.env.SSH_AUTH_SOCK = sock;
  } catch { /* leave unset; deploy.sh will report the SSH failure */ }
}

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const strip = (s) => s.replace(ANSI, '');

function run(cmd, args, { timeoutMs = DEFAULT_TIMEOUT_MS, cwd = REPO_ROOT } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ZCATALYST_NON_INTERACTIVE: 'true', FORCE_COLOR: '0', NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out, err: `${err}\n${e.message}` }); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code: signal ? -1 : code, out, err: signal ? `${err}\nkilled by ${signal} (timeout ${timeoutMs}ms)` : err });
    });
  });
}

async function catalyst(args, opts) {
  const full = ['-ni', ...args];
  const r = await run(CATALYST_BIN, full, opts);
  return format(`catalyst ${full.join(' ')}`, r);
}

function format(cmdline, { code, out, err }) {
  const text = [`$ ${cmdline}`, `exit=${code}`, '', strip(out).trim(), strip(err).trim() ? `\n[stderr]\n${strip(err).trim()}` : '']
    .join('\n').trim();
  return { content: [{ type: 'text', text }], isError: code !== 0 };
}

const server = new McpServer({ name: 'catalyst-cli', version: '1.0.0' });

// ------------------------------------------------------------------ read-only
server.registerTool('catalyst_whoami', {
  description: 'Show which Zoho account the local Catalyst CLI is logged in as.',
  inputSchema: {},
}, () => catalyst(['whoami']));

server.registerTool('catalyst_project_list', {
  description: 'List all Catalyst projects the logged-in account can access.',
  inputSchema: {},
}, () => catalyst(['project:list']));

server.registerTool('catalyst_apig_status', {
  description: 'Show API Gateway status for the active project (and current/previous schedule progress).',
  inputSchema: { previous: z.boolean().optional().describe('Show the previous schedule status instead of the current one') },
}, ({ previous }) => catalyst(['apig:status', ...(previous ? ['--previous'] : [])]));

// ------------------------------------------------------------------ deploy (via deploy.sh)
server.registerTool('catalyst_deploy', {
  description:
    'Deploy this repo to Catalyst using the project\'s deploy.sh: detects changed targets (functions/<name>, frontend client) ' +
    'unless `targets` is given, installs deps, syntax-checks, guards the vault CRED_ENC_KEY, bumps the client version when the client ' +
    'is deployed, runs `catalyst deploy`, verifies live health endpoints, then pushes committed-but-unpushed commits over SSH ' +
    '(never force-pushes). Use dryRun=true to preview.',
  inputSchema: {
    targets: z.array(z.string()).optional().describe('Explicit targets, e.g. ["functions:welcome","functions:task_manager","client"]. Omit to auto-detect.'),
    all: z.boolean().optional().describe('Deploy every target in catalyst.json'),
    noPush: z.boolean().optional().describe('Deploy only; skip git push'),
    noDeploy: z.boolean().optional().describe('Push only; skip Catalyst deploy'),
    dryRun: z.boolean().optional().describe('Print what would happen without deploying or pushing'),
  },
}, async ({ targets, all, noPush, noDeploy, dryRun }) => {
  if (!existsSync(DEPLOY_SH)) {
    return { content: [{ type: 'text', text: `deploy.sh not found at ${DEPLOY_SH}` }], isError: true };
  }
  const args = [];
  if (targets?.length) args.push('--only', targets.join(','));
  if (all) args.push('--all');
  if (noPush) args.push('--no-push');
  if (noDeploy) args.push('--no-deploy');
  if (dryRun) args.push('--dry-run');
  const r = await run('bash', [DEPLOY_SH, ...args], { timeoutMs: 15 * 60 * 1000 });
  return format(`deploy.sh ${args.join(' ')}`, r);
});

// ------------------------------------------------------------------ functions
server.registerTool('catalyst_functions_config', {
  description: 'Configure a deployed function, e.g. set its memory allocation (MB). Omit `memory` to just print current config.',
  inputSchema: {
    functionName: z.string().describe('Function name or ID, e.g. "welcome" or "task_manager"'),
    memory: z.number().int().optional().describe('Memory in MB, e.g. 128, 256, 512'),
  },
}, ({ functionName, memory }) => catalyst(['functions:config', functionName, ...(memory ? ['--memory', String(memory)] : [])]));

// ------------------------------------------------------------------ data store bulk ops
server.registerTool('catalyst_ds_export', {
  description: 'Start a bulk export (read) job for a Data Store table. Returns the job info printed by the CLI; poll with catalyst_ds_status. ' +
    'Exports land in the repo working directory as CSV/zip.',
  inputSchema: {
    table: z.string().describe('Table name or ID, e.g. "credentials"'),
    page: z.number().int().positive().optional().describe('Page number (range of rows) to fetch'),
    configPath: z.string().optional().describe('Path to an export config JSON'),
    production: z.boolean().optional().describe('Target the Production environment instead of Development'),
  },
}, ({ table, page, configPath, production }) => catalyst([
  'ds:export', '--table', table,
  ...(page ? ['--page', String(page)] : []),
  ...(configPath ? ['--config', configPath] : []),
  ...(production ? ['--production'] : []),
]));

server.registerTool('catalyst_ds_import', {
  description: 'Start a bulk import (write) job from a CSV file into a Data Store table. WRITES DATA — confirm the file and table first.',
  inputSchema: {
    file: z.string().describe('Path to the CSV file (absolute, or relative to the repo root)'),
    table: z.string().describe('Target table name or ID'),
    configPath: z.string().optional().describe('Path to an import config JSON'),
    production: z.boolean().optional().describe('Target the Production environment instead of Development'),
  },
}, ({ file, table, configPath, production }) => catalyst([
  'ds:import', file, '--table', table,
  ...(configPath ? ['--config', configPath] : []),
  ...(production ? ['--production'] : []),
]));

server.registerTool('catalyst_ds_status', {
  description: 'Show the status of a Data Store bulk import/export job.',
  inputSchema: {
    operation: z.enum(['import', 'export']),
    jobId: z.string().optional().describe('Job ID from ds_export/ds_import; omit to list recent jobs'),
    production: z.boolean().optional(),
  },
}, ({ operation, jobId, production }) => catalyst(['ds:status', operation, ...(jobId ? [jobId] : []), ...(production ? ['--production'] : [])]));

// ------------------------------------------------------------------ project resources
server.registerTool('catalyst_iac_export', {
  description: 'Export the remote project (code + configuration) from the console as a ZIP into the repo root. *.zip is gitignored.',
  inputSchema: { production: z.boolean().optional() },
}, ({ production }) => catalyst(['iac:export', ...(production ? ['--production'] : [])]));

server.registerTool('catalyst_pull', {
  description: 'Pull remote resources (functions, client, or apig) from the console into the local directory. ' +
    'Refuses to overwrite existing local files unless overwrite=true — use with care; it can clobber uncommitted work.',
  inputSchema: {
    feature: z.enum(['functions', 'client', 'apig']),
    resources: z.array(z.string()).optional().describe('Function names or client version to pull, e.g. ["welcome"]'),
    overwrite: z.boolean().optional().describe('Overwrite existing local resources'),
  },
}, ({ feature, resources, overwrite }) => catalyst([
  'pull', feature,
  ...(resources?.length ? ['--resource', resources.join(',')] : []),
  ...(overwrite ? ['--overwrite'] : []),
]));

// ------------------------------------------------------------------ start
const transport = new StdioServerTransport();
await server.connect(transport);
