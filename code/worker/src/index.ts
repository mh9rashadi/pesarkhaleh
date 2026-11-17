// Pesar Khaleh front door on Cloudflare.
// Telegram's webhook always lands here. While the laptop bridge is polling (heartbeat < 45s),
// updates are queued for it and the full Claude Code brain answers. Otherwise this Worker
// answers itself through the Claude API ("lite" mode) and logs the exchange so the laptop
// can catch up on what was said while it was off.
import Anthropic from "@anthropic-ai/sdk";
import { DurableObject } from "cloudflare:workers";

export interface Env {
  HUB: DurableObjectNamespace<Hub>;
  ANTHROPIC_API_KEY?: string; // unset = secretary mode
  TG_BOT_TOKEN: string;
  TG_WEBHOOK_SECRET: string;
  LAPTOP_SECRET: string;
  SONIOX_API_KEY?: string; // owner's own Soniox (2026-11-16): voice→text started from the Worker
  DIBI_BOT_TOKEN?: string; // دیبی voice→text bot (2026-11-16); runs fully in this Worker since 2026-11-17
  DIBI_ALLOWED_USERS?: string; // comma-separated Telegram user ids (default TG_OWNER_ID)
  DIBI_ALLOWED_CHATS?: string; // chats where every sender is served
  DIBI_OWNER_POST_CHATS?: string; // default TG_GROUP_ID (پسرخاله group)
  HOOSH_AUTH_TOKEN?: string; // company HooshCode (GLM) key: summaries for Dibi's long transcripts (2026-11-17)
  TG_OWNER_ID: string;
  TG_GROUP_ID?: string; // owner's private forum group
}

const LAPTOP_TIMEOUT_MS = 45_000;
const HISTORY_TURNS = 30;
const MODEL = "claude-opus-5-5";

const SYSTEM = `You are "پسرخاله" (inspired by Pesar Khaleh from Kolah Ghermezi), the personal assistant of Mohammad Hossein Rashadi (mh.rashadi).
He is a London-based student who works remotely for Basalam (an Iranian online marketplace); he writes Persian. Always call him «محمدحسین». Reply in Persian, warm and a little playful in tone, but accuracy and usefulness come first. Keep replies short; read his typos from context; don't lecture.
You are running in LITE mode: his laptop is off, so you have NO access to his files, his Gap or Telegram messages, his calendar, or his notes. Say so plainly when a request needs them, and offer to do it when the laptop is back (he can just ask again then).
You can search the web when it helps.
Replies go to Telegram as plain text: no markdown, no tables; use emoji and line breaks.`;

type TgMessage = {
  message_id: number;
  from?: { id: number };
  chat: { id: number; type: string };
  text?: string;
  caption?: string;
  photo?: { file_id: string }[];
  document?: { file_id: string; mime_type?: string; file_name?: string };
  voice?: unknown;
};
type TgUpdate = { update_id: number; message?: TgMessage; [k: string]: unknown };
type Turn = { role: "user" | "assistant"; content: string };
type LiteLog = { at: number; user: string; assistant: string };

// One Durable Object holds all state, so reads are strongly consistent (KV is not).
export class Hub extends DurableObject<Env> {
  async poll(): Promise<{ updates: TgUpdate[]; lite: LiteLog[]; dibi: DibiItem[] }> {
    await this.ctx.storage.put("lastSeen", Date.now());
    const updates = (await this.ctx.storage.get<TgUpdate[]>("queue")) ?? [];
    const lite = (await this.ctx.storage.get<LiteLog[]>("liteUnsynced")) ?? [];
    await this.ctx.storage.put("queue", []);
    await this.ctx.storage.put("liteUnsynced", []);
    await this.ctx.storage.put("noticed", []);
    return { updates, lite, dibi: await this.takeDibi() };
  }

  async laptopAlive(): Promise<boolean> {
    const last = (await this.ctx.storage.get<number>("lastSeen")) ?? 0;
    return Date.now() - last < LAPTOP_TIMEOUT_MS;
  }

  // Returns false if this update was already seen (Telegram retries slow webhooks).
  async claim(updateId: number): Promise<boolean> {
    const seen = (await this.ctx.storage.get<number[]>("seen")) ?? [];
    if (seen.includes(updateId)) return false;
    await this.ctx.storage.put("seen", [...seen.slice(-200), updateId]);
    return true;
  }

