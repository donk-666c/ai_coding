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
