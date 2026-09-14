"""配置加载：环境变量优先，其次项目根目录的 .env 文件。

不引入 python-dotenv，省一个依赖：.env 的语法就这么多。
"""
from __future__ import annotations

import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BACKEND_DIR.parent
FRONTEND_DIR = PROJECT_DIR / "frontend"


def _load_env_file(path: Path) -> None:
    """把 KEY=VALUE 灌进 os.environ，已存在的变量不覆盖（环境变量优先）。"""
    if not path.is_file():
        return
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            os.environ.setdefault(key, value)


_load_env_file(PROJECT_DIR / ".env")
_load_env_file(BACKEND_DIR / ".env")


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


API_KEY: str = _env("ZHIPU_API_KEY")
BASE_URL: str = _env("ZHIPU_BASE_URL", "https://open.bigmodel.cn/api/paas/v4").rstrip("/")
CHAT_PATH: str = "/chat/completions"

# 主模型 + 降级链。GLM-4.7-Flash 是免费模型，高峰期会返回 429，
# 所以主模型挤不进去时自动降级，保证对话可用。
PRIMARY_MODEL: str = _env("GLM_MODEL", "GLM-4.7-Flash")
FALLBACK_MODELS: list[str] = [
    m.strip() for m in _env("GLM_FALLBACK_MODELS", "glm-4-flash-250414,glm-4.5-flash").split(",") if m.strip()
]

# ---------------------------------------------------------------------------
# 免费模式硬锁
#
# 官方定价页（docs.bigmodel.cn/cn/guide/models/text/glm-4）标注"免费"的文本模型：
#   GLM-4.7-Flash、GLM-4-Flash-250414、GLM-4.5-Flash
# 而下面这些是**付费**的，且名字极易混淆：
#   glm-4-flashx（比 glm-4-flash 多一个 x，官方称其为"免费版 GLM-4-Flash 的增强版"）
#   glm-4-air / glm-4-airx / glm-4-plus / glm-5.x 等
# 一旦被写进配置或由前端传入，就会按量计费。所以这里做白名单：清单外的模型一律拒绝调用。
# 要放开就显式把模型名加进 GLM_ALLOWED_MODELS（有意为之，而不是手滑）。
# ---------------------------------------------------------------------------
FREE_ONLY: bool = _env("GLM_FREE_ONLY", "1").lower() not in {"0", "false", "no", "off"}
FREE_MODEL_ALLOWLIST: list[str] = [
    m.strip()
    for m in _env(
        "GLM_ALLOWED_MODELS",
        "GLM-4.7-Flash,glm-4-flash-250414,glm-4.5-flash,glm-4-flash",
    ).split(",")
    if m.strip()
]

_ALLOWED_LC = {m.lower() for m in FREE_MODEL_ALLOWLIST}


def is_model_allowed(name: str | None) -> bool:
    """该模型是否允许调用（免费模式下只放行白名单）。"""
    if not name:
        return False
    if not FREE_ONLY:
        return True
    return name.strip().lower() in _ALLOWED_LC


def blocked_configured_models() -> list[str]:
    """配置里出现、但被白名单拦下的模型（用于启动提示与前端展示）。"""
    seen: list[str] = []
    for name in [PRIMARY_MODEL, *FALLBACK_MODELS]:
        if name and not is_model_allowed(name) and name not in seen:
            seen.append(name)
    return seen

HOST: str = _env("HOST", "127.0.0.1")
PORT: int = int(_env("PORT", "8000"))
DEBUG: bool = _env("DEBUG", "0") in {"1", "true", "yes"}

# 上游请求超时：(连接, 读取)。读取超时同时管"等响应头"和"等下一个分片"，
# 所以它决定了一次挂死的上游最多能拖住用户多久 —— 免费模型偶发只连不答，
# 这个值不能给太大。
CONNECT_TIMEOUT: float = float(_env("CONNECT_TIMEOUT", "10"))
READ_TIMEOUT: float = float(_env("READ_TIMEOUT", "60"))

# 整条降级链的总时限（秒）：超过就报错，绝不让前端无限等下去
TOTAL_DEADLINE: float = float(_env("TOTAL_DEADLINE", "120"))

