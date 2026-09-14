# AIChat · 智谱 GLM 对话机器人

一个前后端分离的聊天机器人：前端原生 HTML/CSS/JS + axios，后端 Python/Flask，
对接智谱 GLM 大模型（默认 `GLM-4.7-Flash`，免费）。支持真流式输出、Markdown 与代码高亮、
多会话管理、思维链展示。

## 快速开始

```bat
:: Windows：双击 run.bat 即可（会自动装依赖、打开浏览器）
run.bat
```

手动启动：

```bash
py -m pip install -r backend/requirements.txt
py backend/app.py
# 打开 http://127.0.0.1:8000/
```

> 注意：PATH 上的 `python` 可能是 Windows 商店的占位符（0 字节），请用 `py`。
> 首次运行前确认 `AIChat/.env` 里有 `ZHIPU_API_KEY`。

## 目录结构

```
AIChat/
├─ backend/
│  ├─ app.py            Flask 路由 + 静态托管 + SSE 输出
│  ├─ glm.py            智谱客户端：降级链、429 重试、SSE 解析、超时兜底
│  ├─ config.py         .env 加载与配置（不依赖 python-dotenv）
│  └─ requirements.txt  仅 flask + requests
├─ frontend/
│  ├─ index.html
│  ├─ css/style.css     深色玻璃拟态主题，响应式
│  ├─ js/
│  │  ├─ api.js         网络层：常规接口走 axios，流式走 fetch
│  │  ├─ store.js       localStorage 会话管理
│  │  ├─ markdown.js    marked + DOMPurify + highlight.js 渲染
│  │  └─ app.js         UI 逻辑
│  └─ vendor/           依赖全部本地化，无任何 CDN 依赖
├─ tests/
│  ├─ test_api.mjs        后端端到端（流式、降级、校验、思维链、免费白名单）
│  ├─ test_ui.py          界面验证 + 截图
│  ├─ test_timeout.py     "上游只连不答"时的限时兜底
│  └─ check_models.mjs    模型可用性探针
├─ .env                 密钥与配置（已被 .gitignore 忽略）
├─ .env.example         配置模板
└─ run.bat              一键启动
```

## 免费模式（默认开启，防止意外计费）

**这个项目的设计前提是：只用免费模型，一分钱不花。**

