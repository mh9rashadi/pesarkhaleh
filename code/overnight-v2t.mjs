// Overnight agent (2026-11-13, owner: «برو تا صبح درستش کن و صبح گزارش بده») — why do voice transcriptions
// die on the way to Cloudflare, and can we make them reliably fast?
// Every 8 minutes until 08:00 laptop-local it measures, on the SAME real voice file:
//   1. GET  worker root                     (is Cloudflare itself reachable, small request)
//   2. POST gemini relay, tiny prompt       (does a small POST survive)
//   3. python probe: default vs IPv4-pinned POST of the full audio payload (address-family hypothesis)
//   4. the REAL path: transcribe.py on the voice (now includes fresh-connection retries)
// Findings land in overnight-v2t.log (JSONL). Decision rule: if IPv4 wins by >=30 points and reaches >=60%
// success while V2T_FORCE4 is off, flip it on in .env + restart.flag + notify the topic once.
// At the end (08:00) it writes brain/v2t-morning-report-<date>.md and sends a short report to the
// «Dev pesarkhaleh» topic through the Worker relay. Everything is one JSONL line per cycle.
import { execFile, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(here, '.env'), 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const WORKER = env.WORKER_URL, AUTH = env.LAPTOP_SECRET;
const PY = existsSync(join(process.env.USERPROFILE || '', 'AppData', 'Local', 'Programs', 'Python', 'Python314', 'python.exe'))
  ? join(process.env.USERPROFILE || '', 'AppData', 'Local', 'Programs', 'Python', 'Python314', 'python.exe') : 'python';
const LOG = join(here, 'overnight-v2t.log');
const VOICE = 'uploads/tg-1037/file_14.oga'; // the 47af voice that failed
const TOPIC = 794; // Dev pesarkhaleh
const GROUP = Number(env.TG_GROUP_ID);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
const log = (o) => appendFileSync(LOG, JSON.stringify({ t: now(), ...o }) + '\n');
console.log = (...a) => appendFileSync(LOG, JSON.stringify({ t: now(), agent: a.join(' ') }) + '\n');

async function timedFetch(url, opts = {}, ms = 40000) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
    return { ok: r.ok, status: r.status, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, err: String(e.cause?.code || e.cause?.message || e.message).slice(0, 60) };
  }
}

