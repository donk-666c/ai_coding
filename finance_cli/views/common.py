"""views/common.py —— 多个页签共用的 UI 辅助"""
import db


def month_options() -> list:
    """月份下拉选项: 「全部」+ 数据里实际出现过的月份"""
    return ["全部"] + db.list_months()


def money(value) -> str:
    """金额统一显示两位小数, 如 25.5 -> '25.50'"""
    return f"{value:.2f}"
