# 《翻转引力》实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:executing-plans 逐任务实现此计划（已选定内联执行）。步骤使用复选框（`- [ ]`）语法跟踪进度。

**目标：** 做一个重力翻转题材的精确平台跳跃游戏，5 关，打包成可发给朋友直接玩的 Windows 桌面应用。

**架构：** Phaser 3.90 负责游戏画面（Canvas 层），所有中文界面走 HTML DOM 覆盖层——理由是中文不必嵌字体、二维码不会被 pixelArt 打成马赛克、自适应布局用 CSS 更省事。Tauri 2 套壳分发。

**技术栈：** Phaser 3.90 / TypeScript 5.7 / Vite 6 / Tauri 2

**完整技术决策与调参入口见项目根 `CLAUDE.md`。**

---

## 全局约束

- **逻辑分辨率 960×540**，一关 = 48×27 格 × 18px = 864×486 像素，摄像机固定
- **关卡每行必须 48 字符等长**，不等长 parser 抛错
- **中文不出现于 Canvas 层**，全部走 DOM
- **收款码与壁纸用 DOM 渲染**，不加任何 CSS filter
- **手感参数全部集中在 `src/game/config.ts`**，不散落在各处
- 所有面向用户的文本用中文；代码、变量名、路径用英文

---

## 文件结构

| 文件 | 职责 | 状态 |
|---|---|---|
| `package.json` `tsconfig.json` `vite.config.ts` `.gitignore` | 工程配置 | ✅ |
| `index.html` | 含 DOM 覆盖层容器 | ✅ |
| `src/style.css` | DOM 层全部样式 | ✅ |
| `src/game/config.ts` | 手感参数 + 配色（唯一调参入口） | ✅ |
| `src/game/level/parser.ts` | ASCII → 实体坐标 | ✅ |
| `src/game/level/levels.ts` | 5 关 ASCII 数据 | ✅ |
| `src/game/objects/Player.ts` | 玩家与四项手感机制 | ✅ T3 |
| `src/game/scenes/BootScene.ts` | 用代码生成纹理（占位素材） | ✅ T4 |
| `src/game/scenes/GameScene.ts` | 关卡构建、碰撞、死亡与通关 | ✅ T4 |
| `src/main.ts` | Phaser.Game 启动配置 + 覆盖层接线 | ✅ T4 |
| `src/ui/overlay.ts` | DOM 覆盖层控制器 | ✅ T5 |
| `src/ui/save-wallpaper.ts` | 保存壁纸（Tauri / Web 双路径） | ⬜ T6 |
| `public/assets/` | 素材（用户提供的两张图放这里） | ⬜ T8 |
| `src-tauri/` | Tauri 壳 | ⬜ T9 |

---

## 任务 1：项目脚手架

**文件：** 创建 `package.json`、`tsconfig.json`、`vite.config.ts`、`.gitignore`、`index.html`、`src/style.css`

- [x] **步骤 1：** 手写工程配置（`npx degit` 拉官方模板失败——GitHub 不可达）
- [x] **步骤 2：** `npm install` 安装 Phaser / Vite / TypeScript
- [x] **步骤 3：** `vite.config.ts` 设 `base: './'`（Tauri 打包后从自定义协议加载，绝对路径会 404）
- [x] **步骤 4：** `index.html` 建 `<div id="overlay">` 覆盖层容器
- [x] **步骤 5：** `style.css` 中二维码显式声明 `image-rendering: auto`

**验收：** `npm install` 退出码 0 ✅

---

## 任务 2：配置层与关卡解析器

**文件：** 创建 `src/game/config.ts`、`src/game/level/parser.ts`、`src/game/level/levels.ts`

- [x] **步骤 1：** `config.ts` 集中全部手感参数（`MAX_RUN_SPEED: 240`、`JUMP_VELOCITY: 460`、`GRAVITY_Y: 1500`、`COYOTE_TIME: 100`、`JUMP_BUFFER: 100`、`JUMP_CUT_MULTIPLIER: 0.4`、`FLIP_COOLDOWN: 150`）
- [x] **步骤 2：** `parser.ts` 定义字符约定并解析为坐标数组；缺 `P` 或 `G` 直接抛错
- [x] **步骤 3：** `parser.ts` 校验所有行等长，不等长抛错（手写 ASCII 极易数错）
- [x] **步骤 4：** `levels.ts` 写 5 关 ASCII 数据
- [x] **步骤 5：** 用 node 脚本校验 5 关每行长度均为 48
- [x] **步骤 6（补）：** 终点改为 `goals: GridPos[]` 数组——关卡里终点写成连续的 `GGG`，只记最后一格会让终点缩成 1 格宽

**验收：** 长度校验脚本报告 0 行异常 ✅

---

## 任务 3：玩家手感层