代码里有一道白名单硬锁（`GLM_FREE_ONLY=1`），只有清单内的模型允许被调用，清单外的
**一律拒绝**，不会"静默替换"。依据[官方定价页](https://docs.bigmodel.cn/cn/guide/models/text/glm-4)
标注"免费"的文本模型，默认白名单是：

```
GLM-4.7-Flash  ·  glm-4-flash-250414  ·  glm-4.5-flash  ·  glm-4-flash
```

⚠️ **名字极易混淆的付费模型**，千万别加进白名单：

| 付费（会计费） | 与免费版的区别 |
|---|---|
| `glm-4-flashx` | 比 `glm-4-flash` **只多一个 x**。官方称它是"免费版 GLM-4-Flash 的增强版" |
| `glm-4-flashx-250414` | 同上，带日期版 |
| `glm-4-air` / `glm-4-airx` / `glm-4-plus` | GLM-4 家族里的高配型号，按量计费 |

所以降级链刻意写成带日期的 `glm-4-flash-250414`，而不是裸别名 `glm-4-flash`
（别名将来可能漂移）。三重保护：

1. **启动横幅**打印白名单与实际调用链；配置里混入付费模型会明确提示"已被忽略"。
2. **前端下拉框**只列出白名单内的模型，选不到付费模型。
3. **请求级拒绝**：即使有人手工构造请求指定 `glm-4-plus`，后端也会直接拒绝并说明原因
   （`tests/test_api.mjs` 的第 6 组用例断言了这一点，且断言没有任何正文产出）。

要确实使用付费模型，必须**显式**改 `.env`（把模型加进 `GLM_ALLOWED_MODELS`，或把
`GLM_FREE_ONLY` 设为 `0`）——刻意为之，而不是手滑。

## 接口

| 方法 | 路径 | 前端用什么调 | 说明 |
|---|---|---|---|
| GET | `/` | — | 前端页面（与后端同源，无跨域） |
| GET | `/api/config` | axios | 下发模型列表等公开配置，**不含 API Key** |
| GET | `/api/health` | axios | 健康检查；`?probe=1` 会真连一次上游 |
| POST | `/api/chat` | fetch（流式） | SSE 流式对话 |
| POST | `/api/title` | axios | 用模型给会话自动起标题 |

`/api/chat` 的请求体：

```jsonc
{
  "messages": [{"role": "user", "content": "用 3 行 Python 演示快速排序"}],
  "system": "你是一个专业、友好的中文 AI 助手",   // 可选：覆盖默认系统提示词
  "temperature": 0.7,
  "maxTokens": 4096
}
```

`/api/chat` 的事件类型：

```jsonc
{"type":"meta",      "model":"GLM-4.7-Flash", "requested":"GLM-4.7-Flash", "fallback":false, "attempt":2}
{"type":"status",    "message":"GLM-4.7-Flash 正忙（429），1.5s 后重试…"}
{"type":"reasoning", "content":"思维链分片"}      // 仅推理模型、开启思考时
{"type":"delta",     "content":"正文分片"}
{"type":"done",      "model":"...", "usage":{...}}
{"type":"error",     "status":429, "message":"..."}
data: [DONE]
```

## 关键设计

**为什么流式用 fetch 而其它用 axios？**
浏览器里 axios 底层是 XHR，拿不到增量响应体，做不了真流式。所以只有 `/api/chat`
用 `fetch` + `ReadableStream`，其余接口（配置、健康检查、起标题）一律走 axios。

**模型降级链。**
`GLM-4.7-Flash` 是免费模型，高峰期会返回 429。后端按
`用户指定模型 → GLM_MODEL → GLM_FALLBACK_MODELS` 依次尝试，同一模型内先重试，
最后告诉前端实际用的是哪个模型（界面上会显示「已降级」）。

**思考模式默认关闭。**
`GLM-4.7-Flash` 是推理模型，实测一个简单问题就烧掉 400 个 reasoning token，
且`thinking=disabled` 时它仍能正常作答。所以默认关掉以保证响应速度；
设置抽屉里可开关，开启后思维链会在气泡上方以可折叠面板展示。

**超时兜底。**
上游偶发"只连不答"。`READ_TIMEOUT` 与 `TOTAL_DEADLINE` 保证这种情况下限时失败
并给出可读提示，而不是把用户吊死（见 `tests/test_timeout.py`）。

**安全。**
API Key 只存在于后端 `.env`，浏览器完全拿不到，所有请求经本地后端转发。
`.env` 已在 `.gitignore` 中。

## 配置项

见 `.env.example`，全部可选（除 `ZHIPU_API_KEY`）：

| 变量 | 默认 | 说明 |
|---|---|---|
| `ZHIPU_API_KEY` | — | 智谱密钥，**必填** |
| `ZHIPU_BASE_URL` | `https://open.bigmodel.cn/api/paas/v4` | 接口地址 |
| `GLM_MODEL` | `GLM-4.7-Flash` | 主模型 |
| `GLM_FALLBACK_MODELS` | `glm-4-flash` | 降级链，逗号分隔 |
| `GLM_THINKING` | `disabled` | `disabled`/`enabled`/`auto`/留空 |
| `HOST` / `PORT` | `127.0.0.1` / `8000` | 监听地址 |
| `CONNECT_TIMEOUT` / `READ_TIMEOUT` | `10` / `60` | 上游超时（秒） |
| `TOTAL_DEADLINE` | `120` | 整条降级链总时限（秒） |
| `MAX_RETRIES` / `RETRY_BACKOFF` | `2` / `1.5` | 同模型重试次数与退避基数 |
| `DEFAULT_TEMPERATURE` / `DEFAULT_MAX_TOKENS` | `0.7` / `4096` | 生成参数 |
| `SYSTEM_PROMPT` | 见模板 | 默认系统提示词 |

## 测试

```bash
py backend/app.py &                # 先起服务

node tests/test_api.mjs            # 后端端到端
py tests/test_ui.py                # 界面验证 + 截图
py tests/test_timeout.py           # 超时兜底（不需要起服务）
node tests/check_models.mjs        # 探测模型可用性

# 截图输出在 tests/.shots/（已在 .gitignore 里）
```

## 常见问题

**一直提示"模型当前访问量过大"。**
`GLM-4.7-Flash` 免费额度被挤爆，属正常现象。后端会自动降级到 `glm-4-flash`，
界面徽标会变黄并显示实际模型；也可在设置里手动切换模型。

**开启深度思考后回复被截断成空。**
思维链和正文共用输出预算。后端在开启思考时会自动把 `max_tokens` 提到
`THINKING_MIN_MAX_TOKENS`（默认 4096）以下限兜底；若仍被截断，把最大回复长度调更大。

**前端样式/脚本改了不生效。**
静态文件由 Flask 直接托管，改完刷新即可；只有改后端 Python 才需要重启。
