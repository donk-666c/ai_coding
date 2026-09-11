import type Phaser from 'phaser';
import { LEVELS } from '../game/level/levels';
import type { LevelClearPayload } from '../game/scenes/GameScene';
import { saveWallpaper } from './save-wallpaper';

const WALLPAPER_URL = './assets/wallpaper.png';
const WALLPAPER_FILENAME = '翻转引力-通关壁纸.png';

/**
 * DOM 覆盖层：所有出现中文的界面都在这里。
 *
 * 与 Phaser 的分工是「画面归 canvas，界面归 DOM」。三条硬理由：
 *   1. 中文不必嵌字体——完整中文字体 5~10MB，系统字体零成本
 *   2. 收款码与壁纸保持原始分辨率——canvas 开了 pixelArt，纹理会被最近邻采样打成马赛克，二维码直接扫不出来
 *   3. 自适应布局交给 CSS——壁纸是任意分辨率的用户图片，在 canvas 里得手算缩放
 *
 * 渲染策略是「界面即函数」：每次切换整个重建 innerHTML，点击事件用委托挂在根节点上。
 * 这些界面都很小，重建的成本可以忽略，换来的是不必维护一套 DOM 增删改的同步逻辑。
 */

/** 覆盖层能显示的界面。null（未显示）表示正在游戏中 */
type ScreenName = 'menu' | 'levels' | 'sponsor' | 'pause' | 'complete';

/** 单关最好成绩 */
interface LevelRecord {
  deaths: number;
  /** 耗时，毫秒 */
  elapsed: number;
}

interface Progress {
  /** 已通关的关卡数，数值上正好是「下一关」的索引 */
  cleared: number;
  records: Record<string, LevelRecord>;
}

const STORAGE_KEY = 'gravity-flip.progress';
/** 飞行彩蛋的成就标记。与关卡进度分开存——两者的生命周期不一样，混在一起改一个就会碰到另一个 */
const HOVER_KEY = 'gravity-flip.hover-found';

function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { cleared: 0, records: {} };
    const parsed = JSON.parse(raw) as Partial<Progress>;
    return {
      // 关卡总数以后会变，存档里的越界值必须夹回来，否则改了关卡表进度就会错位
      cleared: Math.min(Math.max(parsed.cleared ?? 0, 0), LEVELS.length),
      records: parsed.records ?? {},
    };
  } catch {
    // 存档损坏不该让游戏打不开，重来一份就是了
    return { cleared: 0, records: {} };
  }
}

function saveProgress(progress: Progress): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // 无痕模式下 localStorage 会抛异常。丢进度可以接受，崩掉不行
  }
}

function loadHoverAchievement(): boolean {
  try {
    return localStorage.getItem(HOVER_KEY) === '1';
  } catch {
    return false;
  }
}

function saveHoverAchievement(): void {
  try {
    localStorage.setItem(HOVER_KEY, '1');
  } catch {
    // 同上，丢个成就而已
  }
}

