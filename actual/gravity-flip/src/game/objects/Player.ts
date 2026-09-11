import Phaser from 'phaser';
import { FRAMES, PHYS, PLAYER_BOX } from '../config';

/** 重力方向：1 = 向下（常态），-1 = 向上（翻转态） */
export type GravitySign = 1 | -1;

/**
 * 表现层钩子。
 *
 * 用回调而不是 `scene.events.emit`：场景每次 restart 复用的是同一个 Scene 实例，
 * 挂在 `events` 上的监听器不会随 shutdown 清理，切几关之后一次跳跃会触发一串
 * 早已作废的回调（音效叠着响、粒子喷在上一关的坐标上）。
 * 回调随 GameScene 的闭包一起重建，天然没有这个问题。
 */
export interface PlayerHooks {
  /** 起跳成功 */
  onJump?: () => void;
  /** 翻转重力，参数是翻转后的方向 */
  onFlip?: (sign: GravitySign) => void;
  /** 落地，参数是撞地瞬间的下落速度绝对值 */
  onLand?: (impact: number) => void;
}

/**
 * 玩家角色与手感层。
 *
 * 这是整个项目最需要反复调的文件。精确平台跳跃「操作舒服」的感觉不来自
 * 任何单一参数，而来自四项机制的配合：
 *
 *   1. 土狼时间        离地后仍有一小段时间可以起跳
 *   2. 跳跃缓冲        落地前按下的跳跃会被记住，落地立刻执行
 *   3. 可变跳跃高度    按键时长决定跳多高
 *   4. 地空分离加速度  空中控制力弱于地面，且反向输入时加速更快
 *
 * 少任何一项，玩家都会觉得「操作不对劲」，但通常说不清哪里不对。
 * 全部数值集中在 config.ts，改完保存即可热重载看到区别。
 */
export class Player {
  readonly sprite: Phaser.Physics.Arcade.Sprite;

  private readonly body: Phaser.Physics.Arcade.Body;
  private readonly hooks: PlayerHooks;

  private readonly keys: {
    left: readonly Phaser.Input.Keyboard.Key[];
    right: readonly Phaser.Input.Keyboard.Key[];
    jump: readonly Phaser.Input.Keyboard.Key[];
    flip: readonly Phaser.Input.Keyboard.Key[];
  };

  /** 重力方向。翻转玩法的一切都挂在这个符号上 */
  private sign: GravitySign = 1;

  // 三项计时器，单位毫秒
  private coyoteTimer = 0;
  private jumpBufferTimer = 0;
  private flipCooldownTimer = 0;

  /**
   * 本次跳跃是否还允许「松手减速」。
   * 用一个显式标志而不是只看当前速度方向，是因为翻转重力会让「上升」的
   * 含义突变——翻转瞬间的误判会把速度直接砍掉，手感上像撞到了隐形墙。
   */
  private jumpCutPending = false;
  /** 起跳时的重力方向，用来判断跳跃是否仍在朝原方向进行 */
  private jumpSign: GravitySign = 1;

