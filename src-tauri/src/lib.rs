mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .invoke_handler(tauri::generate_handler![
      commands::get_pci_data,
      commands::get_gpuz_data,
      commands::get_system_info,
      commands::get_nvidia_data,
      commands::get_native_nvidia_data,
      commands::get_native_amd_data,
      commands::launch_benchmark,
      commands::open_url,
    ])
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