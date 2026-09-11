import { isTauri } from '@tauri-apps/api/core';
import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from './game/config';
import { BootScene } from './game/scenes/BootScene';
import { GameScene } from './game/scenes/GameScene';
import { Overlay } from './ui/overlay';
import './style.css';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#16162a',

  // 必须开：关掉纹理插值，否则像素图会被拉成模糊的一片
  pixelArt: true,

  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },

  physics: {
    default: 'arcade',
    arcade: {
      // 全局重力必须为 0。翻转玩法要逐对象设置 body.gravityY，
      // 全局重力会叠加在它之上，导致翻转后玩家仍然被往下拽
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },

  scene: [BootScene, GameScene],
});

// DOM 覆盖层接管全部中文界面，也接管「什么时候开始游戏」。
// 它一构造就显示主菜单，此时 Phaser 那边还停在 BootScene 生成纹理的阶段。
new Overlay(game);

/**
 * 屏蔽浏览器自带的交互，只在桌面端生效。
 *
 * 这几样在浏览器里都是正常功能，装进游戏窗口就全是干扰：右键弹出的
 * 「重新加载 / 另存为 / 检查」直接盖住画面，F5 会连游戏进度一起清掉，
 * 拖拽会把画面里的图拖出去变成一张跟着鼠标飘的缩略图。
 *
 * 之所以按环境区分，是因为开发全程跑在浏览器里——那里右键菜单和刷新
 * 是查问题的主要手段，一并禁掉等于自断手脚。
 */
if (isTauri()) {
  window.addEventListener('contextmenu', (event) => event.preventDefault());
  window.addEventListener('dragstart', (event) => event.preventDefault());

  window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    // Ctrl+Shift+R 的 key 是大写 R，所以统一转小写再比
    if (key === 'f5' || ((event.ctrlKey || event.metaKey) && key === 'r')) {
      event.preventDefault();
    }
  });
}
