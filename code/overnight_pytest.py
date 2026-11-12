# Overnight V2T probe (2026-11-13): posts the SAME real voice payload to the Gemini Worker relay twice —
# once with httpx defaults, once pinned to IPv4 — and prints one JSON line {"def": {...}, "v4": {...}} so
# overnight-v2t.mjs can tell whether the resets follow the address family. Args: <payload.json>
import json
import os
import sys
import time

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
import httpx  # noqa: E402

payload = json.load(open(sys.argv[1], encoding="utf-8"))
url = os.environ["GEMINI_URL"].rstrip("/") + "/v1beta/models/gemini-flash-lite-latest:generateContent"
headers = {"X-goog-api-key": os.environ["GEMINI_AUTH"], "Authorization": "Bearer " + os.environ["GEMINI_AUTH"]}


def one(client):
    t0 = time.time()
    try:
        r = client.post(url, headers=headers, json=payload, timeout=30)
        ms = round((time.time() - t0) * 1000)
        if r.status_code == 200:
            return {"ok": True, "ms": ms}
        return {"ok": False, "ms": ms, "err": "HTTP %d" % r.status_code}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "ms": round((time.time() - t0) * 1000), "err": str(e)[:60]}


out = {"def": one(httpx.Client())}
time.sleep(2)
out["v4"] = one(httpx.Client(transport=httpx.HTTPTransport(local_address="0.0.0.0")))
print(json.dumps(out, ensure_ascii=False))
