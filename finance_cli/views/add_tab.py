"""views/add_tab.py —— 「记一笔」页签: 表单填写并保存一条支出"""
import datetime

import streamlit as st

import db


def render():
    st.caption("只记支出。金额精确到分, 日期默认今天, 也可以改成其他日期。")
    with st.form("add_form", clear_on_submit=True):
        # 表单里只放输入控件 + 提交按钮; clear_on_submit=True 提交后自动清空,
        # 防止手滑重复提交同一笔
        amount = st.number_input(
            "金额(元)",
            min_value=0.01,
            max_value=1_000_000.0,
            step=0.01,
            format="%.2f",
            value=None,  # 必须传 value=None, placeholder 才会显示
            placeholder="如 25.50",
        )
        category = st.selectbox("分类", db.CATEGORIES)
        day = st.date_input("日期", value=datetime.date.today())
        note = st.text_input("备注(可选)", placeholder="如: 中午和同事吃饭")
        clicked = st.form_submit_button("保存")

    # 处理逻辑放在表单外面(表单里放别的按钮会报错);
    # 点击保存后整个脚本会重跑, 重跑到这里时 clicked 才是 True
    if not clicked:
        return
    if amount is None:  # 清空金额提交时 number_input 返回 None, 需自己校验必填
        st.error("金额不能为空, 请填写后保存")
        return
    rid = db.add_record(
        round(amount, 2),  # 保险起见再四舍五入一次, 抹掉 25.5000000004 这类浮点尾巴
        category,
        day.isoformat(),  # datetime.date -> '2026-09-02'
        note.strip(),
    )
    # 成功提示写进 session_state, 由 app.py 顶部统一显示一次
    st.session_state["flash"] = f"已保存, 记录 ID = {rid}"
