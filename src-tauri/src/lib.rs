pub mod credentials;
pub mod studio;

#[tauri::command]
fn store_api_key(provider: String, key: String) -> Result<(), String> {
    credentials::store_api_key(&provider, &key)
}

#[tauri::command]
fn get_api_key(provider: String) -> Result<Option<String>, String> {
    credentials::get_api_key(&provider)
}

#[tauri::command]
fn delete_api_key(provider: String) -> Result<bool, String> {
    credentials::delete_api_key(&provider)
}

#[tauri::command]
fn get_key_status(provider: String) -> credentials::KeyStatus {
    credentials::get_key_status(&provider)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(studio::StudioState::default())
        .invoke_handler(tauri::generate_handler![
            studio::studio_pick_folder,
            studio::studio_get_project_root,
            studio::studio_close_project,
            studio::studio_list_dir,
            studio::studio_read_file,
            studio::studio_open_devtools,
            store_api_key,
            get_api_key,
            delete_api_key,
            get_key_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running Mintu Studio");
}
