"""AIChat 后端：Flask 同时托管前端静态文件 + 提供对话 API。

接口一览
    GET  /                 前端页面（同源，无跨域问题）
    GET  /api/config       下发模型列表等公开配置（不含 API Key）
    GET  /api/health       健康检查；?probe=1 会真连一次上游
    POST /api/chat         SSE 流式对话（前端用 fetch 读流）
    POST /api/title        用小模型给会话起标题（前端用 axios 调）
"""
from __future__ import annotations

import json
import re
from typing import Any

from flask import Flask, Response, jsonify, request, send_from_directory, stream_with_context

import config
import glm

app = Flask(__name__, static_folder=str(config.FRONTEND_DIR), static_url_path="")

MAX_HISTORY_MESSAGES = 40  # 只把最近 N 条发给上游，避免 token 无上限增长


@app.after_request
def add_cors_headers(response: Response) -> Response:
    """允许直接双击打开 index.html（file:// 场景）时也能调后端。"""
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response


@app.get("/")
def index() -> Response:
    return send_from_directory(config.FRONTEND_DIR, "index.html")


@app.get("/api/config")
def api_config():
    return jsonify(config.public_config())


@app.get("/api/health")
def api_health():
    info: dict[str, Any] = {"ok": True, **config.public_config()}
    if request.args.get("probe") == "1":
        try:
            result = glm.chat_once(
                [{"role": "user", "content": "回复一个字：好"}], max_tokens=8, temperature=0
            )
            info["probe"] = {"ok": True, "model": result["model"]}
        except glm.UpstreamError as exc:
            info["probe"] = {"ok": False, "status": exc.status, "message": exc.message, "model": exc.model}
    return jsonify(info)


def _read_chat_payload() -> tuple[list[dict], str | None, float, int | None, str | None, str | None]:
    data = request.get_json(silent=True) or {}
    messages = data.get("messages") or []
    if not isinstance(messages, list):
        raise ValueError("messages 必须是数组")
    messages = messages[-MAX_HISTORY_MESSAGES:]
    model = data.get("model")
    model = str(model).strip() if isinstance(model, str) and model.strip() else None
    try:
        temperature = float(data.get("temperature", config.DEFAULT_TEMPERATURE))
    except (TypeError, ValueError):
        temperature = config.DEFAULT_TEMPERATURE
    temperature = min(max(temperature, 0.0), 1.0)
    max_tokens = data.get("maxTokens") or config.DEFAULT_MAX_TOKENS
    try:
        max_tokens = int(max_tokens)
    except (TypeError, ValueError):
        max_tokens = config.DEFAULT_MAX_TOKENS
    system = data.get("system")
    system = system if isinstance(system, str) else None
    thinking = data.get("thinking")
    thinking = str(thinking).strip() if isinstance(thinking, str) and thinking.strip() else None
    return messages, model, temperature, max_tokens, system, thinking


@app.post("/api/chat")
def api_chat():
    try:
        messages, model, temperature, max_tokens, system, thinking = _read_chat_payload()
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    def event_stream():
        try:
            for event in glm.stream_chat(
                messages,
                model=model,
                temperature=temperature,
                max_tokens=max_tokens,
                system=system,
                thinking=thinking,
            ):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as exc:  # 兜底：任何未预期异常也要以事件形式告诉前端
            payload = {"type": "error", "status": 0, "message": f"后端内部错误：{exc}"}
            yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

    return Response(
        stream_with_context(event_stream()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


def _clean_title(raw: str) -> str:
    """模型偶尔会返回代码围栏或 Markdown 装饰，这里剥掉只留标题本体。"""
    text = re.sub(r"```[a-zA-Z0-9_+-]*", "", raw or "")
    for line in text.splitlines():
        cleaned = line.strip().strip("`*#>·—－- \t\"'“”《》【】()（）[]:：。.，,")
        if not cleaned:
            continue
        if cleaned.lower() in {"标题", "title", "会话标题"}:
            continue
        return cleaned[:20]
    return ""


@app.post("/api/title")
def api_title():
    data = request.get_json(silent=True) or {}
    text = str(data.get("text") or "").strip()
    if not text:
        return jsonify({"error": "text 不能为空"}), 400
    try:
        result = glm.chat_once(
            [
                {"role": "system", "content": "你是标题生成器。只输出一个不超过 12 个字的中文标题，不要引号、不要标点、不要代码块、不要解释。"},
                {"role": "user", "content": text[:500]},
            ],
            temperature=0.3,
            max_tokens=32,
            thinking="disabled",  # 起标题不需要思考，省时间
        )
    except glm.UpstreamError as exc:
        return jsonify({"error": exc.message, "status": exc.status}), 502
    return jsonify({"title": _clean_title(result["content"]), "model": result["model"]})


if __name__ == "__main__":
    blocked = config.blocked_configured_models()
    banner = f"""
  AIChat 后端已启动
    页面      http://{config.HOST}:{config.PORT}/
    免费模式  {'已开启（只允许白名单模型）' if config.FREE_ONLY else '!! 已关闭，可能产生费用'}
    白名单    {'、'.join(config.FREE_MODEL_ALLOWLIST)}
    降级链    {' -> '.join(config.model_chain())}
    API Key   {'已配置' if config.API_KEY else '!! 未配置，请检查 .env'}
"""
    print(banner)
    if blocked:
        print(f"  ⚠️  配置里的 {'、'.join(blocked)} 不在免费白名单内，已被忽略（不会被调用）。")
        print("      如确需使用，请修改 .env 的 GLM_ALLOWED_MODELS 或把 GLM_FREE_ONLY 设为 0。\n")
    if not config.API_KEY:
        print("  提示：在 AIChat/.env 里填 ZHIPU_API_KEY=<你的密钥> 后重启。\n")
    app.run(host=config.HOST, port=config.PORT, debug=config.DEBUG, threaded=True)
