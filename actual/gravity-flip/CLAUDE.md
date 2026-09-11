# 翻转引力（Gravity Flip）

重力翻转题材的精确平台跳跃游戏，Tauri 桌面应用，作者署名 **act666**。

## 技术选型

**改动这些决策前先读本节理由**，避免重复讨论已经权衡过的事。

| 决策 | 选择 | 理由 |
|---|---|---|
| 游戏框架 | Phaser **3.90**，不是 Phaser 4 | Phaser 4（2026-04 发布）的新特性——GPU 精灵层、Filters 光照——对 2D 平台跳跃完全用不上，而 Phaser 3 的 API 在 AI 训练数据中远更充分。AI 协作场景下，版本熟悉度比版本新旧值钱 |
| 桌面壳 | Tauri **2**，不是 Electron | Tauri 包体 3~10MB 且体验等同 Electron，而 Electron 光内核就 100~250MB。290MB 上限下，Tauri 把几乎全部预算留给游戏资源 |
| 关卡格式 | **ASCII 文本**，不是 Tiled | AI 能直接读写全部关卡，人也能用记事本改；Tiled 的 JSON 对人和 AI 都是不透明数据块 |
| 逻辑分辨率 | 960×540，48×27 格一屏一关 | 一屏看完整个挑战，死了立刻知道错在哪——比拖动镜头更适合快速重试 |
| 碰撞系统 | Arcade Physics，全局重力设为 0 | 重力必须逐对象设置才能翻转，见下方「重力翻转」 |

## 双层架构（最重要的结构约束）

| 层 | 承载内容 |
|---|---|
| **Phaser Canvas** | 游戏画面 + 数字 HUD（关卡号、死亡数、计时） |
| **HTML DOM 覆盖层** | 主菜单、关卡选择、通关奖励页、赞助页 |

**中文界面一律走 DOM 层**，三条硬理由：

1. **中文不必嵌入字体** —— 完整中文字体 5~10MB，系统字体零成本。canvas 内只出现数字和图形，从根上规避这个体积问题
2. **收款码绝不能被像素化** —— 游戏开了 `pixelArt: true`，Phaser 会对所有纹理做最近邻采样，二维码会变成马赛克导致**扫码失败**。DOM 层以原始像素渲染
3. **布局用 CSS** —— 通关壁纸是任意分辨率的用户图片，自适应缩放在 CSS 里是几行，在 Phaser 里要自己算

## 重力翻转的实现

Phaser 的**全局**重力无法逐对象翻转，但对象**自身**的 `body.gravityY` 可以。所以全部实现是：

```ts
this.gravitySign *= -1;
this.body.setGravityY(this.gravitySign * PHYS.GRAVITY_Y);
```

配合两个必须区分的判断（翻转后「地面」是天花板）：

```ts
isGrounded() { return this.gravitySign === 1 ? body.onFloor() : body.onCeiling(); }
isRising()   { return body.velocity.y * this.gravitySign < 0; }
```

翻转时**刻意保留速度**——先沿原方向滑一小段再被新重力拉走，这个迟滞感是 VVVVVV 手感的关键。

## 目录结构

```
gravity-flip/
├── index.html              # 含 DOM 覆盖层容器
├── src/
│   ├── main.ts             # Phaser.Game 启动
│   ├── style.css           # DOM 层样式
│   ├── ui/overlay.ts       # DOM 层控制器
│   └── game/
│       ├── config.ts       # 全部手感参数（调参入口）
│       ├── scenes/         # BootScene / GameScene
│       ├── objects/        # Player
│       └── level/          # levels.ts（ASCII 数据）+ parser.ts
├── public/assets/          # 素材
└── src-tauri/              # Tauri 壳（最后阶段才建）
```

## 开发命令

```bash
npm run dev      # 浏览器实时开发（热重载）
npm run build    # 类型检查 + 生产构建
```

**开发策略：先纯 Web，最后才套 Tauri 壳。** 手感调好之前不引入 Tauri，否则每次迭代多等数秒。

## 调参入口

**全部手感参数集中在 `src/game/config.ts`。** 精确平台跳跃的手感几乎完全由这些数字决定，而它们没有「正确答案」——只能靠反复试玩调。改数字 → 保存 → 热重载 → 立刻感觉到区别。

四项缺一不可的机制（少任何一项玩家都会觉得「操作不对劲」，但说不清哪里不对）：土狼时间、跳跃缓冲、可变跳跃高度、地空分离的加速度。

## 关卡数据

`src/game/level/levels.ts`，每关 48×27 个字符，**每行必须等长**（长度不符 parser 会直接抛错）。

字符：`.` 空地 | `X` 实心 | `^` 尖刺 | `P` 出生点 | `G` 终点

## 计划与进度

实现计划：`docs/superpowers/plans/2026-09-11-gravity-flip.md`（用 `- [ ]` 复选框跟踪进度）。
