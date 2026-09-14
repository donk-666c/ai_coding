"""智谱 GLM 对话客户端：模型降级链 + 429 重试 + SSE 解析。

上游接口是 OpenAI 兼容格式：
    POST {BASE_URL}/chat/completions
    Authorization: Bearer <API_KEY>
    {"model": "...", "messages": [...], "stream": true}
"""
from __future__ import annotations

import json
import time
from typing import Generator, Iterable

import requests

from config import (
    API_KEY,
    BASE_URL,
    CHAT_PATH,
    CONNECT_TIMEOUT,
    MAX_RETRIES,
    READ_TIMEOUT,
    RETRY_BACKOFF,
)

# 这些状态码值得原模型重试；其它错误直接换下一个模型
RETRYABLE_STATUS = {408, 429, 500, 502, 503, 504}


class UpstreamError(Exception):
    """上游返回的错误，status=0 表示网络层失败。"""

    def __init__(self, status: int, message: str, model: str | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.message = message
        self.model = model


def _short_error(exc: Exception) -> str:
    """requests 的异常消息很长，截短后放进给用户看的状态提示里。"""
    text = str(exc).split("\n")[0]
    return text[:60] + ("…" if len(text) > 60 else "")


def _friendly_message(status: int, payload: object, raw_text: str) -> str:
    """把上游错误翻译成用户能看懂的中文。"""
    detail = ""
    if isinstance(payload, dict):
        err = payload.get("error")
        if isinstance(err, dict):
            detail = str(err.get("message") or "")
        elif isinstance(err, str):
            detail = err
        detail = detail or str(payload.get("message") or "")
    detail = detail or raw_text.strip()[:300]

    if status == 401 or status == 403:
        return f"API Key 无效或无权访问该模型（{status}）：{detail}"
    if status == 404:
        return f"模型不存在或接口地址有误（404）：{detail}"
    if status == 429:
        return f"该模型当前访问量过大，请稍后重试（429）：{detail}"
    if status >= 500:
        return f"智谱服务端异常（{status}）：{detail}"
    return f"上游返回错误（{status}）：{detail}"


def _prepare(messages: Iterable[dict], system: str | None) -> list[dict]:
    """清洗并组装消息列表（system 提示词放最前）。"""
    cleaned: list[dict] = []
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        role = str(msg.get("role") or "").strip()
        content = msg.get("content")
        if role not in {"user", "assistant", "system"} or not isinstance(content, str):
            continue
        if not content.strip():
            continue
        cleaned.append({"role": role, "content": content})
    if system and system.strip() and not any(m["role"] == "system" for m in cleaned):
        cleaned.insert(0, {"role": "system", "content": system.strip()})
    return cleaned


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }


def _iter_sse_data(response: requests.Response) -> Generator[str, None, None]:
    """按字节缓冲切行，避免多字节字符被分片切断。"""
    buffer = b""
    for chunk in response.iter_content(chunk_size=1024):
        if not chunk:
            continue
        buffer += chunk
        while b"\n" in buffer:
            line, buffer = buffer.split(b"\n", 1)
            line = line.strip(b"\r").strip()
            if not line.startswith(b"data:"):
                continue
            yield line[5:].strip().decode("utf-8", errors="replace")
    if buffer.strip().startswith(b"data:"):
        yield buffer.strip()[5:].strip().decode("utf-8", errors="replace")


