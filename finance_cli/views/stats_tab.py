"""views/stats_tab.py —— 「统计」页签: 分类支出柱状图 + 统计表"""
import pandas as pd
import streamlit as st

import db
from views import common


def render():
    # label 用「统计月份」而非「月份」, 避免和明细页的同名控件互相干扰
    month = st.selectbox("统计月份", common.month_options(), key="stat_month")

    rows = db.category_summary(None if month == "全部" else month)
    if not rows:
        st.info("该范围暂无支出, 先去「记一笔」添加吧")  # 空数据先挡住, 不画图
        return
    stat = pd.DataFrame([dict(r) for r in rows])
    stat = stat.rename(columns={"c": "分类", "cnt": "笔数", "total": "金额(元)"})

    # 柱状图: 行序按金额从大到小(查询里已 ORDER BY), 便于扫一眼看大头;
    # 显式指定 x/y 列(不写 y 的话「笔数」也会被画成一个系列)
    st.bar_chart(stat, x="分类", y="金额(元)")
    st.divider()

    # 统计表: 金额列转成文本后追加「合计」行。
    # 注意顺序: 文本列不能求和, 所以先用数值列算出合计、再显示文本
    show = stat.copy()
    show["金额(元)"] = show["金额(元)"].map(common.money)
    show.loc[len(show)] = [
        "合计",
        int(stat["笔数"].sum()),
        f"{stat['金额(元)'].sum():.2f}",
    ]
    st.dataframe(show, width="stretch", hide_index=True)
