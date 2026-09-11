import Phaser from 'phaser';
import { COLORS, TILE } from '../config';

/**
 * 启动场景：用代码画出全部纹理。
 *
 * 现阶段不加载任何外部素材，好处是「能不能跑」和「素材对不对」两件事
 * 互不干扰——占位图形一旦跑通，之后换成 Kenney 素材时如果出问题，
 * 就一定出在素材本身而不是逻辑里。
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    this.makeTextures();
    // 纹理就绪后这个场景就没用了。何时进游戏由 DOM 主菜单决定，
    // 所以这里不启动任何场景——canvas 空着不影响观感，覆盖层是全屏不透明的
    this.scene.stop();
  }

  private makeTextures(): void {
    const g = this.make.graphics({ x: 0, y: 0 });

    // 实心块：深色块 + 亮一档的描边，让相连的地块之间还能看出格子边界
    g.fillStyle(COLORS.SOLID, 1);
    g.fillRect(0, 0, TILE, TILE);
    g.lineStyle(1, COLORS.SOLID_EDGE, 1);
    g.strokeRect(0.5, 0.5, TILE - 1, TILE - 1);
    g.generateTexture('solid', TILE, TILE);
    g.clear();

    // 尖刺：始终朝上的三角形。它不随重力翻转——危险物的方向是关卡设计的一部分
    g.fillStyle(COLORS.SPIKE, 1);
    g.fillTriangle(TILE / 2, 1, 1, TILE - 1, TILE - 1, TILE - 1);
    g.generateTexture('spike', TILE, TILE);
    g.clear();

    // 玩家：方块加两只眼睛。眼睛不是装饰——重力翻转时整张图上下颠倒，
    // 有眼睛才能一眼看出「我现在朝哪边站」
    g.fillStyle(COLORS.PLAYER, 1);
    g.fillRect(1, 1, TILE - 2, TILE - 2);
    g.fillStyle(COLORS.BG, 1);
    g.fillRect(4, 4, 3, 4);
    g.fillRect(11, 4, 3, 4);
    g.generateTexture('player', TILE, TILE);
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
}
