// Claude helper for Pesar Khaleh when it runs on GLM: one short task goes to Claude Sonnet, which has what GLM
// lacks (better judgement and Persian; on the personal login also Google Calendar/Gmail/Drive connectors and
// claude.ai skills such as Word/PDF/Excel/PowerPoint). Stateless; the answer is printed for the caller.
//
//   node claude-helper.mjs "<short, self-contained task with every fact it needs>"
//
// Since 2026-11-02 the personal login rejects headless runs ("403 Non-interactive use isn't supported").
// Then the helper retries on HooshCode's hosted claude-sonnet-5-5, which runs headless but has no Google connectors.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const task = process.argv.slice(2).join(' ').trim();
if (!task) { console.log('usage: node claude-helper.mjs "<task>"'); process.exit(1); }

const here = dirname(fileURLToPath(import.meta.url));
const dotenv = Object.fromEntries(readFileSync(join(here, '.env'), 'utf8').split(/\r?\n/)
  .map((l) => l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)).filter(Boolean)
  .map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]));

const SYS = 'You are a helper called by another agent (Pesar Khaleh), not talking to the user. Do only the given task, with your tools if needed. Reply with the result only, at most 10 lines, plain text, in the language of the task.';
const NO_GOOGLE = ' If the task needs Google Calendar, Gmail or Google Drive/Docs, you do not have them here: reply exactly NO_GOOGLE and nothing else.';

function run(backend) {
  const env = { ...process.env, CAVEMAN_DEFAULT_MODE: 'off' };
  delete env.ANTHROPIC_BASE_URL;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.CLAUDE_CONFIG_DIR; // always the personal config, never a company (iclaude) one
  let args = ['-p', '--model', 'sonnet', '--output-format', 'json', '--max-turns', '15', '--permission-mode', 'auto',
    '--append-system-prompt', SYS];
  if (backend === 'hoosh') {
    env.ANTHROPIC_BASE_URL = dotenv.HOOSH_BASE_URL;
    env.ANTHROPIC_AUTH_TOKEN = dotenv.HOOSH_AUTH_TOKEN;
    // HooshCode needs real model names, and has no permission classifier for auto mode
    args = ['-p', '--model', 'claude-sonnet-5-5', '--output-format', 'json', '--max-turns', '15', '--permission-mode', 'dontAsk',
      '--allowedTools', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Skill', 'Bash(python:*)', 'Bash(node:*)',
      '--append-system-prompt', SYS + NO_GOOGLE];
  }
  return new Promise((res) => {
    const p = spawn(join(process.env.USERPROFILE || '', '.local', 'bin', 'claude.exe'), args,
      { cwd: process.env.USERPROFILE, windowsHide: true, env });
    let out = '';
    const timer = setTimeout(() => p.kill(), 5 * 60e3);
    p.stdout.on('data', (d) => (out += d));
    p.on('close', (code) => {
      clearTimeout(timer);
      try { res(JSON.parse(out)); } catch { res({ is_error: true, subtype: `exit ${code}`, result: '' }); }
    });
    p.stdin.end(task);
  });
}

let j = await run('subscription');
if (j.is_error && /Non-interactive use/i.test(j.result || '') && dotenv.HOOSH_AUTH_TOKEN) j = await run('hoosh');
if (!j.is_error && String(j.result).trim() === 'NO_GOOGLE') {
  console.log('[claude helper] Google (Calendar/Gmail/Drive) is unreachable from here: the personal Claude login no longer accepts headless runs. Tell محمدحسین in one line and give him a ready prompt to paste into his personal Claude window.');
} else console.log(j.is_error ? `[claude helper error: ${j.subtype}] ${j.result || ''}` : j.result);