**文件：** 创建 `src/game/objects/Player.ts`；修改 `src/game/config.ts`

本项目最关键的一个文件。四项手感机制缺一不可。

- [x] **步骤 1：** 类骨架——持有 sprite、body、按键映射（左右：`←→`/`AD`；跳跃：`空格`/`Z`；翻转：`↑`/`X`）
- [x] **步骤 2：** 实现重力翻转。全部实现是改 body 自身的 gravityY 符号：

```ts
private flipGravity(): void {
  this.sign = this.sign === 1 ? -1 : 1;
  this.body.setGravityY(this.sign * PHYS.GRAVITY_Y);
  this.sprite.setFlipY(this.sign === -1);
  this.flipCooldownTimer = PHYS.FLIP_COOLDOWN;
  // 速度刻意保留：翻转后先沿原方向滑一小段再被新重力拉走。
  // 这个迟滞感是 VVVVVV 手感的关键，清空速度会让翻转显得生硬。
}
```

- [x] **步骤 3：** 实现两个必须随重力方向翻转语义的判断：

```ts
/** 翻转后「地面」是天花板 */
private isGrounded(): boolean {
  return this.sign === 1 ? this.body.onFloor() : this.body.onCeiling();
}

/**
 * 是否正沿重力反方向运动（正在「上升」）。
 * 带参数是因为判断跳跃状态时要传「起跳时」记下的方向——
 * 翻转会让当前方向突变，用它去判断旧跳跃会把速度误砍。
 */
private isRising(sign: GravitySign = this.sign): boolean {
  return this.body.velocity.y * sign < 0;
}
```

- [x] **步骤 4：** 实现土狼时间——站在支撑面上时计时器保持满值，离地后倒计时
- [x] **步骤 5：** 实现跳跃缓冲 + 起跳判定（两者同时有效才真正起跳）：

```ts
if (this.jumpBufferTimer > 0 && this.coyoteTimer > 0) {
  this.body.setVelocityY(-PHYS.JUMP_VELOCITY * this.sign);
  this.jumpBufferTimer = 0;
  this.coyoteTimer = 0;
  this.jumpCutPending = true;
  this.jumpSign = this.sign;
}
```

- [x] **步骤 6：** 实现可变跳跃高度——仅在**松手那一帧**削减上升速度，不是每帧削减（每帧削减会让速度指数衰减，跳高远低于预期）
- [x] **步骤 7：** 实现水平控制——地面/空中分离的加速度；无输入时手动改速度而非用 Phaser 的 drag（drag 与 acceleration 会相互干扰）
- [x] **步骤 8：** `JustDown`/`JustUp` 每帧只检测一次。它们会消费标志位，多次调用会漏判。多按键检测必须遍历全部而非短路：

```ts
function anyJustDown(keys: readonly Phaser.Input.Keyboard.Key[]): boolean {
  let hit = false;
  for (const key of keys) {
    if (Phaser.Input.Keyboard.JustDown(key)) hit = true;
  }
  return hit;
}
```

- [x] **步骤 9：** 实现 `respawn()`——重置重力方向、位置、速度与全部计时器
- [x] **步骤 10（补）：** `config.ts` 新增 `TURN_ACCEL_MULTIPLIER: 2`——反向输入时用双倍加速度，否则急停转向有「飘」感
- [x] **步骤 11（补）：** 碰撞箱设为 12×16 + offset(3,1)，比 18×18 的视觉小一圈，避免玩家被「看起来能过去」的缝隙卡住

**验收：** `npx tsc --noEmit` 退出码 0 ✅

---

## 任务 4：场景与启动（可玩里程碑）

**文件：** 创建 `src/game/scenes/BootScene.ts`、`src/game/scenes/GameScene.ts`、`src/main.ts`

完成后应能在浏览器里跑、跳、翻转。

