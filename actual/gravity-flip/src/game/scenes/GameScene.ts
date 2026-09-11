import Phaser from 'phaser';
import {
  COLORS,
  LEVEL_COLS,
  LEVEL_OFFSET_X,
  LEVEL_OFFSET_Y,
  LEVEL_ROWS,
  TILE,
} from '../config';
import { LEVELS } from '../level/levels';
import { parseLevel, toWorld, type ParsedLevel } from '../level/parser';
import { Player } from '../objects/Player';

/** 关卡清晰事件携带的数据，DOM 层用它累计总成绩 */
export interface LevelClearPayload {
  level: number;
  deaths: number;
  elapsed: number;
}

/**
 * 游戏主场景：构建关卡、接管碰撞、处理死亡与通关。
 *
 * 界面相关的部分（主菜单、奖励页、赞助页）一概不在这里——那些走 DOM 覆盖层。
 * 这里只放像素画面与纯数字 HUD。
 */
export class GameScene extends Phaser.Scene {
  private levelIndex = 0;
  private player!: Player;
  private readonly spawnPoint = new Phaser.Math.Vector2();

  private deaths = 0;
  private startedAt = 0;
  private lastHudSecond = -1;
  private hud!: Phaser.GameObjects.Text;
  /** 本关是否已判定通关。用途见 onReachGoal 的注释 */
  private cleared = false;

  constructor() {
    super('Game');
  }

  init(data: { level?: number }): void {
    this.levelIndex = data.level ?? 0;
  }

  create(): void {
    const level = LEVELS[this.levelIndex];
    if (!level) throw new Error(`关卡索引 ${this.levelIndex} 越界`);

    this.deaths = 0;
    this.startedAt = this.time.now;
    this.lastHudSecond = -1;
    this.cleared = false;

    this.cameras.main.setBackgroundColor(COLORS.BG);

    const parsed = parseLevel(level.ascii);
    const { solids, spikes, goals } = this.buildLevel(parsed);

    // 世界边界比关卡四周各多留 4 格：翻转时玩家会从天花板缺口飞出去，
    // 没有边界兜住就会一路飞出屏幕、再也回不来
    this.physics.world.setBounds(
      LEVEL_OFFSET_X - TILE * 4,
      LEVEL_OFFSET_Y - TILE * 4,
      LEVEL_COLS * TILE + TILE * 8,
      LEVEL_ROWS * TILE + TILE * 8,
    );

    const spawn = toWorld(parsed.spawn);
    this.spawnPoint.set(spawn.x + LEVEL_OFFSET_X, spawn.y + LEVEL_OFFSET_Y);

    this.player = new Player(this, this.spawnPoint.x, this.spawnPoint.y);
    this.player.sprite.setCollideWorldBounds(true);

    this.physics.add.collider(this.player.sprite, solids);
    this.physics.add.overlap(this.player.sprite, spikes, () => this.onDeath());
    this.physics.add.overlap(this.player.sprite, goals, () => this.onReachGoal());

    this.hud = this.add.text(16, 14, '', {
      fontFamily: 'Consolas, monospace',
      fontSize: '20px',
      color: '#8b8bb0',
    });
    this.updateHud();
  }

  override update(_time: number, delta: number): void {
    this.player.update(delta);
    this.checkFellOff();

    // 计时只精确到秒，没必要每帧重画一次文字（setText 会重建纹理）
    const elapsed = Math.floor((this.time.now - this.startedAt) / 1000);
    if (elapsed !== this.lastHudSecond) {
      this.lastHudSecond = elapsed;
      this.updateHud();
    }
  }

  /**
   * 掉出关卡范围即判定死亡。
   *
   * 少了这一步，「掉进虚空」会变成安全区：世界边界把玩家挡在半空，
   * 玩家自己翻转一下就能飘回来，所有深渊都失去意义。
   */
  private checkFellOff(): void {
    const { x, y } = this.player.sprite;
    // 容差比世界边界小得多：玩家能亲眼看到自己飞出去，但飞不了多远就判定死亡
    const margin = TILE * 2;
    const outX =
      x < LEVEL_OFFSET_X - margin || x > LEVEL_OFFSET_X + LEVEL_COLS * TILE + margin;
    const outY =
      y < LEVEL_OFFSET_Y - margin || y > LEVEL_OFFSET_Y + LEVEL_ROWS * TILE + margin;
    if (outX || outY) this.onDeath();
  }

  private buildLevel(parsed: ParsedLevel): {
    solids: Phaser.Physics.Arcade.StaticGroup;
    spikes: Phaser.Physics.Arcade.StaticGroup;
    goals: Phaser.Physics.Arcade.StaticGroup;
  } {
    const solids = this.physics.add.staticGroup();
    const spikes = this.physics.add.staticGroup();
    const goals = this.physics.add.staticGroup();

    for (const pos of parsed.solids) {
      const p = toWorld(pos);
      solids.create(p.x + LEVEL_OFFSET_X, p.y + LEVEL_OFFSET_Y, 'solid');
    }

    for (const pos of parsed.spikes) {
      const p = toWorld(pos);
      const spike = spikes.create(
        p.x + LEVEL_OFFSET_X,
        p.y + LEVEL_OFFSET_Y,
        'spike',
      ) as Phaser.Physics.Arcade.Sprite;

      // 尖刺画的是三角形，上半格其实是空的。判定箱跟着缩到底部，
      // 否则玩家「擦到尖刺上方的空气」就死，是最招人烦的一类判定
      const body = spike.body as Phaser.Physics.Arcade.StaticBody;
      body.setSize(14, 9);
      body.setOffset(2, 9);
    }

    for (const pos of parsed.goals) {
      const p = toWorld(pos);
      goals.create(p.x + LEVEL_OFFSET_X, p.y + LEVEL_OFFSET_Y, 'goal');
    }

    return { solids, spikes, goals };
  }

  private onDeath(): void {
    this.deaths++;
    this.player.respawn(this.spawnPoint.x, this.spawnPoint.y);
    this.cameras.main.shake(120, 0.006);
    this.updateHud();
    this.game.events.emit('level:death', this.deaths);
  }

  /**
   * 碰到终点。
   *
   * 进门先挡一道：终点写成连续的 GGG，也就是三个独立的判定体，玩家 12px 宽的身体
   * 跨在两格交界时会同一帧触发两次回调；而 Arcade 的 overlap 不区分「是否已触发过」，
   * 站着不动同样每帧继续触发。没有这个门闩，切关会 restart 两次（create 跑两遍），
   * 最后一关更是会以每秒 60 次的频率刷 game:complete，奖励页会被反复弹出。
   */
  private onReachGoal(): void {
    if (this.cleared) return;
    this.cleared = true;

    const elapsed = this.time.now - this.startedAt;
    const payload: LevelClearPayload = {
      level: this.levelIndex,
      deaths: this.deaths,
      elapsed,
    };
    this.game.events.emit('level:clear', payload);

    const next = this.levelIndex + 1;
    if (next < LEVELS.length) {
      this.scene.restart({ level: next });
    } else {
      this.game.events.emit('game:complete', payload);
    }
  }

  private updateHud(): void {
    const elapsed = Math.floor((this.time.now - this.startedAt) / 1000);
    this.hud.setText(
      `${this.levelIndex + 1}/${LEVELS.length}   ✕${this.deaths}   ${formatTime(elapsed)}`,
    );
  }
}

/** 秒数格式化成 mm:ss */
function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}
