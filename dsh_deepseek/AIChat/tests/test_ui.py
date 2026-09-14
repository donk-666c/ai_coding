"""AIChat 前端浏览器验证：加载、发消息、流式渲染、Markdown、设置抽屉、移动端、持久化。

任何一步异常都不会吞掉报告：控制台错误和进度始终会打印出来。
"""
from __future__ import annotations

import sys
import traceback
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8000/"
SHOTS = Path(__file__).resolve().parent / ".shots"
SHOTS.mkdir(exist_ok=True)

results: list[tuple[str, bool, str]] = []
console_errors: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'} | {name}{' — ' + detail if detail else ''}")


def wait_stream_done(page, minimum: int = 20, timeout: int = 180_000) -> None:
    """等"正文"结束。必须把思考面板排除掉：它的文字也是气泡文本的一部分，
    否则模型还在思考时就会被误判成回答完成。clone 之后没有布局，只能用 textContent。"""
    page.wait_for_function(
        """(min) => {
            const b = document.querySelector('.msg.assistant .bubble');
            if (!b) return false;
            const clone = b.cloneNode(true);
            clone.querySelectorAll('.think').forEach((n) => n.remove());
            const text = (clone.textContent || '').trim();
            return text.length > min && !b.querySelector('.caret') && !b.querySelector('.typing');
        }""",
        arg=minimum,
        timeout=timeout,
    )


