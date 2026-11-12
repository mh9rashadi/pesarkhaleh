# Voice → text for the Pesar Khaleh bridge (2026-11-12). Replaces the خانوم جلسه‌ای round-trip:
# the bridge downloads the voice and runs this script; the transcript becomes the message itself.
# Usage: python transcribe.py <audio/video file>
# Env: GROQ_API_KEY (optional — tried first: whisper-large-v3-turbo via Groq, fast + cheapest at scale),
#      V2T_MODEL (local faster-whisper model, default large-v3-turbo), V2T_LANG (default fa).
# stdout on success: one JSON line {"engine": "groq|whisper", "text": "..."}; exit 3 if both engines fail.
# Everything on stderr is diagnostics only. Python 3.14, deps: httpx (system) + faster_whisper (system).
import json
import os
import sys


def groq(path):
    # Direct api.groq.com by default; GROQ_URL/GROQ_AUTH route through the Cloudflare Worker relay
    # (/laptop/groq/transcriptions) when the laptop's region is blocked by Groq.
    key = os.environ.get("GROQ_API_KEY", "").strip()
    url = os.environ.get("GROQ_URL", "").strip() or "https://api.groq.com/openai/v1/audio/transcriptions"
    auth = os.environ.get("GROQ_AUTH", "").strip() or key
    if not auth:
        return None
    import httpx

    with open(path, "rb") as f:
        r = httpx.post(
            url,
            headers={"Authorization": "Bearer " + auth},
            # Full v3 (not turbo): meaningfully better on Persian; API speed makes the cost irrelevant.
            data={"model": os.environ.get("GROQ_MODEL") or "whisper-large-v3", "language": "fa", "response_format": "json"},
            files={"file": (os.path.basename(path), f, "application/octet-stream")},
            timeout=90,
        )
    r.raise_for_status()
    return (r.json().get("text") or "").strip() or None


def gemini(path):
    # Gemini audio transcription (best Persian quality, free tier). GEMINI_URL/GEMINI_AUTH route through
    # the Worker relay when the laptop's region is blocked by Google. Audio goes inline as base64.
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    base = os.environ.get("GEMINI_URL", "").strip() or "https://generativelanguage.googleapis.com"
    auth = os.environ.get("GEMINI_AUTH", "").strip() or key
    model = os.environ.get("GEMINI_MODEL") or "gemini-flash-latest"
    if not auth:
        return None
    import base64
    import httpx

    mime = {
        "oga": "audio/ogg", "ogg": "audio/ogg", "opus": "audio/ogg", "mp3": "audio/mpeg",
        "m4a": "audio/mp4", "mp4": "audio/mp4", "wav": "audio/wav", "webm": "audio/webm",
    }.get(path.rsplit(".", 1)[-1].lower(), "audio/ogg")
    with open(path, "rb") as f:
        data = base64.b64encode(f.read()).decode()
    prompt = {"contents": [{"parts": [
        {"inline_data": {"mime_type": mime, "data": data}},
        {"text": "این فایل صوتی فارسی را کلمه‌به‌کلمه پیاده‌کن. فقط خودِ متن گفتار را به فارسی بنویس — بدون توضیح، بدون گیومه، بدون مقدمه. کلمات پرکننده (مثل «اِممم») و تکرارها را همان‌طور که گفته شده نگه دار. اگر بخشی نامفهوم بود همان را خالی بگذار و ادامه بده."},
    ]}]}
    # Bounded ladder (must fit the bridge's 240s): flash → flash-lite (503s under load, verified 2026-11-12).
    # Transport resets (the laptop's network drops TLS to Cloudflare intermittently) get one quick retry;
    # if the network is dead we bail to the local engine instead of grinding through timeouts.
    import time

    last = None
    for m in [model, "gemini-flash-lite-latest"]:
        transport_fail = 0
        for attempt in range(2):
            try:
                r = httpx.post(
                    f"{base}/v1beta/models/{m}:generateContent",
                    # X-goog-api-key for direct calls; Authorization Bearer is what the Worker relay checks.
                    headers={"X-goog-api-key": auth, "Authorization": "Bearer " + auth},
                    timeout=30, json=prompt,
                )
                r.raise_for_status()
                return (r.json()["candidates"][0]["content"]["parts"][0]["text"] or "").strip() or None
            except httpx.HTTPStatusError as e:
                last = e
                print("gemini(%s) HTTP %s" % (m, e.response.status_code), file=sys.stderr)
                break  # busy/gone — next model
            except Exception as e:  # noqa: BLE001 — connection reset: quick retry, then give up on clouds
                last = e
                transport_fail += 1
                print("gemini(%s) try %s failed: %s" % (m, attempt + 1, e), file=sys.stderr)
                if transport_fail >= 2:
                    print("gemini: network to the relay looks dead, falling back", file=sys.stderr)
                    raise last
                time.sleep(4)
    raise last


