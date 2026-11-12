// Points the Telegram bot's webhook at the Worker (node set-webhook.mjs), or removes it so the
// laptop can long-poll Telegram directly again (node set-webhook.mjs off).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(here, '..', '.env'), 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const api = (method, body) => fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/${method}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then((r) => r.json());

const r = process.argv[2] === 'off'
  ? await api('deleteWebhook', {})
  : await api('setWebhook', {
    url: env.WORKER_URL + '/telegram',
    secret_token: env.TG_WEBHOOK_SECRET,
    allowed_updates: ['message', 'inline_query', 'chosen_inline_result', 'callback_query'],
  });
console.log(r.ok ? 'ok: ' + r.description : 'failed: ' + r.description);
const info = await api('getWebhookInfo', {});
console.log('webhook:', info.result.url || '(none)', '| pending:', info.result.pending_update_count, '| last error:', info.result.last_error_message || '-');