  async enqueue(u: TgUpdate): Promise<void> {
    const q = (await this.ctx.storage.get<TgUpdate[]>("queue")) ?? [];
    q.push(u);
    await this.ctx.storage.put("queue", q.slice(-500));
  }

  // Secretary mode: true the first time a chat is told "laptop is off" during this off period
  // (the list is cleared when the laptop polls again), so nobody gets the notice twice.
  async firstNotice(chatId: number): Promise<boolean> {
    const n = (await this.ctx.storage.get<number[]>("noticed")) ?? [];
    if (n.includes(chatId)) return false;
    await this.ctx.storage.put("noticed", [...n, chatId]);
    return true;
  }

  async history(): Promise<Turn[]> {
    return (await this.ctx.storage.get<Turn[]>("history")) ?? [];
  }

  async record(user: string, assistant: string): Promise<void> {
    const h = await this.history();
    h.push({ role: "user", content: user }, { role: "assistant", content: assistant });
    await this.ctx.storage.put("history", h.slice(-HISTORY_TURNS * 2));
    const lite = (await this.ctx.storage.get<LiteLog[]>("liteUnsynced")) ?? [];
    lite.push({ at: Date.now(), user, assistant });
    await this.ctx.storage.put("liteUnsynced", lite.slice(-100));
  }

  async reset(): Promise<void> {
    await this.ctx.storage.put("history", []);
  }

  // دیبی (2026-11-17): de-dupe keys (Dibi update ids, Soniox job ids) in their own list, so they can never
  // collide with the main bot's update ids.
  async claimKey(key: string): Promise<boolean> {
    const seen = (await this.ctx.storage.get<string[]>("dibiSeen")) ?? [];
    if (seen.includes(key)) return false;
    await this.ctx.storage.put("dibiSeen", [...seen.slice(-300), key]);
    return true;
  }

  // Transcripts of the owner's voices in the پسرخاله group, waiting for the laptop bridge to post them from
  // his own account (post_as_owner.py). Handed out once by takeDibi().
  async pushDibi(item: DibiItem): Promise<void> {
    const q = (await this.ctx.storage.get<DibiItem[]>("dibiQueue")) ?? [];
    q.push(item);
    await this.ctx.storage.put("dibiQueue", q.slice(-100));
  }

  async takeDibi(): Promise<DibiItem[]> {
    const q = (await this.ctx.storage.get<DibiItem[]>("dibiQueue")) ?? [];
    if (q.length) await this.ctx.storage.put("dibiQueue", []);
    return q;
  }
}

type DibiItem = { chat_id: number; message_id: number; text?: string; fail?: string };

const hub = (env: Env) => env.HUB.get(env.HUB.idFromName("main"));

