/**
 * 全部手感参数集中在这里。
 *
 * 精确平台跳跃的手感几乎完全由这些数字决定，而它们没有"正确答案"
 * ——只能靠反复试玩来调。集中在一处是为了让这个反复过程尽可能快：
 * 改数字 → 保存 → Vite 热重载 → 立刻能感觉到区别。
 */

export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 540;

/** tile 像素尺寸，与 Kenney Pixel Platformer 素材对齐 */
export const TILE = 18;

/** 一关的格子数。一屏一关，摄像机固定不动 */
export const LEVEL_COLS = 48;
export const LEVEL_ROWS = 27;

/** 关卡在画面中的左上角偏移——居中留边，四周各留一点呼吸空间 */
export const LEVEL_OFFSET_X = Math.round((GAME_WIDTH - LEVEL_COLS * TILE) / 2);
export const LEVEL_OFFSET_Y = Math.round((GAME_HEIGHT - LEVEL_ROWS * TILE) / 2);

export const PHYS = {
  /** 水平最大速度（像素/秒） */
  MAX_RUN_SPEED: 240,
  /** 地面加速度 */
  RUN_ACCEL: 1600,
  /** 空中加速度——低于地面，制造「空中控制力弱」的物理感 */
  AIR_ACCEL: 1000,
  /** 反向输入时的加速度倍率。用同一个加速度急停转向会有明显的「飘」感 */
  TURN_ACCEL_MULTIPLIER: 2,
  /** 无输入时的地面减速 */
  RUN_FRICTION: 2000,
  /** 无输入时的空中阻力 */
  AIR_DRAG: 500,

  /** 起跳初速度。跳高 = v² / (2g) = 460² / 3000 ≈ 70px ≈ 3.9 格 */
  JUMP_VELOCITY: 460,
  /** 重力加速度 */
  GRAVITY_Y: 1500,
  /** 下落速度上限 */
  MAX_FALL_SPEED: 800,

  /** 离地后仍可起跳的宽限时间（毫秒）——「跳跃手感好」的第一来源 */
  COYOTE_TIME: 100,
  /** 落地前按下的跳跃会被记住多久（毫秒） */
  JUMP_BUFFER: 100,
  /**
   * 松开跳跃键后允许保留的最大上升速度。
   *
   * 用它而不是「速度乘以一个系数」，是因为乘法在低端太平：快速点按时速度
   * 还接近满速，乘完依然跳得很高，体感上只剩两档。压到固定值后，
   * 跳高几乎完全由「按住了多久」线性决定。
   */
  MAX_RISE_ON_RELEASE: 90,

  /** 重力翻转冷却（毫秒），防止连按把自己卡进墙里 */
  FLIP_COOLDOWN: 150,
} as const;

/**
 * 表现层参数：粒子、震屏这类视觉反馈的强度。
 *
 * 它们不参与任何物理判定，却和加速度一样直接影响「手感」——喷多少土、震多狠
 * 没有标准答案，只能试。放在同一处，调的时候不必翻文件。
 */
export const FEEL = {
  /** 落地扬尘的粒子数区间。落到最重时取上限，轻落按比例落到下限 */
  DUST_MIN: 3,
  DUST_MAX: 12,
  /** 尘粒受到的「重力」，让它散开后落回地面而不是飘在半空 */
  DUST_GRAVITY: 420,
  /** 死亡碎片的粒子数 */
  DEATH_SHARDS: 26,
  /** 翻转时溅出的火花数 */
  FLIP_SPARKS: 8,
  /**
   * 撞地速度达到 MAX_FALL_SPEED 的这个比例才震屏。
   * 每次落地都震会让人烦——震屏的价值在于「重摔」与「轻放」有区别
   */
  LAND_SHAKE_RATIO: 0.75,
  /** 死亡震屏强度 */
  DEATH_SHAKE: 0.012,
} as const;

/** 配色。像素风用少量高对比颜色最有效。 */
export const COLORS = {
  BG: 0x16162a,
  SOLID: 0x3d3d63,
  SOLID_EDGE: 0x5a5a8a,
  SPIKE: 0xef4444,
  PLAYER: 0x7dd3fc,
  GOAL: 0x4ade80,
} as const;
