/**
 * 清掉 Rust 的编译缓存。
 *
 * 这几个目录加起来 1.5G 上下，全是依赖库编译出来的中间产物，源码一个字节都不在里面。
 * 删掉不影响已经打包好的 exe——Rust 的 exe 是静态链接的，运行时不需要这些缓存。
 * 唯一的代价是下次构建要重编依赖，约两分钟。
 *
 * 故意不碰 release/ 下的 exe 和 bundle/：那是要发出去的成品，
 * 成品不该跟缓存一起消失。这也是为什么不能图省事直接删掉整个 target/。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(ROOT, 'src-tauri/target');

// debug/ 是 `tauri dev` 的产物。开发全程跑在浏览器里，那个基本没被用过
const DIRS = ['release/deps', 'release/build', 'release/incremental', 'debug'];

// 用系统的 rmdir 而不是 fs.rmSync：这里动辄几十万个文件，rmSync 是一个个 unlink，
// 而 cmd 的 rmdir 走批量删除，两者差出几十倍
const isWindows = process.platform === 'win32';
const remove = isWindows
  ? (dir) => execFileSync('cmd', ['/c', 'rmdir', '/s', '/q', dir], { stdio: 'ignore' })
  : (dir) => fs.rmSync(dir, { recursive: true, force: true });

let hit = 0;
for (const rel of DIRS) {
  const dir = path.join(TARGET, rel);
  if (!fs.existsSync(dir)) continue;
  remove(dir);
  console.log(`  已清理 target/${rel}`);
  hit++;
}

if (hit === 0) {
  console.log('没有可清理的缓存——要么已经清过了，要么还没构建过');
} else {
  console.log(`\n清理了 ${hit} 个目录。下次构建会慢一点，之后就又有缓存了。`);
}