async function tg(env: Env, method: string, body: unknown): Promise<any> {
  const r = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function send(env: Env, chatId: number, text: string) {
  for (let i = 0; i < text.length || i === 0; i += 4000) {
    await tg(env, "sendMessage", { chat_id: chatId, text: text.slice(i, i + 4000) || "…" });
  }
}

// Photos (and image documents) are passed to Claude as base64 images.
async function imageBlock(env: Env, fileId: string, mediaType = "image/jpeg") {
  const f = await tg(env, "getFile", { file_id: fileId });
  if (!f.ok) return null;
  const r = await fetch(`https://api.telegram.org/file/bot${env.TG_BOT_TOKEN}/${f.result.file_path}`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return {
    type: "image" as const,
    source: { type: "base64" as const, media_type: mediaType as "image/jpeg", data: btoa(bin) },
  };
}

async function answerLite(env: Env, m: TgMessage) {
  const h = hub(env);
  const text = (m.text || m.caption || "").trim();
  if (text === "/new" || text === "!new") {
    await h.reset();
    return send(env, m.chat.id, "گفتگوی تازه شروع شد. (حالت سبک؛ لپ‌تاپ خاموشه)");
  }
  if (text === "/start" || text === "/help" || text === "!help") {
    return send(env, m.chat.id, "سلام! لپ‌تاپ خاموشه، پس الان پسرخاله‌ی سبکم: چت، فکر، نوشتن، جست‌وجوی وب و دیدن عکس بلدم؛ به گپ و تلگرام و فایل‌ها دسترسی ندارم.");
  }
  if (m.voice) return send(env, m.chat.id, "ویس رو الان نمی‌تونم گوش بدم 🙈 وقتی لپ‌تاپ روشن شد دوباره بفرست، یا متنش رو بنویس.");

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  const photo = m.photo?.at(-1);
  if (photo) {
    const img = await imageBlock(env, photo.file_id);
    if (img) content.push(img);
  } else if (m.document?.mime_type?.startsWith("image/")) {
    const img = await imageBlock(env, m.document.file_id, m.document.mime_type);
    if (img) content.push(img);
  }
  content.push({ type: "text", text: text || "این رو ببین." });

  const typing = setInterval(() => tg(env, "sendChatAction", { chat_id: m.chat.id, action: "typing" }), 4500);
  await tg(env, "sendChatAction", { chat_id: m.chat.id, action: "typing" });
  let reply: string;
  try {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const history = await h.history();
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      // Server-side fallback on refusals; the SDK types may predate the "default" form.
      ...({ fallbacks: "default" } as object),
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }],
      messages: [...history, { role: "user", content }],
    });
    if (response.stop_reason === "refusal") {
      reply = "این یکی رو نمی‌تونم انجام بدم.";
    } else {
      reply = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim() || "…";
    }
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) reply = "الان شلوغه، یه دقیقه دیگه دوباره بپرس 🙏";
    else if (e instanceof Anthropic.APIError) reply = `خطا از سمت Claude (${e.status ?? "?"}). یه کم بعد دوباره امتحان کن.`;
    else reply = "یه مشکلی پیش اومد؛ دوباره امتحان کن.";
    console.error(e);
  } finally {
    clearInterval(typing);
  }
  await send(env, m.chat.id, reply);
  await h.record(photo ? `[عکس] ${text}` : text, reply);
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/telegram" && req.method === "POST") {
      if (req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TG_WEBHOOK_SECRET) {
        return new Response("forbidden", { status: 403 });
      }
      const u = (await req.json()) as TgUpdate;
      const h = hub(env);
      if (!(await h.claim(u.update_id))) return new Response("ok");
      if (await h.laptopAlive()) {
        await h.enqueue(u);
        return new Response("ok");
      }
      // Laptop is off.
      const m = u.message;
      const owner = m?.from?.id === Number(env.TG_OWNER_ID);
      if (m && owner && m.chat.type === "private" && env.ANTHROPIC_API_KEY) {
        await answerLite(env, m);
      } else if (m && (m.chat.type === "private" || (owner && m.chat.id === Number(env.TG_GROUP_ID)))) {
        // Secretary mode (no API key): keep the message for the laptop, which answers it normally when it
        // is back (owner → main brain, others → guest handler), and say so once per off period.
        await h.enqueue(u);
        if (await h.firstNotice(m.chat.id)) {
          await tg(env, "sendMessage", {
            chat_id: m.chat.id,
            ...((m as any).is_topic_message && { message_thread_id: (m as any).message_thread_id }),
            text: owner
              ? "محمدحسین، لپ‌تاپت الان خاموشه. پیامت رو نگه داشتم؛ روشنش کردی جواب می‌دم."
              : "سلام. پسرخاله الان خوابه؛ پیامتون رو نگه داشتم و وقتی برگشت جواب می‌ده.",
          });
        }
      } else if ((u as any).inline_query) {
        await tg(env, "answerInlineQuery", { inline_query_id: (u as any).inline_query.id, results: [], cache_time: 0 });
      }
      return new Response("ok");
    }

    if (url.pathname === "/laptop/poll") {
      if (req.headers.get("Authorization") !== `Bearer ${env.LAPTOP_SECRET}`) {
        return new Response("forbidden", { status: 403 });
      }
      return Response.json(await hub(env).poll());
    }

    // دیبی runs here, not on the laptop (2026-11-17, owner: the bot must work without his laptop).
    if (url.pathname === "/dibi/webhook" && req.method === "POST") return dibiWebhook(req, env, ctx);
    if (url.pathname === "/dibi/sx" && req.method === "POST") return dibiSoniox(req, env, ctx);
    // Test hook for the long-text path: POST /dibi/test-long {"chat","text"} (auth: Bearer LAPTOP_SECRET).
    if (url.pathname === "/dibi/test-long" && req.method === "POST") {
      if (req.headers.get("Authorization") !== `Bearer ${env.LAPTOP_SECRET}`) return new Response("forbidden", { status: 403 });
      const b = (await req.json()) as { chat: number; text: string; reply_to?: number };
      return Response.json(await dibiSend(env, b.chat, b.reply_to || 0, 0, b.text));
    }

    // Telegram relay for the laptop (trial, 2026-11-12): api.telegram.org is often unreachable from the
    // laptop's network, Cloudflare is not. The laptop sends Bot API calls here; the token stays in the Worker.
    //   POST /laptop/tg/<method>      → https://api.telegram.org/bot<token>/<method> (JSON or multipart, as-is)
    //   GET  /laptop/tgfile/<path>    → https://api.telegram.org/file/bot<token>/<path>
    if (url.pathname.startsWith("/laptop/tg/") || url.pathname.startsWith("/laptop/tgfile/")) {
      if (req.headers.get("Authorization") !== `Bearer ${env.LAPTOP_SECRET}`) {
        return new Response("forbidden", { status: 403 });
      }
      if (url.pathname.startsWith("/laptop/tgfile/")) {
        const path = url.pathname.slice("/laptop/tgfile/".length);
        return fetch(`https://api.telegram.org/file/bot${env.TG_BOT_TOKEN}/${path}`);
      }
      const method = url.pathname.slice("/laptop/tg/".length);
      if (!/^[A-Za-z]+$/.test(method)) return new Response("bad method", { status: 400 });
      const ct = req.headers.get("Content-Type");
      return fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/${method}`, {
        method: "POST",
        headers: ct ? { "Content-Type": ct } : {},
        body: req.body,
      });
    }

    // دیبی relay (2026-11-16): same as /laptop/tg but with the Dibi bot token.
    //   POST /dibi/tg/<method> · GET /dibi/tgfile/<path>   (auth: Bearer LAPTOP_SECRET)
    if (url.pathname.startsWith("/dibi/tg/") || url.pathname.startsWith("/dibi/tgfile/")) {
      if (req.headers.get("Authorization") !== `Bearer ${env.LAPTOP_SECRET}`) {
        return new Response("forbidden", { status: 403 });
      }
      if (!env.DIBI_BOT_TOKEN) return new Response("dibi token not set", { status: 503 });
      if (url.pathname.startsWith("/dibi/tgfile/")) {
        const path = url.pathname.slice("/dibi/tgfile/".length);
        return fetch(`https://api.telegram.org/file/bot${env.DIBI_BOT_TOKEN}/${path}`);
      }
      const method = url.pathname.slice("/dibi/tg/".length);
      if (!/^[A-Za-z]+$/.test(method)) return new Response("bad method", { status: 400 });
      const ct = req.headers.get("Content-Type");
      return fetch(`https://api.telegram.org/bot${env.DIBI_BOT_TOKEN}/${method}`, {
        method: "POST",
        headers: ct ? { "Content-Type": ct } : {},
        body: req.body,
      });
    }

    // Voice→text start IN the Worker (2026-11-16): this laptop's network kills Telegram file downloads,
    // Cloudflare does not. The laptop sends only a file_id; the Worker fetches the audio from Telegram,
    // uploads it to Soniox and creates the job, then returns the ids. The laptop polls Soniox itself
    // (small requests pass) and deletes the job + file afterwards.
    //   POST /stt/start {"file_id","bot":"dibi"|"main","speakers"?:bool,"model"?:string}
    //   → {"ok":true,"transcription_id","file_id"}   auth: Bearer LAPTOP_SECRET
    if (url.pathname === "/stt/start" && req.method === "POST") {
      if (req.headers.get("Authorization") !== `Bearer ${env.LAPTOP_SECRET}`) {
        return new Response("forbidden", { status: 403 });
      }
      if (!env.SONIOX_API_KEY) return Response.json({ ok: false, err: "soniox key not set" }, { status: 503 });
      const b = (await req.json().catch(() => ({}))) as { file_id?: string; bot?: string; speakers?: boolean; model?: string };
      const token = b.bot === "dibi" ? env.DIBI_BOT_TOKEN : env.TG_BOT_TOKEN;
      if (!b.file_id || !token) return Response.json({ ok: false, err: "bad request" }, { status: 400 });
      try {
        const gf = (await (await fetch(`https://api.telegram.org/bot${token}/getFile`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file_id: b.file_id }),
        })).json()) as { ok: boolean; result?: { file_path: string }; description?: string };
        if (!gf.ok || !gf.result) return Response.json({ ok: false, err: "getFile: " + (gf.description || "?") });
        const audio = await fetch(`https://api.telegram.org/file/bot${token}/${gf.result.file_path}`);
        if (!audio.ok) return Response.json({ ok: false, err: "download " + audio.status });
        const name = (gf.result.file_path.split("/").pop() || "audio.ogg").replace(/.oga$/i, ".ogg");
        const fd = new FormData();
        fd.append("file", new Blob([await audio.arrayBuffer()]), name);
        const H = { Authorization: `Bearer ${env.SONIOX_API_KEY}` };
        const up = await fetch("https://api.soniox.com/v1/files", { method: "POST", headers: H, body: fd });
        if (!up.ok) return Response.json({ ok: false, err: "soniox upload " + up.status + ": " + (await up.text()).slice(0, 200) });
        const fid = ((await up.json()) as { id: string }).id;
        const cfg: Record<string, unknown> = { model: b.model || "stt-async-v6", file_id: fid, language_hints: ["fa", "en"], client_reference_id: b.bot || "main" };
        if (b.speakers) cfg.enable_speaker_diarization = true;
        const tr = await fetch("https://api.soniox.com/v1/transcriptions", {
          method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify(cfg),
        });
        if (!tr.ok) return Response.json({ ok: false, err: "soniox create " + tr.status + ": " + (await tr.text()).slice(0, 200), file_id: fid });
        return Response.json({ ok: true, transcription_id: ((await tr.json()) as { id: string }).id, file_id: fid });
      } catch (e) {
        return Response.json({ ok: false, err: String(e).slice(0, 200) });
      }
    }

    return new Response("پسرخاله اینجاست 👋");
  },
} satisfies ExportedHandler<Env>;

