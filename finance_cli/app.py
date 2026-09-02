"""记账本 —— 入口

只做页面装配, 具体逻辑在 views/(UI 层) 和 db.py(数据层)。
启动命令(在 finance_cli 目录下):
    .venv/Scripts/python -m streamlit run app.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # 保证 db、views 可 import

import streamlit as st

import db
from views import add_tab, list_tab, stats_tab

# 必须是第一个 streamlit 调用
st.set_page_config(page_title="记账本", layout="centered")

db.init_db()  # 幂等建表: 每次运行顶部调用, 保证表一定存在

# 一次性提示(保存/删除结果): 写的人只放 st.session_state["flash"],
# 在这里显示一次后立即清除, 避免下次刷新还挂着旧消息
if "flash" in st.session_state:
    st.success(st.session_state.pop("flash"))

st.title("💰 记账本")
tab1, tab2, tab3 = st.tabs(["记一笔", "明细", "统计"])
with tab1:
    add_tab.render()
with tab2:
    list_tab.render()
with tab3:
    stats_tab.render()