def stream_chat(
    messages: Iterable[dict],
    model: str | None = None,
    temperature: float = 0.7,
    max_tokens: int | None = None,
    system: str | None = None,
    thinking: str | None = None,
) -> Generator[dict, None, None]:
    """流式对话：依次产出 meta / status / reasoning / delta / done / error 事件字典。

    meta 事件会告知前端实际使用的模型以及是否走了降级。
    reasoning 事件是推理模型（GLM-4.7-Flash）的思维链，与正文分开推送。
    """
    from config import (  # 延迟导入，便于测试时替换
        FREE_MODEL_ALLOWLIST,
        FREE_ONLY,
        THINKING_MIN_MAX_TOKENS,
        TOTAL_DEADLINE,
        blocked_configured_models,
        is_model_allowed,
        model_chain,
        resolve_thinking,
    )

    # 免费模式：显式点名一个非白名单模型时直接拒绝。
    # 这里刻意不"静默换成免费模型" —— 否则你以为是免费在跑，实际请求的是付费模型，
    # 只有明确报错才不会被误解。
    if FREE_ONLY and model and not is_model_allowed(model):
        yield {
            "type": "error",
            "status": 0,
            "blocked": True,
            "model": model,
            "message": (
                f"已拒绝调用「{model}」：它不在免费白名单内，会产生费用。"
                f"当前允许的免费模型：{'、'.join(FREE_MODEL_ALLOWLIST)}。"
                f"确实要用它，请把 .env 里的 GLM_FREE_ONLY 设为 0，"
                f"或把它加入 GLM_ALLOWED_MODELS。"
            ),
        }
        return

    chain = model_chain(model)
    prepared = _prepare(messages, system)
    if not prepared:
        yield {"type": "error", "status": 400, "message": "没有可发送的消息内容。"}
        return
    if not API_KEY:
        yield {"type": "error", "status": 401, "message": "后端未配置 ZHIPU_API_KEY，请在 .env 中填写。"}
        return

    # 配置里若混进了付费模型，明确告诉用户"已忽略"，而不是悄悄按白名单跑
    if FREE_ONLY:
        ignored = blocked_configured_models()
        if ignored:
            yield {
                "type": "status",
                "message": f"免费模式：已忽略配置中的付费模型 {'、'.join(ignored)}，仅使用 {'、'.join(chain)}",
            }

    deadline = time.monotonic() + TOTAL_DEADLINE
    thinking_param = resolve_thinking(thinking)
    budget = max_tokens
    if thinking_param and thinking_param.get("type") in {"enabled", "auto"}:
        # 思维链和正文共用输出预算，开思考时给足，否则正文很容易被截断成空
        budget = max(budget or 0, THINKING_MIN_MAX_TOKENS)

    last_error: UpstreamError | None = None
    url = f"{BASE_URL}{CHAT_PATH}"

    for index, name in enumerate(chain):
        # 上游可能"只连不答"，每次尝试前先看总时限，避免把用户吊死
        if time.monotonic() >= deadline:
            yield {
                "type": "error",
                "status": 0,
                "model": name,
                "message": (
                    f"等待上游超过 {TOTAL_DEADLINE:.0f} 秒仍未拿到回复，已放弃。"
                    f"可稍后重试、在设置里换模型，或调大 .env 的 TOTAL_DEADLINE。"
                ),
                "triedModels": chain,
            }
            return

        payload: dict = {"model": name, "messages": prepared, "stream": True, "temperature": temperature}
        if budget:
            payload["max_tokens"] = budget
        if thinking_param is not None:
            payload["thinking"] = thinking_param

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                response = requests.post(
                    url,
                    headers=_headers(),
                    json=payload,
                    stream=True,
                    timeout=(CONNECT_TIMEOUT, READ_TIMEOUT),
                )
            except requests.RequestException as exc:
                last_error = UpstreamError(0, f"无法连接智谱接口：{exc}", name)
                if attempt < MAX_RETRIES:
                    wait = RETRY_BACKOFF * attempt
                    yield {
                        "type": "status",
                        "model": name,
                        "message": f"{name} 响应超时（{_short_error(exc)}），{wait:.1f}s 后重试…",
                    }
                    time.sleep(wait)
                    continue
                break

            if response.status_code != 200:
                raw_text = response.text[:500]
                try:
                    body = json.loads(raw_text)
                except json.JSONDecodeError:
                    body = None
                response.close()
                last_error = UpstreamError(
                    response.status_code,
                    _friendly_message(response.status_code, body, raw_text),
                    name,
                )
                if response.status_code in RETRYABLE_STATUS and attempt < MAX_RETRIES:
                    wait = RETRY_BACKOFF * attempt
                    yield {
                        "type": "status",
                        "model": name,
                        "message": f"{name} 正忙（{response.status_code}），{wait:.1f}s 后重试…",
                    }
                    time.sleep(wait)
                    continue
                break  # 换下一个模型

            # 上游已接受请求，从这里开始就是确定的模型了
            yield {
                "type": "meta",
                "model": name,
                "requested": chain[0],
                "fallback": index > 0,
                "attempt": attempt,
            }

            usage: dict | None = None
            produced = False
            reasoning_chars = 0
            try:
                for data in _iter_sse_data(response):
                    if data == "[DONE]":
                        break
                    try:
                        event = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    if isinstance(event.get("usage"), dict):
                        usage = event["usage"]
                    choices = event.get("choices") or []
                    if not choices:
                        continue
                    delta = choices[0].get("delta") or {}
                    # 推理模型把思维链放在 reasoning_content，正文在 content，两者要分开推
                    thought = delta.get("reasoning_content")
                    if isinstance(thought, str) and thought:
                        reasoning_chars += len(thought)
                        yield {"type": "reasoning", "content": thought}
                    piece = delta.get("content")
                    if isinstance(piece, str) and piece:
                        produced = True
                        yield {"type": "delta", "content": piece}
            except requests.RequestException as exc:
                if produced:
                    yield {"type": "done", "model": name, "usage": usage, "truncated": True,
                           "message": f"连接中断：{exc}"}
                else:
                    yield {"type": "error", "status": 0, "model": name,
                           "message": f"读取流式响应失败：{exc}"}
                return
            finally:
                response.close()

            # 只有思维链、没有正文：多半是输出预算被思考吃光了，给出可执行的建议
            if not produced and reasoning_chars > 0:
                yield {
                    "type": "error",
                    "status": 0,
                    "model": name,
                    "message": (
                        f"{name} 把输出预算都用在了思考上（思维链 {reasoning_chars} 字），没能产出正文。"
                        f"请在设置里关闭「深度思考」，或把最大回复长度调大。"
                    ),
                }
                return

            yield {"type": "done", "model": name, "usage": usage}
            return

        # 这个模型彻底失败，准备降级
        if index + 1 < len(chain):
            yield {
                "type": "status",
                "model": name,
                "message": f"{name} 当前不可用，正在降级到 {chain[index + 1]}…",
            }

    if last_error is not None:
        yield {
            "type": "error",
            "status": last_error.status,
            "model": last_error.model,
            "message": last_error.message,
            "triedModels": chain,
        }
    else:
        yield {"type": "error", "status": 0, "message": "未知错误：没有可用模型。", "triedModels": chain}