// ───────────────────────── دیبی (Dibi) — voice→text bot, fully on Cloudflare (2026-11-17) ─────────────────────────
// Before this, Dibi ran on the owner's laptop (~/dibi-bot/dibi.mjs) and only relayed through this Worker. The owner
// asked for it to work with the laptop off, so the whole bot lives here now:
//   Telegram → POST /dibi/webhook  → fetch audio, upload to Soniox, create the job with webhook_url=/dibi/sx
//   Soniox   → POST /dibi/sx       → read the transcript, reply to the voice, delete job + file
// No state on the laptop. The one exception is the owner's own voice in the پسرخاله group: that transcript must be
// posted FROM HIS ACCOUNT (post_as_owner.py, Telethon), which only the laptop can do. If the laptop bridge is alive
// the text is queued for it (/laptop/poll → "dibi"); if not, Dibi replies as itself so the text is never lost.
// Auth: Telegram secret_token and Soniox webhook header are both derived from TG_WEBHOOK_SECRET (no new secret).
// Config (wrangler vars): DIBI_ALLOWED_USERS (default owner), DIBI_ALLOWED_CHATS, DIBI_OWNER_POST_CHATS.

const DIBI_MODEL = "stt-async-v6";
const sha256hex = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
const dibiSecret = (env: Env) => sha256hex("dibi:" + env.TG_WEBHOOK_SECRET);
const ids = (s: string | undefined) => new Set((s || "").split(",").map((x) => Number(x.trim())).filter(Boolean));

