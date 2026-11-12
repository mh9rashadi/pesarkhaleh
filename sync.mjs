// Copies the live Pesar Khaleh code into this skill's code/ folder, then commits and pushes the skill repo.
// Usage: node sync.mjs "what changed"
import { cpSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const live = process.env.PESARKHALEH_DIR || 'C:\\Users\\M.H.Rashadi\\gap-claude-bridge';
const dest = join(here, 'code');
// Secrets (.env) and logs stay out; so do coworkers' messages, notes about them, people's ids/sessions
// (state.json, guests/), the user's own files (hw*) and runtime junk. .env.example documents every key;
// the secret values stay only on the laptop.
const skip = new Set(['.git', '.env', 'bridge.log', 'bridge.log.1', 'node_modules', 'inbox', 'brain', 'uploads', 'outbox',
  '.last-good', '.broken', '.wrangler', 'restart.flag', 'state.json', 'guests']);
const skipName = (n) => skip.has(n) || /^hw\d+/i.test(n) || /\.bak/.test(n);

if (!existsSync(live)) throw new Error('live code not found: ' + live);
rmSync(dest, { recursive: true, force: true });
cpSync(live, dest, { recursive: true, filter: (src) => !skipName(basename(src)) });

const git = (...args) => execFileSync('git', args, { cwd: here, encoding: 'utf8' }).trim();
git('add', '-A');
if (!git('status', '--porcelain')) { console.log('nothing changed'); process.exit(0); }
git('commit', '-q', '-m', `${process.argv[2] || 'Sync Pesar Khaleh'}\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`);
git('push', '-q', '-u', 'origin', 'HEAD');
console.log('pushed:', git('log', '--oneline', '-1'));
