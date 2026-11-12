// Eyvan (Basalam's HR portal, eyvan.app) helper for Claude. Full access, approved by the user on 2026-11-02:
// targeted commands for the colleague directory and meeting-room booking, plus a raw `call` for anything else.
// Times are Tehran local time; dates are Gregorian YYYY-MM-DD.
//
//   node eyvan.mjs find "<name>"                          colleagues: email, mobile, team, role, Gap username
//   node eyvan.mjs rooms                                  salons (buildings) and their rooms, booking rules
//   node eyvan.mjs day <date> [salon]                     all bookings of that day, per room
//   node eyvan.mjs free <date> <HH:MM> <HH:MM> [salon]    rooms free for the whole slot
//   node eyvan.mjs mine                                   my bookings and meetings I am invited to
//   node eyvan.mjs reserve <roomId> <date> <HH:MM> <HH:MM> [participant ...]   book (participants: name or user id)
//   node eyvan.mjs edit <reservationId> <roomId> <date> <HH:MM> <HH:MM>          move a booking
//   node eyvan.mjs cancel <reservationId>                 delete a booking
//   node eyvan.mjs call <GET|POST|PUT|PATCH|DELETE> </v1/path> ['<json body>']   any other endpoint (raw JSON out)
//
// Endpoints come from the eyvan.app frontend bundle (Nuxt); base https://api.eyvan.app/api.
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
// Tokens copied from the browser are URL-encoded ("id%7Csecret"); the API wants "id|secret".
const TOKEN = decodeURIComponent(env.EYVAN_TOKEN || '');
const BASE = 'https://api.eyvan.app/api';

async function api(path, { method = 'GET', query, body } = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
  const headers = { Authorization: 'Bearer ' + TOKEN, Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (r.status === 401) throw new Error('Eyvan token expired or invalid: the user must put a new EYVAN_TOKEN in .env');
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!r.ok) throw new Error(`eyvan ${method} ${path} -> ${r.status}: ${typeof data === 'string' ? data.slice(0, 300) : data.message || JSON.stringify(data).slice(0, 300)}`);
  return data;
}

// ---- directory ----
async function contacts(q, page = 1) {
  return (await api('/v1/contacts/all', { query: { q, page } })).users || {};
}

async function find(q) {
  const first = await contacts(q);
  const users = [...(first.data || [])];
  for (let p = 2; p <= Math.min(first.last_page || 1, 3); p++) users.push(...((await contacts(q, p)).data || []));
  if (!users.length) return console.log(`No colleague matches "${q}".`);
  for (const u of users) {
    const s = u.struct || {};
    console.log([
      `■ ${u.name} (user id ${u.id})`,
      s.responsibility_title || s.job?.title ? `  role: ${s.responsibility_title || s.job?.title}` : '',
      s.team?.name || s.team?.title ? `  team: ${s.team?.name || s.team?.title}` : '',
      u.email ? `  email: ${u.email}` : '',
      u.email_basalam && typeof u.email_basalam === 'string' ? `  basalam email: ${u.email_basalam}` : '',
      u.mobile ? `  mobile: ${u.mobile}` : '',
      u.certman_username ? `  gap: @${u.certman_username}` : '',
      u.is_vacation ? '  (on vacation now)' : '',
    ].filter(Boolean).join('\n'));
  }
  if ((first.total || 0) > users.length) console.log(`…${first.total - users.length} more; narrow the name.`);
}