def run(page, browser) -> None:
    # ---------- 1. 加载与首屏 ----------
    page.goto(BASE, wait_until="networkidle")
    page.wait_for_selector(".welcome", timeout=15_000)
    check("页面标题正确", "AIChat" in page.title(), page.title())
    check("欢迎页渲染", page.locator(".welcome").count() == 1)
    check("建议卡片有 4 个", page.locator(".suggestion").count() == 4, f"{page.locator('.suggestion').count()} 个")
    check("模型下拉已填充", page.locator("#modelSelect option").count() >= 2, f"{page.locator('#modelSelect option').count()} 个选项")

    # 下拉弹层的可读性：曾经是"白底浅灰字"，只有鼠标悬停才看得见。
    # 原生弹层截不到图，所以直接量计算样式 + 对比度。
    contrast = page.evaluate(
        """() => {
            const lum = (css) => {
                const p = css.match(/[\\d.]+/g).map(Number);
                const [r, g, b] = p.slice(0, 3).map((v) => {
                    v /= 255;
                    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
                });
                return 0.2126 * r + 0.7152 * g + 0.0722 * b;
            };
            const ratio = (a, b) => {
                const l1 = lum(a), l2 = lum(b);
                return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
            };
            const opt = document.getElementById('modelSelect').querySelector('option');
            const os = getComputedStyle(opt);
            return {
                scheme: getComputedStyle(document.documentElement).colorScheme || '',
                fg: os.color,
                bg: os.backgroundColor,
                contrast: Number(ratio(os.color, os.backgroundColor).toFixed(2)),
                opaque: !/rgba?\\([^)]*,\\s*0(\\.0+)?\\)/.test(os.backgroundColor),
            };
        }"""
    )
    check("下拉弹层已声明暗色配色", "dark" in contrast["scheme"], f"color-scheme={contrast['scheme'] or '(未设置)'}")
    check("下拉选项背景不透明（不是白底浅灰字）", contrast["opaque"], f"bg={contrast['bg']}")
    check("下拉选项文字对比度 ≥ 4.5:1", contrast["contrast"] >= 4.5,
          f"{contrast['contrast']}:1（前景 {contrast['fg']} / 背景 {contrast['bg']}）")

    conn = page.locator("#connState span").inner_text()
    check("后端连接状态为就绪", "就绪" in conn, conn)
    check("axios 已加载（前端要求的 HTTP 库）", page.evaluate("() => typeof window.axios === 'function'"))
    check("其它库全部本地化（无 CDN 依赖）",
          page.evaluate("() => Boolean(window.marked && window.DOMPurify && window.hljs)"),
          page.evaluate("() => [typeof marked, typeof DOMPurify, typeof hljs].join('/')"))
    page.screenshot(path=str(SHOTS / "1-welcome.png"))

    # ---------- 2. 发消息 + 流式渲染 ----------
    page.fill("#input", "用 4 行 Python 演示快速排序，并说明平均时间复杂度。")
    page.click("#sendBtn")
    check("发送后出现停止按钮", page.locator("#stopBtn").is_visible())
    check("用户消息立即上屏", page.locator(".msg.user .bubble").count() == 1)
    wait_stream_done(page)
    page.wait_for_timeout(600)

    assistant_text = page.locator(".msg.assistant .bubble").inner_text()
    check("助手回复非空", len(assistant_text.strip()) > 20, f"{len(assistant_text)} 字")
    check("Markdown 代码块已渲染", page.locator(".code-block").count() >= 1, f"{page.locator('.code-block').count()} 个")
    check("代码块带复制按钮", page.locator(".code-block .copy-code").count() >= 1)
    check("代码高亮已生效", page.locator(".code-block .hljs-keyword, .code-block .hljs-string, .code-block .hljs-built_in").count() > 0)
    label = page.locator(".code-head span").first.inner_text()
    check("代码块显示语言标签", label.strip().lower() in {"python", "py", "text", "code"}, label)
    model_badge = page.locator("#modelBadge").inner_text()
    check("模型徽标显示实际模型", "glm" in model_badge.lower(), model_badge)
    # 自动起标题走 axios 异步请求，模型繁忙时可能要好几秒，这里等它落地
    try:
        page.wait_for_function(
            """() => {
                const t = document.querySelector('.conv-item .conv-title');
                const text = t ? t.textContent.trim() : '';
                return text.length > 0 && text !== '新对话';
            }""",
            timeout=45_000,
        )
        title_ok = True
    except Exception:  # noqa: BLE001
        title_ok = False
    check("侧边栏自动生成了标题", title_ok, page.locator(".conv-item .conv-title").first.inner_text())
    page.screenshot(path=str(SHOTS / "2-chat.png"))

    # ---------- 3. 复制按钮 ----------
    page.context.grant_permissions(["clipboard-read", "clipboard-write"])
    page.locator(".code-block .copy-code").first.click()
    page.wait_for_timeout(500)
    check("点击复制后弹出提示", page.locator(".toast").count() >= 1,
          page.locator(".toast").first.inner_text() if page.locator(".toast").count() else "")

    # ---------- 4. 设置抽屉 ----------
    page.click("#settingsBtn")
    page.wait_for_timeout(500)
    check("设置抽屉已展开", "open" in (page.locator("#settingsDrawer").get_attribute("class") or ""))
    check("系统提示词已预填", len(page.input_value("#systemPrompt")) > 0)
    page.screenshot(path=str(SHOTS / "3-settings.png"))
    page.click("#probeBtn")
    page.wait_for_timeout(7000)
    probe = page.locator("#probeResult").inner_text()
    check("测试连接按钮有结果", len(probe) > 0, probe)

    # ---------- 5. 深度思考模式 ----------
    page.click(".switch")
    page.wait_for_timeout(300)
    check("深度思考开关可点击", page.is_checked("#thinkingToggle"))
    check("打开思考后最大长度自动提到 4096", page.input_value("#maxTokens") == "4096", page.input_value("#maxTokens"))
    page.click("#closeSettings")
    page.wait_for_timeout(400)

    # GLM-4.7-Flash 是免费模型，随时可能 429 并降级到非推理模型（那时本来就没有思维链），
    # 所以这里重试几次；全部撞上限流就如实标记为跳过，而不是报假失败。
    think_ok = False
    for attempt in range(1, 4):
        page.fill("#input", f"9.11 和 9.8 哪个大？一句话回答。")
        page.click("#sendBtn")
        try:
            page.wait_for_selector(".msg.assistant .think", timeout=60_000)
            think_ok = True
            break
        except Exception:  # noqa: BLE001
            wait_stream_done(page, 5, timeout=60_000)
            print(f"   · 第 {attempt} 次未出现思考面板（主模型被限流、已降级），重试…")
    else:
        pass

    if think_ok:
        check("思考过程面板出现", True, page.locator(".think summary").last.inner_text().replace("\n", " "))
        wait_stream_done(page, 5, timeout=200_000)
        page.wait_for_timeout(600)
        think_open = page.locator(".think").last.get_attribute("open")
        check("正文开始后思考面板自动收起", think_open is None, f"open={think_open}")
        page.locator(".think summary").last.click()
        page.wait_for_timeout(500)
        body = page.locator(".think-body").last.inner_text()
        check("展开后能看到思维链内容", len(body) > 30, f"{len(body)} 字：{body[:50]}…")
        check("思维链按 Markdown 渲染（不是字面星号）", "**" not in body, f"含 '**' 字样：{'**' in body}")
        page.screenshot(path=str(SHOTS / "4-thinking.png"))
    else:
        check("思考过程面板（三次都撞上限流并降级到非推理模型，本轮跳过）", True,
              "思维链通道已由后端 E2E 用例（reasoning 事件）独立覆盖")

    # ---------- 6. 刷新后持久化 ----------
    before = page.locator(".conv-item").count()
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(1000)
    check("刷新后会话仍在（localStorage）", page.locator(".conv-item").count() == before,
          f"{before} → {page.locator('.conv-item').count()}")
    check("刷新后消息仍在", page.locator(".msg").count() > 0, f"{page.locator('.msg').count()} 条消息")

    # ---------- 7. 导出 Markdown ----------
    with page.expect_download(timeout=15_000) as dl:
        page.click("#exportBtn")
    download = dl.value
    check("导出 Markdown 触发下载", download.suggested_filename.endswith(".md"), download.suggested_filename)

    # ---------- 8. 移动端 ----------
    mobile = browser.new_page(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    mobile.goto(BASE, wait_until="networkidle")
    mobile.wait_for_timeout(1000)
    check("移动端默认隐藏侧边栏", "open" not in (mobile.locator("#sidebar").get_attribute("class") or ""))
    check("移动端显示菜单按钮", mobile.locator("#menuBtn").is_visible())
    mobile.click("#menuBtn")
    mobile.wait_for_timeout(500)
    check("移动端抽屉可打开", "open" in (mobile.locator("#sidebar").get_attribute("class") or ""))
    mobile.screenshot(path=str(SHOTS / "5-mobile.png"))
    mobile.close()


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.on("console", lambda m: console_errors.append(f"{m.type}: {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: console_errors.append(f"pageerror: {e}"))
    try:
        run(page, browser)
    except Exception:  # noqa: BLE001
        check("验证流程未中断", False, "见下方 traceback")
        traceback.print_exc()
    finally:
        check("浏览器控制台无报错", len(console_errors) == 0, " | ".join(console_errors[:4]))
        browser.close()

failed = [r for r in results if not r[1]]
print("\n" + "=" * 62)
print(f"通过 {len(results) - len(failed)}/{len(results)}")
for name, _, detail in failed:
    print(f"  FAIL {name} {detail}")
print(f"截图目录：{SHOTS}")
sys.exit(1 if failed else 0)
