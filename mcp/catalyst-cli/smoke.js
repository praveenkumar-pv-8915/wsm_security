// Minimal end-to-end check: spawn the server, do initialize → tools/list → tools/call whoami.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const transport = new StdioClientTransport({ command: 'node', args: [path.join(here, 'server.js')] });
const client = new Client({ name: 'smoke', version: '0.0.0' });
await client.connect(transport);
const { tools } = await client.listTools();
console.log('tools:', tools.map((t) => t.name).join(', '));
const call = process.argv[2] || 'catalyst_whoami';
const args = process.argv[3] ? JSON.parse(process.argv[3]) : {};
const res = await client.callTool({ name: call, arguments: args });
console.log(`--- ${call} (isError=${!!res.isError}) ---`);
console.log(res.content.map((c) => c.text).join('\n'));
await client.close();