def whisperd(path):
    # The warm local server (transcribe-server.py, spawned by the bridge): model already in RAM, no cold load.
    url = os.environ.get("V2T_LOCAL_URL", "").strip() or "http://127.0.0.1:47475/stt"
    import httpx

    with open(path, "rb") as f:
        r = httpx.post(url, content=f.read(), headers={"X-V2T-Lang": os.environ.get("V2T_LANG") or "fa"}, timeout=240)
    r.raise_for_status()
    j = r.json()
    if not j.get("ok"):
        raise RuntimeError(j.get("err") or "stt server error")
    return (j.get("text") or "").strip() or None


def whisper(path):
    # PyAV >= 19 dropped the `metadata_errors` kwarg that faster-whisper 1.2.1 still passes to av.open()
    # (it only suppressed noisy metadata warnings, so dropping it is safe).
    import av

    _open = av.open
    if not getattr(av, "_v2t_patched", False):
        av.open = lambda *a, **k: _open(*a, **{x: y for x, y in k.items() if x != "metadata_errors"})
        av._v2t_patched = True
    from faster_whisper import WhisperModel

    # Ordered ladder: the configured/big model first; "small" is the always-cached safety net (e.g. while
    # the big model is still downloading on first use, or if its cache gets cleared).
    models = [os.environ.get("V2T_MODEL") or "large-v3-turbo", "small"]
    last_err = None
    for name in models:
        try:
            model = WhisperModel(name, device="cpu", compute_type="int8")
            segments, _info = model.transcribe(path, language=os.environ.get("V2T_LANG") or "fa", vad_filter=True)
            return "".join(s.text for s in segments).strip() or None
        except Exception as e:  # noqa: BLE001
            last_err = e
            print("whisper(%s) failed: %s" % (name, e), file=sys.stderr)
    raise last_err


def main():
    # Persian text on a Windows pipe defaults to cp1252 and dies; force UTF-8 both ways.
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    if len(sys.argv) < 2 or not os.path.exists(sys.argv[1]):
        sys.exit(2)
    path = sys.argv[1]
    text, engine = None, None
    attempts = []  # per-engine timings for the bridge's trace (!trace): {"e": name, "ms": …, "ok"/"err"}
    import time

    def attempt(name, fn):
        t0 = time.time()
        try:
            t = fn(path)
        except Exception as e:  # noqa: BLE001 — one engine failing must not kill the others
            attempts.append({"e": name, "ms": round((time.time() - t0) * 1000), "err": str(e)[:80]})
            print("%s failed: %s" % (name, e), file=sys.stderr)
            return None
        attempts.append({"e": name, "ms": round((time.time() - t0) * 1000), "ok": bool(t)})
        return t

    # V2T_CLOUD=0 (bridge circuit breaker: relay unreachable) → local engines only, no ~50 s of resets.
    cloud = os.environ.get("V2T_CLOUD", "1") != "0"
    engines = ([("gemini", gemini), ("groq", groq)] if cloud else []) + [("whisperd", whisperd), ("whisper", whisper)]
    for name, fn in engines:
        text = attempt(name, fn)
        if text:
            engine = name
            break
    if not text:
        sys.exit(3)
    print(json.dumps({"engine": engine, "text": text, "attempts": attempts}, ensure_ascii=False))


if __name__ == "__main__":
    main()