// ---- rooms ----
const boot = () => api('/v1/room/reservation'); // rooms, salons, users, 30 days of bookings, rules
const hm = (s) => String(s).slice(0, 5);
const norm = (s) => String(s || '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[‌\s]+/g, ' ').trim().toLowerCase();

function pickSalon(b, name) {
  if (!name) return null;
  const s = b.salons.find((x) => String(x.id) === name || norm(x.name).includes(norm(name)));
  if (!s) throw new Error(`no salon "${name}"; salons: ${b.salons.map((x) => `${x.name} (${x.id})`).join(', ')}`);
  return s;
}
const roomsOf = (b, salon) => b.rooms.filter((r) => !salon || r.salon_id === salon.id);
const salonName = (b, id) => b.salons.find((s) => s.id === id)?.name || id;

function checkSlot(b, date, from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('date must be Gregorian YYYY-MM-DD');
  if (!/^\d{1,2}:\d{2}$/.test(from) || !/^\d{1,2}:\d{2}$/.test(to)) throw new Error('times must be HH:MM');
  const pad = (t) => t.padStart(5, '0');
  from = pad(from); to = pad(to);
  if (to <= from) throw new Error('end must be after start');
  const mins = (t) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
  const max = (b.roomMaxDurationForReserveInHour || 0) * 60;
  if (max && !b.canUserReserveUnlimited && mins(to) - mins(from) > max) throw new Error(`max booking length is ${b.roomMaxDurationForReserveInHour}h; split it into several bookings`);
  if (from < hm(b.startTimeOfReservation) || to > hm(b.endTimeOfReservation)) throw new Error(`bookings only between ${hm(b.startTimeOfReservation)} and ${hm(b.endTimeOfReservation)}`);
  const wd = new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  if ((b.weekends || []).includes(wd)) throw new Error(`${date} is ${wd}, a weekend`);
  return { from, to };
}
const overlaps = (ev, date, from, to) => ev.start < `${date} ${to}:00` && ev.end > `${date} ${from}:00`;

async function rooms() {
  const b = await boot();
  for (const s of b.salons) {
    console.log(`■ salon ${s.name} (id ${s.id})${s.id === b.defaultSalonId ? ' [default]' : ''}`);
    for (const r of roomsOf(b, s)) console.log(`  room ${r.id}: ${r.title}, capacity ${r.capacity}${r.description?.trim() ? ' — ' + r.description.trim() : ''}`);
  }
  console.log(`rules: ${hm(b.startTimeOfReservation)}–${hm(b.endTimeOfReservation)}, max ${b.roomMaxDurationForReserveInHour}h per booking${b.canUserReserveUnlimited ? ' (you: unlimited)' : ''}, closed: ${(b.weekends || []).join(', ')}`);
}

async function day(date, salonArg) {
  const b = await boot();
  const salon = pickSalon(b, salonArg);
  const evs = (await api('/v1/room/events')).reservations || [];
  for (const r of roomsOf(b, salon)) {
    const list = evs.filter((e) => e.resourceId === r.id && e.start.startsWith(date)).sort((a, c) => a.start.localeCompare(c.start));
    console.log(`■ ${salonName(b, r.salon_id)} / ${r.title} (room ${r.id}, cap ${r.capacity}): ${list.length ? list.map((e) => `${e.start.slice(11, 16)}–${e.end.slice(11, 16)} ${e.title} [#${e.id}]`).join(' · ') : 'free all day'}`);
  }
}

async function free(date, from, to, salonArg) {
  const b = await boot();
  ({ from, to } = checkSlot(b, date, from, to));
  const salon = pickSalon(b, salonArg);
  const evs = (await api('/v1/room/events')).reservations || [];
  const ok = roomsOf(b, salon).filter((r) => !evs.some((e) => e.resourceId === r.id && overlaps(e, date, from, to)));
  if (!ok.length) return console.log(`No room free ${date} ${from}–${to}${salon ? ' in ' + salon.name : ''}.`);
  console.log(`Free ${date} ${from}–${to}:`);
  for (const r of ok) console.log(`  room ${r.id}: ${salonName(b, r.salon_id)} / ${r.title}, capacity ${r.capacity}`);
}

async function mine() {
  const d = await api('/v1/room/reserve-list');
  const line = (x) => `#${x.id} ${x.started_at} → ${String(x.ended_at).slice(11, 16)} · ${x.room?.title || 'room ' + x.room_id}${x.user?.name ? ' · by ' + x.user.name : ''}${x.note ? ' · ' + x.note : ''}`;
  console.log('My bookings:'); for (const x of d.reservations || []) console.log('  ' + line(x));
  if (!(d.reservations || []).length) console.log('  none');
  console.log('Invited to:'); for (const x of d.invited || []) if (x.reserve) console.log('  ' + line(x.reserve));
  if (!(d.invited || []).length) console.log('  none');
}

function resolveUsers(b, names) {
  return names.map((n) => {
    if (/^\d+$/.test(n)) return +n;
    const hits = b.users.filter((u) => norm(u.name).includes(norm(n)));
    if (hits.length === 1) return hits[0].id;
    if (!hits.length) throw new Error(`no colleague named "${n}"`);
    throw new Error(`"${n}" matches several: ${hits.slice(0, 8).map((u) => `${u.name} (${u.id})`).join(', ')}; pass the user id`);
  });
}

const result = (d, okText) => {
  if (d && d.code === 1) console.log(`✅ ${d.message || okText}`);
  else { console.log(`❌ ${d?.message || 'Eyvan refused'}: ${JSON.stringify(d).slice(0, 300)}`); process.exitCode = 2; }
};

async function reserve(roomId, date, from, to, people) {
  const b = await boot();
  ({ from, to } = checkSlot(b, date, from, to));
  const room = b.rooms.find((r) => String(r.id) === String(roomId));
  if (!room) throw new Error(`no room ${roomId}; run: node eyvan.mjs rooms`);
  const participants = resolveUsers(b, people);
  const d = await api(`/v1/room/reserve/${room.id}`, { method: 'POST', body: { started_at: `${date}T${from}:00`, ended_at: `${date}T${to}:00`, participants } });
  result(d, 'booked');
  if (d?.code === 1) console.log(`   ${salonName(b, room.salon_id)} / ${room.title} · ${date} ${from}–${to}${participants.length ? ' · participants ' + participants.map((id) => b.users.find((u) => u.id === id)?.name || id).join('، ') : ''}`);
}

async function edit(id, roomId, date, from, to) {
  const b = await boot();
  ({ from, to } = checkSlot(b, date, from, to));
  result(await api(`/v1/room/reserve/edit/${id}`, { method: 'POST', body: { roomId: +roomId, started_at: `${date}T${from}:00`, ended_at: `${date}T${to}:00` } }), 'moved');
}

async function cancel(id) {
  result(await api(`/v1/room/reserve/delete/${id}`, { method: 'POST' }), 'cancelled');
}

async function call(method, path, body) {
  if (!path?.startsWith('/')) throw new Error('path must start with /, e.g. /v1/room/events');
  const d = await api(path, { method: method.toUpperCase(), body: body ? JSON.parse(body) : undefined });
  console.log(typeof d === 'string' ? d : JSON.stringify(d, null, 1).slice(0, 20000));
}

const USAGE = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//   node')).map((l) => l.slice(5)).join('\n');
const [cmd, ...a] = process.argv.slice(2);
if (!TOKEN) { console.error('EYVAN_TOKEN is missing in .env'); process.exit(1); }
try {
  switch (cmd) {
    case 'find': if (!a.length) throw 0; await find(a.join(' ').trim()); break;
    case 'rooms': await rooms(); break;
    case 'day': if (!a[0]) throw 0; await day(a[0], a.slice(1).join(' ')); break;
    case 'free': if (a.length < 3) throw 0; await free(a[0], a[1], a[2], a.slice(3).join(' ')); break;
    case 'mine': await mine(); break;
    case 'reserve': if (a.length < 4) throw 0; await reserve(a[0], a[1], a[2], a[3], a.slice(4)); break;
    case 'edit': if (a.length < 5) throw 0; await edit(...a.slice(0, 5)); break;
    case 'cancel': if (!a[0]) throw 0; await cancel(a[0]); break;
    case 'call': if (a.length < 2) throw 0; await call(a[0], a[1], a[2]); break;
    default: throw 0;
  }
} catch (e) {
  console.error(e === 0 ? 'usage:\n' + USAGE : String(e.message || e));
  process.exit(1);
}
