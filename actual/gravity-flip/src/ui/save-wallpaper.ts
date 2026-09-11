/**
 * 把通关壁纸存到玩家自己的机器上。
 *
 * 没有这个动作，「获得精美壁纸一张」就只是一句空话——玩家看得见、拿不走。
 *
 * 浏览器环境下退化成 `<a download>`：文件直接进下载目录，玩家不必做任何选择。
 * Tauri 环境（任务 10）会换成原生保存对话框，让玩家自己挑路径，
 * 那时才会返回 'cancelled'——现在这个值是给那条路径预留的。
 */

export type SaveOutcome = 'saved' | 'cancelled' | 'failed';

export async function saveWallpaper(url: string, filename: string): Promise<SaveOutcome> {
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
