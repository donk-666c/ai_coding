# 💰 记账本（finance_cli）

一个用 Streamlit 写的极简记账工具：只记支出，数据存本地 SQLite，浏览器里点点就能用。

## 功能

| 页签 | 能做什么 |
|---|---|
| 记一笔 | 填金额/分类/日期/备注，保存一条支出 |
| 明细 | 按月份、分类筛选，看列表，按 ID 删除 |
| 统计 | 分类支出柱状图 + 笔数/金额/合计表 |

**刻意不做的事**：只记支出（没有收入）、没有编辑功能（记错就删了重记）。
范围收窄是为了让每个文件都能一眼读完。

## 快速开始

```bash
py -3 -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
.venv/Scripts/python -m streamlit run app.py
```

浏览器会自动打开 <http://localhost:8501>。
首次运行会在本目录生成 `finance.db`（已 gitignore，不会提交）。

## 项目结构

```
app.py              入口：页面装配、建表、flash 消息显示
db.py               数据层：所有 SQL 都在这里
views/
  __init__.py       依赖方向约定
  add_tab.py        「记一笔」
  list_tab.py       「明细」
  stats_tab.py      「统计」
  common.py         页签共用的 UI 辅助（月份下拉、金额格式化）
```

依赖方向是单向的：`app.py → views/* → db.py`，页面代码不碰 SQL。
各页签之间互不 import，共用代码放 `common.py`。

## 改分类

分类列表是 `db.py` 顶部的 `CATEGORIES` 常量，建表时的 `CHECK` 约束由它生成。
改完要**删掉 `finance.db` 再重启**才会生效（表已经建好了，不会自动迁移）。

## 几个设计取舍

- **每次操作新建连接、用完即关**：Streamlit 刷新可能换线程，跨刷新共享连接会报
  `SQLite objects created in a thread can only be used in that same thread`。
  `timeout=5` 让多窗口同时写入时等待，而不是立刻报 `database is locked`。
- **删除区放在查询之前**：同一轮刷新里先删后查，表格立刻反映删除结果。
- **金额查询时 `ROUND(..., 2)`**：直接消除 `34.47000000000003` 这类浮点尾巴。
- **成功提示走 `session_state["flash"]`**：由 `app.py` 顶部统一显示一次，
  避免下次刷新还挂着旧消息。
- **SQL 值一律走 `?` 参数**：条件拼接只拼列名和结构，值从不拼进字符串。

## 环境

- Python 3.12（`str | None` 这类写法需要 3.10+）
- streamlit >= 1.30、pandas >= 2.0