- [x] **步骤 1：** `BootScene` 用 `Graphics.generateTexture()` 生成占位纹理（solid / spike / player / goal），先不依赖外部素材
- [x] **步骤 2：** `GameScene.buildLevel()` 解析 ASCII，用静态物理组创建实心块与尖刺
- [x] **步骤 3：** 设置 `physics.world.setBounds()` 留出上下余量——翻转时玩家会飞出天花板缺口，需要边界兜住
- [x] **步骤 4：** 碰撞：玩家 × 实心块 = `collider`；玩家 × 尖刺 = `overlap` → 死亡重生
- [x] **步骤 5：** `main.ts` 配置 Phaser：`pixelArt: true`、`scale.mode: FIT`、**`arcade.gravity = {x:0, y:0}`**（全局重力必须为 0，每个 body 自己设）
- [x] **步骤 6：** 通关检测：碰到 `G` 且有下一关则 `scene.restart({ level: n+1 })`，否则派发 `game:complete` 事件给 DOM 层
- [x] **步骤 7（试玩后补）：** `checkFellOff()`——掉出关卡范围即死。原先只靠世界边界兜底，结果那 4 格余量变成了安全区，玩家能站在半空自己翻转回来，所有深渊都失去意义
- [x] **步骤 8（试玩后补）：** 尖刺判定箱缩到底部 14×9，不再是整格——否则「擦到尖刺上方的空气」就死
- [x] **步骤 9（试玩后补）：** 第 4、5 关重新设计：拉长路径、天花板加阻挡墙、加宽尖刺区。关卡行数据改由脚本按坐标生成，避免手数 48 个字符出错
- [x] **步骤 10（试玩后补）：** 可变跳跃高度改用「松手时压到固定值」而非「乘以系数」——乘法在低端太平，快速点按时仍接近满速，体感上只剩两档
- [x] **步骤 11（审查后补）：** `onReachGoal()` 加一次性门闩。终点写成连续 `GGG`，即三个独立判定体，身体跨在两格交界时同一帧会触发两次回调，切关时 `create` 会跑两遍；最后一关没有 restart 截断，站着不动就每帧重复派发 `game:complete`
- [x] **步骤 12（审查后补）：** 翻转重力时作废本次跳跃的松手削减。否则翻转飞行途中松手，会被按「起跳时」的方向判定为仍在上升，把新重力刚积累的速度砍掉近九成——第 4 关的核心操作序列正是「起跳 → 翻转 → 松手」
- [x] **步骤 13（试玩后调整）：** 第 5 关柱子由 4 格加高到 5 格（90px，而满跳只有 66.75px）。原高 72px 与满跳只差 5px，玩家会误以为「差一点就够」而反复硬跳；拉开到一眼可辨，才会去找翻转路线。**这关的解法本就是翻转上天花板绕行，不是跳过去**——曾误判为关卡数据错误把柱子调矮，已回退
- [x] **步骤 14（试玩后调整）：** 第 1 关补上顶行天花板。让玩家在最初这关就敢按翻转键：翻过来是落到天花板上，而不是飞出关卡

**验收：**
```
npm run dev
```
浏览器打开 `localhost:8080`，能用方向键移动、空格跳跃、↑/X 翻转重力，碰到尖刺或掉出关卡都会回到出生点

---

## 任务 5：DOM 覆盖层

**文件：** 创建 `src/ui/overlay.ts`；修改 `src/main.ts`、`index.html`

- [x] **步骤 1：** 覆盖层入口——私有的 `show(screen, html)` / `hide()` 两个方法，各界面（主菜单 / 关卡选择 / 赞助 / 暂停 / 通关）自己渲染模板。点击事件用委托挂在根节点上，界面重建时不必重新绑事件
- [x] **步骤 2：** 主菜单——标题《翻转引力》、开始游戏、赞助作者、操作说明（←→ 移动 / 空格 跳跃 / ↑ 翻转重力）
- [x] **步骤 3：** 关卡选择——5 个按钮，未通关的禁用；最好成绩塞进 `title` 属性（按钮只有 84px 见方，放不下文字）
- [x] **步骤 4：** 进度存档用 `localStorage`，记录已通关关卡与每关最佳死亡数、用时（死亡数优先，相同才比用时）
- [x] **步骤 5：** 游戏内 HUD 用 Phaser 渲染——只有数字，不需要中文字体（T4 已完成）
- [x] **步骤 6（补）：** 暂停菜单——游戏内按 Esc 唤出「继续游戏 / 返回主菜单」。没有这个出口，玩家进了游戏就回不来
- [x] **步骤 7（补）：** `BootScene` 改为生成纹理后直接 `stop()`，不再自行进入游戏；何时开始由主菜单决定

**验收：** 主菜单能开始游戏，通关一关后返回菜单能看到下一关解锁，刷新页面进度仍在

---

## 任务 6：通关奖励页与赞助页

**文件：** 创建 `src/ui/save-wallpaper.ts`；修改 `src/ui/overlay.ts`

**需要用户提供两个文件**（未提供时显示占位提示，不阻塞开发）：
- `public/assets/wallpaper.png` —— 通关壁纸
- `public/assets/sponsor-qr.png` —— 微信收款码