async function notify(text) {
  for (let i = 0; i < 2; i++) {
    const r = await timedFetch(`${WORKER}/laptop/tg/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + AUTH },
      body: JSON.stringify({ chat_id: GROUP, message_thread_id: TOPIC, text }),
    }, 30000);
    if (r.ok) return true;
    await sleep(5000);
  }
  return false;
}

function pyProbe() {
  return new Promise((resolve) => {
    execFile(PY, [join(here, 'overnight_pytest.py'), join(here, 'overnight_payload.json')], {
      windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024,
      env: { ...process.env, GEMINI_URL: env.GEMINI_URL, GEMINI_AUTH: env.GEMINI_AUTH },
    }, (err, out) => {
      if (err) return resolve({ err: err.killed ? 'timeout' : err.message.slice(0, 60) });
      try { resolve(JSON.parse(out.trim().split('\n').pop())); } catch { resolve({ err: 'parse' }); }
    });
  });
}

function realRun() {
  return new Promise((resolve) => {
    execFile(PY, [join(here, 'transcribe.py'), join(here, VOICE)], {
      windowsHide: true, timeout: 110000, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, GEMINI_API_KEY: env.GEMINI_API_KEY, GEMINI_URL: env.GEMINI_URL, GEMINI_AUTH: env.GEMINI_AUTH },
    }, (err, out) => {
      if (err) return resolve({ ok: false, code: err.code });
      try {
        const j = JSON.parse(out.trim().split('\n').pop());
        resolve({ ok: !!j.text, engine: j.engine, attempts: (j.attempts || []).length });
      } catch { resolve({ ok: false, code: 'parse' }); }
    });
  });
}

const rate = (xs) => { xs = xs.filter((x) => x !== null); return xs.length ? xs.filter(Boolean).length / xs.length : null; };

// --- prepare the exact failing payload once
const { GEMINI_AUTH, GEMINI_URL } = env;
const audio = readFileSync(join(here, VOICE));
const payload = { contents: [{ parts: [
  { inline_data: { mime_type: 'audio/ogg', data: audio.toString('base64') } },
  { text: 'یک کلمه بنویس.' },
] }] };
writeFileSync(join(here, 'overnight_payload.json'), JSON.stringify(payload));

const stopAt = new Date(); stopAt.setHours(8, 0, 0, 0);
if (Date.now() >= stopAt.getTime()) stopAt.setDate(stopAt.getDate() + 1); // next 08:00, never 31 h away
const samples = { root: [], small: [], v2t: [], pyDef: [], pyV4: [], e2e: [] };
let fixApplied = false, notifiedFix = false;
console.log(`overnight v2t agent up; ${Math.round((stopAt - Date.now()) / 60000)} minutes to 08:00; payload ${(audio.length / 1024).toFixed(0)} KB`);

let cycle = 0;
while (Date.now() < stopAt.getTime()) {
  cycle++;
  const row = { c: cycle };
  try {
    row.root = await timedFetch(`${WORKER}/`, {}, 15000);
    row.small = await timedFetch(`${GEMINI_URL}/v1beta/models/gemini-flash-lite-latest:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + GEMINI_AUTH, 'X-goog-api-key': GEMINI_AUTH },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'یک کلمه بنویس.' }] }] }),
    }, 30000);
    row.v2t = await timedFetch(`${WORKER}/laptop/v2t`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + AUTH },
      body: JSON.stringify({ ping: true }),
    }, 45000); // the NEW production path (worker-side Telegram→Gemini), health-checked
    row.py = await pyProbe();
    row.e2e = await realRun();
  } catch (e) { row.fatal = String(e).slice(0, 80); }
  log(row);
  samples.root.push(row.root?.ok ?? null);
  samples.small.push(row.small?.ok ?? null);
  samples.v2t.push(row.v2t?.ok ?? null);
  samples.pyDef.push(row.py?.def?.ok ?? null);
  samples.pyV4.push(row.py?.v4?.ok ?? null);
  samples.e2e.push(row.e2e?.ok ?? null);

  // Decision: flip on IPv4 pinning if it clearly beats the default (from cycle 5, once).
  if (!fixApplied && cycle >= 5) {
    const d = rate(samples.pyDef), v = rate(samples.pyV4);
    if (v !== null && d !== null && v >= 0.6 && v - d >= 0.3) {
      let txt = readFileSync(join(here, '.env'), 'utf8');
      if (!/^V2T_FORCE4=/m.test(txt)) txt += '\n# Overnight agent 2026-11-13: IPv4 clearly beat the default for the Gemini relay\nV2T_FORCE4=1\n';
      writeFileSync(join(here, '.env'), txt);
      writeFileSync(join(here, 'restart.flag'), 'overnight: enable V2T_FORCE4');
      fixApplied = true;
      console.log(`FIX: V2T_FORCE4=1 (def ${(d * 100).toFixed(0)}% vs v4 ${(v * 100).toFixed(0)}%)`);
      if (!notifiedFix) {
        notifiedFix = true;
        await notify(`🔧 ایجنت شبانه: مشکل پیدا شد — اتصال‌های IPv4 به کلادفلر سالم‌اند ولی مسیر پیش‌فرض ریست می‌شود. IPv4 قفل شد (${(v * 100).toFixed(0)}٪ موفق در برابر ${(d * 100).toFixed(0)}٪). تبدیل ویس از حالا باید پایدار باشد؛ گزارش کامل صبح.`);
      }
    }
  }
  const min = samples.e2e.filter((x) => x !== null).length;
  if (cycle >= 6 && min % 12 === 0) {
    const e = rate(samples.e2e);
    await notify(`🌙 گزارش میانی ایجنت شبانه (چرخه ${cycle}): مسیر واقعی ویس ${(e * 100).toFixed(0)}٪ موفق. ${fixApplied ? 'فیکس IPv4 فعال است.' : 'هنوز فیکس IPv4 لازم نشده.'}`);
  }
  await sleep(Math.max(60000, 8 * 60000 - (Date.now() % 8000)));
}

