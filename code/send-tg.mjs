// Bot-DM sender: sends a message FROM THE BOT (@PesarKhaleh_bot) to a chat id.
// Built for the nightly Kourosh report (brain/kourosh-report/, approved by the owner in the
// "Report to kourosh" topic). This never touches the user's own Telegram account.
// Usage: node send-tg.mjs <chat_id> <utf8-text-file>
// Mirrors bridge.mjs tgFetch: worker relay first (api.telegram.org is often blocked here), direct fallback.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(here, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);

const [chatId, file] = process.argv.slice(2);
if (!/^\d+$/.test(chatId || '') || !file) {
  console.error('usage: node send-tg.mjs <chat_id> <text-file>');
  process.exit(2);
}
const text = readFileSync(file, 'utf8').replace(/^﻿/, '').replace(/\s+$/, '');
if (!text) { console.error('error: empty text'); process.exit(2); }

const relay = env.TG_VIA_WORKER === '1' && env.WORKER_URL && env.LAPTOP_SECRET;
async function call(method, body) {
  if (relay) {
    try {
      const r = await fetch(`${env.WORKER_URL}/laptop/tg/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.LAPTOP_SECRET },
        body: JSON.stringify(body),
      });
      if (r.headers.get('content-type')?.includes('json')) return await r.json();
    } catch { /* fall through to direct */ }
  }
  return (await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })).json();
}

let ok = true;
for (let i = 0; i < text.length; i += 3900) {
  const res = await call('sendMessage', { chat_id: Number(chatId), text: text.slice(i, i + 3900) });
  if (!res.ok) { console.error('error:', res.description || 'send failed'); ok = false; break; }
  console.log('sent message_id', res.result?.message_id);
}
process.exit(ok ? 0 : 1);
