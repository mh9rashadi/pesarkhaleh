// Copies the Worker's secrets from ../.env into Cloudflare (wrangler secret put), printing names only.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(here, '..', '.env'), 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);

for (const key of ['TG_BOT_TOKEN', 'TG_WEBHOOK_SECRET', 'LAPTOP_SECRET', 'ANTHROPIC_API_KEY']) {
  if (!env[key]) { console.log(`${key}: missing in .env, skipped`); continue; }
  const r = spawnSync('npx', ['wrangler', 'secret', 'put', key], {
    cwd: here, input: env[key], encoding: 'utf8', shell: true,
  });
  console.log(`${key}: ${r.status === 0 ? 'ok' : 'FAILED ' + (r.stderr || r.stdout).split('\n').filter((l) => /error/i.test(l)).join(' ').slice(0, 200)}`);
}
