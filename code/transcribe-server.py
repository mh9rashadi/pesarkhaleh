# Warm local STT server (2026-11-13): loads faster-whisper ONCE and serves /stt forever, so a voice
# doesn't pay the ~25 s cold model load every time (measured: 37 s → ~10 s for a 5 s voice). The bridge
# spawns it detached at startup; transcribe.py POSTs the raw audio bytes here first, and falls back to
# in-process loading if this server is down. Stdlib only, listens on 127.0.0.1 only.
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# PyAV >= 19 dropped the `metadata_errors` kwarg faster-whisper still passes (same patch as transcribe.py).
import av

_open = av.open
if not getattr(av, "_v2t_patched", False):
    av.open = lambda *a, **k: _open(*a, **{x: y for x, y in k.items() if x != "metadata_errors"})
    av._v2t_patched = True

from faster_whisper import WhisperModel  # noqa: E402

MODEL = os.environ.get("V2T_MODEL") or "large-v3-turbo"
LANG = os.environ.get("V2T_LANG") or "fa"
PORT = int(os.environ.get("V2T_PORT") or 47475)

sys.stderr.reconfigure(encoding="utf-8")
print("v2t server: loading", MODEL, "…", flush=True, file=sys.stderr)
model = WhisperModel(MODEL, device="cpu", compute_type="int8")
print("v2t server: model ready on 127.0.0.1:%s" % PORT, flush=True, file=sys.stderr)


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/stt":
            self.send_response(404)
            self.end_headers()
            return
        data = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        lang = self.headers.get("X-V2T-Lang") or LANG
        tmp = os.path.join(os.environ.get("TEMP") or os.getcwd(), "v2t_in_%d.bin" % os.getpid())
        try:
            with open(tmp, "wb") as fh:
                fh.write(data)
            segments, _info = model.transcribe(tmp, language=lang, vad_filter=True)
            text = "".join(s.text for s in segments).strip()
            body = json.dumps({"ok": True, "text": text}, ensure_ascii=False).encode("utf-8")
        except Exception as e:  # noqa: BLE001 — one bad request must not kill the server
            body = json.dumps({"ok": False, "err": str(e)[:200]}, ensure_ascii=False).encode("utf-8")
        finally:
            try:
                os.remove(tmp)
            except OSError:
                pass
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # keep it quiet; the bridge traces timing itself
        pass


ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
