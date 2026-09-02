"""views 包 —— UI 层, 按页签拆分

依赖方向: app.py -> views/* -> db.py
各页签模块互相不 import, 共用代码放在 common.py。
每个模块只暴露一个 render() 函数, 模块顶层不执行任何页面代码。
"""
