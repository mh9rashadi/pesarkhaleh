// Keeps bridge.mjs running. Exit code 75 = planned restart. If the bridge dies within
// 30s of starting, its code is rolled back to the last copy that stayed up (.last-good/).
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const here = dirname(fileURLToPath(import.meta.url));
const CODE = ['bridge.mjs', 'gap.mjs'];
const goodDir = join(here, '.last-good');
const brokenDir = join(here, '.broken');
const log = (...a) => console.log(new Date().toISOString(), '[supervisor]', ...a);

const env = Object.fromEntries(
  readFileSync(join(here, '.env'), 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const notify = (text) => fetch(env.WEBHOOK_URL, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, username: 'Claude' }),
}).catch(() => {});

const copyAll = (from, to) => {
  mkdirSync(to, { recursive: true });
  for (const f of CODE) if (existsSync(join(from, f))) copyFileSync(join(from, f), join(to, f));
};
const same = () => CODE.every((f) => !existsSync(join(goodDir, f))
  || readFileSync(join(goodDir, f), 'utf8') === readFileSync(join(here, f), 'utf8'));

await new Promise((resolve) => {
  const lock = net.createServer();
  lock.once('error', () => { log('already running, exiting'); process.exit(0); });
  lock.listen(47812, '127.0.0.1', resolve);
});

let crashes = 0;
function start() {
  const began = Date.now();
  const child = spawn(process.execPath, [join(here, 'bridge.mjs')], { cwd: here, stdio: 'inherit', windowsHide: true });
  const healthy = setTimeout(() => { copyAll(here, goodDir); crashes = 0; }, 30000);
  child.on('exit', async (code) => {
    clearTimeout(healthy);
    log('bridge exited with', code);
    if (code === 0) process.exit(0); // another instance owns the lock
    if (code === 75) return start();
    const early = Date.now() - began < 30000;
    if (early && existsSync(goodDir) && !same()) {
      copyAll(here, join(brokenDir, String(Date.now())));
      copyAll(goodDir, here);
      log('rolled back to last good code');
      await notify('⚠️ کد جدید پل بالا نیامد. به آخرین نسخه‌ی سالم برگشتم؛ نسخه‌ی خراب در `.broken/` است.');
      return start();
    }
    crashes++;
    const wait = Math.min(5000 * crashes, 300000);
    if (crashes === 3) await notify('⚠️ پل چند بار پشت سر هم کرش کرد؛ `bridge.log` را ببین.');
    setTimeout(start, wait);
  });
}
start();
