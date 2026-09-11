/**
 * 把刚构建出来的成品同步到发布目录 gravity-flip-dist/。
 *
 * 成品本来是躺在 src-tauri/target/release/ 里的，但那个目录是「清理磁盘时
 * 容易被整个端掉」的位置，所以另外存一份到项目外面去。
 *
 * 这一步以前是手工 cp 的，忘了就会把上一版发出去——等对方已经在玩了才发现
 * 发错版本，很难收场。所以并进 `npm run pack`，构建完自动同步。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE = path.join(ROOT, 'src-tauri/target/release');
const DIST = path.resolve(ROOT, '..', 'gravity-flip-dist');

const APP_EXE = path.join(RELEASE, 'gravity-flip.exe');
const NSIS_DIR = path.join(RELEASE, 'bundle/nsis');

if (!fs.existsSync(APP_EXE)) {
  console.error(`找不到 ${APP_EXE}`);
  console.error('先跑一次 npm run pack，或检查构建是不是失败了');
  process.exit(1);
}

fs.mkdirSync(DIST, { recursive: true });

// 安装包文件名带版本号，不先清掉的话升级几次就堆一目录旧版本
for (const name of fs.readdirSync(DIST)) {
  if (name.endsWith('-setup.exe')) fs.rmSync(path.join(DIST, name));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 复制文件，遇到「被占用」时重试几次。
 *
 * Windows 上 EBUSY 基本就一个来源：游戏还开着，exe 的句柄没释放。
 * 之所以要重试而不是直接报错，是因为「构建跑了两分钟、用户在最后几秒把窗口关了」
 * 这种时间差很常见，为它让整个流程失败太亏。5 次 × 800ms 给到 4 秒的窗口，
 * 再长就该怀疑不是时间差而是真占用了——那时候早点报错比让脚本干等着强。
 */
async function copyWithRetry(from, to, attempts = 5) {
  for (let i = 1; i <= attempts; i++) {
    try {
      fs.copyFileSync(from, to);
      return;
    } catch (error) {
      if (i === attempts) {
        console.error(`\n复制失败：${path.basename(to)}（${error.code}）`);
        if (error.code === 'EBUSY' || error.code === 'EPERM') {
          console.error('文件被占用了 —— 游戏是不是还开着？关掉窗口再跑一次 npm run pack');
        } else {
          console.error(error.message);
        }
        process.exit(1);
      }
      await sleep(800);
    }
  }
}

// 同一个 exe 存两个名字：中文名发给朋友时一眼看得懂，英文名在命令行里少些麻烦
await copyWithRetry(APP_EXE, path.join(DIST, 'gravity-flip.exe'));
await copyWithRetry(APP_EXE, path.join(DIST, '翻转引力.exe'));

let bundles = 0;
if (fs.existsSync(NSIS_DIR)) {
  for (const name of fs.readdirSync(NSIS_DIR)) {
    if (!name.endsWith('.exe')) continue;
    await copyWithRetry(path.join(NSIS_DIR, name), path.join(DIST, name));
    bundles++;
  }
}

const size = (p) => (fs.statSync(p).size / 1024 / 1024).toFixed(1) + 'MB';
console.log(`已同步到 ${DIST}`);
console.log(`  gravity-flip.exe / 翻转引力.exe   ${size(path.join(DIST, 'gravity-flip.exe'))}`);
if (bundles === 0) console.log('  （没找到 NSIS 安装包，不影响裸 exe 分发）');
