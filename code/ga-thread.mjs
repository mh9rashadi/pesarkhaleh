// GA-only conversation with @a.rajabi (Ali Asghar Rajabi's AI assistant) in ONE Gap thread.
// User-approved 2026-11-11: Claude may write automatically in the DM with @a.rajabi, only about
// setting up Google Analytics for Parda, and only inside a single thread.
// Usage:
//   node ga-thread.mjs send "<text>"   post in the thread (first call starts it). Refuses if our last
//                                       thread message is still unanswered (pass --force to override).
//   node ga-thread.mjs wait [minutes]  wait for a new reply from them (default 60), print it, exit.
//   node ga-thread.mjs show [n]        print the last n messages of the thread (default 20).
// State: ga-thread.json (root post id + last seen time). Gitignored-safe: no secrets inside.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
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
const PEER = 'a.rajabi';
const stateFile = join(here, 'ga-thread.json');
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};
const save = () => writeFileSync(stateFile, JSON.stringify(state, null, 2));

async function api(path, opts = {}) {
  const r = await fetch(MM_URL + '/api/v4' + path, {
    method: opts.method || 'GET',
    headers: { Authorization: 'Bearer ' + MM_TOKEN, 'Content-Type': 'application/json' },
    body: opts.body && JSON.stringify(opts.body),
  });
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json();
}

const me = await api('/users/me');
const peer = await api('/users/username/' + PEER);
const dm = await api('/channels/direct', { method: 'POST', body: [me.id, peer.id] });
if (dm.type !== 'D') throw new Error('not a DM');

const fmt = (ts) => new Date(ts).toLocaleString('en-GB', { timeZone: 'Asia/Tehran', hour12: false });

async function threadPosts() {
  if (!state.root) return [];
  const { order, posts } = await api(`/posts/${state.root}/thread`);
  return order.map((id) => posts[id]).sort((a, b) => a.create_at - b.create_at);
}

const [cmd, arg, flag] = process.argv.slice(2);
if (cmd === 'send' && arg) {
  const thread = await threadPosts();
  const last = thread.at(-1);
  if (last && last.user_id === me.id && flag !== '--force') {
    console.error('REFUSED: our last thread message is still unanswered. Run `wait` first.');
    process.exit(2);
  }
  const p = await api('/posts', {
    method: 'POST',
    body: { channel_id: dm.id, message: arg, ...(state.root ? { root_id: state.root } : {}) },
  });
  if (!state.root) state.root = p.id;
  state.lastSeen = p.create_at;
  save();
  console.log(`sent ${p.id} in thread ${state.root} at ${fmt(p.create_at)}`);
} else if (cmd === 'wait') {
  const deadline = Date.now() + (Number(arg) || 60) * 60e3;
  const since = state.lastSeen || Date.now();
  // Optional 3rd arg: regex; only messages matching it end the wait (others in the DM are ignored).
  const match = flag ? new RegExp(flag, 'i') : null;
  while (Date.now() < deadline) {
    const { order, posts } = await api(`/channels/${dm.id}/posts?since=${since}`);
    const fresh = order.map((id) => posts[id])
      .filter((p) => p.user_id === peer.id && p.create_at > since && !p.type?.startsWith('system_'))
      .filter((p) => !match || match.test(p.message))
      .sort((a, b) => a.create_at - b.create_at);
    if (fresh.length) {
      // Follow them: if they reply in a thread, that thread becomes ours; else thread under their post.
      const lastP = fresh.at(-1);
      if (!state.root) state.root = lastP.root_id || lastP.id;
      else if (lastP.root_id && lastP.root_id !== state.root) state.root = lastP.root_id;
      state.lastSeen = lastP.create_at;
      save();
      for (const p of fresh) console.log(`${fmt(p.create_at)} ${PEER}${p.root_id ? ' (thread)' : ''}: ${p.message}`);
      process.exit(0);
    }
    await new Promise((r) => setTimeout(r, 30e3));
  }
  console.log('TIMEOUT: no reply yet');
} else if (cmd === 'show') {
  for (const p of (await threadPosts()).slice(-(Number(arg) || 20)))
    console.log(`${fmt(p.create_at)} ${p.user_id === me.id ? 'me' : PEER}: ${p.message}`);
} else {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(0, 9).join('\n'));
}