def chat_once(
    messages: Iterable[dict],
    model: str | None = None,
    temperature: float = 0.7,
    max_tokens: int | None = None,
    system: str | None = None,
    thinking: str | None = None,
) -> dict:
    """非流式对话（给 /api/title 这类轻量场景用），同样走降级链。"""
    from config import THINKING_MIN_MAX_TOKENS, model_chain, resolve_thinking

    chain = model_chain(model)
    prepared = _prepare(messages, system)
    if not prepared:
        raise UpstreamError(400, "没有可发送的消息内容。")
    if not API_KEY:
        raise UpstreamError(401, "后端未配置 ZHIPU_API_KEY，请在 .env 中填写。")

    thinking_param = resolve_thinking(thinking)
    budget = max_tokens
    if thinking_param and thinking_param.get("type") in {"enabled", "auto"}:
        budget = max(budget or 0, THINKING_MIN_MAX_TOKENS)

    url = f"{BASE_URL}{CHAT_PATH}"
    last_error: UpstreamError | None = None

    for name in chain:
        payload: dict = {"model": name, "messages": prepared, "stream": False, "temperature": temperature}
        if budget:
            payload["max_tokens"] = budget
        if thinking_param is not None:
            payload["thinking"] = thinking_param
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                response = requests.post(
                    url, headers=_headers(), json=payload, timeout=(CONNECT_TIMEOUT, READ_TIMEOUT)
                )
            except requests.RequestException as exc:
                last_error = UpstreamError(0, f"无法连接智谱接口：{exc}", name)
                if attempt < MAX_RETRIES:
                    time.sleep(RETRY_BACKOFF * attempt)
                    continue
                break
            if response.status_code != 200:
                raw_text = response.text[:500]
                try:
                    body = json.loads(raw_text)
                except json.JSONDecodeError:
                    body = None
                last_error = UpstreamError(
                    response.status_code, _friendly_message(response.status_code, body, raw_text), name
                )
                if response.status_code in RETRYABLE_STATUS and attempt < MAX_RETRIES:
                    time.sleep(RETRY_BACKOFF * attempt)
                    continue
                break
            body = response.json()
            choices = body.get("choices") or []
            content = (choices[0].get("message") or {}).get("content", "") if choices else ""
            return {"content": content, "model": name, "usage": body.get("usage")}

    raise last_error or UpstreamError(0, "未知错误：没有可用模型。")