// --- morning report
const pct = (xs) => { const r = rate(xs); return r === null ? 'نداده' : (r * 100).toFixed(0) + '٪'; };
const lines = readFileSync(LOG, 'utf8').trim().split('\n').slice(-120);
const fails = {};
for (const l of lines) { try { const j = JSON.parse(l); const e = j.py?.def?.err || j.root?.err || j.small?.err; if (e) fails[e] = (fails[e] || 0) + 1; } catch {} }
const topFails = Object.entries(fails).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k} ×${n}`).join(' · ') || 'چیز خاصی نه';
const dateTag = new Date().toISOString().slice(0, 10);
const report = [
  `# گزارش صبح ایجنت شبانه ویس→متن (${dateTag})`,
  '',
  `- چرخه‌های تست: ${cycle} (هر ۸ دقیقه، روی همان ویس واقعی)`,
  `- کلادفلر (درخواست کوچک): ${pct(samples.root)}`,
  `- پست کوچک به Gemini: ${pct(samples.small)}`,
  `- مسیر جدید worker (v2t): ${pct(samples.v2t)}`,
  `- پست کامل صدا، مسیر پیش‌فرض: ${pct(samples.pyDef)}`,
  `- پست کامل صدا، IPv4: ${pct(samples.pyV4)}`,
  `- مسیر واقعی تبدیل (با retryهای جدید): ${pct(samples.e2e)}`,
  `- فیکس اعمال‌شده: ${fixApplied ? 'V2T_FORCE4=1 (قفل IPv4)' : 'فعلاً فقط retryهای خودکار؛ IPv4 لازم نشد یا برنده نبود'}`,
  `- خطاهای رایج: ${topFails}`,
  '',
  'نتیجه‌ی عملی: ' + (rate(samples.e2e) >= 0.8
    ? 'تبدیل ویس عملاً پایدار است (۸۰٪+). اگر باز هم «تایپ کن» دیدی، علت چیزی جز این نمونه‌ها نبوده.'
    : rate(samples.e2e) >= 0.5
      ? 'تبدیل ویس در اکثر مواقع کار می‌کند؛ پنجره‌های قطعی شبکه گاهی می‌گیرند. گام بعدی: کش کردن ویس و تبدیل دوباره‌ی خودکار بعد از باز شدن شبکه.'
      : 'شبکه به کلادفلر در طول شب واقعاً ناپایدار بود؛ گام بعدی پیشنهادی: صف‌کردن ویس‌ها و تبدیل با تاخیر وقتی شبکه باز شد، یا آپلود تکه‌تکه.'),
  '',
  `لاگ خام: overnight-v2t.log (${lines.length} خط آخر نگه داشته شده).`,
].join('\n');
const reportPath = join(here, 'brain', `v2t-morning-report-${dateTag}.md`);
writeFileSync(reportPath, report);
console.log('morning report written: ' + reportPath);
await notify(`☀️ گزارش شبانه ویس آمده:\n- مسیر واقعی: ${pct(samples.e2e)} موفق\n- IPv4 در برابر پیش‌فرض: ${pct(samples.pyV4)} / ${pct(samples.pyDef)}\n- فیکس: ${fixApplied ? 'IPv4 قفل شد' : 'retry خودکار'}\nگزارش کامل در ${reportPath}`);
for (const f of ['overnight_payload.json']) { try { unlinkSync(join(here, f)); } catch {} }
