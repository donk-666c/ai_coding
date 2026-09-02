"""views/list_tab.py —— 「明细」页签: 按月份/分类筛选列表, 按 ID 删除"""
import pandas as pd
import streamlit as st

import db
from views import common


def render():
    month = st.selectbox("月份", common.month_options(), key="list_month")
    category = st.selectbox("分类", ["全部"] + db.CATEGORIES, key="list_category")

    # 删除区放在查询之前: 同一轮刷新里先删除后查询, 表格立刻反映删除结果
    del_id = st.number_input(
        "要删除的记录 ID(见下方表格第一列)",
        min_value=1,
        step=1,
        value=None,
        placeholder="如 3",
    )
    if st.button("删除该 ID", type="primary"):
        if del_id is None:
            st.error("请先输入要删除的 ID")
        elif db.delete_record(int(del_id)):  # 输入框可能返回非 int, 保险起见转一次
            st.session_state["flash"] = f"已删除 ID = {del_id}"
        else:
            st.warning(f"ID {del_id} 不存在, 可能已被删除")

    rows = db.list_records(
        None if month == "全部" else month,
        None if category == "全部" else category,
    )
    if not rows:
        st.info("当前条件下没有记录")  # 空数据先挡住, 不画表格
        return
    df = pd.DataFrame([dict(r) for r in rows])
    df = df.rename(
        columns={"id": "ID", "amount": "金额(元)", "category": "分类",
                 "date": "日期", "note": "备注"}
    )
    df["金额(元)"] = df["金额(元)"].map(common.money)  # 金额转文本, 统一两位小数
    st.dataframe(df, width="stretch", hide_index=True)
