# ai_coding

用 AI 协作开发的代码仓库。三个独立项目，各自有详细 README。

| 项目 | 是什么 | 技术栈 | 详情 |
|---|---|---|---|
| `actual/gravity-flip` | 「翻转引力」——重力翻转题材的精确平台跳跃游戏，5 关，计时 + 死亡计数，通关有壁纸奖励 | Phaser 3 · Tauri 2 | [README](actual/gravity-flip/) |
| `dsh_deepseek/AIChat` | 智谱 GLM 对话机器人，前后端分离，支持真流式输出、多会话、思维链展示；默认锁定免费模型白名单 | Flask · 原生 HTML/CSS/JS | [README](dsh_deepseek/AIChat/) |
| `finance_cli` | 记账本——只记支出，数据存本地 SQLite，浏览器里点点就能用 | Streamlit · SQLite | [README](finance_cli/) |

三个项目互不依赖，可以单独打开。各自的 README 里有完整的上手命令、目录结构和设计取舍说明。

## 目录说明

本地目录名是 `vibeCoding`，远程仓库名是 `ai_coding` —— 两者是同一个仓库，改名时没动本地目录。

下面这些目录**只存在于本地，不在仓库里**（已被 `.gitignore` 排除），所以 clone 下来看到的内容比上面表格列的要少，属正常：

| 目录 | 为什么不提交 |
|---|---|
| `actual/gravity-flip-dist/` | 打包产物（exe / 安装包），每次发版都会重新生成 |
| `actual/personal/` | 私人笔记 |
| `dsh_deepseek/dsh_native/` | 空目录占位，Git 不跟踪空目录 |

## 分支

| 分支 | 内容 |
|---|---|
| `master` | 主线，通用对话机器人 |
| `ai-girlfriend` | AIChat 的 AI 女友版实验分支 |

## 仓库约定

- **密钥**：`.env` 一律 gitignore，仓库里只提交 `.env.example` 模板
- **分支**：实验性改动走 `ai-girlfriend`，`master` 保持可用
- **不跟踪**：打包产物、本地笔记、依赖目录（见 `.gitignore`）