  /** 上一帧是否站在支撑面上，用来识别「刚落地」那一帧 */
  private wasGrounded = true;
  /** 上一帧末尾的垂直速度绝对值，落地时用它衡量撞击力度 */
  private landingSpeed = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, hooks: PlayerHooks = {}) {
    this.hooks = hooks;

    const keyboard = scene.input.keyboard;
    if (!keyboard) throw new Error('键盘输入不可用：scene.input.keyboard 为空');

    const K = Phaser.Input.Keyboard.KeyCodes;
    const add = (code: number) => keyboard.addKey(code);

    this.keys = {
      left: [add(K.LEFT), add(K.A)],
      right: [add(K.RIGHT), add(K.D)],
      jump: [add(K.SPACE), add(K.Z)],
      flip: [add(K.UP), add(K.X)],
    };

    // 方向键与空格会滚动页面，必须拦掉默认行为
    keyboard.addCapture([K.LEFT, K.RIGHT, K.UP, K.DOWN, K.SPACE]);

    this.sprite = scene.physics.add.sprite(x, y, 'chars', FRAMES.PLAYER_IDLE);
    this.body = this.sprite.body as Phaser.Physics.Arcade.Body;

    this.body.setGravityY(PHYS.GRAVITY_Y);
    this.body.setMaxVelocity(PHYS.MAX_RUN_SPEED, PHYS.MAX_FALL_SPEED);
    // 尺寸与偏移的取值理由见 config.ts 的 PLAYER_BOX
    this.body.setSize(PLAYER_BOX.WIDTH, PLAYER_BOX.HEIGHT, false);
    this.body.setOffset(PLAYER_BOX.OFFSET_X, PLAYER_BOX.OFFSET_Y);
  }

  /** 当前重力方向，供场景做视觉反馈 */
  get gravitySign(): GravitySign {
    return this.sign;
  }

  update(deltaMs: number): void {
    // 切走标签页再回来时 delta 会大得离谱，不钳住会一帧穿过整张地图
    const delta = Math.min(deltaMs, 50);
    const dt = delta / 1000;

    // JustDown / JustUp 会「消费」按键状态，同一帧只能问一次，
    // 所以先全部取出来存成布尔值，后面只读这些值。
    const jumpPressed = anyJustDown(this.keys.jump);
    const jumpHeld = anyDown(this.keys.jump);
    const flipPressed = anyJustDown(this.keys.flip);
    const moveDir = (anyDown(this.keys.right) ? 1 : 0) - (anyDown(this.keys.left) ? 1 : 0);

    // 先翻转再判定接地——翻转会改变「哪边算地面」
    if (flipPressed && this.flipCooldownTimer <= 0) this.flipGravity();
    if (this.flipCooldownTimer > 0) this.flipCooldownTimer -= delta;

    const grounded = this.isGrounded();

    // 落地那一帧，物理步进已经把撞地速度清零了，只能靠上一帧末尾记下的值。
    // 必须放在 updateJump 之前取——那里会改速度
    if (grounded && !this.wasGrounded) this.hooks.onLand?.(this.landingSpeed);
    this.wasGrounded = grounded;

    if (grounded) {
      this.coyoteTimer = PHYS.COYOTE_TIME;
    } else if (this.coyoteTimer > 0) {
      this.coyoteTimer -= delta;
    }

    if (jumpPressed) {
      this.jumpBufferTimer = PHYS.JUMP_BUFFER;
    } else if (this.jumpBufferTimer > 0) {
      this.jumpBufferTimer -= delta;
    }

    this.updateHorizontal(moveDir, grounded, dt);
    this.updateJump(jumpHeld, grounded);
    this.updateAnimation(grounded, moveDir);

    // 记在最后：下一帧若判定为落地，这里就是撞地瞬间的速度
    this.landingSpeed = Math.abs(this.body.velocity.y);
  }

  /** 回到出生点。重力方向与全部计时器都要重置，否则会把上一轮的状态带进来 */
  respawn(x: number, y: number): void {
    this.body.reset(x, y);
    this.sign = 1;
    this.body.setGravityY(PHYS.GRAVITY_Y);
    this.sprite.setFlipY(false);
    this.coyoteTimer = 0;
    this.jumpBufferTimer = 0;
    this.flipCooldownTimer = 0;
    this.jumpCutPending = false;
    // 传送不算落地：不重置的话，出生点在地面上的关卡每次复活都会扬一圈土
    this.wasGrounded = true;
    this.landingSpeed = 0;
  }

  private flipGravity(): void {
    this.sign = this.sign === 1 ? -1 : 1;
    this.body.setGravityY(this.sign * PHYS.GRAVITY_Y);
    this.sprite.setFlipY(this.sign === -1);
    this.flipCooldownTimer = PHYS.FLIP_COOLDOWN;
    // 翻转后「上升」的含义整个变了，这次跳跃的松手削减就此作废。
    // 否则玩家在翻转飞行途中松手，会被按「起跳时」的方向判定为仍在上升，
    // 把新重力刚积累起来的速度一刀砍掉——正是上面注释里说的「撞到隐形墙」。
    this.jumpCutPending = false;
    // 速度刻意保留：翻转后先沿原方向滑一段，再被新重力拉走。
    // 这段迟滞感是 VVVVVV 手感的关键，把速度清零会让翻转显得生硬。
    this.hooks.onFlip?.(this.sign);
  }

  /**
   * 是否站在支撑面上。翻转后「地面」是天花板，所以必须跟着符号走。
   */
  private isGrounded(): boolean {
    return this.sign === 1 ? this.body.onFloor() : this.body.onCeiling();
  }

  /**
   * 速度是否指向重力反方向（也就是正在「上升」）。
   * 默认用当前重力方向；判断跳跃状态时要传起跳时记下的方向。
   */
  private isRising(sign: GravitySign = this.sign): boolean {
    return this.body.velocity.y * sign < 0;
  }

  private updateHorizontal(moveDir: number, grounded: boolean, dt: number): void {
    let vx = this.body.velocity.x;

    if (moveDir !== 0) {
      const accel = grounded ? PHYS.RUN_ACCEL : PHYS.AIR_ACCEL;
      // 反向输入时给更大的加速度，否则急停转向会有明显的「飘」感
      const turning = vx !== 0 && Math.sign(vx) !== moveDir;
      const a = turning ? accel * PHYS.TURN_ACCEL_MULTIPLIER : accel;
      vx = Phaser.Math.Clamp(vx + moveDir * a * dt, -PHYS.MAX_RUN_SPEED, PHYS.MAX_RUN_SPEED);
    } else {
      // 手动减速而不用 body.setDrag：drag 会和 acceleration 相互干扰，
      // 而地面与空中需要的减速度本来就不同，分开算更直白
      const decel = (grounded ? PHYS.RUN_FRICTION : PHYS.AIR_DRAG) * dt;
      vx = Math.abs(vx) <= decel ? 0 : vx - Math.sign(vx) * decel;
    }

    this.body.setVelocityX(vx);
  }

  private updateJump(jumpHeld: boolean, grounded: boolean): void {
    // 落地即结束本次跳跃，不再允许松手减速
    if (grounded) this.jumpCutPending = false;

    // 土狼时间与跳跃缓冲同时有效，才真正起跳——
    // 只满足一个就跳会变成「二段跳」，都不满足就跳会变成「吞键」
    if (this.jumpBufferTimer > 0 && this.coyoteTimer > 0) {
      // 起跳方向始终与重力相反，翻转后自动跟着翻过来
      this.body.setVelocityY(-PHYS.JUMP_VELOCITY * this.sign);
      this.jumpBufferTimer = 0;
      this.coyoteTimer = 0;
      this.jumpCutPending = true;
      this.jumpSign = this.sign;
      this.hooks.onJump?.();
      return;
    }

    // 可变跳跃高度：松手时把上升速度压到一个很小的固定值。
    //
    // 只在松手这一帧处理，不是每帧处理——每帧都压的话速度会指数衰减，
    // 实际跳高会远低于 JUMP_VELOCITY 算出来的值。
    //
    // 用「压到固定值」而不是「乘以一个系数」：乘法在低端太平，快速点按时
    // 速度还接近满速，乘完 0.4 依然跳得高，体感上只剩两档。
    if (this.jumpCutPending && !jumpHeld) {
      this.jumpCutPending = false;
      const vy = this.body.velocity.y;
      if (this.isRising(this.jumpSign) && Math.abs(vy) > PHYS.MAX_RISE_ON_RELEASE) {
        this.body.setVelocityY(-PHYS.MAX_RISE_ON_RELEASE * this.jumpSign);
      }
    }
  }

  /**
   * 动画与朝向。
   *
   * Kenney 的角色表只有两帧，凑不出 idle / run / jump / fall 四套动作——
   * 两帧全给跑动，静止和滞空都停在站立帧。这种体量的游戏不值得为动画再找一套素材。
   *
   * 朝向用 setFlipX，与重力翻转用的 setFlipY 互不干扰：上下颠倒之后
   * 左右朝向仍然是独立的，翻转态下往左走照样要面向左。
   */
  private updateAnimation(grounded: boolean, moveDir: number): void {
    if (moveDir !== 0) this.sprite.setFlipX(moveDir < 0);

    if (grounded && moveDir !== 0) {
      // 第二个参数 true：已在播就沿用，不从头重来，否则每一步都会卡一下
      this.sprite.play('player-run', true);
    } else {
      this.sprite.stop();
      this.sprite.setFrame(FRAMES.PLAYER_IDLE);
    }
  }
}

/**
 * JustDown 每问一次就消费掉该键的状态，所以：
 * 同一帧里必须一次性把所有键都问完，而且不能短路——
 * 用 some 之类的写法会让后面没查到的键白白丢掉一次按下。
 */
function anyJustDown(keys: readonly Phaser.Input.Keyboard.Key[]): boolean {
  let hit = false;
  for (const key of keys) {
    if (Phaser.Input.Keyboard.JustDown(key)) hit = true;
  }
  return hit;
}

/** isDown 是只读的，没有消费问题，可以安全短路 */
function anyDown(keys: readonly Phaser.Input.Keyboard.Key[]): boolean {
  return keys.some((key) => key.isDown);
}
