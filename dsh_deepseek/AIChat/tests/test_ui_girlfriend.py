"""AI 女友改造的端到端验证：人设向导 → 主题切换 → 开场白 → 聊天。

用法: py tests/test_ui_girlfriend.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8000/"
SHOTS = Path(__file__).resolve().parent / ".shots"
SHOTS.mkdir(exist_ok=True)

results: list[tuple[str, bool, str]] = []
errors: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'} | {name}{' — ' + detail if detail else ''}")


def wait_stream_done(page, minimum: int = 4, timeout: int = 180_000) -> None:
    """等正文结束（排除思考面板里的文字）。"""
    page.wait_for_function(
        """(min) => {
            const b = document.querySelector('.msg.assistant .bubble:last-of-type') ||
                      [...document.querySelectorAll('.msg.assistant .bubble')].pop();
            if (!b) return false;
            const clone = b.cloneNode(true);
            clone.querySelectorAll('.think').forEach((n) => n.remove());
            const text = (clone.textContent || '').trim();
            return text.length > min && !b.querySelector('.caret') && !b.querySelector('.typing');
        }""",
        arg=minimum,
        timeout=timeout,
    )


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text[:200]}") if m.type == "error" else None)

    page.goto(BASE, wait_until="networkidle")
    page.wait_for_timeout(2000)

    # ---------- 1. 全新用户：直接进人设向导 ----------
    check("全新用户直接进入人设向导", page.locator("#setup").is_visible())
    check("性格卡片有 6 张", page.locator(".persona-card").count() == 6,
          f"{page.locator('.persona-card').count()} 张")
    names = page.locator(".persona-name").all_inner_texts()
    check("六种性格名称正确", names == ["温柔", "傲娇", "犀利", "害羞", "黏人", "高冷"], "、".join(names))
    check("第一步只显示性格选择", page.locator('.setup-step[data-step="1"]').is_visible()
          and not page.locator('.setup-step[data-step="2"]').is_visible())
    check("此时还没有会话", page.locator(".conv-item").count() == 0)
    page.screenshot(path=str(SHOTS / "gf-1-persona.png"))

    # ---------- 2. 选「傲娇」→ 主题色应立刻切换 ----------
    page.get_by_text("傲娇", exact=True).click()
    page.wait_for_timeout(800)
    accent = page.evaluate("() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()")
    check("选中性格后整站主题色切换", accent.lower() == "#fb7185", f"--accent={accent}")
    check("自动进入第二步", page.locator('.setup-step[data-step="2"]').is_visible())
    check("回显选中的她", page.locator("#pickedPreview b").inner_text() == "傲娇")
    check("提供名字建议", page.locator(".name-chip").count() >= 3, f"{page.locator('.name-chip').count()} 个")
    page.screenshot(path=str(SHOTS / "gf-2-name.png"))

    # ---------- 3. 起名字 → 开始聊天 ----------
    page.click(".name-chip >> nth=0")  # 用第一个建议名
    suggested = page.input_value("#partnerName")
    check("点建议名会填入输入框", len(suggested) > 0, suggested)
    page.fill("#partnerName", "阿凛")
    page.click("#setupDone")
    page.wait_for_timeout(1200)

    check("向导已关闭", not page.locator("#setup").is_visible())
    check("生成了会话", page.locator(".conv-item").count() == 1)
    check("她主动说了第一句话", page.locator(".msg.assistant").count() == 1)
    greeting = page.locator(".msg.assistant .bubble").first.inner_text().strip()
    check("开场白里用了她的名字", "阿凛" in greeting, greeting[:60])
    check("头部标题是她的名字", page.locator("#chatTitle").inner_text() == "阿凛",
          page.locator("#chatTitle").inner_text())
    check("头部显示性格标签", page.locator("#personaBadge").inner_text() == "傲娇",
          page.locator("#personaBadge").inner_text())
    check("头部显示她的 emoji 头像", len(page.locator("#partnerAvatar").inner_text().strip()) > 0,
          page.locator("#partnerAvatar").inner_text().strip())
    check("侧边栏用 emoji 当图标", page.locator(".conv-emoji").count() == 1)
    check("输入框提示带她的名字", "阿凛" in (page.locator("#input").get_attribute("placeholder") or ""),
          page.locator("#input").get_attribute("placeholder"))
    page.screenshot(path=str(SHOTS / "gf-3-chat.png"))

    # ---------- 4. 真的按人设聊天 ----------
    page.fill("#input", "今天上班被领导骂了，好累。")
    page.click("#sendBtn")
    wait_stream_done(page, 4, 180_000)
    page.wait_for_timeout(400)
    reply = page.locator(".msg.assistant .bubble").last.inner_text().strip()
    check("她回复了", len(reply) > 4, reply[:70].replace("\n", " "))
    check("没有自称 AI/助手/模型", not re.search(r"(AI|人工智能|语言模型|助手|程序)", reply),
          reply[:70].replace("\n", " "))
    # 上面这句是「倾诉」场景，按新长度规则她应该说长一点（实测 ~240 字）。
    # 这里只守住上限，防止退化成小作文；「有长有短」由 tests/test_length.mjs 专门验证。
    check("倾诉时可以说长，但没写成小作文（< 500 字）", len(reply) < 500, f"{len(reply)} 字")
    page.screenshot(path=str(SHOTS / "gf-4-reply.png"))

    # ---------- 5. 换一个她 ----------
    page.click("#editPersonaBtn")
    page.wait_for_timeout(700)
    check("「换一个她」能重开向导", page.locator("#setup").is_visible())
    check("重开时预选了当前性格", page.locator(".persona-card.on").count() == 1)
    check("重开时带出当前名字", page.input_value("#partnerName") == "阿凛", page.input_value("#partnerName"))

    page.get_by_text("害羞", exact=True).click()
    page.wait_for_timeout(700)
    page.fill("#partnerName", "小柚")
    page.click("#setupDone")
    page.wait_for_timeout(900)
    check("换人后标题跟着变", page.locator("#chatTitle").inner_text() == "小柚",
          page.locator("#chatTitle").inner_text())
    check("换人后性格标签跟着变", page.locator("#personaBadge").inner_text() == "害羞",
          page.locator("#personaBadge").inner_text())
    accent2 = page.evaluate("() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()")
    check("换人后主题色也变了", accent2.lower() == "#f9a8d4", f"--accent={accent2}")
    check("改设定不会清空已聊记录", page.locator(".msg").count() >= 3, f"{page.locator('.msg').count()} 条消息")
    page.screenshot(path=str(SHOTS / "gf-5-switched.png"))

    # ---------- 6. 刷新后保持 ----------
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(1800)
    check("刷新后不重复弹向导", not page.locator("#setup").is_visible())
    check("刷新后人设仍在", page.locator("#personaBadge").inner_text() == "害羞",
          page.locator("#personaBadge").inner_text())
    check("刷新后聊天记录还在", page.locator(".msg").count() >= 3, f"{page.locator('.msg').count()} 条")

    check("浏览器控制台无报错", len(errors) == 0, " | ".join(errors[:3]) or "干净")
    browser.close()

failed = [r for r in results if not r[1]]
print("\n" + "=" * 62)
print(f"通过 {len(results) - len(failed)}/{len(results)}")
for name, _, detail in failed:
    print(f"  FAIL {name} {detail}")
print(f"截图：{SHOTS}")
sys.exit(1 if failed else 0)
