import Phaser from 'phaser';
import { CHAR_SIZE, COLORS, FRAMES, TILE } from '../config';

/**
 * 启动场景：加载 Kenney 素材、用代码补齐素材里没有的纹理、注册动画。
 *
 * 素材里没有尖刺——Kenney Pixel Platformer 是冒险风格，不是陷阱风格。
 * 尖刺和终点继续用代码画：危险物用高对比的纯色三角，可读性比勉强找一张
 * 贴图来凑更好，这也是像素游戏的常见做法。
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    // 用 packed 版（无间隔），所以不需要 spacing / margin 参数
    this.load.spritesheet('tiles', './assets/tiles.png', {
      frameWidth: TILE,
      frameHeight: TILE,
    });
    this.load.spritesheet('chars', './assets/chars.png', {
      frameWidth: CHAR_SIZE,
      frameHeight: CHAR_SIZE,
    });
  }

  create(): void {
    this.makeTextures();
    this.makeAnimations();

    // 主菜单在 Phaser 启动的同时就画出来了，但按钮要等素材就位才能点。
    // 本地加载虽快，却没快到可以赌——冷启动、机械硬盘上都可能慢一拍
    this.game.events.emit('boot:ready');

    // 纹理就绪后这个场景就没用了。何时进游戏由 DOM 主菜单决定，
    // 所以这里不启动任何场景——canvas 空着不影响观感，覆盖层是全屏不透明的
    this.scene.stop();
  }

  private makeTextures(): void {
    const g = this.make.graphics({ x: 0, y: 0 });

    // 尖刺：始终朝上的三角形。它不随重力翻转——危险物的方向是关卡设计的一部分
    g.fillStyle(COLORS.SPIKE, 1);
    g.fillTriangle(TILE / 2, 1, 1, TILE - 1, TILE - 1, TILE - 1);
    g.generateTexture('spike', TILE, TILE);
    g.clear();

    // 终点：一条绿色横带，宽度正好占满一格
    g.fillStyle(COLORS.GOAL, 1);
    g.fillRect(0, 3, TILE, TILE - 6);
    g.generateTexture('goal', TILE, TILE);
    g.clear();

    // 粒子：一个 4px 白方块。落地尘土、死亡碎片、翻转火花共用这一张，
    // 靠 emitter 的 tint 上色——多画几张不同颜色的纹理只是白占显存
    g.fillStyle(0xffffff, 1);
    g.fillRect(0, 0, 4, 4);
    g.generateTexture('dust', 4, 4);

    g.destroy();
  }

  private makeAnimations(): void {
    // 角色的两帧在垂直方向各错开 1px，交替播放就是上下颠的走路动作。
    // 帧率不宜高——两帧的像素角色切太快会糊成一团，8 帧/秒看着最像走路
    this.anims.create({
      key: 'player-run',
      frames: this.anims.generateFrameNumbers('chars', {
        frames: [FRAMES.PLAYER_IDLE, FRAMES.PLAYER_WALK],
      }),
      frameRate: 8,
      repeat: -1,
    });
  }
}