# 同一个模型 429/5xx 时的重试次数与退避基数（秒）
MAX_RETRIES: int = int(_env("MAX_RETRIES", "2"))
RETRY_BACKOFF: float = float(_env("RETRY_BACKOFF", "1.5"))

DEFAULT_TEMPERATURE: float = float(_env("DEFAULT_TEMPERATURE", "0.7"))
DEFAULT_MAX_TOKENS: int = int(_env("DEFAULT_MAX_TOKENS", "4096"))

# 女友人格模式的默认值：温度更高才有「人味」，回复短一点更像聊天（也更快更省）
DEFAULT_TEMPERATURE_PERSONA: float = float(_env("DEFAULT_TEMPERATURE_PERSONA", "0.9"))
DEFAULT_MAX_TOKENS_PERSONA: int = int(_env("DEFAULT_MAX_TOKENS_PERSONA", "1024"))
DEFAULT_SYSTEM_PROMPT: str = _env(
    "SYSTEM_PROMPT",
    "你是一个专业、友好的中文 AI 助手。回答准确、条理清晰；涉及代码时使用 Markdown 代码块并标注语言。",
)

# 思考模式。GLM-4.7-Flash 是推理模型，默认会把大量 token 花在思维链上
# （实测一个简单问题就烧掉 404 reasoning tokens），所以默认关掉以保证响应速度；
# 前端可随时切换成 enabled 并展示思考过程。
# 取值：disabled（默认，快）/ enabled（开启并展示思维链）/ auto（交给上游判断）/ 空（不传该参数）
THINKING_MODE: str = _env("GLM_THINKING", "disabled").lower()

# 开启思考时，思维链会吃掉输出预算，所以给一个下限兜底
THINKING_MIN_MAX_TOKENS: int = int(_env("THINKING_MIN_MAX_TOKENS", "4096"))


def resolve_thinking(value: str | None) -> dict | None:
    """把开关值翻译成上游的 thinking 参数；返回 None 表示不带这个字段。"""
    mode = (value if value is not None else THINKING_MODE).strip().lower()
    if mode in {"", "default", "none"}:
        return None
    if mode in {"disabled", "off", "false", "0", "no"}:
        return {"type": "disabled"}
    if mode in {"enabled", "on", "true", "1", "yes"}:
        return {"type": "enabled"}
    return {"type": "auto"}



def model_chain(requested: str | None = None) -> list[str]:
    """返回本次请求要依次尝试的模型列表（用户指定的排在最前，去重）。

    免费模式下会剔除非白名单模型；若全被剔除，退回白名单本身。
    """
    chain: list[str] = []
    for name in [requested, PRIMARY_MODEL, *FALLBACK_MODELS]:
        if name and name not in chain:
            chain.append(name)
    if FREE_ONLY:
        chain = [m for m in chain if is_model_allowed(m)]
        if not chain:
            chain = list(FREE_MODEL_ALLOWLIST)
    return chain or ["glm-4-flash-250414"]


def public_config() -> dict:
    """可以安全下发到前端的配置（不含 API Key）。"""
    return {
        "primaryModel": PRIMARY_MODEL if is_model_allowed(PRIMARY_MODEL) else (FREE_MODEL_ALLOWLIST[0] if FREE_MODEL_ALLOWLIST else PRIMARY_MODEL),
        "fallbackModels": [m for m in FALLBACK_MODELS if is_model_allowed(m)],
        "models": model_chain(),
        "freeOnly": FREE_ONLY,
        "allowedModels": list(FREE_MODEL_ALLOWLIST),
        "blockedConfiguredModels": blocked_configured_models(),
        "defaultTemperature": DEFAULT_TEMPERATURE,
        "defaultMaxTokens": DEFAULT_MAX_TOKENS,
        "defaultSystemPrompt": DEFAULT_SYSTEM_PROMPT,
        "defaultThinking": THINKING_MODE,
        "personaDefaults": {
            "temperature": DEFAULT_TEMPERATURE_PERSONA,
            "maxTokens": DEFAULT_MAX_TOKENS_PERSONA,
        },
        "hasApiKey": bool(API_KEY),
        "endpoint": f"{BASE_URL}{CHAT_PATH}",
    }
