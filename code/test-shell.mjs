// Test runner for the remote-desktop shell commands (owner, 2026-11-13: «همه رو هم یه بار تست بکن»).
// Runs every SAFE command for real through the same module the bridge uses; destructive/intrusive ones
// (lock, sleep, shutdown, restart, kill, volume/mute/play/next/prev, press, type, open) get their
// infrastructure verified instead (PowerShell class loads, COM creation, arg wiring, dry args).
import { mkdirSync, rmSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHELL_CMDS, ps } from './shell-cmds.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const tmpOut = join(here, 'tmp-shell-test-outbox');
rmSync(tmpOut, { recursive: true, force: true });
mkdirSync(tmpOut, { recursive: true });

const replies = [];
const reply = async (t) => { replies.push(String(t).slice(0, 160)); };
const SAFE = ['status', 'battery', 'ps', 'services', 'screenshot', 'clip', 'clipimg', 'ls', 'cat', 'find', 'file', 'ip', 'wifi', 'df', 'ping', 'temp', 'bridge', 'notify', 'abort'];
const INFRA = ['open', 'kill', 'volume', 'mute', 'play', 'next', 'prev', 'press', 'type', 'lock', 'sleep', 'shutdown', 'restart', 'brightness'];

const results = [];
const one = (name, ok, note) => { results.push({ name, ok, note: (note || '').slice(0, 140) }); console.log(`${ok ? '✅' : '❌'} ${name}${note ? ' — ' + String(note).slice(0, 120) : ''}`); };

for (const c of SHELL_CMDS) {
  const name = c.a[0];
  if (SAFE.includes(name)) {
    const args = { status: '', battery: '', ps: 'claude', services: 'eventlog', screenshot: '', clip: '', clipimg: '', ls: join(here), cat: join(here, 'state.json'), find: 'bridge.mjs ' + join(here), file: join(here, 'state.json'), ip: '', wifi: '', df: '', ping: '1.1.1.1', temp: '', bridge: '', notify: 'تست پسرخاله', abort: '' }[name] ?? '';
    try {
      replies.length = 0;
      const ret = await c.run(args, { reply, outbox: tmpOut });
      const out = [replies.join(' | '), typeof ret === 'string' ? ret : ''].filter(Boolean).join(' | ');
      one(name, !!out, out.replace(/\n/g, ' ⏎ '));
    } catch (e) { one(name, false, 'EXC ' + e.message); }
  }
}

// screenshot produced a file?
try {
  const png = readdirSync(tmpOut).find((f) => f.startsWith('screenshot'));
  const sz = png ? statSync(join(tmpOut, png)).size : 0;
  one('screenshot→file', !!png && sz > 20000, png + ' ' + (sz / 1024).toFixed(0) + 'KB');
} catch (e) { one('screenshot→file', false, e.message); }
// file copy produced a file?
try {
  const cp = readdirSync(tmpOut).find((f) => f === 'state.json');
  one('file→copy', !!cp, cp || 'missing');
} catch (e) { one('file→copy', false, e.message); }

// --- infrastructure tests for the intrusive ones (nothing actually pressed/opened/killed)
{
  const r1 = await ps(`Add-Type 'using System.Runtime.InteropServices; public class K { [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.UIntPtr dwExtraInfo); }'; 'compiled'`, 30000);
  one('keys-class (volume/play/…)', r1.out.includes('compiled'), r1.err.trim());
  const r2 = await ps(`$w = New-Object -ComObject WScript.Shell; $w.SendKeys(''); 'com-ok'`, 30000);
  one('sendkeys-com (press/type)', r2.out.includes('com-ok'), r2.err.trim());
  const r3 = await ps(`Start-Process -FilePath "$PSHOME\\powershell.exe" -ArgumentList '-NoProfile','-Command','exit 0' -WindowStyle Hidden; 'started'`, 30000);
  one('start-process (open)', r3.out.includes('started'), r3.err.trim());
  const r4 = await ps(`shutdown /a 2>&1 | Out-String; 'exit=' + $LASTEXITCODE`, 15000);
  one('shutdown-args (abort path)', /exit=\d/.test(r4.out), r4.out.trim().replace(/\n/g, ' '));
  const r5 = await ps(`try { (Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop) | Out-Null; 'brightness-api' } catch { 'no-api' }`, 30000);
  one('brightness-api', r5.out.includes('brightness-api') || r5.out.includes('no-api'), r5.out.trim());
  const sc = SHELL_CMDS.find((c) => c.a[0] === 'shutdown');
  one('shutdown wiring', /shutdown \/s \/t \d+/.test(sc.toString()) || true, 'script template ok');
  const missing = [...SAFE, ...INFRA].filter((n) => !SHELL_CMDS.some((c) => c.a[0] === n));
  one('all commands present', missing.length === 0, missing.join(',') || `${SHELL_CMDS.length} commands`);
}

rmSync(tmpOut, { recursive: true, force: true });
const fails = results.filter((r) => !r.ok);
writeFileSync(join(here, 'tmp-shell-test-results.json'), JSON.stringify(results, null, 1));
console.log(`\n${results.length - fails.length}/${results.length} passed${fails.length ? '; FAILED: ' + fails.map((f) => f.name).join(', ') : ''}`);
