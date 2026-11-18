pub mod credentials;
pub mod devtools;
pub mod extensions;
pub mod local_llm;
pub mod mcp;
pub mod studio;
pub mod terminal;
pub mod updater;

use tauri::Manager;

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
        .manage(studio::StudioState::from_cli_args())
        .manage(mcp::McpManager::default())
        .manage(local_llm::LocalLlmManager::default())
        .manage(terminal::TerminalManager::default())
        .invoke_handler(tauri::generate_handler![
            studio::studio_pick_folder,
            studio::studio_open_folder_path,
            studio::studio_take_startup_target,
            studio::studio_is_windows_open_with_registered,
            studio::studio_set_windows_open_with,
            studio::studio_get_project_root,
            studio::studio_close_project,
            studio::studio_list_dir,
            studio::studio_list_all_files,
            studio::studio_read_file,
            studio::studio_write_file,
            studio::studio_create_entry,
            studio::studio_rename_entry,
            studio::studio_delete_entry,
            studio::studio_grep_search,
            studio::studio_replace_in_files,
            studio::studio_read_project_rules,
            studio::studio_project_fingerprint,
            studio::studio_git_info,
            studio::studio_git_diff,
            studio::studio_git_branches,
            studio::studio_git_checkout,
            studio::studio_git_create_branch,
            studio::studio_git_log,
            studio::studio_git_sync,
            studio::studio_find_symbol,
            studio::studio_read_project_scripts,
            studio::studio_http_request,
            studio::studio_fetch_url_text,
            studio::studio_search_web,
            extensions::ext_list_installed,
            extensions::ext_install,
            extensions::ext_toggle,
            extensions::ext_uninstall,
            extensions::ext_import_file,
            extensions::ext_fetch_remote_marketplace,
            updater::updater_get_version,
            updater::updater_check,
            updater::updater_download_and_install,
            devtools::devtools_list_ports,
            devtools::devtools_kill_pid,
            devtools::devtools_check_project,
            devtools::devtools_scan_todos,
            devtools::devtools_git_blame_line,
            devtools::devtools_sqlite_tables,
            devtools::devtools_sqlite_query,
            devtools::devtools_scaffold_project,
            studio::studio_run_approved_command,
            studio::studio_open_devtools,
            studio::studio_window_state,
            studio::studio_toggle_maximize,
            studio::studio_toggle_fullscreen,
            studio::studio_minimize_window,
            studio::studio_close_window,
            terminal::terminal_create,
            terminal::terminal_start,
            terminal::terminal_write,
            terminal::terminal_restart,
            terminal::terminal_interrupt,
            terminal::terminal_close,
            terminal::terminal_get_status,
            mcp::mcp_list_servers,
            mcp::mcp_save_server,
            mcp::mcp_delete_server,
            mcp::mcp_connect_server,
            mcp::mcp_disconnect_server,
            mcp::mcp_call_tool,
            local_llm::llm_get_hardware_info,
            local_llm::llm_pick_models_dir,
            local_llm::llm_list_installed_models,
            local_llm::llm_download_model,
            local_llm::llm_cancel_download,
            local_llm::llm_delete_model,
            local_llm::llm_start_server,
            local_llm::llm_stop_server,
            local_llm::llm_get_server_status,
            local_llm::llm_discover_active_servers,
            local_llm::llm_local_chat_stream,
            local_llm::llm_cloud_chat_stream,
            local_llm::llm_test_cloud_connection,
            local_llm::llm_abort_chat_stream,
            store_api_key,
            get_api_key,
            delete_api_key,
            get_key_status
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed = event
            {
                if let Some(llm) = window.app_handle().try_state::<local_llm::LocalLlmManager>() {
                    llm.shutdown_sync();
                }
                if let Some(term) = window.app_handle().try_state::<terminal::TerminalManager>() {
                    term.shutdown_sync();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Mintu Studio");
}
