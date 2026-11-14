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


def soniex(path, attempts):
    # Soniex gateway (owner-provided, 2026-11-13): DIRECT http to an IP — no DNS, no filtering windows.
    # Async flow: upload file → start transcription → poll → transcript → delete file. Skipped without a key.
    base = (os.environ.get("SONIEX_URL") or "http://212.80.22.165:8096").rstrip("/")
    key = (os.environ.get("SONIEX_KEY") or "").strip()
    if not key:
        return None
    import httpx

    hdr = {"Authorization": "Bearer " + key}
    fid = None
    try:
        with open(path, "rb") as f:
            up = httpx.post(f"{base}/v1/files", headers=hdr, files={"file": (os.path.basename(path), f)}, timeout=60)
        up.raise_for_status()
        fid = up.json()["id"]
        tr = httpx.post(
            f"{base}/v1/transcriptions", headers=hdr, timeout=30,
            json={"model": os.environ.get("SONIEX_MODEL") or "stt-async-v6", "file_id": fid, "language_hints": ["fa", "en"]},
        )
        tr.raise_for_status()
        tid = tr.json()["id"]
        deadline = time.time() + 85  # fit the bridge's 110 s budget
        while time.time() < deadline:
            st = httpx.get(f"{base}/v1/transcriptions/{tid}", headers=hdr, timeout=20).json()
            status = st.get("status")
            if status == "completed":
                break
            if status in ("error", "failed"):
                raise RuntimeError("soniex: " + str(st.get("error") or status))
            time.sleep(8)
        else:
            raise RuntimeError("soniex: not ready in time")
        tx = httpx.get(f"{base}/v1/transcriptions/{tid}/transcript", headers=hdr, timeout=20).json()
        return (tx.get("text") or "").strip() or None
    finally:
        if fid:
            try:
                httpx.delete(f"{base}/v1/files/{fid}", headers=hdr, timeout=15)
            except Exception:  # noqa: BLE001 — cleanup best-effort
                pass


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
    # PREFERRED (2026-11-13 overnight finding): the laptop's network resets LARGE uploads to Cloudflare
    # while small POSTs pass — so with V2T_VIA_WORKER=1 and a Telegram file_id, the audio never leaves:
    # the Worker fetches it from Telegram and calls Gemini itself (worker /laptop/v2t). The old
    # inline-base64 path below stays as the fallback for runs without a file_id (e.g. offline probes).
    last = None
    file_id = os.environ.get("V2T_FILE_ID", "").strip()
    if os.environ.get("V2T_VIA_WORKER") == "1" and file_id:
        t0 = time.time()
        vw_url = (os.environ.get("V2T_WORKER_URL", "").strip() or base.replace("/laptop/gemini", "")) + "/laptop/v2t"
        try:
            r = httpx.post(
                vw_url,
                headers={"Authorization": "Bearer " + auth},
                timeout=90, json={"file_id": file_id},
            )
            r.raise_for_status()
            j = r.json()
            if not j.get("ok"):
                raise RuntimeError(j.get("err") or "v2t worker error")
            text = (j.get("text") or "").strip()
            attempts.append({"e": "v2t:worker", "ms": round((time.time() - t0) * 1000), "ok": bool(text)})
            print("v2t(worker) %.0fs" % ((time.time() - t0)), file=sys.stderr)
            return text or None
        except Exception as e:  # noqa: BLE001 — fall through to the inline path
            attempts.append({"e": "v2t:worker", "ms": round((time.time() - t0) * 1000), "err": str(e)[:60]})
            print("v2t(worker) failed: %s" % e, file=sys.stderr)
    # Full flash first, lite when flash 503s under load; 20 s cap per attempt. Connection resets (the
    # laptop's network kills TLS to Cloudflare intermittently) get one quick retry on a fresh connection.
    # V2T_FORCE4=1 pins IPv4 (overnight-test knob, 2026-11-13). X-goog-api-key for direct calls;
    # Authorization Bearer is what the Worker relay authenticates.
    client_kw = {"transport": httpx.HTTPTransport(local_address="0.0.0.0")} if os.environ.get("V2T_FORCE4") == "1" else {}
    with httpx.Client(**client_kw) as client:
        for m in [model, "gemini-flash-lite-latest"]:
            for attempt in range(2):
                t0 = time.time()
                tag = "gemini:" + m + ("" if attempt == 0 else "#2")
                try:
                    r = client.post(
                        f"{base}/v1beta/models/{m}:generateContent",
                        headers={"X-goog-api-key": auth, "Authorization": "Bearer " + auth},
                        timeout=20, json=prompt,
                    )
                    r.raise_for_status()
                    text = (r.json()["candidates"][0]["content"]["parts"][0]["text"] or "").strip()
                    attempts.append({"e": tag, "ms": round((time.time() - t0) * 1000), "ok": bool(text)})
                    if text:
                        return text
                    break  # answered but empty → next model
                except httpx.HTTPStatusError as e:
                    attempts.append({"e": tag, "ms": round((time.time() - t0) * 1000), "err": "HTTP %d" % e.response.status_code})
                    print("gemini(%s) HTTP %s" % (m, e.response.status_code), file=sys.stderr)
                    break  # busy/gone → next model
                except Exception as e:  # noqa: BLE001 — transport reset: quick retry on a fresh connection
                    last = e
                    attempts.append({"e": tag, "ms": round((time.time() - t0) * 1000), "err": str(e)[:60]})
                    print("gemini(%s) try %s failed: %s" % (m, attempt + 1, e), file=sys.stderr)
                    if attempt < 1:
                        time.sleep(3)
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
    engine = None
    text = None
    import time

    for name, fn in (("soniex", soniex), ("gemini", gemini)):
        t0 = time.time()
        try:
            text = fn(sys.argv[1], attempts)
        except Exception as e:  # noqa: BLE001 — one engine failing must not kill the other
            print("%s failed: %s" % (name, e), file=sys.stderr)
            text = None
        attempts.append({"e": name, "ms": round((time.time() - t0) * 1000), "ok": bool(text)})
        if text:
            engine = name
            break
    if not text:
        sys.exit(3)
    print(json.dumps({"engine": engine, "text": text, "attempts": attempts}, ensure_ascii=False))


if __name__ == "__main__":
    main()
