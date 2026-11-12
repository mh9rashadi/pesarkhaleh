// Read-only Gap (Mattermost) helper for Claude. Never posts, edits or marks anything as read.
// Usage:
//   node gap.mjs unread                  channels/DMs with unread messages
//   node gap.mjs channels                all channels and DMs you are in
//   node gap.mjs read <name|@user> [n]   last n messages (default 30) of a channel or DM
//   node gap.mjs search "<terms>"        Mattermost search (supports from:, in:, after:)
//   node gap.mjs recent [hours]          everything posted in the last N hours (default 12), read or not
//   node gap.mjs inbox [n]               last n messages received live by the bridge (inbox/)
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(here, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const { MM_URL, MM_TOKEN } = env;

async function api(path, body) {
  // Only search uses POST, and it is read-only on the server.
  const r = await fetch(MM_URL + '/api/v4' + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + MM_TOKEN, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json();
}

const me = await api('/users/me');
const teams = await api('/users/me/teams');
const users = new Map();
async function userName(id) {
  if (!users.has(id)) users.set(id, await api('/users/' + id).then((u) => u.username).catch(() => id));
  return users.get(id);
}

async function myChannels() {
  const seen = new Map();
  for (const t of teams) for (const c of await api(`/users/me/teams/${t.id}/channels`)) seen.set(c.id, c);
  return [...seen.values()];
}

async function label(c) {
  if (c.type === 'D') {
    const other = c.name.split('__').find((id) => id !== me.id) || me.id;
    return '@' + (await userName(other));
  }
  return (c.display_name || c.name) + (c.type === 'G' ? ' (group)' : '');
}

const fmt = (ts) => new Date(ts).toLocaleString('en-GB', { timeZone: 'Asia/Tehran', hour12: false });

async function printPosts(order, posts, withChannel) {
  for (const id of order) {
    const p = posts[id];
    if (p.type?.startsWith('system_')) continue;
    const ch = withChannel ? ` [${await label(await api('/channels/' + p.channel_id))}]` : '';
    const files = p.metadata?.files?.length ? ` (+${p.metadata.files.length} file)` : '';
    console.log(`${fmt(p.create_at)}${ch} ${await userName(p.user_id)}: ${p.message}${files}`);
  }
}

async function findChannel(name) {
  const all = await myChannels();
  if (name.startsWith('@')) {
    const u = await api('/users/username/' + encodeURIComponent(name.slice(1)));
    const dm = [me.id, u.id].sort().join('__');
    return all.find((c) => c.name === dm);
  }
  const n = name.toLowerCase();
  return all.find((c) => c.name.toLowerCase() === n || c.display_name?.toLowerCase() === n)
    || all.find((c) => c.display_name?.toLowerCase().includes(n));
}

const [cmd, arg, arg2] = process.argv.slice(2);
if (cmd === 'channels' || cmd === 'unread') {
  const all = await myChannels();
  const members = new Map();
  for (const t of teams) for (const m of await api(`/users/me/teams/${t.id}/channels/members`)) members.set(m.channel_id, m);
  const rows = [];
  for (const c of all) {
    const m = members.get(c.id);
    const unread = m ? Math.max(0, (c.total_msg_count_root ?? c.total_msg_count) - (m.msg_count_root ?? m.msg_count)) : 0;
    if (cmd === 'unread' && !unread && !m?.mention_count) continue;
    rows.push([c.last_post_at, `${await label(c)}  unread=${unread} mentions=${m?.mention_count || 0}  last=${fmt(c.last_post_at)}`]);
  }
  rows.sort((a, b) => b[0] - a[0]).forEach((r) => console.log(r[1]));
} else if (cmd === 'read' && arg) {
  const c = await findChannel(arg);
  if (!c) throw new Error('channel not found: ' + arg);
  const { order, posts } = await api(`/channels/${c.id}/posts?per_page=${Number(arg2) || 30}`);
  console.log(`== ${await label(c)}`);
  await printPosts(order.reverse(), posts, false);
} else if (cmd === 'search' && arg) {
  for (const t of teams) {
    const { order, posts } = await api(`/teams/${t.id}/posts/search`, { terms: arg, is_or_search: false, per_page: 40 });
    await printPosts(order, posts, true);
  }
} else if (cmd === 'recent') {
  // Everything posted in the last n hours across all channels, read or not (skips the bridge channel).
  const since = Date.now() - (Number(arg) || 12) * 3600e3;
  for (const c of (await myChannels()).filter((c) => c.last_post_at >= since && c.id !== env.CHANNEL_ID)) {
    const { order, posts } = await api(`/channels/${c.id}/posts?since=${since}`);
    const ids = order.filter((id) => posts[id].create_at >= since).sort((a, b) => posts[a].create_at - posts[b].create_at);
    if (!ids.length) continue;
    console.log(`\n== ${await label(c)}`);
    await printPosts(ids, posts, false);
  }
} else if (cmd === 'inbox') {
  const dir = join(here, 'inbox');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort() : [];
  const lines = files.flatMap((f) => readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean));
  for (const l of lines.slice(-(Number(arg) || 50))) {
    const p = JSON.parse(l);
    console.log(`${fmt(p.at)} [${p.channel}] ${p.from}: ${p.text}`);
  }
} else {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 8).join('\n'));
}
