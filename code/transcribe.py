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
    key = os.environ.get("GROQ_API_KEY", "").strip()
    if not key:
        return None
    import httpx

    with open(path, "rb") as f:
        r = httpx.post(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            headers={"Authorization": "Bearer " + key},
            data={"model": "whisper-large-v3-turbo", "language": "fa", "response_format": "json"},
            files={"file": (os.path.basename(path), f, "application/octet-stream")},
            timeout=90,
        )
    r.raise_for_status()
    return (r.json().get("text") or "").strip() or None


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
    try:
        text, engine = groq(path), "groq"
    except Exception as e:  # noqa: BLE001 — one engine failing must not kill the other
        print("groq failed: %s" % e, file=sys.stderr)
    if not text:
        try:
            text, engine = whisper(path), "whisper"
        except Exception as e:  # noqa: BLE001
            print("whisper failed: %s" % e, file=sys.stderr)
    if not text:
        sys.exit(3)
    print(json.dumps({"engine": engine, "text": text}, ensure_ascii=False))


if __name__ == "__main__":
    main()
