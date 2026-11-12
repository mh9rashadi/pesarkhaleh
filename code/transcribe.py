# Voice → text for the Pesar Khaleh bridge. Gemini ONLY (owner, 2026-11-13): every voice must come back
# fast with Gemini, and if Gemini can't be reached the bridge says "type it instead" — no slow local
# fallback (the local whisper cost ~26 s per short voice and its Persian was far worse).
# Usage: python transcribe.py <audio file>
# Env: GEMINI_API_KEY (or GEMINI_AUTH for the Worker relay), GEMINI_URL (relay base, default direct),
#      GEMINI_MODEL (default gemini-flash-latest), GEMINI_LANG (default fa), V2T_CLOUD=0 → exit 4 at once
#      (the bridge sets it when the Worker relay is known-unreachable).
# stdout: one JSON line {"engine": "gemini", "text": "...", "attempts": [...]} for the bridge's trace.
# Exit codes: 0 ok · 2 bad args · 3 no text · 4 cloud disabled (relay known down) · 5 no key.
import base64
import json
import os
import sys
import time


def gemini(path, attempts):
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    base = os.environ.get("GEMINI_URL", "").strip() or "https://generativelanguage.googleapis.com"
    auth = os.environ.get("GEMINI_AUTH", "").strip() or key
    model = os.environ.get("GEMINI_MODEL") or "gemini-flash-latest"
    lang = os.environ.get("GEMINI_LANG") or "fa"
    if not auth:
        attempts.append({"e": "gemini", "ms": 0, "err": "no key"})
        sys.exit(5)
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
    # One attempt per model, 25 s cap each (owner wants fast-or-honest, not slow-but-eventual): full flash
    # first, lite when flash 503s under load. X-goog-api-key for direct; Authorization Bearer is what the
    # Worker relay authenticates.
    last = None
    for m in [model, "gemini-flash-lite-latest"]:
        t0 = time.time()
        try:
            r = httpx.post(
                f"{base}/v1beta/models/{m}:generateContent",
                headers={"X-goog-api-key": auth, "Authorization": "Bearer " + auth},
                timeout=25, json=prompt,
            )
            r.raise_for_status()
            text = (r.json()["candidates"][0]["content"]["parts"][0]["text"] or "").strip()
            attempts.append({"e": "gemini:" + m, "ms": round((time.time() - t0) * 1000), "ok": bool(text)})
            if text:
                return text
        except Exception as e:  # noqa: BLE001 — next model, then give up honestly
            last = e
            attempts.append({"e": "gemini:" + m, "ms": round((time.time() - t0) * 1000), "err": str(e)[:80]})
            print("gemini(%s) failed: %s" % (m, e), file=sys.stderr)
    return None


def main():
    # Persian text on a Windows pipe defaults to cp1252 and dies; force UTF-8 both ways.
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    if len(sys.argv) < 2 or not os.path.exists(sys.argv[1]):
        sys.exit(2)
    if os.environ.get("V2T_CLOUD", "1") == "0":
        print(json.dumps({"engine": "none", "text": "", "attempts": [{"e": "gemini", "ms": 0, "err": "relay down"}]}, ensure_ascii=False))
        sys.exit(4)
    attempts = []
    text = gemini(sys.argv[1], attempts)
    if not text:
        sys.exit(3)
    print(json.dumps({"engine": "gemini", "text": text, "attempts": attempts}, ensure_ascii=False))


if __name__ == "__main__":
    main()
