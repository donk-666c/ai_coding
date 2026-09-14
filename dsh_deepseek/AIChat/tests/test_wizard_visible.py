"""轻量验证：切到女友版并重启后端后，刷新页面是否会弹出人设向导。

不调用模型，只查 DOM，所以很快。
"""
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8000/"
SHOTS = Path(__file__).resolve().parent / ".shots"
SHOTS.mkdir(exist_ok=True)

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'} | {name}{' — ' + detail if detail else ''}")


with sync_playwright() as p:
    browser = p.chromium.launch()

    # ---------- 场景 1：全新用户（空 localStorage）----------
    print("=== 场景 1：全新用户 ===")
    ctx1 = browser.new_context(viewport={"width": 1440, "height": 900})
    page1 = ctx1.new_page()
    errs1 = []
    page1.on("pageerror", lambda e: errs1.append(str(e)))
    page1.goto(BASE, wait_until="networkidle")
    page1.wait_for_timeout(2500)
    vis1 = page1.locator("#setup").is_visible()
    cards = page1.locator(".persona-card").count()
    names = page1.locator(".persona-name").all_inner_texts()
    check("弹出人设向导", vis1)
    check("6 种性格都在", cards == 6, "、".join(names))
    check("第一步只显示性格选择", page1.locator('.setup-step[data-step="1"]').is_visible())
    check("页面无 JS 报错", len(errs1) == 0, "; ".join(errs1[:2]) or "干净")
    page1.screenshot(path=str(SHOTS / "restore-1-new-user.png"))
    ctx1.close()

    # ---------- 场景 2：老用户（localStorage 里有旧会话，且没有 persona）----------
    print("\n=== 场景 2：你现在的状态（有旧会话、都没有女友设定）===")
    ctx2 = browser.new_context(viewport={"width": 1440, "height": 900})
    page2 = ctx2.new_page()
    page2.goto(BASE, wait_until="domcontentloaded")
    page2.evaluate(
        """() => {
            localStorage.setItem('aichat.v1', JSON.stringify({
                conversations: [
                    { id: 'old1', title: '新对话', createdAt: 1, updatedAt: 3, messages: [] },
                    { id: 'old2', title: '今日天气如何', createdAt: 1, updatedAt: 2, messages: [] }
                ],
                activeId: 'old1',
                settings: {}
            }));
        }"""
    )
    page2.reload(wait_until="networkidle")
    page2.wait_for_timeout(2500)
    vis2 = page2.locator("#setup").is_visible()
    check("也弹出向导（让老会话补上女友设定）", vis2)
    check("侧边栏仍保留旧会话", page2.locator(".conv-item").count() == 2,
          f"{page2.locator('.conv-item').count()} 个")
    page2.screenshot(path=str(SHOTS / "restore-2-old-sessions.png"))
    ctx2.close()

    browser.close()

failed = [r for r in results if not r[1]]
print("\n" + "=" * 56)
print(f"通过 {len(results) - len(failed)}/{len(results)}")
for name, _, detail in failed:
    print(f"  FAIL {name} {detail}")
print(f"截图：{SHOTS}")
sys.exit(1 if failed else 0)
