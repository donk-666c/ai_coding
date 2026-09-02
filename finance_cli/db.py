"""db.py —— 数据访问层

所有 SQL 都集中在这里; 页面代码只调用这里的函数, 不碰 SQL。
sqlite3 是 Python 自带的标准库, 不需要额外安装。
"""
import sqlite3
from pathlib import Path

# 6 个固定支出分类。这是唯一需要改的地方: init_db() 的 CHECK 约束
# 会从这份常量自动生成, 改这里后删掉 finance.db 重启即可生效
CATEGORIES = ["餐饮", "交通", "购物", "娱乐", "居住", "其他"]

# 相对本文件定位数据库文件, 与"streamlit 在哪个目录启动"无关
DB_PATH = Path(__file__).resolve().parent / "finance.db"


def _connect() -> sqlite3.Connection:
    """新建一个连接。每个函数独立连接、用完即关:
    streamlit 每次刷新可能换线程, 跨刷新共享连接会报
    "SQLite objects created in a thread can only be used in that same thread"。
    timeout=5: 多个窗口同时写入时等待 5 秒而不是立刻报 database is locked。"""
    conn = sqlite3.connect(DB_PATH, timeout=5)
    conn.row_factory = sqlite3.Row  # 让每行可以 r["amount"] 这样按列名取值
    return conn


def init_db() -> None:
    """幂等建表: 表已存在就什么都不做。app.py 每次运行顶部调用, 开销极小。
    注意: 这里用的是 with 语法自动提交, 但 sqlite3 的 with 只提交事务、
    不会关闭连接, 所以仍要手动 close(见各函数模式)。"""
    category_check = "(" + ", ".join(repr(c) for c in CATEGORIES) + ")"
    conn = _connect()
    try:
        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS records (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                amount   REAL NOT NULL CHECK (amount > 0),   -- 金额(元), 必须为正
                category TEXT NOT NULL CHECK (category IN {category_check}),
                date     TEXT NOT NULL,                      -- 'YYYY-MM-DD' 文本
                note     TEXT NOT NULL DEFAULT ''
            )
            """
        )
        conn.commit()
    finally:
        conn.close()


def add_record(amount: float, category: str, date: str, note: str) -> int:
    """插入一条支出记录, 返回新记录的 ID。
    amount 单位元; date 形如 '2026-09-02'(调用方用 date.isoformat() 保证)"""
    conn = _connect()
    try:
        cur = conn.execute(
            "INSERT INTO records (amount, category, date, note) VALUES (?, ?, ?, ?)",
            (amount, category, date, note),
        )
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def list_records(month: str | None = None, category: str | None = None) -> list:
    """按条件查询支出明细, 新的在前。month 形如 '2026-09', None 表示不过滤。
    条件用列表动态拼接, 但值一律走 ? 参数, 不要改成 f-string 拼值(会注入)。"""
    sql = "SELECT id, amount, category, date, note FROM records"
    conds, params = [], []
    if month:
        conds.append("substr(date, 1, 7) = ?")  # 取 'YYYY-MM-DD' 前 7 位即月份
        params.append(month)
    if category:
        conds.append("category = ?")
        params.append(category)
    if conds:
        sql += " WHERE " + " AND ".join(conds)
    sql += " ORDER BY date DESC, id DESC"
    conn = _connect()
    try:
        # fetchall 已把数据取出来, 连接关闭后 sqlite3.Row 仍可正常读取
        return conn.execute(sql, params).fetchall()
    finally:
        conn.close()


def delete_record(rid: int) -> bool:
    """按 ID 删除记录, 返回是否真的删掉了(False = 该 ID 不存在)。"""
    conn = _connect()
    try:
        cur = conn.execute("DELETE FROM records WHERE id = ?", (rid,))
        conn.commit()
        return cur.rowcount > 0  # 受影响行数要在 commit 之前读
    finally:
        conn.close()


def list_months() -> list:
    """返回所有出现过记录的月份, 新的在前, 如 ['2026-09', '2026-08']。"""
    conn = _connect()
    try:
        return [
            r["m"]
            for r in conn.execute(
                "SELECT DISTINCT substr(date, 1, 7) AS m"
                " FROM records ORDER BY m DESC"
            )
        ]
    finally:
        conn.close()


def category_summary(month: str | None = None) -> list:
    """按月份(可选)统计各分类支出: 每行 category / cnt / total, 金额大的在前。
    ROUND 在 SQL 里直接消除浮点尾巴(如 34.47000000000003)。"""
    sql = (
        "SELECT category AS c, COUNT(*) AS cnt,"
        " ROUND(SUM(amount), 2) AS total FROM records"
    )
    params = []
    if month:
        sql += " WHERE substr(date, 1, 7) = ?"
        params.append(month)
    sql += " GROUP BY category ORDER BY total DESC"
    conn = _connect()
    try:
        return conn.execute(sql, params).fetchall()
    finally:
        conn.close()
