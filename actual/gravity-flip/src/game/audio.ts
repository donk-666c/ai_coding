/**
 * 音效：用 Web Audio 实时合成，不带任何音频素材。
 *
 * 这个游戏统共四个音——跳、翻转、死亡、通关。为它们各塞一个音频文件是不划算的：
 * 每个几十 KB，加起来比全部游戏逻辑还大，而且音色不好改。
 * 用振荡器画个包络，代码不到百行，体积为零，调音色就是改两个数字。
 */

interface ToneSpec {
  type: OscillatorType;
  /** 起始频率（Hz） */
  from: number;
  /** 结束频率（Hz）。与 from 相同就是定音，不同则是扫频 */
  to: number;
  /** 时长（秒） */
  duration: number;
  /** 峰值音量，0~1。合成音很容易过大，全部压在 0.1 以下 */
  volume: number;
  /** 相对当前时刻的延迟（秒），用来把几个音拼成琶音 */
  delay?: number;
}

class Sfx {
  private ctx: AudioContext | null = null;
  /** 拿不到 AudioContext 就彻底闭嘴，不再反复尝试 */
  private unavailable = false;

  /** 起跳：短促上扬，强调「往上走」 */
  jump(): void {
    this.tone({ type: 'square', from: 380, to: 640, duration: 0.09, volume: 0.05 });
  }

  /**
   * 翻转：下滑音。听感上就是「落向另一边」，与跳跃的上扬正好互补，
   * 玩家闭着眼也能分辨自己按的是哪个键。
   */
  flip(): void {
    this.tone({ type: 'triangle', from: 560, to: 240, duration: 0.12, volume: 0.06 });
  }

  /** 死亡：锯齿下滑 + 一层噪声爆裂，是四个音里唯一刺耳的 */
  death(): void {
    this.tone({ type: 'sawtooth', from: 300, to: 70, duration: 0.3, volume: 0.07 });
    this.noise(0.22, 0.045);
  }

  /** 通关：C5-E5-G5 上行琶音，全局唯一「正面」的声音，只在整关结束时响 */
  clear(): void {
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((freq, i) => {
      this.tone({
        type: 'triangle',
        from: freq,
        to: freq,
        duration: 0.24,
        volume: 0.06,
        delay: i * 0.09,
      });
    });
  }

  private tone(spec: ToneSpec): void {
    const ctx = this.ensure();
    if (!ctx) return;

    const t0 = ctx.currentTime + (spec.delay ?? 0);

    const osc = ctx.createOscillator();
    osc.type = spec.type;
    osc.frequency.setValueAtTime(spec.from, t0);
    osc.frequency.exponentialRampToValueAtTime(spec.to, t0 + spec.duration);

    const gain = ctx.createGain();
    // 起音不能从 0 直接跳到峰值，那会「啪」一声；留 5ms 爬升
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(spec.volume, t0 + 0.005);
    // 指数衰减的尾巴最自然。目标值不能写 0，指数插值不允许
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + spec.duration);

    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    // 多留 20ms 再停，避免在包络还没走完时被硬切出杂音
    osc.stop(t0 + spec.duration + 0.02);
  }

  /** 白噪声爆裂，自带线性衰减的包络 */
  private noise(duration: number, volume: number): void {
    const ctx = this.ensure();
    if (!ctx) return;

    const frames = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) {
      // 开头的满幅噪声是「炸裂」，末尾收干净，不留电流声
      data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const gain = ctx.createGain();
    gain.gain.value = volume;

    source.connect(gain).connect(ctx.destination);
    source.start();
  }

  /**
   * 浏览器不允许 AudioContext 在用户交互之前出声，但允许提前创建。
   * 游戏里第一个手势必然是主菜单上那次点击，所以每次发声前顺手 resume 一次就够。
   */
  private ensure(): AudioContext | null {
    if (this.unavailable) return null;

    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        // 没有 Web Audio 的 WebView 极少，但真有。没声音可以接受，崩掉不行
        this.unavailable = true;
        return null;
      }
    }

    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }
}

/**
 * 全局唯一实例。
 *
 * GameScene 每次 restart 都会重新 create，音效实例绝不能跟着重建——
 * 每个 AudioContext 都占着一份系统音频资源，切几关就会攒下一串。
 */
export const sfx = new Sfx();
