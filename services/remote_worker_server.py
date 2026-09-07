import hmac
import os
import time
from pathlib import Path

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, request

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / "api.env")

LM_STUDIO_BASE_URL = os.getenv("LM_STUDIO_BASE_URL", "http://127.0.0.1:2806/v1").rstrip("/")
WORKER_TOKEN = os.getenv("MAILMATE_WORKER_TOKEN", "").strip()
WORKER_HOST = os.getenv("MAILMATE_WORKER_HOST", "0.0.0.0")
WORKER_PORT = int(os.getenv("MAILMATE_WORKER_PORT", "2810"))
WORKER_TIMEOUT = int(os.getenv("MAILMATE_WORKER_TIMEOUT_SECONDS", "75"))

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024


def _authorized() -> bool:
    if not WORKER_TOKEN:
        return False
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return False
    supplied = header[7:].strip()
    return bool(supplied) and hmac.compare_digest(supplied, WORKER_TOKEN)


def _lm_health():
    started = time.perf_counter()
    try:
        response = requests.get(f"{LM_STUDIO_BASE_URL}/models", timeout=3)
        return {
            "available": response.ok,
            "status": response.status_code,
            "latency_ms": round((time.perf_counter() - started) * 1000),
        }
    except Exception:
        return {
            "available": False,
            "status": None,
            "latency_ms": round((time.perf_counter() - started) * 1000),
        }


@app.get("/health")
def health():
    lm = _lm_health()
    ready = bool(WORKER_TOKEN) and lm["available"]
    return jsonify({
        "ok": ready,
        "worker": "mailmate-local-inference",
        "auth_configured": bool(WORKER_TOKEN),
        "lm_studio": lm,
        "retention": "none",
    }), 200 if ready else 503


@app.post("/v1/chat/completions")
def chat_completions():
    if not _authorized():
        return jsonify({"error": "unauthorized"}), 401

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "invalid_json"}), 400

    messages = payload.get("messages")
    if not isinstance(messages, list) or not messages:
        return jsonify({"error": "messages_required"}), 400
    if len(messages) > 64:
        return jsonify({"error": "too_many_messages"}), 400

    try:
        upstream = requests.post(
            f"{LM_STUDIO_BASE_URL}/chat/completions",
            json=payload,
            timeout=WORKER_TIMEOUT,
        )
    except requests.RequestException:
        return jsonify({"error": "local_model_unavailable"}), 503

    try:
        body = upstream.json()
    except Exception:
        return jsonify({
            "error": "invalid_upstream_response",
            "status": upstream.status_code,
        }), 502

    return jsonify(body), upstream.status_code


if __name__ == "__main__":
    if not WORKER_TOKEN:
        raise SystemExit(
            "MAILMATE_WORKER_TOKEN is required. Set the same token on the host and teammate clients."
        )

    print(f"[MailmateWorker] listening on http://{WORKER_HOST}:{WORKER_PORT}")
    print(f"[MailmateWorker] LM Studio upstream: {LM_STUDIO_BASE_URL}")
    print("[MailmateWorker] zero-retention proxy; request bodies are not logged")
    app.run(host=WORKER_HOST, port=WORKER_PORT, debug=False, threaded=True)