async function dtg(env: Env, method: string, body: unknown): Promise<any> {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${env.DIBI_BOT_TOKEN}/${method}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const j = (await r.json()) as any;
      if (j.ok || r.status < 500) return j;
    } catch {}
    await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
  }
  return { ok: false };
}

function dibiChunks(text: string, n = 4000): string[] {
  const out: string[] = [];
  let s = text;
  while (s.length > n) {
    let cut = s.lastIndexOf("\n", n);
    if (cut < n / 2) cut = s.lastIndexOf(" ", n);
    if (cut < n / 2) cut = n;
    out.push(s.slice(0, cut));
    s = s.slice(cut).replace(/^\s+/, "");
  }
  if (s) out.push(s);
  return out;
}

// Every part replies to the voice, so readers (call_sync.py) can collect the whole transcript.
async function dibiReply(env: Env, chat: number, replyTo: number, thread: number, text: string) {
  for (const part of dibiChunks(text)) {
    await dtg(env, "sendMessage", {
      chat_id: chat, ...(thread && { message_thread_id: thread }),
      reply_parameters: { message_id: replyTo, allow_sending_without_reply: true }, text: part,
    });
  }
}

const audioOf = (m: any) => m?.voice || m?.audio || m?.video_note
  || (m?.document && /^(audio|video)\//.test(m.document.mime_type || "") ? m.document : null);

const failText = (err: string) => /balance|402/i.test(err)
  ? "اعتبار سونیکس تموم شده؛ از console.soniox.com شارژش کن."
  : "نتونستم تبدیلش کنم، یه بار دیگه بفرست.";

async function dibiWebhook(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  if (!env.DIBI_BOT_TOKEN || !env.SONIOX_API_KEY) return new Response("dibi not configured", { status: 503 });
  if (req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== (await dibiSecret(env))) {
    return new Response("forbidden", { status: 403 });
  }
  const u = (await req.json()) as any;
  const m = u.message;
  if (!m?.chat) return new Response("ok");
  const h = hub(env);
  if (!(await h.claimKey("u" + u.update_id))) return new Response("ok"); // Telegram retry
  const ownerId = Number(env.TG_OWNER_ID);
  const users = ids(env.DIBI_ALLOWED_USERS || env.TG_OWNER_ID);
  const chats = ids(env.DIBI_ALLOWED_CHATS);
  const allowed = users.has(m.from?.id) || chats.has(m.chat.id);
  const priv = m.chat.type === "private";
  const thread = m.is_topic_message ? m.message_thread_id : 0;
  const text = (m.text || "").trim();

  if (priv && /^\/(start|help)\b/.test(text)) {
    await dibiReply(env, m.chat.id, m.message_id, 0, allowed
      ? "سلام! من دیبی‌ام 🎙️ ویس، فایل صوتی یا ویدیو‌مسیج بفرست، متنش رو برات می‌نویسم.\nتو گروه هم اگه منو اضافه کنی، ویس‌ها رو خودم می‌نویسم؛ یا روی یه ویس ریپلای کن و منو منشن کن."
      : "سلام! این ربات شخصیه و فقط برای صاحبش کار می‌کنه.");
    return new Response("ok");
  }

  let target: any = null;
  if (audioOf(m)) target = m;
  else if (m.reply_to_message && audioOf(m.reply_to_message) && /@\w*bot\b/i.test(text)) {
    const me = await dtg(env, "getMe", {});
    if (me.ok && new RegExp(`@${me.result.username}\\b`, "i").test(text)) target = m.reply_to_message;
  }
  if (!target) return new Response("ok");
  if (!allowed) {
    if (priv) await dibiReply(env, m.chat.id, m.message_id, 0, "این ربات شخصیه و فقط برای صاحبش کار می‌کنه.");
    return new Response("ok");
  }

  const a = audioOf(target);
  const ownerPost = ids(env.DIBI_OWNER_POST_CHATS || env.TG_GROUP_ID).has(m.chat.id) && target.from?.id === ownerId;
  if ((a.file_size || 0) > 20 * 1024 * 1024) {
    await dibiReply(env, m.chat.id, target.message_id, thread,
      "این فایل از ۲۰ مگابایت بزرگ‌تره و تلگرام اجازه نمی‌ده ربات دانلودش کنه. فشرده‌ترش کن یا تیکه‌تیکه بفرست.");
    return new Response("ok");
  }
  await dtg(env, "sendChatAction", { chat_id: m.chat.id, ...(thread && { message_thread_id: thread }), action: "typing" });

  // Start the Soniox job now (synchronously: no waitUntil time limit; Telegram retries are de-duped above).
  const H = { Authorization: `Bearer ${env.SONIOX_API_KEY}` };
  let fid = "";
  try {
    const gf = await dtg(env, "getFile", { file_id: a.file_id });
    if (!gf.ok) throw new Error("getFile: " + (gf.description || "?"));
    const audio = await fetch(`https://api.telegram.org/file/bot${env.DIBI_BOT_TOKEN}/${gf.result.file_path}`);
    if (!audio.ok) throw new Error("download " + audio.status);
    const name = a.file_name || (gf.result.file_path.split("/").pop() || "audio.ogg").replace(/\.oga$/i, ".ogg");
    const fd = new FormData();
    fd.append("file", new Blob([await audio.arrayBuffer()]), name);
    const up = await fetch("https://api.soniox.com/v1/files", { method: "POST", headers: H, body: fd });
    if (!up.ok) throw new Error("soniox upload " + up.status + ": " + (await up.text()).slice(0, 200));
    fid = ((await up.json()) as { id: string }).id;
    const cb = new URL("/dibi/sx", req.url);
    cb.search = new URLSearchParams({
      c: String(m.chat.id), m: String(target.message_id), t: String(thread || 0),
      s: (a.duration || 0) > 90 ? "1" : "0", o: ownerPost ? "1" : "0",
    }).toString();
    const cfg: Record<string, unknown> = {
      model: DIBI_MODEL, file_id: fid, language_hints: ["fa", "en"], client_reference_id: "dibi",
      webhook_url: cb.toString(), webhook_auth_header_name: "X-Dibi-Auth", webhook_auth_header_value: await dibiSecret(env),
    };
    if ((a.duration || 0) > 90) cfg.enable_speaker_diarization = true;
    const tr = await fetch("https://api.soniox.com/v1/transcriptions", {
      method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify(cfg),
    });
    if (!tr.ok) throw new Error("soniox create " + tr.status + ": " + (await tr.text()).slice(0, 200));
    console.log("dibi started", m.chat.id, target.message_id);
  } catch (e) {
    const err = String((e as Error).message || e).slice(0, 300);
    console.error("dibi start", err);
    if (fid) await fetch(`https://api.soniox.com/v1/files/${fid}`, { method: "DELETE", headers: H }).catch(() => {});
    await dibiDeliver(env, { chat: m.chat.id, msg: target.message_id, thread, ownerPost, fail: err });
  }
  return new Response("ok");
}

async function dibiSoniox(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  if (req.headers.get("X-Dibi-Auth") !== (await dibiSecret(env))) return new Response("forbidden", { status: 403 });
  const url = new URL(req.url);
  const p = (await req.json().catch(() => ({}))) as { id?: string; status?: string };
  if (!p.id) return new Response("ok");
  const h = hub(env);
  if (!(await h.claimKey("sx" + p.id))) return new Response("ok"); // Soniox retry
  const chat = Number(url.searchParams.get("c")), msg = Number(url.searchParams.get("m"));
  const thread = Number(url.searchParams.get("t")) || 0;
  const speakers = url.searchParams.get("s") === "1", ownerPost = url.searchParams.get("o") === "1";
  const H = { Authorization: `Bearer ${env.SONIOX_API_KEY}` };
  let fid = "";
  try {
    const job = (await (await fetch(`https://api.soniox.com/v1/transcriptions/${p.id}`, { headers: H })).json()) as any;
    fid = job.file_id || "";
    if (job.status !== "completed") throw new Error(job.error_message || "transcription " + (job.status || p.status));
    const res = (await (await fetch(`https://api.soniox.com/v1/transcriptions/${p.id}/transcript`, { headers: H })).json()) as any;
    const tokens: { text: string; speaker?: string }[] = res.tokens || [];
    let text = "";
    if (!speakers) text = (res.text || tokens.map((t) => t.text).join("")).trim();
    else {
      let cur: string | undefined;
      for (const t of tokens) {
        if (t.speaker && t.speaker !== cur) {
          cur = t.speaker;
          text += (text ? "\n\n" : "") + `گوینده ${cur}: ` + t.text.replace(/^\s+/, "");
        } else text += t.text;
      }
      text = text.trim();
    }
    console.log("dibi ok", chat, msg, text.length + "ch");
    await dibiDeliver(env, { chat, msg, thread, ownerPost, text: text || "(متنی شنیده نشد)" });
  } catch (e) {
    const err = String((e as Error).message || e).slice(0, 300);
    console.error("dibi sx", err);
    await dibiDeliver(env, { chat, msg, thread, ownerPost, fail: err });
  } finally {
    await fetch(`https://api.soniox.com/v1/transcriptions/${p.id}`, { method: "DELETE", headers: H }).catch(() => {});
    if (fid) await fetch(`https://api.soniox.com/v1/files/${fid}`, { method: "DELETE", headers: H }).catch(() => {});
  }
  return new Response("ok");
}

// Owner's voice in the پسرخاله group + laptop alive → the bridge posts it as him (or answers the failure once).
// Everything else (or laptop off) → Dibi replies as itself.
async function dibiDeliver(env: Env, d: { chat: number; msg: number; thread: number; ownerPost: boolean; text?: string; fail?: string }) {
  if (d.ownerPost && (await hub(env).laptopAlive())) {
    await hub(env).pushDibi({ chat_id: d.chat, message_id: d.msg, ...(d.text ? { text: d.text } : { fail: d.fail || "" }) });
    return;
  }
  await dibiSend(env, d.chat, d.msg, d.thread, d.text ?? failText(d.fail || ""));
}

// Long transcripts (2026-11-17, owner): text that does not fit in ONE Telegram message (4096 chars) is sent as a
// .txt file replying to the voice, with a short summary as the caption (GLM via HooshCode). If the summary fails,
// the caption says so; the file always goes out. If the file upload fails, fall back to chunked messages.
const TG_MAX = 4096, CAPTION_MAX = 1024;
async function dibiSend(env: Env, chat: number, replyTo: number, thread: number, text: string) {
  if (text.length <= TG_MAX) { await dibiReply(env, chat, replyTo, thread, text); return { mode: "text" }; }
  await dtg(env, "sendChatAction", { chat_id: chat, ...(thread && { message_thread_id: thread }), action: "upload_document" });
  const summary = await dibiSummary(env, text);
  let caption = "📄 متن کامل توی فایل.\n\n" + (summary ? "خلاصه:\n" + summary : "(خلاصه آماده نشد.)");
  let extra = "";
  if (caption.length > CAPTION_MAX) { extra = caption; caption = "📄 متن کامل توی فایل؛ خلاصه پیام بعدی."; }
  const stamp = new Date(Date.now() + 3.5 * 3600_000).toISOString().slice(0, 16).replace("T", "_").replace(":", "-");
  const fd = new FormData();
  fd.append("chat_id", String(chat));
  if (thread) fd.append("message_thread_id", String(thread));
  if (replyTo) fd.append("reply_parameters", JSON.stringify({ message_id: replyTo, allow_sending_without_reply: true }));
  fd.append("caption", caption);
  fd.append("document", new Blob(["\uFEFF" + text], { type: "text/plain; charset=utf-8" }), `dibi_${stamp}.txt`);
  let ok = false;
  for (let i = 0; i < 3 && !ok; i++) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${env.DIBI_BOT_TOKEN}/sendDocument`, { method: "POST", body: fd });
      const j = (await r.json()) as any;
      ok = !!j.ok;
      if (!ok) console.error("dibi sendDocument", j.description);
      if (!ok && r.status < 500) break;
    } catch (e) { console.error("dibi sendDocument", (e as Error).message); }
  }
  if (!ok) { await dibiReply(env, chat, replyTo, thread, text); return { mode: "chunks", summary: !!summary }; }
  if (extra) await dibiReply(env, chat, replyTo, thread, extra);
  return { mode: "file", summary: !!summary };
}

async function dibiSummary(env: Env, text: string): Promise<string> {
  if (!env.HOOSH_AUTH_TOKEN) return "";
  try {
    const r = await fetch("https://claude.flearning.ir/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.HOOSH_AUTH_TOKEN, Authorization: `Bearer ${env.HOOSH_AUTH_TOKEN}`,
        "anthropic-version": "2023-06-01", "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "glm-5.3-flash", max_tokens: 3000,
        system: "You summarise transcripts of voice notes and calls. Write in the transcript's own language (usually Persian). " +
          "Give a faithful, concise summary: 3 to 7 short bullet lines starting with «• », covering the main points, decisions, " +
          "numbers, names and action items. No intro, no title, no markdown. Hard limit: 700 characters.",
        messages: [{ role: "user", content: "متن پیاده‌شده:\n\n" + text.slice(0, 120_000) }],
      }),
      signal: AbortSignal.timeout(90_000),
    });
    const j = (await r.json()) as any;
    if (!r.ok) { console.error("dibi summary", r.status, JSON.stringify(j).slice(0, 200)); return ""; }
    const out = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    return out.replace(/\*\*/g, "").slice(0, 900);
  } catch (e) { console.error("dibi summary", (e as Error).message); return ""; }
}
