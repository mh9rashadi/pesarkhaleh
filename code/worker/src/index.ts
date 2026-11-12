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
  GROQ_API_KEY?: string; // Groq whisper for the laptop's voice→text (added 2026-11-12)
  GEMINI_API_KEY?: string; // Gemini voice→text for the laptop (added 2026-11-12)
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
  async poll(): Promise<{ updates: TgUpdate[]; lite: LiteLog[] }> {
    await this.ctx.storage.put("lastSeen", Date.now());
    const updates = (await this.ctx.storage.get<TgUpdate[]>("queue")) ?? [];
    const lite = (await this.ctx.storage.get<LiteLog[]>("liteUnsynced")) ?? [];
    await this.ctx.storage.put("queue", []);
    await this.ctx.storage.put("liteUnsynced", []);
    await this.ctx.storage.put("noticed", []);
    return { updates, lite };
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
}

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
  async fetch(req: Request, env: Env): Promise<Response> {
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

    // Groq relay for the laptop (2026-11-12): Groq 403s the laptop's region, Cloudflare is fine.
    //   POST /laptop/groq/transcriptions → https://api.groq.com/openai/v1/audio/transcriptions
    // Auth to the Worker is the laptop secret; the Groq key stays in the Worker.
    if (url.pathname === "/laptop/groq/transcriptions") {
      if (req.headers.get("Authorization") !== `Bearer ${env.LAPTOP_SECRET}`) {
        return new Response("forbidden", { status: 403 });
      }
      if (!env.GROQ_API_KEY) return new Response("groq key not set", { status: 503 });
      const ct = req.headers.get("Content-Type");
      return fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, ...(ct ? { "Content-Type": ct } : {}) },
        body: req.body,
      });
    }

    // Voice→text IN the Worker (2026-11-13, overnight finding): the laptop's network resets LARGE uploads
    // to Cloudflare while small requests pass (root/small POST → 200 OK, 51 KB audio POST → 10054 every
    // time). So the audio never travels from the laptop: the bridge sends only a Telegram file_id and this
    // Worker fetches the file from Telegram and calls Gemini from here (CF→TG and CF→Google are fine).
    //   POST /laptop/v2t  {"file_id": "..."}          production: fetch from Telegram → Gemini
    //                      {"audio_b64": "..."}       same, audio supplied inline (tests)
    //                      {"ping": true}             health: tiny Gemini call, no audio
    // Gemini flash first, flash-lite on 503/429. Auth: Bearer LAPTOP_SECRET.
    if (url.pathname === "/laptop/v2t") {
      if (req.headers.get("Authorization") !== `Bearer ${env.LAPTOP_SECRET}`) {
        return new Response("forbidden", { status: 403 });
      }
      if (!env.GEMINI_API_KEY) return Response.json({ ok: false, err: "gemini key not set" }, { status: 503 });
      const body = (await req.json().catch(() => ({}))) as { file_id?: string; audio_b64?: string; mime?: string; ping?: boolean };
      const b64 = (buf: ArrayBuffer) => {
        const u = new Uint8Array(buf);
        let s = "";
        for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
        return btoa(s);
      };
      const gcall = async (parts: unknown[], m: string) => {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-goog-api-key": env.GEMINI_API_KEY || "" },
          body: JSON.stringify({ contents: [{ parts }] }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 120)}`);
        const j = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
        return (j.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
      };
      const transcribe = async (data: string, mime: string) => {
        const parts = [
          { inline_data: { mime_type: mime, data } },
          { text: "این فایل صوتی فارسی را کلمه‌به‌کلمه پیاده‌کن. فقط خودِ متن گفتار را به فارسی بنویس — بدون توضیح، بدون گیومه، بدون مقدمه. کلمات پرکننده (مثل «اِممم») و تکرارها را همان‌طور که گفته شده نگه دار. اگر بخشی نامفهوم بود همان را خالی بگذار و ادامه بده." },
        ];
        try {
          return await gcall(parts, "gemini-flash-latest");
        } catch (e) {
          if (!/HTTP (429|503)/.test(String(e))) throw e;
          return await gcall(parts, "gemini-flash-lite-latest"); // flash under load → lite (2026-11-12)
        }
      };
      try {
        if (body.ping) {
          await gcall([{ text: "یک کلمه بنویس." }], "gemini-flash-lite-latest");
          return Response.json({ ok: true, ping: true });
        }
        let data = body.audio_b64 || "";
        let mime = body.mime || "audio/ogg";
        if (!data && body.file_id) {
          const g = await (await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(body.file_id)}`)).json() as { ok: boolean; description?: string; result?: { file_path: string } };
          if (!g.ok || !g.result?.file_path) return Response.json({ ok: false, err: "tg getFile: " + (g.description || "no file_path") });
          const f = await fetch(`https://api.telegram.org/file/bot${env.TG_BOT_TOKEN}/${g.result.file_path}`);
          if (!f.ok) return Response.json({ ok: false, err: "tg file " + f.status });
          const ct = f.headers.get("content-type") || "";
          mime = ct.includes("mpeg") ? "audio/mpeg" : ct.includes("mp4") ? "audio/mp4" : ct.includes("webm") ? "audio/webm" : "audio/ogg";
          data = b64(await f.arrayBuffer());
        }
        if (!data) return Response.json({ ok: false, err: "file_id or audio_b64 required" }, { status: 400 });
        const text = await transcribe(data, mime);
        return Response.json({ ok: true, text });
      } catch (e) {
        return Response.json({ ok: false, err: String(e).slice(0, 160) });
      }
    }

    // Gemini relay for the laptop (2026-11-12): Google 403s the laptop's region. Same pattern as Groq.
    //   POST /laptop/gemini/v1beta/models/<model>:generateContent
    // (Superseded for audio by /laptop/v2t above — large uploads get reset — but kept for small calls.)
    if (url.pathname.startsWith("/laptop/gemini/")) {
      if (req.headers.get("Authorization") !== `Bearer ${env.LAPTOP_SECRET}`) {
        return new Response("forbidden", { status: 403 });
      }
      if (!env.GEMINI_API_KEY) return new Response("gemini key not set", { status: 503 });
      const path = url.pathname.slice("/laptop/gemini/".length);
      if (!/^[A-Za-z0-9.:/-]+$/.test(path) || path.includes("..")) return new Response("bad path", { status: 400 });
      return fetch(`https://generativelanguage.googleapis.com/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-goog-api-key": env.GEMINI_API_KEY },
        body: req.body,
      });
    }

    return new Response("پسرخاله اینجاست 👋");
  },
} satisfies ExportedHandler<Env>;
