# 翻转引力

重力翻转题材的精确平台跳跃游戏。5 关，计时 + 死亡计数，通关有壁纸奖励。
Tauri 2 桌面应用，打包后 9.3MB。

## 三条命令

都在项目根目录下跑。

| 命令 | 干什么 | 什么时候用 |
|---|---|---|
| `npm run dev` | 浏览器里跑，改完即时生效 | 改关卡、调手感 |
| `npm run pack` | 构建 + 自动同步到发布目录 | 要发新版给朋友 |
| `npm run clean` | 清掉 Rust 编译缓存（约 1.4G） | 磁盘紧张时 |

### `npm run pack`

依次做五件事：

1. `tsc --noEmit` —— 类型检查。有错就停，不会打包出一个坏版本
2. `vite build` —— 前端产物进 `dist/`
3. `cargo build` —— 编译 Rust，产出 `src-tauri/target/release/gravity-flip.exe`
4. `makensis` —— 生成 NSIS 安装包
5. `scripts/sync-dist.mjs` —— 把成品复制到 `../gravity-flip-dist/`

**第 5 步是这个脚本存在的理由**：以前它靠手工 `cp`，忘了就会把上一版发出去——
等对方已经在玩了才发现，很难收场。成品也特意存到项目外面，因为
`src-tauri/target/` 是「清理磁盘时容易被整个端掉」的位置。

**跑之前先关掉游戏。** exe 被占用时脚本会重试 4 秒；你要是正玩着，重试再久也没用，
它会直接告诉你「游戏是不是还开着」，而不是甩一段 Node 报错出来。

### `npm run clean`

删这四个目录：

```
src-tauri/target/release/deps
src-tauri/target/release/build
src-tauri/target/release/incremental
src-tauri/target/debug
```

全是依赖库编译出来的中间产物，源码一个字节都不在里面，加起来 1.4G 上下。

**故意不碰** `release/` 下的 exe 和 `bundle/` —— 那是要发出去的成品，不该跟缓存一起消失。
这也是为什么不能图省事直接把整个 `target/` 删掉。

代价：下次 `pack` 要重编依赖，约 2 分钟。之后就回到 30 秒。

## 分发给朋友

`../gravity-flip-dist/` 里三个文件：

| 文件 | 用途 |
|---|---|
| `翻转引力.exe` | 免安装，双击就跑 · 9.3MB |
| `gravity-flip.exe` | 同一份文件的英文名，命令行里少些麻烦 |
| `翻转引力_1.0.0_x64-setup.exe` | NSIS 安装版 · 2.6MB |

两条踩过的坑：

- 微信、QQ 对 `.exe` 多半会拦截，**发之前先压成 zip**
- 对方首次打开会弹「Windows 已保护你的电脑 · 未知发布者」，点「更多信息 → 仍要运行」即可。
  自己 build 的在本机不会弹，别人收到的才弹

## 改内容从哪下手

| 想改什么 | 去哪 |
|---|---|
| 手感参数（跑速、重力、跳跃） | `src/game/config.ts` |
| 关卡 | `src/game/level/levels.ts`（ASCII 文本，记事本能改） |
| 界面文字与流程 | `src/ui/overlay.ts` |
| 应用图标 | 改 `scripts/make-icon.mjs` 后重跑它，再跑 `npx tauri icon src-tauri/icons/icon-source.png` |
| 壁纸 / 收款码 | 覆盖 `public/assets/` 下的文件，**扩展名要跟实际内容一致** |

## 环境要求

- Node 18+
- Rust 工具链 —— 只有打包需要，`npm run dev` 用不上
- Windows 还需要 VS 2022 的「C++ 生成工具」和 Windows SDK
