import { invoke, isTauri } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';

/**
 * 把通关壁纸存到玩家自己的机器上。
 *
 * 没有这个动作，「获得精美壁纸一张」就只是一句空话——玩家看得见、拿不走。
 *
 * 两条路径按运行环境二选一：
 *   - 桌面端：弹原生保存对话框让玩家挑路径，因此才会出现「取消」这个结果
 *   - 浏览器：退化成 `<a download>`，文件直接进下载目录，玩家不必做任何选择
 * 开发全程跑在浏览器里，打包成桌面版之后也两条都得留着。
 */

export type SaveOutcome = 'saved' | 'cancelled' | 'failed';

export async function saveWallpaper(url: string, filename: string): Promise<SaveOutcome> {
  return isTauri() ? saveToDisk(url, filename) : saveViaDownload(url, filename);
}

/**
 * 桌面端：原生对话框选路径，字节交给 Rust 落盘。
 *
 * 图片在这里读出来再递过去，而不是让 Rust 自己去读文件——打包之后前端资源
 * 是嵌在 exe 里的，Rust 侧根本没有那个路径可读。壁纸三百来 KB，
 * 转成数组走一次 IPC 的开销可以忽略。
 *
 * 写文件之所以在 Rust 而不是前端直调 fs 插件：fs 的可写范围是预先声明的，
 * 而保存对话框允许玩家选到任何目录，两者凑一起要么把整个盘开出去，
 * 要么让玩家在某些目录下莫名其妙地保存失败。
 */
async function saveToDisk(url: string, filename: string): Promise<SaveOutcome> {
  try {
    const path = await save({
      defaultPath: filename,
      filters: [{ name: 'PNG 图片', extensions: ['png'] }],
    });
    // 玩家点了取消。这是正常结果，不该当成失败报错
    if (!path) return 'cancelled';

    const response = await fetch(url);
    if (!response.ok) throw new Error(`取图失败：HTTP ${response.status}`);
    const bytes = Array.from(new Uint8Array(await response.arrayBuffer()));

    await invoke('save_wallpaper', { path, bytes });
    return 'saved';
  } catch (error) {
    console.error('保存壁纸失败', error);
    return 'failed';
  }
}

/** 浏览器：`<a download>` 把文件直接送进下载目录 */
async function saveViaDownload(url: string, filename: string): Promise<SaveOutcome> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`取图失败：HTTP ${response.status}`);

    const objectUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    link.click();

    // 立刻 revoke 会让部分浏览器来不及把文件读出来，下载直接变成 0 字节。
    // 留足一拍再释放——这点内存十秒后就还回去了，不值得为它冒险
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);

    return 'saved';
  } catch (error) {
    console.error('保存壁纸失败', error);
    return 'failed';
  }
}
