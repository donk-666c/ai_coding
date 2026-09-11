# 素材目录

**文件名必须完全一致**——代码里的路径是写死的，换名字不会自动找到。

## 需要你提供的

| 文件 | 内容 | 说明 |
|---|---|---|
| `wallpaper.png` | 通关壁纸 | 建议 1920×1080 或更大、横版；画面上会被限制在 1080px 宽以内等比例显示 |
| `sponsor-qr.png` | 微信收款码 | 用微信导出的**原图**，不要截图、不要二次压缩、不要缩放 |

## 游戏素材

| 文件 | 来源 |
|---|---|
| `tiles.png` | [Kenney Pixel Platformer](https://kenney.nl/assets/pixel-platformer) 的 `tilemap_packed.png`，20 列 × 9 行 × 18px |
| `chars.png` | 同一素材包的 `tilemap-characters_packed.png`，9 列 × 3 行 × 24px |
| `Kenney-License.txt` | 原始许可证（CC0，署名非必需，但留着以示出处） |

两张图都是 **packed 版**（格子之间没有间隔），所以 `load.spritesheet()` 不需要 `spacing` / `margin`。
帧号 = 行 × 列数 + 列。要改帧号，先用图片查看器打开数一遍，再改 `src/game/config.ts` 的 `FRAMES`。

关于收款码：游戏画面开了 `pixelArt`（最近邻采样），所以收款码走的是 DOM 层，不受影响。
但如果图片本身在保存时被压缩过，手机照样扫不出来。判定标准只有一个——**真的拿手机扫一次**。

两个文件都缺失时，界面上会显示占位提示，游戏流程不受影响。