- [x] **步骤 1：** 通关奖励页——壁纸（等比例自适应）+ 文案「恭喜你通关，获得精美壁纸一张」+ 署名「作者 act666」
- [x] **步骤 2：** 保存壁纸按钮。Web 环境用 `a[download]` 触发下载，结果以轻提示反馈（成功 / 取消 / 失败三种文案）
- [x] **步骤 3：** 赞助页——收款码原尺寸展示，不加缩放变换；主菜单与通关页都有入口，从通关页进来时返回键退回通关页而不是主菜单
- [x] **步骤 4：** 素材缺失时渲染 `.placeholder` 提示而非破图；壁纸缺失时「保存壁纸」按钮直接置灰，而不是让玩家点了才发现失败
- [x] **步骤 5（补）：** 新建 `public/assets/` 并附 README，写明两个文件的规格要求（收款码必须用原图，判定标准是真拿手机扫一次）
- [ ] **步骤 6（推迟到 T9）：** Tauri 原生保存对话框（`plugin-dialog` + `plugin-fs`）。这条路径必须在 Tauri 环境里才验证得了，现在写等于盲写；`SaveOutcome` 已预留 `'cancelled'`，届时补上分支即可
- [ ] **步骤 7（待素材）：** 放入 `public/assets/wallpaper.png` 与 `public/assets/sponsor-qr.png`

**验收：** 用真实收款码图片，**手机实际扫码能扫出来**（必须真扫，这是像素化问题的唯一验证方式）

---

## 任务 7：表现层

**文件：** 修改 `src/game/scenes/GameScene.ts`、`src/game/objects/Player.ts`

- [ ] **步骤 1：** 落地尘土粒子（落地速度越快越明显）
- [ ] **步骤 2：** 死亡像素爆散粒子 + 摄像机短促震动
- [ ] **步骤 3：** 翻转时的视觉反馈（`setFlipY` 已有，补充速度线或颜色闪烁）
- [ ] **步骤 4：** 音效——跳跃、翻转、死亡、通关。可用 Web Audio 实时合成（零素材体积）

**验收：** 手感反馈明显但不干扰操作判断

---

## 任务 8：Kenney 像素素材接入

**文件：** 下载至 `public/assets/`；修改 `BootScene.ts`、`GameScene.ts`

- [ ] **步骤 1：** 下载 [Kenney Pixel Platformer](https://kenney.nl/assets/pixel-platformer)（CC0，可商用，18×18）
- [ ] **步骤 2：** `BootScene` 改为 `this.load.spritesheet()` 加载真实素材
- [ ] **步骤 3：** 玩家动画：idle / run / jump / fall / death
- [ ] **步骤 4：** 调整碰撞箱——像素角色贴图四周留白多，碰撞箱必须单独定尺寸

**验收：** 画面为像素素材，比例正确无拉伸

---

## 任务 9：Tauri 打包

**文件：** 创建 `src-tauri/`

- [ ] **步骤 1：** `npm create tauri-app` 或手动添加 `src-tauri/`
- [ ] **步骤 2：** `tauri.conf.json` 的 `frontendDist` 指向 `../dist`，窗口标题设「翻转引力」
- [ ] **步骤 3：** 窗口配置：固定逻辑尺寸、禁止右键菜单、`resizable` 按需
- [ ] **步骤 4：** `webviewInstallMode` 先用默认 `downloadBootstrapper`（包约 5MB，首次运行需联网装 WebView2）；若分发对象环境不确定，改 `offlineInstaller`（约 130MB，完全离线）
- [ ] **步骤 5：** `npm run tauri build` 产出 exe

**验收：** 本机双击 exe 能独立运行；把 exe 发给一位朋友，对方无需安装任何东西即可玩

---

## 任务 10：飞行彩蛋（试玩中发现）

**背景：** 试玩时发现，卡着节奏点按翻转键可以让角色持续滞空——「翻转保留速度」加「150ms 冷却」的组合，使得在速度接近 0 的时刻反复翻转能够悬停。

**决策：不修掉，做成彩蛋。** 理由：在落地前禁止翻转会直接废掉第 4 关的核心玩法（空中连续翻转），而「随时可翻」正是这类游戏手感的基础。堵不如疏。

- [ ] **步骤 1：** `Player` 里累计「连续滞空时长」——接地（按重力方向判断的地面或天花板）时清零，否则累加
- [ ] **步骤 2：** 超过 5 秒派发一次性事件 `player:hovering`，整局只触发一次
- [ ] **步骤 3：** DOM 层弹提示「你发现了飞行——这不在设计之内，但挺酷的」，并写进 `localStorage` 作为成就
- [ ] **步骤 4：** 主菜单显示已解锁成就（可选）

**验收：** 空中滞留满 5 秒弹出提示；正常游玩全程不触发

---

## 风险与已知取舍

| 项 | 说明 |
|---|---|
| **跨平台** | Tauri 在 macOS/Linux 用不同 WebView，渲染可能不一致。**当前只针对 Windows**；要跨平台需逐平台验证 |
| **WebView2 依赖** | Win11 自带；老 Win10 可能没有，靠安装包的 bootstrapper 自动装 |
| **手感调参无法由 AI 完成** | 参数表只是起点，最终值必须靠人反复试玩——这是本类游戏最耗时也最不可省略的部分 |
| **关卡平衡** | 5 关的难度曲线需要实际试玩迭代，不是一次设计到位 |
