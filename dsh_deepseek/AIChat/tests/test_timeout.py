"""验证"上游只连不答"时的兜底行为：必须限时失败，不能吊死调用方。

做法：本地起一个只 accept、永不响应的 TCP 服务冒充智谱接口，
把 READ_TIMEOUT / TOTAL_DEADLINE 调小，断言 stream_chat 在限时内产出 error 事件。
"""
from __future__ import annotations

import os
import socket
import sys
import threading
import time

PORT = 8099
os.environ.update(
    {
        "ZHIPU_API_KEY": "dummy-key-for-timeout-test",
        "ZHIPU_BASE_URL": f"http://127.0.0.1:{PORT}/api/paas/v4",
        "READ_TIMEOUT": "3",
        "CONNECT_TIMEOUT": "2",
        "TOTAL_DEADLINE": "6",
        "MAX_RETRIES": "2",
        "RETRY_BACKOFF": "0.4",
        "GLM_MODEL": "GLM-4.7-Flash",
        "GLM_FALLBACK_MODELS": "glm-4-flash",
    }
)
sys.path.insert(
    0,
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"),
)

stop = threading.Event()
held: list[socket.socket] = []


def hang_server() -> None:
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", PORT))
    srv.listen(8)
    srv.settimeout(0.5)
    while not stop.is_set():
        try:
            conn, _ = srv.accept()
        except TimeoutError:
            continue
        held.append(conn)  # 收下连接但永不回包，模拟"只连不答"
    srv.close()


threading.Thread(target=hang_server, daemon=True).start()
time.sleep(0.4)

import glm  # noqa: E402  必须在设置好环境变量之后再导入，config 在导入时读取

print(f"上游地址 {os.environ['ZHIPU_BASE_URL']}（只连不答）")
print(f"配置：READ_TIMEOUT=3s  TOTAL_DEADLINE=6s  MAX_RETRIES=2\n")

started = time.time()
events = []
for event in glm.stream_chat([{"role": "user", "content": "你好"}], max_tokens=16):
    events.append(event)
    elapsed = time.time() - started
    label = event.get("type")
    detail = event.get("message") or event.get("model") or ""
    print(f"  +{elapsed:5.2f}s  {label:9} {str(detail)[:110]}")

total = time.time() - started
stop.set()
for c in held:
    c.close()

errors = [e for e in events if e.get("type") == "error"]
deltas = [e for e in events if e.get("type") == "delta"]

print()
ok = True
if not errors:
    print("❌ 没有产出 error 事件，调用方会被吊死")
    ok = False
elif total > 12:
    print(f"❌ 限时失效：耗时 {total:.1f}s，远超 TOTAL_DEADLINE")
    ok = False
elif deltas:
    print("❌ 上游没回包却产出了正文，数据来源可疑")
    ok = False
else:
    print(f"✅ 在 {total:.1f}s 内限时失败，并给出了可读的错误信息")
    print(f"   错误：{errors[-1]['message'][:150]}")
    print(f"   尝试过的模型：{errors[-1].get('triedModels')}")
sys.exit(0 if ok else 1)
