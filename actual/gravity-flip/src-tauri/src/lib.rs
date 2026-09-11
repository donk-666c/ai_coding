/// 把壁纸写到玩家挑好的位置。
///
/// 路径由前端的原生保存对话框产生，这里只负责落盘。写文件这一步之所以
/// 留在 Rust 而不是用 fs 插件：fs 的可写范围是预先声明的 scope，而保存
/// 对话框允许玩家选到任何目录——两者凑一起只有两条路，要么把整个盘开出去
/// （等于没设防），要么让玩家在某些目录下莫名其妙地保存失败。
///
/// 出错时返回的是一句给玩家看的中文，前端直接显示，所以不写成英文的
/// io::Error 原文。
#[tauri::command]
fn save_wallpaper(path: String, bytes: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, &bytes).map_err(|e| format!("写入失败：{e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![save_wallpaper])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