/** 毫秒 → mm:ss */
function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const mm = Math.floor(total / 60)
    .toString()
    .padStart(2, '0');
  const ss = (total % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

/**
 * 把图片挂进容器，加载失败就换成 .placeholder 提示。
 *
 * 收款码和壁纸是用户后补的素材，没放进来的时候必须给一句能看懂的话，
 * 而不是让浏览器显示一个破图图标。
 */
function mountImage(
  container: Element,
  options: { src: string; alt: string; placeholder: string; imgClass?: string; frameClass?: string },
): Promise<boolean> {
  // 返回是否加载成功：调用方据此决定「保存」按钮可不可点——图都没有就没有可存的东西
  return new Promise((resolve) => {
    const img = new Image();
    img.alt = options.alt;
    if (options.imgClass) img.className = options.imgClass;

    img.onload = () => {
      if (options.frameClass) {
        const frame = document.createElement('div');
        frame.className = options.frameClass;
        frame.appendChild(img);
        container.replaceWith(frame);
      } else {
        container.replaceWith(img);
      }
      resolve(true);
    };

    img.onerror = () => {
      const box = document.createElement('div');
      box.className = 'placeholder';
      box.innerHTML = options.placeholder;
      container.replaceWith(box);
      resolve(false);
    };

    // src 必须最后赋值：图片若已在缓存里，赋值会同步触发 onload，
    // 先设 src 再挂回调就会永远等不到
    img.src = options.src;
  });
}

export class Overlay {
  private readonly root: HTMLElement;
  private readonly game: Phaser.Game;
  private readonly progress: Progress;

  /** 当前显示的界面；null 表示覆盖层隐藏、游戏正在运行 */
  private screen: ScreenName | null = null;
  /** 轻提示的定时器。连续触发时要把上一次清掉，否则前一条会提前收走新的 */
  private toastTimer = 0;
  /** 赞助页是从哪进来的——通关后进来要能退回通关页，而不是被踢回主菜单 */
  private sponsorReturn: 'menu' | 'complete' = 'menu';
  /** 素材是否就绪。没就绪不能放玩家进游戏：Phaser 会拿不存在的纹理去建精灵 */
  private ready = false;
  /** 飞行彩蛋是否已解锁，决定主菜单要不要显示成就 */
  private hoverUnlocked = false;
  /** 常驻的轻提示元素。它挂在覆盖层外面，游戏进行中也能弹 */
  private readonly toastEl: HTMLElement | null;

  constructor(game: Phaser.Game) {
    const root = document.getElementById('overlay');
    if (!root) throw new Error('找不到 #overlay 容器');
    this.root = root;
    this.game = game;
    this.progress = loadProgress();
    this.hoverUnlocked = loadHoverAchievement();
    this.toastEl = document.getElementById('toast');

    this.root.addEventListener('click', this.onClick);
    window.addEventListener('keydown', this.onKeyDown);
    this.game.events.on('level:clear', this.onLevelClear);
    this.game.events.on('game:complete', this.onGameComplete);
    this.game.events.on('player:hovering', this.onHovering);
    this.game.events.on('boot:ready', this.onBootReady);

    // 正常时序下 BootScene 的 preload 还没跑完，靠上面那个事件补上；
    // 但从缓存里瞬间加载完的情况真的存在，所以这里也查一次
    this.ready = game.textures.exists('chars');

    this.showMenu();
  }

  // ---------- 界面 ----------

  private showMenu(): void {
    this.show(
      'menu',
      `
      <div class="screen">
        <h1 class="title">翻转引力</h1>
        <p class="subtitle">GRAVITY FLIP</p>
        <div class="menu">
          <button class="primary" data-act="levels"${this.ready ? '' : ' disabled'}>开始游戏</button>
          <button data-act="sponsor">赞助作者</button>
        </div>
        <p class="hint">
          ← → 或 A D　移动　·　空格 或 Z　跳跃　·　↑ 或 X　翻转重力<br />
          碰到尖刺、掉出屏幕都会回到起点
        </p>
        ${this.hoverUnlocked ? '<p class="achievement">✦ 成就：发现飞行</p>' : ''}
      </div>
      `,
    );
  }

  private showLevels(): void {
    const buttons = LEVELS.map((level, index) => {
      const unlocked = index <= this.progress.cleared;
      const record = this.progress.records[String(index)];
      // 成绩塞进 title：按钮只有 84px 见方，放不下文字
      const best = record ? ` · 最好 ✕${record.deaths} ${formatTime(record.elapsed)}` : '';
      const label = `第 ${index + 1} 关 · ${level.name}${best}`;
      const disabled = unlocked ? '' : ' disabled';
      return `<button class="level-btn" data-level="${index}" title="${label}"${disabled}>${index + 1}</button>`;
    }).join('');

    this.show(
      'levels',
      `
      <div class="screen">
        <h1 class="title small">选择关卡</h1>
        <div class="level-grid">${buttons}</div>
        <p class="hint">通关一关即解锁下一关</p>
        <button class="ghost" data-act="menu">返回主菜单</button>
      </div>
      `,
    );
  }

  private showSponsor(returnTo: 'menu' | 'complete'): void {
    this.sponsorReturn = returnTo;
    this.show(
      'sponsor',
      `
      <div class="screen">
        <h1 class="title small">赞助作者</h1>
        <div id="qr-slot"></div>
        <p class="hint">如果这个游戏让你开心了几分钟，可以请作者喝杯水</p>
        <button class="ghost" data-act="back">返回</button>
      </div>
      `,
    );

    const slot = this.root.querySelector('#qr-slot');
    if (!slot) return;
    mountImage(slot, {
      src: './assets/sponsor-qr.png',
      alt: '微信收款码',
      frameClass: 'qr-frame',
      placeholder: '收款码还没放进来<br /><code>public/assets/sponsor-qr.png</code>',
    });
  }

  private showPause(): void {
    this.game.scene.pause('Game');
    this.show(
      'pause',
      `
      <div class="screen">
        <h1 class="title small">已暂停</h1>
        <div class="menu">
          <button class="primary" data-act="resume">继续游戏</button>
          <button data-act="menu">返回主菜单</button>
        </div>
        <p class="hint">按 Esc 也可以继续</p>
      </div>
      `,
    );
  }

  private async showComplete(): Promise<void> {
    this.show(
      'complete',
      `
      <div class="screen">
        <h1 class="title small">全部通关</h1>
        <p class="reward-text">恭喜你通关，获得精美壁纸一张</p>
        <p class="author">作者 <strong>act666</strong></p>
        <div id="wallpaper-slot"></div>
        <div class="row">
          <button class="primary" data-act="save">保存壁纸</button>
          <button data-act="sponsor" data-from="complete">赞助作者</button>
        </div>
        <button class="ghost" data-act="menu">返回主菜单</button>
      </div>
      `,
    );

    const slot = this.root.querySelector('#wallpaper-slot');
    if (!slot) return;

    const loaded = await mountImage(slot, {
      src: WALLPAPER_URL,
      alt: '通关壁纸',
      imgClass: 'wallpaper',
      placeholder: '壁纸还没放进来<br /><code>public/assets/wallpaper.png</code>',
    });

    // 图都没有就没有可存的东西，直接把按钮灰掉，而不是让玩家点了才发现保存失败
    if (!loaded) {
      const button = this.saveButton();
      if (button) {
        button.disabled = true;
        button.title = '壁纸文件还没放进来';
      }
    }
  }

  private saveButton(): HTMLButtonElement | null {
    return this.root.querySelector<HTMLButtonElement>('button[data-act="save"]');
  }

  private async saveWallpaperToDisk(): Promise<void> {
    const button = this.saveButton();
    if (button) {
      button.disabled = true;
      button.textContent = '正在保存…';
    }

    const outcome = await saveWallpaper(WALLPAPER_URL, WALLPAPER_FILENAME);

    if (button) {
      button.disabled = false;
      button.textContent = '保存壁纸';
    }

    if (outcome === 'saved') this.toast('壁纸已保存到下载目录');
    else if (outcome === 'cancelled') this.toast('已取消');
    else this.toast('保存失败，可以在图片上点右键另存为');
  }

  private toast(message: string): void {
    if (!this.toastEl) return;

    this.toastEl.textContent = message;
    this.toastEl.classList.add('show');

    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl?.classList.remove('show');
    }, 2600);
  }

  // ---------- 交互 ----------

  private readonly onClick = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest('button');
    if (!button || button.disabled) return;

    const level = button.dataset.level;
    if (level !== undefined) {
      this.startLevel(Number(level));
      return;
    }

    switch (button.dataset.act) {
      case 'levels':
        this.showLevels();
        break;
      case 'sponsor':
        this.showSponsor(button.dataset.from === 'complete' ? 'complete' : 'menu');
        break;
      case 'resume':
        this.resumeGame();
        break;
      case 'save':
        void this.saveWallpaperToDisk();
        break;
      case 'back':
        this.goBackFromSponsor();
        break;
      case 'menu':
        this.goMenu();
        break;
      default:
        break;
    }
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;

    if (this.screen === 'levels') {
      this.showMenu();
    } else if (this.screen === 'sponsor') {
      this.goBackFromSponsor();
    } else if (this.screen === 'pause') {
      this.resumeGame();
    } else if (this.screen === null) {
      this.showPause();
    }
    // 通关页不给 Esc 出口：那是通关瞬间，让玩家自己看清再点返回
  };

  // ---------- 游戏事件 ----------

  private readonly onLevelClear = (payload: LevelClearPayload): void => {
    const { level, deaths, elapsed } = payload;

    if (level + 1 > this.progress.cleared) {
      this.progress.cleared = level + 1;
    }

    // 只有更好才覆盖：先比死亡数，死亡数相同再比用时
    const key = String(level);
    const previous = this.progress.records[key];
    const better =
      !previous ||
      deaths < previous.deaths ||
      (deaths === previous.deaths && elapsed < previous.elapsed);
    if (better) this.progress.records[key] = { deaths, elapsed };

    saveProgress(this.progress);
  };

  private readonly onGameComplete = (): void => {
    this.game.scene.pause('Game');
    void this.showComplete();
  };

  /** 素材加载完毕。停在主菜单就重画一次，把「开始游戏」解禁 */
  private readonly onBootReady = (): void => {
    this.ready = true;
    if (this.screen === 'menu') this.showMenu();
  };

  /**
   * 飞行彩蛋被触发了。
   *
   * 用轻提示而不是整屏界面——玩家正悬在半空，挡住画面等于毁掉这一刻。
   * 成就只在第一次写入，但提示每次都会弹：玩家多半想再演一遍给别人看。
   */
  private readonly onHovering = (): void => {
    if (!this.hoverUnlocked) {
      this.hoverUnlocked = true;
      saveHoverAchievement();
    }
    this.toast('你发现了飞行——这不在设计之内，但挺酷的');
  };

  // ---------- 场景切换 ----------

  private startLevel(index: number): void {
    this.hide();
    // 先 stop 再 start：从主菜单进来时 Game 可能还活着（比如通关后暂停在那），
    // 直接 start 会把旧实例的状态带进新一关
    this.game.scene.stop('Game');
    this.game.scene.start('Game', { level: index });
  }

  private resumeGame(): void {
    this.hide();
    this.game.scene.resume('Game');
  }

  private goMenu(): void {
    const scene = this.game.scene.getScene('Game');
    if (scene?.scene.isPaused()) this.game.scene.resume('Game');
    this.game.scene.stop('Game');
    this.showMenu();
  }

  /** 赞助页的返回：从通关页进来的就退回通关页，别把刚通关的玩家踢回主菜单 */
  private goBackFromSponsor(): void {
    if (this.sponsorReturn === 'complete') void this.showComplete();
    else this.showMenu();
  }

  // ---------- 渲染工具 ----------

  private show(screen: ScreenName, html: string): void {
    this.root.innerHTML = html;
    this.root.classList.remove('hidden');
    this.screen = screen;
  }

  private hide(): void {
    this.root.classList.add('hidden');
    this.root.innerHTML = '';
    this.screen = null;
  }
}
