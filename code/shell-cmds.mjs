// Remote-desktop shell commands for the Pesar Khaleh bridge (2026-11-13). Kept in its own module so
// the bridge imports it AND the test runner can exercise every command without loading the whole bridge.
import { spawn, execFile } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const killTree = (p) => process.platform === 'win32' ? execFile('taskkill', ['/pid', String(p.pid), '/T', '/F'], () => {}) : p.kill('SIGTERM');

// --- Remote-desktop topic (owner, 2026-11-13): a topic whose name says remote/desktop is a DIRECT Windows
// shell. Messages (typed or transcribed voices) first match a table of practical shortcuts (status,
// screenshot, volume, shutdown, …); anything else runs as PowerShell verbatim. No AI brain in the loop.
// Only the owner can write there anyway (others are ignored by tgUpdate). Destructive commands need a
// literal "force " prefix; output is capped; 120 s timeout.
export const shellTopicName = (name) => /remote|shell|دسکتاپ|شل|دستور/i.test(name || '');
// One PowerShell run, silent: returns {out, err, code}. Used by shortcuts and by raw runShell.
export function ps(script, timeoutMs = 120000, cwd = process.env.USERPROFILE || '.') {
  return new Promise((resolve) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '[Console]::OutputEncoding=[Text.Encoding]::UTF8; ' + script],
      { cwd, windowsHide: true });
    let out = '', err = '', done = false;
    const t = setTimeout(() => { if (!done) { done = true; try { killTree(p); } catch {} resolve({ out, err, code: 'timeout' }); } }, timeoutMs);
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => { if (done) return; done = true; clearTimeout(t); resolve({ out: '', err: e.message, code: 'error' }); });
    p.on('close', (code) => { if (done) return; done = true; clearTimeout(t); resolve({ out, err, code }); });
  });
}
const KEYS_CSHARP = `Add-Type 'using System.Runtime.InteropServices; public class K { [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.UIntPtr dwExtraInfo); }';`;
const pressVk = (vk, times = 1) => ps(KEYS_CSHARP + ` 1..${times} | ForEach-Object { [K]::keybd_event(${vk},0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 30; [K]::keybd_event(${vk},0,2,[UIntPtr]::Zero) }`, 30000);
const clipStr = (s) => s.length > 3000 ? s.slice(0, 1500) + '\n…[حذف ' + (s.length - 3000) + ' کاراکتر]…\n' + s.slice(-1500) : s;
// Practical shortcuts: a = aliases (single word, EN+FA; ZWNJ-insensitive), h = help line.
// run(arg, ctx) → Promise<string|void>; ctx = {reply, outbox}. Files to send: copy into ctx.outbox.
export const SHELL_CMDS = [
  { a: ['status', 'وضعیت'], h: '`status` — باتری، CPU، RAM، دیسک، آپ‌تایم، IP', run: async () => {
    const r = await ps(`$b=Get-CimInstance Win32_Battery; $o=Get-CimInstance Win32_OperatingSystem; $c=Get-CimInstance Win32_Processor|Select -First 1; $d=Get-PSDrive C; $chg=@{1='روی باتری';2='روی برق';11='نیمه‌شارج'}[[int]$b.BatteryStatus]; "باتری: $($b.EstimatedChargeRemaining)% ($chg)"; "CPU: $($c.LoadPercentage)% RAM آزاد: $([math]::Round($o.FreePhysicalMemory/1MB,1))GB/$([math]::Round($o.TotalVisibleMemorySize/1MB,1))GB"; "دیسک C: $([math]::Round($d.Free/1GB))GB آزاد از $([math]::Round(($d.Used+$d.Free)/1GB))GB"; "روشن از: $($o.LastBootUpTime.ToString('yyyy-MM-dd HH:mm')) ($([math]::Round(((Get-Date)-$o.LastBootUpTime).TotalHours,1)) ساعت)"; $ip=(Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.IPAddress -notlike '169.*' -and $_.InterfaceAlias -notlike '*Loopback*'} | Select -First 1).IPAddress; "IP: $ip"`, 45000);
    return clipStr(r.out.trim() || '[stderr] ' + r.err.trim());
  } },
  { a: ['battery', 'باتری'], h: '`battery` — وضعیت باتری', run: async () => {
    const r = await ps(`Get-CimInstance Win32_Battery | ForEach-Object { "باتری: $($_.EstimatedChargeRemaining)% · وضعیت شماره $($_.BatteryStatus)" }`, 30000);
    return r.out.trim() || 'اطلاعات باتری پیدا نشد (دسکتاپ؟).';
  } },
  { a: ['ps', 'پروسه', 'پروسه‌ها'], h: '`ps [نام]` — پروسه‌ها (پرکارترین) یا جستجوی نام', run: async (arg) => {
    const r = arg
      ? await ps(`Get-Process ${JSON.stringify(arg)} -ErrorAction SilentlyContinue | Select Name,Id,@{n='CPU(s)';e={[math]::Round($_.CPU,0)}},@{n='RAM(MB)';e={[math]::Round($_.WorkingSet/1MB,0)}} | Format-Table -Auto | Out-String`, 30000)
      : await ps(`Get-Process | Sort CPU -Desc | Select -First 12 Name,Id,@{n='CPU(s)';e={[math]::Round($_.CPU,0)}},@{n='RAM(MB)';e={[math]::Round($_.WorkingSet/1MB,0)}} | Format-Table -Auto | Out-String`, 30000);
    return clipStr(r.out.trim()) || 'چیزی پیدا نشد.';
  } },
  { a: ['kill', 'ببند'], h: '`kill <نام پروسه>` — بستن یک برنامه', run: async (arg) => {
    if (!arg) return 'نام پروسه را بده: `kill chrome`';
    const r = await ps(`Stop-Process -Name ${JSON.stringify(arg.split(/\s+/)[0])} -Force -ErrorAction Continue; Get-Process ${JSON.stringify(arg.split(/\s+/)[0])} -ErrorAction SilentlyContinue | Measure-Object | ForEach-Object { if ($_.Count -eq 0) { 'بسته شد.' } else { "هنوز $($_.Count) نمونه باز است." } }`, 30000);
    return r.out.trim() || '(اجرا شد)';
  } },
  { a: ['services', 'سرویس‌ها'], h: '`services [نام]` — سرویس‌های ویندوز', run: async (arg) => {
    const r = await ps(`Get-Service ${arg ? JSON.stringify('*' + arg + '*') : ''} | Select -First 25 Name,Status | Format-Table -Auto | Out-String`, 30000);
    return clipStr(r.out.trim()) || 'پیدا نشد.';
  } },
  { a: ['screenshot', 'اسکرین', 'اسکرین‌شات', 'اسکرینشات'], h: '`screenshot` — عکس کل صفحه (همه مانیتورها) همین‌جا', run: async (arg, ctx) => {
    mkdirSync(ctx.outbox, { recursive: true });
    const f = join(ctx.outbox, 'screenshot-' + Date.now() + '.png');
    const r = await ps(`Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.SystemInformation]::VirtualScreen; $bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.X,$b.Y,0,0,$bmp.Size); $bmp.Save('${f.replace(/\\/g, '\\\\')}',[System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose(); 'ok'`, 60000);
    if (r.out.includes('ok')) return '📸 عکس صفحه گرفته شد؛ می‌فرستم.';
    return 'نشد: ' + (r.err.trim() || r.out.trim() || 'ناشناخته').slice(0, 200);
  } },
  { a: ['clip', 'کلیپ‌بورد'], h: '`clip` — متن کلیپ‌بورد', run: async () => {
    const r = await ps('Get-Clipboard -Raw', 20000);
    return clipStr(r.out.trim()) || '(کلیپ‌بورد متن ندارد — عکسش با clipimg)';
  } },
  { a: ['clipimg', 'عکس‌کلیپ', 'عکس‌کلیپ‌بورد'], h: '`clipimg` — عکس داخل کلیپ‌بورد را بفرست', run: async (arg, ctx) => {
    mkdirSync(ctx.outbox, { recursive: true });
    const f = join(ctx.outbox, 'clip-' + Date.now() + '.png');
    const r = await ps(`Add-Type -AssemblyName System.Windows.Forms; $i=[System.Windows.Forms.Clipboard]::GetImage(); if ($i) { $i.Save('${f.replace(/\\/g, '\\\\')}',[System.Drawing.Imaging.ImageFormat]::Png); 'ok' } else { 'noimg' }`, 30000);
    if (r.out.includes('ok')) return '🖼 عکس کلیپ‌بورد ذخیره شد؛ می‌فرستم.';
    return 'کلیپ‌بورد عکس ندارد.';
  } },
  { a: ['open', 'بازکن'], h: '`open <برنامه|مسیر|لینک>` — باز کردن', run: async (arg) => {
    if (!arg) return 'چی باز کنم؟ مثل: `open notepad` یا `open https://example.com`';
    const r = await ps(`Start-Process ${JSON.stringify(arg)}; 'ok'`, 30000);
    return r.out.includes('ok') ? 'باز شد: ' + arg : 'نشد: ' + (r.err.trim() || '').slice(0, 150);
  } },
  { a: ['ls', 'فایل‌ها'], h: '`ls [مسیر]` — لیست فایل‌ها', run: async (arg) => {
    const r = await ps(`Get-ChildItem ${arg ? JSON.stringify(arg) : '.'} | Select Mode,LastWriteTime,Length,Name | Format-Table -Auto | Out-String -Width 200`, 30000);
    return clipStr(r.out.trim()) || 'خالی یا پیدا نشد.';
  } },
  { a: ['cat', 'بخوان'], h: '`cat <مسیر>` — آخر ۳۰ خط فایل', run: async (arg) => {
    if (!arg) return 'مسیر فایل را بده.';
    const r = await ps(`Get-Content ${JSON.stringify(arg)} -Tail 30 -ErrorAction Continue | Out-String`, 30000);
    return clipStr(r.out.trim()) || clipStr('[stderr] ' + r.err.trim());
  } },
  { a: ['find', 'پیدا'], h: '`find <نام> [مسیر]` — جستجوی فایل (عمق ۸)', run: async (arg) => {
    const [name, dir] = arg.split(/\s+(?=\S)/);
    if (!name) return 'چی پیدا کنم؟ مثل: `find report C:\\Users`';
    const r = await ps(`Get-ChildItem -Path ${JSON.stringify(dir || 'C:\\Users\\M.H.Rashadi')} -Recurse -Depth 8 -Filter ${JSON.stringify('*' + name + '*')} -ErrorAction SilentlyContinue | Select -First 20 FullName | Format-Table -HideTableHeaders | Out-String -Width 250`, 90000);
    return clipStr(r.out.trim()) || 'چیزی پیدا نشد.';
  } },
  { a: ['file', 'بفرست'], h: '`file <مسیر>` — فایلی از لپ‌تاپ را همین‌جا بفرست', run: async (arg, ctx) => {
    if (!arg || !existsSync(arg)) return 'مسیر فایل درست نیست.';
    mkdirSync(ctx.outbox, { recursive: true });
    copyFileSync(arg, join(ctx.outbox, basename(arg)));
    return '📎 ' + basename(arg) + ' می‌فرستم.';
  } },
  { a: ['dl', 'دانلود'], h: '`dl <لینک>` — دانلود به Downloads', run: async (arg) => {
    if (!/^https?:\/\//.test(arg || '')) return 'لینک را بده: `dl https://…`';
    const name = (arg.split('/').pop() || 'download').split('?')[0].slice(0, 60) || 'download';
    const dst = join(process.env.USERPROFILE || '', 'Downloads', name);
    const r = await ps(`Invoke-WebRequest ${JSON.stringify(arg)} -OutFile ${JSON.stringify(dst)} -UseBasicParsing; 'ok ' + (Get-Item ${JSON.stringify(dst)}).Length`, 90000);
    return r.out.trim().startsWith('ok') ? '⬇️ ذخیره شد: ' + dst + ' (' + r.out.trim().slice(3) + ' بایت)' : 'نشد: ' + (r.err.trim() || '').slice(0, 150);
  } },
  { a: ['ip', 'آی‌پی'], h: '`ip` — IP های سیستم', run: async () => {
    const r = await ps(`Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.IPAddress -notlike '169.*' -and $_.InterfaceAlias -notlike '*Loopback*'} | ForEach-Object { "$($_.InterfaceAlias): $($_.IPAddress)" }`, 30000);
    return r.out.trim() || 'IP پیدا نشد.';
  } },
  { a: ['wifi', 'وای‌فای'], h: '`wifi` — وضعیت وای‌فای', run: async () => {
    const r = await ps(`netsh wlan show interfaces`, 30000);
    const keep = r.out.split('\n').filter((l) => /State|SSID|Signal|Receive|Transmit|Authentication/i.test(l)).join('\n');
    return clipStr(keep || r.out.trim() || 'وای‌فای قطع است.');
  } },
  { a: ['df', 'دیسک'], h: '`df` — جا و حجم دیسک‌ها', run: async () => {
    const r = await ps(`Get-Volume | Where-Object DriveLetter | Sort DriveLetter | ForEach-Object { "$($_.DriveLetter): $([math]::Round($_.SizeRemaining/1GB))GB آزاد از $([math]::Round($_.Size/1GB))GB" }`, 30000);
    return r.out.trim() || 'پیدا نشد.';
  } },
  { a: ['ping', 'پینگ'], h: '`ping <host>` — تست اتصال', run: async (arg) => {
    if (!arg) return 'کی رو پینگ کنم؟ مثل: `ping 1.1.1.1`';
    const r = await ps(`Test-Connection ${JSON.stringify(arg.split(/\s+/)[0])} -Count 3 -ErrorAction Continue | ForEach-Object { "$($_.Address): $($_.ResponseTime)$($_.Latency)ms" } | Out-String`, 60000);
    return clipStr(r.out.trim() || 'جواب نداد: ' + (r.err.trim() || '').slice(0, 100));
  } },
  { a: ['temp', 'دما'], h: '`temp` — دمای CPU (اگر سنسور باشد)', run: async () => {
    const r = await ps(`try { [math]::Round((Get-CimInstance -Namespace root/WMI -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop | Select -First 1).CurrentTemperature/10 - 273.15) } catch { 'na' }`, 30000);
    return r.out.trim() === 'na' || !r.out.trim() ? 'سنسور دما در دسترس نیست.' : '🌡 دما: ' + r.out.trim() + '°C';
  } },
  { a: ['volume', 'صدا'], h: '`volume <0-100>` — میزان صدا', run: async (arg) => {
    const n = Math.max(0, Math.min(100, Number(arg) || 50));
    await pressVk(0xAE, 50); // down to (near) zero, then up in steps of 2
    await pressVk(0xAF, Math.round(n / 2));
    return '🔊 صدا حدود ' + n + '٪ (تقریبی، با کلیدهای صدا).';
  } },
  { a: ['mute', 'سکوت'], h: '`mute` — قطع/وصل صدا (toggle)', run: async () => { await pressVk(0xAD); return '🔇 صدا toggle شد.'; } },
  { a: ['play', 'پخش'], h: '`play` — پخش/توقف موزیک', run: async () => { await pressVk(0xB3); return '⏯ پخش/توقف.'; } },
  { a: ['next', 'بعدی'], h: '`next` — تراک بعدی', run: async () => { await pressVk(0xB0); return '⏭ بعدی.'; } },
  { a: ['prev', 'قبلی'], h: '`prev` — تراک قبلی', run: async () => { await pressVk(0xB1); return '⏮ قبلی.'; } },
  { a: ['brightness', 'نور'], h: '`brightness <0-100>` — روشنایی صفحه', run: async (arg) => {
    const n = Math.max(0, Math.min(100, Number(arg) || 50));
    const r = await ps(`try { (Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop).WmiSetBrightness(1,${n}); 'ok' } catch { 'na' }`, 30000);
    return r.out.includes('ok') ? '☀️ روشنایی ' + n + '٪.' : 'روشنایی از دستور پشتیبانی نشد (مانیتور خارجی؟).';
  } },
  { a: ['notify', 'اعلان'], h: '`notify <متن>` — پیام روی صفحه لپ‌تاپ', run: async (arg) => {
    if (!arg) return 'چه متنی روی صفحه نشان بدهم؟';
    await ps(`(New-Object -ComObject WScript.Shell).Popup(${JSON.stringify(arg.slice(0, 300))}, 30, 'پسرخاله', 64) | Out-Null`, 45000);
    return '📣 روی صفحه نشان داده شد (۳۰ ثانیه).';
  } },
  { a: ['press', 'کلید'], h: '`press <ترکیب>` — کلید روی پنجره‌ی فعال (ctrl+s، alt+f4، enter…)', run: async (arg) => {
    if (!arg) return 'مثل: `press ctrl+s` یا `press enter`';
    const m = arg.toLowerCase().match(/^(ctrl|alt|shift)\s*\+\s*(.+)$/);
    const pre = m ? ({ ctrl: '^', alt: '%', shift: '+' })[m[1]] : '';
    const key = m ? m[2] : arg.toLowerCase();
    const sk = ({ enter: '{ENTER}', tab: '{TAB}', esc: '{ESC}', space: ' ' })[key] || (/(^f\d+$)/.test(key) ? '{' + key.toUpperCase() + '}' : (pre ? pre + key : key));
    const r = await ps(`(New-Object -ComObject WScript.Shell).SendKeys(${JSON.stringify(sk)})`, 20000);
    return r.err.trim() ? 'نشد: ' + r.err.trim().slice(0, 100) : '⌨️ فرستاده شد: ' + arg;
  } },
  { a: ['type', 'تایپ'], h: '`type <متن>` — تایپ در پنجره‌ی فعال (فارسی را کیبورد باید ساپورت کند)', run: async (arg) => {
    if (!arg) return 'چه تایپ کنم؟';
    const safe = arg.replace(/[+^%~(){}[\]]/g, '{$&}');
    const r = await ps(`(New-Object -ComObject WScript.Shell).SendKeys(${JSON.stringify(safe)})`, 20000);
    return r.err.trim() ? 'نشد (متن با کاراکتر خاص؟): ' + r.err.trim().slice(0, 100) : '⌨️ تایپ شد.';
  } },
  { a: ['lock', 'قفل'], h: '`lock` — قفل کردن ویندوز', run: async () => { ps('rundll32.exe user32.dll,LockWorkStation', 15000); return '🔒 قفل شد.'; } },
  { a: ['sleep', 'خواب'], h: '`sleep` — حالت خواب', run: async () => { ps('rundll32.exe powrprof.dll,SetSuspendState 0,1,0', 15000); return '😴 خواب.'; } },
  { a: ['shutdown', 'خاموش'], h: '`shutdown [ثانیه=۶۰]` — خاموش کردن · `abort` برای لغو', run: async (arg) => {
    const t = Math.max(0, Number(arg) || 60);
    ps(`shutdown /s /t ${t} /c "پسرخاله: دستور محمدحسین"`, 15000);
    return t === 0 ? '⏻ خاموش می‌شود.' : '⏻ خاموش تا ' + t + ' ثانیه دیگر (`abort` لغو می‌کند).';
  } },
  { a: ['restart', 'ری‌استارت'], h: '`restart [ثانیه=۶۰]` — ری‌استارت · `abort` برای لغو', run: async (arg) => {
    const t = Math.max(0, Number(arg) || 60);
    ps(`shutdown /r /t ${t} /c "پسرخاله: دستور محمدحسین"`, 15000);
    return t === 0 ? '🔄 ری‌استارت می‌شود.' : '🔄 ری‌استارت تا ' + t + ' ثانیه دیگر (`abort` لغو می‌کند).';
  } },
  { a: ['abort', 'لغو'], h: '`abort` — لغو خاموش/ری‌استارت زمان‌بندی‌شده', run: async () => { const r = await ps('shutdown /a', 15000); return r.err.trim() ? 'چیزی برای لغو نبود.' : '✅ لغو شد.'; } },
  { a: ['bridge', 'پل'], h: '`bridge` — سلامت خود پسرخاله (لاگ و پروسه‌ها)', run: async () => {
    const r = await ps(`Get-Process node,claude -ErrorAction SilentlyContinue | Group Name | ForEach-Object { "$($_.Name): $($_.Count)" }`, 30000);
    const tail = readFileSync(join(here, 'bridge.log'), 'utf8').trim().split('\n').slice(-8).join('\n');
    return 'پروسه‌ها:\n' + (r.out.trim() || '-') + '\n\nآخر لاگ:\n' + clipStr(tail);
  } },
];
export const SHELL_HELP = [
  '🖥️ **شل ویندوز از راه دور** — هر پیام این تاپیک یک دستور است (متن یا ویس، فارسی یا انگلیسی). هرچه پایین نیست، عیناً PowerShell اجرا می‌شود.',
  '',
  '**وضعیت سیستم**',
  '`status` باتری/CPU/RAM/دیسک/آپ‌تایم · `battery` باتری · `temp` دمای CPU · `ps` پروسه‌های پرکار · `ps <نام>` جستجو · `kill <نام>` بستن · `services [نام]` سرویس‌ها · `bridge` سلامت خود پسرخاله',
  '',
  '**صفحه و صدا**',
  '`screenshot` عکس کل صفحه همین‌جا · `clipimg` عکس کلیپ‌بورد · `clip` متن کلیپ‌بورد · `volume 40` میزان صدا · `mute` قطع/وصل · `play`/`next`/`prev` موزیک · `brightness 70` روشنایی · `notify <متن>` پیام روی صفحه',
  '',
  '**فایل و برنامه**',
  '`open <برنامه|لینک|مسیر>` باز کردن · `ls [مسیر]` لیست · `cat <مسیر>` آخر ۳۰ خط · `find <نام> [مسیر]` جستجو · `file <مسیر>` فایل را همین‌جا بفرست · `dl <لینک>` دانلود',
  '',
  '**شبکه**',
  '`ip` آی‌پی‌ها · `wifi` وضعیت وای‌فای · `df` دیسک‌ها · `ping <host>` تست اتصال',
  '',
  '**کنترل ویندوز**',
  '`press ctrl+s` کلید در پنجره‌ی فعال · `type <متن>` تایپ · `lock` قفل · `sleep` خواب · `shutdown [ثانیه]` خاموش · `restart [ثانیه]` ری‌استارت · `abort` لغو',
  '',
  '**دستور خام PowerShell**',
  'مثل `Get-Date` یا `ipconfig /all` — هرچه شناخته نشود عیناً اجرا می‌شود. خروجی طولانی بریده می‌شود؛ کار طولانی را با `Start-Process` جدا بیاورید.',
  'دستورهای فارسی هم همین‌ها هستند: وضعیت، باتری، پروسه‌ها، ببند، اسکرین، صدا، سکوت، پخش، بعدی، قبلی، نور، اعلان، کلید، تایپ، قفل، خواب، خاموش، ری‌استارت، لغو، آی‌پی، وای‌فای، دیسک، پینگ، دما، فایل‌ها، بخوان، پیدا، بفرست، دانلود، بازکن، سرویس‌ها، پل.',
].join('\n');
export async function runShell(cmdText, reply) {
  const hard = /^\s*(format|diskpart|cipher)\b/i.test(cmdText);
  if (hard && !/^\s*force\s/i.test(cmdText)) {
    return reply('⛔ این دستور تخریب‌فوری است؛ اگر مطمئنی اولش کلمه‌ی `force` را بگذار: `force ' + cmdText.trim() + '`');
  }
  const text = (/^\s*force\s/i.test(cmdText) ? cmdText.replace(/^\s*force\s/i, '') : cmdText);
  const { out, err, code } = await ps(text, 120000);
  if (code === 'timeout') return reply('⏱ بیش از ۱۲۰ ثانیه طول کشید؛ کشته شد. برای کار طولانی: `Start-Process` یا `Start-Job`.');
  const body = clipStr((out || '').trim() + (err.trim() ? (out.trim() ? '\n' : '') + '[stderr] ' + clipStr(err.trim()) : ''));
  return reply('`PS> ' + text.trim().slice(0, 200) + '`\n' + (body || '(بدون خروجی)') + (typeof code === 'number' && code ? `\n_exit ${code}_` : ''));
}

