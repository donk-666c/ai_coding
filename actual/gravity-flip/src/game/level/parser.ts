import { TILE } from '../config';

/**
 * ASCII 关卡解析。
 *
 * 关卡用纯文本描述而不是 Tiled 导出的 JSON，理由很实际：
 * 文本格式意味着任何人都能用记事本改关卡，AI 也能直接读懂和重写，
 * 而 JSON 对人和 AI 都是一团不透明的数据。
 */

/** 地图字符约定 */
export const CHAR = {
  EMPTY: '.',
  SOLID: 'X',
  SPIKE: '^',
  SPAWN: 'P',
  GOAL: 'G',
} as const;

export interface GridPos {
  col: number;
  row: number;
}

export interface ParsedLevel {
  cols: number;
  rows: number;
  solids: GridPos[];
  spikes: GridPos[];
  spawn: GridPos;
  /**
   * 终点格列表而非单格。
   * 关卡里的终点通常写成连续的几个 G，只记一个会把终点缩成 1 格宽，
   * 玩家撞到终点边缘时判定会莫名失败。
   */
  goals: GridPos[];
}

/** 把 ASCII 行数组解析成各类实体坐标 */
export function parseLevel(ascii: readonly string[]): ParsedLevel {
  const rows = ascii.length;
  const cols = ascii.reduce((max, line) => Math.max(max, line.length), 0);

  const solids: GridPos[] = [];
  const spikes: GridPos[] = [];
  const goals: GridPos[] = [];
  let spawn: GridPos | null = null;

  for (let row = 0; row < rows; row++) {
    const line = ascii[row];

    for (let col = 0; col < line.length; col++) {
      const ch = line[col];

      switch (ch) {
        case CHAR.SOLID:
          solids.push({ col, row });
          break;
        case CHAR.SPIKE:
          spikes.push({ col, row });
          break;
        case CHAR.SPAWN:
          spawn = { col, row };
          break;
        case CHAR.GOAL:
          goals.push({ col, row });
          break;
        // CHAR.EMPTY 与未知字符一律当空地
        default:
          break;
      }
    }
  }

  // 缺出生点或终点是关卡数据写错了，早失败比运行时黑屏好
  if (!spawn) throw new Error('关卡数据缺少出生点（P）');
  if (goals.length === 0) throw new Error('关卡数据缺少终点（G）');

  return { cols, rows, solids, spikes, spawn, goals };
}

/** 网格坐标 → 世界坐标（该格中心的像素位置） */
export function toWorld(pos: GridPos): { x: number; y: number } {
  return {
    x: pos.col * TILE + TILE / 2,
    y: pos.row * TILE + TILE / 2,
  };
}
