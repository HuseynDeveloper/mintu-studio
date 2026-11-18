/**
 * studio.rs
 * Mintu Studio Standalone Backend Module (Phase 2: Secure Read/Write, Content Grep, Approved Commands)
 *
 * Security rules (preserved & enforced in Rust):
 * - Project root is chosen ONLY via native OS folder-picker dialog in Rust.
 * - All read/write/create/search operations take relative paths validated & canonicalized inside root.
 * - Blocks `..`, symlinks/junctions escaping root, absolute paths, UNC paths, drive-letter switches.
 * - Rust-enforced sensitive file exclusion on BOTH reads, writes, creates, and grep searches.
 * - Max read 1 MB, max write 2 MB, binary rejection, skip node_modules/.git/target by default.
 * - Shell commands run ONLY inside opened project root with CREATE_NO_WINDOW, 30s timeout, and output cap.
 */

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, RwLock};
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

pub const MAX_STUDIO_FILE_SIZE: u64 = 1_048_576; // 1 MB read limit
pub const MAX_STUDIO_WRITE_SIZE: usize = 2_097_152; // 2 MB write limit
pub const MAX_CMD_OUTPUT_BYTES: usize = 65_536; // 64 KB output cap

const SKIPPED_DIRS: &[&str] = &["node_modules", ".git", "target", "dist", ".next", "__pycache__"];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartupTarget {
    pub folder_path: String,
    pub folder_name: String,
    pub file_rel_path: Option<String>,
}

#[derive(Default)]
pub struct StudioState {
    pub project_root: Arc<RwLock<Option<PathBuf>>>,
    pub startup_target: Arc<RwLock<Option<StartupTarget>>>,
}

impl StudioState {
    pub fn from_cli_args() -> Self {
        let state = Self::default();
        for arg in std::env::args().skip(1) {
            if arg.starts_with('-') || arg.trim().is_empty() {
                continue;
            }
            let raw_path = PathBuf::from(arg.trim().trim_matches('"'));
            if !raw_path.exists() {
                continue;
            }
            if raw_path.is_dir() {
                if let Ok(canon) = fs::canonicalize(&raw_path) {
                    let folder_name = canon
                        .file_name()
                        .and_then(|s| s.to_str())
                        .unwrap_or("Workspace")
                        .to_string();
                    let folder_path = strip_windows_verbatim(&canon).to_string_lossy().to_string();
                    if let Ok(mut guard) = state.project_root.write() {
                        *guard = Some(canon);
                    }
                    if let Ok(mut st) = state.startup_target.write() {
                        *st = Some(StartupTarget {
                            folder_path,
                            folder_name,
                            file_rel_path: None,
                        });
                    }
                    break;
                }
            } else if raw_path.is_file() {
                if let Some(parent) = raw_path.parent() {
                    if let Ok(canon_parent) = fs::canonicalize(parent) {
                        let folder_name = canon_parent
                            .file_name()
                            .and_then(|s| s.to_str())
                            .unwrap_or("Workspace")
                            .to_string();
                        let folder_path = strip_windows_verbatim(&canon_parent).to_string_lossy().to_string();
                        let file_name = raw_path
                            .file_name()
                            .and_then(|s| s.to_str())
                            .map(|s| s.to_string());
                        let safe_file = file_name.filter(|f| !is_sensitive_file_or_dir(Path::new(f)));
                        if let Ok(mut guard) = state.project_root.write() {
                            *guard = Some(canon_parent);
                        }
                        if let Ok(mut st) = state.startup_target.write() {
                            *st = Some(StartupTarget {
                                folder_path,
                                folder_name,
                                file_rel_path: safe_file,
                            });
                        }
                        break;
                    }
                }
            }
        }
        state
    }
}

fn strip_windows_verbatim(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(stripped) = s.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        p.to_path_buf()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudioFolderInfo {
    pub root_path: String,
    pub folder_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudioFileEntry {
    pub name: String,
    pub path: String, // Relative path with forward slashes
    pub is_dir: bool,
    pub is_sensitive: bool,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudioGrepMatch {
    pub path: String,
    pub line_number: usize,
    pub line_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudioCommandResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
}

/// Checks whether a given relative path or any of its segments match sensitive/secret patterns.
pub fn is_sensitive_file_or_dir(rel_path: &Path) -> bool {
    for component in rel_path.components() {
        let seg = component.as_os_str().to_string_lossy().to_lowercase();

        if seg == ".ssh" || seg.starts_with(".ssh/") || seg.starts_with(".ssh\\") {
            return true;
        }

        if seg.starts_with(".env") {
            if !seg.ends_with(".example")
                && !seg.ends_with(".sample")
                && !seg.ends_with(".template")
            {
                return true;
            }
        }

        if seg.ends_with(".pem")
            || seg.ends_with(".key")
            || seg.ends_with(".pkcs12")
            || seg.ends_with(".pfx")
            || seg.ends_with(".p12")
            || seg.ends_with(".keystore")
            || seg.ends_with(".jks")
        {
            return true;
        }

        if seg.starts_with("id_rsa")
            || seg.starts_with("id_ed25519")
            || seg.starts_with("id_ecdsa")
            || seg.starts_with("id_dsa")
        {
            return true;
        }

        if seg.contains("secret")
            || seg.contains("credential")
            || seg.contains("password")
            || seg.contains("private_key")
            || seg.contains("privatekey")
        {
            return true;
        }
    }
    false
}

/// Validates syntax of relative path (no absolute, no drive letter, no UNC, no `..`).
fn sanitize_relative_path(rel_path_str: &str) -> Result<String, String> {
    let clean_str = rel_path_str.trim().replace('\\', "/");

    if clean_str.is_empty() {
        return Ok(String::new());
    }

    if clean_str.starts_with('/') || clean_str.starts_with('\\') {
        return Err("Path traversal rejected: path cannot be absolute".to_string());
    }

    if clean_str.contains(':') || clean_str.starts_with("//") {
        return Err("Path traversal rejected: invalid drive or UNC path".to_string());
    }

    let rel_path = Path::new(&clean_str);
    for comp in rel_path.components() {
        match comp {
            Component::ParentDir => {
                return Err("Path traversal rejected: '..' component forbidden".to_string());
            }
            Component::Prefix(_) | Component::RootDir => {
                return Err(
                    "Path traversal rejected: root or prefix component forbidden".to_string(),
                );
            }
            _ => {}
        }
    }

    Ok(clean_str)
}

/// Validates that an existing user-provided relative path stays strictly inside root.
pub fn validate_and_resolve_path(root: &Path, rel_path_str: &str) -> Result<PathBuf, String> {
    let clean_str = sanitize_relative_path(rel_path_str)?;

    let canonical_root = root
        .canonicalize()
        .map_err(|e| format!("Cannot resolve project root: {e}"))?;

    if clean_str.is_empty() {
        return Ok(canonical_root);
    }

    let combined = root.join(Path::new(&clean_str));
    let canonical_target = combined
        .canonicalize()
        .map_err(|e| format!("Cannot resolve target path: {e}"))?;

    if !canonical_target.starts_with(&canonical_root) {
        return Err("Security boundary violation: target path escapes project root".to_string());
    }

    Ok(canonical_target)
}

/// Validates a target path that may NOT exist yet (for writing/creating files safely inside root).
pub fn validate_and_resolve_write_path(root: &Path, rel_path_str: &str) -> Result<PathBuf, String> {
    let clean_str = sanitize_relative_path(rel_path_str)?;
    if clean_str.is_empty() {
        return Err("File path cannot be empty".to_string());
    }

    if is_sensitive_file_or_dir(Path::new(&clean_str)) {
        return Err(
            "Security block: sensitive/secret files cannot be written or modified".to_string(),
        );
    }

    let canonical_root = root
        .canonicalize()
        .map_err(|e| format!("Cannot resolve project root: {e}"))?;

    let candidate = root.join(Path::new(&clean_str));

    // If file already exists, canonicalize directly to verify symlinks don't escape root or hit sensitive files
    if candidate.exists() {
        let canonical_target = candidate
            .canonicalize()
            .map_err(|e| format!("Cannot resolve target path: {e}"))?;
        if !canonical_target.starts_with(&canonical_root) {
            return Err("Security boundary violation: target path escapes project root".to_string());
        }
        if let Ok(stripped) = canonical_target.strip_prefix(&canonical_root) {
            if is_sensitive_file_or_dir(stripped) {
                return Err(
                    "Security block: resolved target is a sensitive/secret file".to_string(),
                );
            }
        }
        return Ok(canonical_target);
    }

    // Walk up to the nearest existing ancestor and verify it canonicalizes inside root
    let mut ancestor = candidate.parent();
    while let Some(a) = ancestor {
        if a.exists() {
            let canonical_ancestor = a
                .canonicalize()
                .map_err(|e| format!("Cannot resolve parent directory: {e}"))?;
            if !canonical_ancestor.starts_with(&canonical_root) {
                return Err(
                    "Security boundary violation: parent directory escapes project root".to_string(),
                );
            }
            let tail = candidate
                .strip_prefix(a)
                .map_err(|e| format!("Invalid relative path tail: {e}"))?;
            return Ok(canonical_ancestor.join(tail));
        }
        ancestor = a.parent();
    }

    Err("Security boundary violation: could not verify parent directory".to_string())
}

/// Core secure file reader used by the Tauri command and unit tests.
pub fn read_file_secure(root: &Path, rel_path: &str) -> Result<String, String> {
    let clean_rel = sanitize_relative_path(rel_path)?;
    if clean_rel.is_empty() {
        return Err("File path cannot be empty".to_string());
    }

    if is_sensitive_file_or_dir(Path::new(&clean_rel)) {
        return Err(
            "Security block: sensitive/secret files cannot be read or sent to AI models"
                .to_string(),
        );
    }

    let target_file = validate_and_resolve_path(root, &clean_rel)?;

    if let Ok(canonical_root) = root.canonicalize() {
        if let Ok(stripped) = target_file.strip_prefix(&canonical_root) {
            if is_sensitive_file_or_dir(stripped) {
                return Err(
                    "Security block: resolved target is a sensitive/secret file".to_string(),
                );
            }
        }
    }

    if !target_file.is_file() {
        return Err("Target path is not a file".to_string());
    }

    let meta = fs::metadata(&target_file)
        .map_err(|e| format!("Failed to read file metadata: {e}"))?;

    if meta.len() > MAX_STUDIO_FILE_SIZE {
        return Err(format!(
            "File size ({:.2} MB) exceeds the 1 MB limit",
            meta.len() as f64 / 1_048_576.0
        ));
    }

    let mut file =
        fs::File::open(&target_file).map_err(|e| format!("Failed to open file: {e}"))?;
    let mut buffer = Vec::with_capacity(meta.len() as usize);
    file.read_to_end(&mut buffer)
        .map_err(|e| format!("Failed to read file: {e}"))?;

    if buffer.iter().take(1024).any(|&b| b == 0) {
        return Err("Binary file cannot be displayed or processed".to_string());
    }

    String::from_utf8(buffer)
        .map_err(|_| "File contains invalid UTF-8 and cannot be displayed".to_string())
}

/// Core secure file writer used by Tauri command and unit tests.
pub fn write_file_secure(root: &Path, rel_path: &str, content: &str) -> Result<(), String> {
    if content.len() > MAX_STUDIO_WRITE_SIZE {
        return Err("Content exceeds 2 MB write size limit".to_string());
    }

    let target_file = validate_and_resolve_write_path(root, rel_path)?;
    if let Some(parent) = target_file.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent dirs: {e}"))?;
    }

    fs::write(&target_file, content.as_bytes()).map_err(|e| format!("Failed to write file: {e}"))
}

/// Core secure content search (strictly skips sensitive files, skipped dirs, binary files).
pub fn grep_search_secure(
    root: &Path,
    query: &str,
    max_results: usize,
) -> Result<Vec<StudioGrepMatch>, String> {
    let q_lower = query.trim().to_lowercase();
    if q_lower.is_empty() {
        return Ok(Vec::new());
    }

    let canonical_root = root
        .canonicalize()
        .map_err(|e| format!("Cannot resolve project root: {e}"))?;

    let mut matches = Vec::new();
    let cap = max_results.clamp(1, 200);
    let mut stack = vec![canonical_root.clone()];
    let mut visited_files: usize = 0;

    while let Some(dir) = stack.pop() {
        if matches.len() >= cap || visited_files >= 4000 {
            break;
        }
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };

        for entry in entries.flatten() {
            if matches.len() >= cap {
                break;
            }
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let Ok(meta) = entry.metadata() else {
                continue;
            };

            let Ok(canonical_entry) = path.canonicalize() else {
                continue;
            };
            if !canonical_entry.starts_with(&canonical_root) {
                continue;
            }
            let Ok(rel) = canonical_entry.strip_prefix(&canonical_root) else {
                continue;
            };

            if is_sensitive_file_or_dir(rel) {
                continue;
            }

            if meta.is_dir() {
                if SKIPPED_DIRS.iter().any(|&s| s.eq_ignore_ascii_case(&name)) {
                    continue;
                }
                stack.push(canonical_entry);
                continue;
            }

            if !meta.is_file() || meta.len() > MAX_STUDIO_FILE_SIZE {
                continue;
            }

            visited_files += 1;
            let Ok(mut file) = fs::File::open(&canonical_entry) else {
                continue;
            };
            let mut buf = Vec::with_capacity(meta.len() as usize);
            if file.read_to_end(&mut buf).is_err() {
                continue;
            }
            if buf.iter().take(512).any(|&b| b == 0) {
                continue;
            }
            let Ok(text) = String::from_utf8(buf) else {
                continue;
            };

            let rel_str = rel.to_string_lossy().replace('\\', "/");
            for (idx, line) in text.lines().enumerate() {
                if line.to_lowercase().contains(&q_lower) {
                    let preview = if line.len() > 180 {
                        format!("{}...", &line[..180])
                    } else {
                        line.to_string()
                    };
                    matches.push(StudioGrepMatch {
                        path: rel_str.clone(),
                        line_number: idx + 1,
                        line_text: preview.trim().to_string(),
                    });
                    if matches.len() >= cap {
                        break;
                    }
                }
            }
        }
    }

    Ok(matches)
}

#[tauri::command]
pub async fn studio_pick_folder(
    state: State<'_, StudioState>,
) -> Result<Option<StudioFolderInfo>, String> {
    let root_arc = state.project_root.clone();
    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            use std::process::Command;
            const CREATE_NO_WINDOW: u32 = 0x08000000;

            let script = r#"
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Select Project Folder for Mintu Studio'
$dialog.ShowNewFolderButton = $false
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    Write-Output $dialog.SelectedPath
}
"#;
            let output = Command::new("powershell.exe")
                .arg("-NoProfile")
                .arg("-NonInteractive")
                .arg("-Command")
                .arg(script)
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .map_err(|e| e.to_string())?;

            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !stdout.is_empty() {
                    let path = PathBuf::from(&stdout);
                    if path.is_dir() {
                        let folder_name = path
                            .file_name()
                            .map(|s| s.to_string_lossy().to_string())
                            .unwrap_or_else(|| stdout.clone());

                        let mut root_guard = root_arc.write().map_err(|e| e.to_string())?;
                        *root_guard = Some(path);

                        return Ok(Some(StudioFolderInfo {
                            root_path: stdout,
                            folder_name,
                        }));
                    }
                }
            }
            Ok(None)
        }
        #[cfg(not(target_os = "windows"))]
        {
            Ok(None)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn studio_get_project_root(
    state: State<'_, StudioState>,
) -> Result<Option<StudioFolderInfo>, String> {
    let root_guard = state.project_root.read().map_err(|e| e.to_string())?;
    if let Some(ref path) = *root_guard {
        let folder_name = path
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| path.to_string_lossy().to_string());
        Ok(Some(StudioFolderInfo {
            root_path: path.to_string_lossy().to_string(),
            folder_name,
        }))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub fn studio_close_project(state: State<'_, StudioState>) -> Result<(), String> {
    let mut root_guard = state.project_root.write().map_err(|e| e.to_string())?;
    *root_guard = None;
    Ok(())
}

#[tauri::command]
pub fn studio_list_dir(
    state: State<'_, StudioState>,
    rel_path: Option<String>,
) -> Result<Vec<StudioFileEntry>, String> {
    let root = {
        let root_guard = state.project_root.read().map_err(|e| e.to_string())?;
        root_guard
            .as_ref()
            .cloned()
            .ok_or("No project folder is currently opened")?
    };

    let target_rel = rel_path.unwrap_or_default();
    let target_dir = validate_and_resolve_path(&root, &target_rel)?;

    if !target_dir.is_dir() {
        return Err("Target path is not a directory".to_string());
    }

    let entries =
        fs::read_dir(&target_dir).map_err(|e| format!("Failed to read directory: {e}"))?;
    let mut result = Vec::new();
    let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;

    for entry in entries.flatten() {
        let entry_path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let is_dir = meta.is_dir();

        if is_dir && SKIPPED_DIRS.iter().any(|&skip| skip.eq_ignore_ascii_case(&name)) {
            continue;
        }

        let canonical_entry = match entry_path.canonicalize() {
            Ok(p) => p,
            Err(_) => continue,
        };
        if !canonical_entry.starts_with(&canonical_root) {
            continue;
        }

        let rel_display = match entry_path.strip_prefix(&root) {
            Ok(r) => r.to_string_lossy().replace('\\', "/"),
            Err(_) => match canonical_entry.strip_prefix(&canonical_root) {
                Ok(r) => r.to_string_lossy().replace('\\', "/"),
                Err(_) => continue,
            },
        };

        let is_sensitive = is_sensitive_file_or_dir(Path::new(&rel_display));

        result.push(StudioFileEntry {
            name,
            path: rel_display,
            is_dir,
            is_sensitive,
            size: if is_dir { 0 } else { meta.len() },
        });
    }

    result.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(result)
}

#[tauri::command]
pub fn studio_read_file(state: State<'_, StudioState>, rel_path: String) -> Result<String, String> {
    let root = {
        let root_guard = state.project_root.read().map_err(|e| e.to_string())?;
        root_guard
            .as_ref()
            .cloned()
            .ok_or("No project folder is currently opened")?
    };

    read_file_secure(&root, &rel_path)
}

#[tauri::command]
pub fn studio_write_file(
    state: State<'_, StudioState>,
    rel_path: String,
    content: String,
) -> Result<(), String> {
    let root = {
        let root_guard = state.project_root.read().map_err(|e| e.to_string())?;
        root_guard
            .as_ref()
            .cloned()
            .ok_or("No project folder is currently opened")?
    };

    write_file_secure(&root, &rel_path, &content)
}

#[tauri::command]
pub fn studio_create_entry(
    state: State<'_, StudioState>,
    rel_path: String,
    is_dir: bool,
) -> Result<(), String> {
    let root = {
        let root_guard = state.project_root.read().map_err(|e| e.to_string())?;
        root_guard
            .as_ref()
            .cloned()
            .ok_or("No project folder is currently opened")?
    };

    let target = validate_and_resolve_write_path(&root, &rel_path)?;
    if target.exists() {
        return Err("Bu adda fayl və ya qovluq artıq mövcuddur".to_string());
    }

    if is_dir {
        fs::create_dir_all(&target).map_err(|e| format!("Failed to create directory: {e}"))
    } else {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent dirs: {e}"))?;
        }
        fs::write(&target, b"").map_err(|e| format!("Failed to create file: {e}"))
    }
}

#[tauri::command]
pub async fn studio_grep_search(
    state: State<'_, StudioState>,
    query: String,
    max_results: Option<usize>,
) -> Result<Vec<StudioGrepMatch>, String> {
    let root = {
        let root_guard = state.project_root.read().map_err(|e| e.to_string())?;
        root_guard
            .as_ref()
            .cloned()
            .ok_or("No project folder is currently opened")?
    };

    let limit = max_results.unwrap_or(60);
    tokio::task::spawn_blocking(move || grep_search_secure(&root, &query, limit))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn studio_run_approved_command(
    state: State<'_, StudioState>,
    command: String,
) -> Result<StudioCommandResult, String> {
    let root = {
        let root_guard = state.project_root.read().map_err(|e| e.to_string())?;
        root_guard
            .as_ref()
            .cloned()
            .ok_or("No project folder is currently opened")?
    };

    let trimmed = command.trim().to_string();
    if trimmed.is_empty() {
        return Err("Command cannot be empty".to_string());
    }

    let mut cmd = {
        #[cfg(target_os = "windows")]
        {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            let mut c = tokio::process::Command::new("powershell.exe");
            c.arg("-NoProfile")
                .arg("-NonInteractive")
                .arg("-Command")
                .arg(&trimmed);
            c.creation_flags(CREATE_NO_WINDOW);
            c
        }
        #[cfg(not(target_os = "windows"))]
        {
            let mut c = tokio::process::Command::new("sh");
            c.arg("-c").arg(&trimmed);
            c
        }
    };

    cmd.current_dir(&root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn command: {e}"))?;

    match tokio::time::timeout(Duration::from_secs(30), child.wait_with_output()).await {
        Ok(Ok(output)) => {
            let stdout_slice = &output.stdout[..output.stdout.len().min(MAX_CMD_OUTPUT_BYTES)];
            let stderr_slice = &output.stderr[..output.stderr.len().min(MAX_CMD_OUTPUT_BYTES)];
            Ok(StudioCommandResult {
                exit_code: output.status.code().unwrap_or(-1),
                stdout: String::from_utf8_lossy(stdout_slice).to_string(),
                stderr: String::from_utf8_lossy(stderr_slice).to_string(),
                timed_out: false,
            })
        }
        Ok(Err(e)) => Err(format!("Command execution error: {e}")),
        Err(_) => Ok(StudioCommandResult {
            exit_code: -1,
            stdout: String::new(),
            stderr: "Komanda 30 saniyəlik vaxt limitini keçdiyi üçün dayandırıldı.".to_string(),
            timed_out: true,
        }),
    }
}

#[tauri::command]
pub fn studio_open_devtools(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        win.open_devtools();
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowStateInfo {
    pub maximized: bool,
    pub fullscreen: bool,
}

#[tauri::command]
pub fn studio_window_state(app: AppHandle) -> Result<WindowStateInfo, String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;
    let maximized = win.is_maximized().unwrap_or(false);
    let fullscreen = win.is_fullscreen().unwrap_or(false);
    Ok(WindowStateInfo { maximized, fullscreen })
}

#[tauri::command]
pub fn studio_toggle_maximize(app: AppHandle) -> Result<WindowStateInfo, String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    if win.is_fullscreen().unwrap_or(false) {
        win.set_fullscreen(false).map_err(|e| e.to_string())?;
    }

    if win.is_maximized().unwrap_or(false) {
        win.unmaximize().map_err(|e| e.to_string())?;
    } else {
        win.maximize().map_err(|e| e.to_string())?;
    }

    Ok(WindowStateInfo {
        maximized: win.is_maximized().unwrap_or(false),
        fullscreen: win.is_fullscreen().unwrap_or(false),
    })
}

#[tauri::command]
pub fn studio_toggle_fullscreen(app: AppHandle) -> Result<WindowStateInfo, String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    let next_fs = !win.is_fullscreen().unwrap_or(false);
    win.set_fullscreen(next_fs).map_err(|e| e.to_string())?;

    Ok(WindowStateInfo {
        maximized: win.is_maximized().unwrap_or(false),
        fullscreen: win.is_fullscreen().unwrap_or(next_fs),
    })
}

#[tauri::command]
pub fn studio_minimize_window(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        win.minimize().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn studio_close_window(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        win.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitFileStatus {
    pub path: String,
    pub status: String, // "M" | "A" | "D" | "U" | "R"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitRepoInfo {
    pub is_git_repo: bool,
    pub branch: Option<String>,
    pub files: Vec<GitFileStatus>,
}

#[tauri::command]
pub fn studio_open_folder_path(
    state: State<'_, StudioState>,
    path: String,
) -> Result<StudioFolderInfo, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Qovluq yolu boş ola bilməz".to_string());
    }
    let pb = PathBuf::from(trimmed);
    if !pb.is_dir() {
        return Err("Seçilmiş qovluq mövcud deyil".to_string());
    }
    let canonical = pb
        .canonicalize()
        .map_err(|e| format!("Qovluq açıla bilmədi: {e}"))?;
    let clean_path = canonical
        .to_string_lossy()
        .trim_start_matches("\\\\?\\")
        .to_string();
    let folder_name = canonical
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| clean_path.clone());

    {
        let mut guard = state.project_root.write().map_err(|e| e.to_string())?;
        *guard = Some(PathBuf::from(&clean_path));
    }

    Ok(StudioFolderInfo {
        root_path: clean_path,
        folder_name,
    })
}

#[tauri::command]
pub fn studio_rename_entry(
    state: State<'_, StudioState>,
    old_rel_path: String,
    new_rel_path: String,
) -> Result<(), String> {
    let root = {
        let guard = state.project_root.read().map_err(|e| e.to_string())?;
        guard
            .clone()
            .ok_or_else(|| "Layihə qovluğu açılmayıb".to_string())?
    };

    let clean_old = sanitize_relative_path(&old_rel_path)?;
    let clean_new = sanitize_relative_path(&new_rel_path)?;
    if clean_old.is_empty() || clean_new.is_empty() {
        return Err("Fayl yolu boş ola bilməz".to_string());
    }
    if is_sensitive_file_or_dir(Path::new(&clean_old)) || is_sensitive_file_or_dir(Path::new(&clean_new)) {
        return Err("Security block: həssas faylların adı dəyişdirilə bilməz".to_string());
    }

    let src = validate_and_resolve_path(&root, &clean_old)?;
    let dst = validate_and_resolve_write_path(&root, &clean_new)?;

    if dst.exists() {
        return Err("Hədəf ad artıq mövcuddur".to_string());
    }
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Qovluq yaradılmadı: {e}"))?;
    }
    fs::rename(&src, &dst).map_err(|e| format!("Ad dəyişdirilmədi: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn studio_delete_entry(
    state: State<'_, StudioState>,
    rel_path: String,
) -> Result<(), String> {
    let root = {
        let guard = state.project_root.read().map_err(|e| e.to_string())?;
        guard
            .clone()
            .ok_or_else(|| "Layihə qovluğu açılmayıb".to_string())?
    };

    let clean = sanitize_relative_path(&rel_path)?;
    if clean.is_empty() {
        return Err("Layihə kök qovluğu silinə bilməz".to_string());
    }
    if is_sensitive_file_or_dir(Path::new(&clean)) {
        return Err("Security block: həssas fayllar silinə bilməz".to_string());
    }

    let target = validate_and_resolve_path(&root, &clean)?;
    let canonical_root = root
        .canonicalize()
        .map_err(|e| format!("Layihə kökü tapılmadı: {e}"))?;
    if target == canonical_root {
        return Err("Layihə kök qovluğu silinə bilməz".to_string());
    }

    if target.is_dir() {
        fs::remove_dir_all(&target).map_err(|e| format!("Qovluq silinmədi: {e}"))?;
    } else if target.is_file() {
        fs::remove_file(&target).map_err(|e| format!("Fayl silinmədi: {e}"))?;
    } else {
        return Err("Hədəf tapılmadı".to_string());
    }
    Ok(())
}

fn collect_files_recursive(
    root: &Path,
    dir: &Path,
    out: &mut Vec<String>,
    max_files: usize,
) {
    if out.len() >= max_files {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut dirs = Vec::new();
    let mut files = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.is_dir() {
            if SKIPPED_DIRS.iter().any(|s| s.eq_ignore_ascii_case(&name)) {
                continue;
            }
            if let Ok(rel) = path.strip_prefix(root) {
                if !is_sensitive_file_or_dir(rel) {
                    dirs.push(path);
                }
            }
        } else if path.is_file() {
            if let Ok(rel) = path.strip_prefix(root) {
                if !is_sensitive_file_or_dir(rel) {
                    let rel_str = rel.to_string_lossy().replace('\\', "/");
                    files.push(rel_str);
                }
            }
        }
    }

    files.sort();
    for f in files {
        if out.len() >= max_files {
            return;
        }
        out.push(f);
    }

    dirs.sort();
    for d in dirs {
        if out.len() >= max_files {
            return;
        }
        collect_files_recursive(root, &d, out, max_files);
    }
}

#[tauri::command]
pub fn studio_list_all_files(
    state: State<'_, StudioState>,
    max_files: Option<usize>,
) -> Result<Vec<String>, String> {
    let root = {
        let guard = state.project_root.read().map_err(|e| e.to_string())?;
        match *guard {
            Some(ref r) => r.clone(),
            None => return Ok(Vec::new()),
        }
    };
    let limit = max_files.unwrap_or(1500).min(4000);
    let mut out = Vec::new();
    collect_files_recursive(&root, &root, &mut out, limit);
    Ok(out)
}

fn run_git_cmd(root: &Path, args: &[&str]) -> Option<String> {
    let mut cmd = std::process::Command::new("git");
    cmd.args(args)
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd.output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
pub async fn studio_git_info(state: State<'_, StudioState>) -> Result<GitRepoInfo, String> {
    let root = {
        let guard = state.project_root.read().map_err(|e| e.to_string())?;
        match *guard {
            Some(ref r) => r.clone(),
            None => {
                return Ok(GitRepoInfo {
                    is_git_repo: false,
                    branch: None,
                    files: Vec::new(),
                });
            }
        }
    };

    tokio::task::spawn_blocking(move || {
        let Some(branch_raw) = run_git_cmd(&root, &["rev-parse", "--abbrev-ref", "HEAD"]) else {
            return GitRepoInfo {
                is_git_repo: false,
                branch: None,
                files: Vec::new(),
            };
        };

        let branch = branch_raw.trim().to_string();
        let status_raw = run_git_cmd(&root, &["status", "--porcelain"]).unwrap_or_default();
        let mut files = Vec::new();

        for line in status_raw.lines() {
            if line.len() < 4 {
                continue;
            }
            let code = &line[..2];
            let raw_path = line[3..].trim().trim_matches('"');
            let path = if let Some((_, after)) = raw_path.split_once(" -> ") {
                after.trim().trim_matches('"').replace('\\', "/")
            } else {
                raw_path.replace('\\', "/")
            };

            if is_sensitive_file_or_dir(Path::new(&path)) {
                continue;
            }

            let status = if code == "??" {
                "U"
            } else if code.contains('D') {
                "D"
            } else if code.contains('A') {
                "A"
            } else if code.contains('R') {
                "R"
            } else {
                "M"
            };

            files.push(GitFileStatus {
                path,
                status: status.to_string(),
            });
        }

        GitRepoInfo {
            is_git_repo: true,
            branch: if branch.is_empty() { None } else { Some(branch) },
            files,
        }
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn studio_git_diff(
    state: State<'_, StudioState>,
    rel_path: Option<String>,
) -> Result<String, String> {
    let root = {
        let guard = state.project_root.read().map_err(|e| e.to_string())?;
        guard
            .clone()
            .ok_or_else(|| "Layihə qovluğu açılmayıb".to_string())?
    };

    let clean_target = if let Some(ref p) = rel_path {
        let c = sanitize_relative_path(p)?;
        if is_sensitive_file_or_dir(Path::new(&c)) {
            return Err("Security block: həssas fayl diff-i oxuna bilməz".to_string());
        }
        if c.is_empty() { None } else { Some(c) }
    } else {
        None
    };

    tokio::task::spawn_blocking(move || {
        let mut args: Vec<&str> = vec!["diff", "HEAD"];
        if let Some(ref p) = clean_target {
            args.push("--");
            args.push(p.as_str());
        }
        let mut diff = run_git_cmd(&root, &args).unwrap_or_default();
        if diff.trim().is_empty() {
            // Fallback for repo without commits yet
            let mut unstaged: Vec<&str> = vec!["diff"];
            if let Some(ref p) = clean_target {
                unstaged.push("--");
                unstaged.push(p.as_str());
            }
            diff = run_git_cmd(&root, &unstaged).unwrap_or_default();
        }
        if diff.len() > MAX_CMD_OUTPUT_BYTES {
            diff.truncate(MAX_CMD_OUTPUT_BYTES);
            diff.push_str("\n... [diff kəsildi]");
        }
        Ok(diff)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalReplaceResult {
    pub files_changed: usize,
    pub replacements: usize,
    pub changed_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitCommitEntry {
    pub hash: String,
    pub date: String,
    pub author: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitBranchesInfo {
    pub current: String,
    pub branches: Vec<String>,
}

#[tauri::command]
pub fn studio_read_project_rules(state: State<'_, StudioState>) -> Result<Option<String>, String> {
    let root = {
        let guard = state.project_root.read().map_err(|e| e.to_string())?;
        match *guard {
            Some(ref r) => r.clone(),
            None => return Ok(None),
        }
    };
    let rules_file = root.join(".minturules");
    if !rules_file.is_file() {
        return Ok(None);
    }
    let meta = fs::metadata(&rules_file).map_err(|e| e.to_string())?;
    if meta.len() > 32_768 {
        return Err(".minturules faylı 32 KB limitini keçir".to_string());
    }
    let txt = fs::read_to_string(&rules_file).map_err(|e| e.to_string())?;
    Ok(Some(txt))
}

#[tauri::command]
pub fn studio_replace_in_files(
    state: State<'_, StudioState>,
    query: String,
    replacement: String,
    rel_paths: Vec<String>,
) -> Result<GlobalReplaceResult, String> {
    if query.is_empty() {
        return Err("Axtarış mətni boş ola bilməz".to_string());
    }
    let root = {
        let guard = state.project_root.read().map_err(|e| e.to_string())?;
        guard
            .clone()
            .ok_or_else(|| "Layihə qovluğu açılmayıb".to_string())?
    };

    let mut files_changed = 0usize;
    let mut total_replacements = 0usize;
    let mut changed_paths = Vec::new();

    for raw_rel in rel_paths.into_iter().take(250) {
        let Ok(clean) = sanitize_relative_path(&raw_rel) else {
            continue;
        };
        if clean.is_empty() || is_sensitive_file_or_dir(Path::new(&clean)) {
            continue;
        }
        let Ok(target) = validate_and_resolve_path(&root, &clean) else {
            continue;
        };
        if !target.is_file() {
            continue;
        }
        let Ok(meta) = fs::metadata(&target) else {
            continue;
        };
        if meta.len() > MAX_STUDIO_FILE_SIZE {
            continue;
        }
        let Ok(content) = fs::read_to_string(&target) else {
            continue;
        };
        let count = content.matches(&query).count();
        if count == 0 {
            continue;
        }
        let updated = content.replace(&query, &replacement);
        if fs::write(&target, updated.as_bytes()).is_ok() {
            files_changed += 1;
            total_replacements += count;
            changed_paths.push(clean);
        }
    }

    Ok(GlobalReplaceResult {
        files_changed,
        replacements: total_replacements,
        changed_paths,
    })
}

fn compute_dir_fingerprint(dir: &Path, depth: usize, acc: &mut u64, count: &mut u64) {
    if depth > 6 || *count > 4000 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if SKIPPED_DIRS.iter().any(|s| s.eq_ignore_ascii_case(&name)) {
            continue;
        }
        let path = entry.path();
        if let Ok(meta) = entry.metadata() {
            *count += 1;
            if let Ok(modified) = meta.modified() {
                if let Ok(dur) = modified.duration_since(std::time::UNIX_EPOCH) {
                    *acc = acc.wrapping_add(dur.as_secs()).wrapping_add(meta.len());
                }
            }
            if meta.is_dir() {
                compute_dir_fingerprint(&path, depth + 1, acc, count);
            }
        }
    }
}

#[tauri::command]
pub async fn studio_project_fingerprint(state: State<'_, StudioState>) -> Result<String, String> {
    let root = {
        let guard = state.project_root.read().map_err(|e| e.to_string())?;
        match *guard {
            Some(ref r) => r.clone(),
            None => return Ok(String::new()),
        }
    };
    tokio::task::spawn_blocking(move || {
        let mut acc: u64 = 0;
        let mut count: u64 = 0;
        compute_dir_fingerprint(&root, 0, &mut acc, &mut count);
        format!("{count}:{acc}")
    })
    .await
    .map_err(|e| e.to_string())
}

fn validate_git_branch_name(name: &str) -> Result<String, String> {
    let clean = name.trim();
    if clean.is_empty()
        || clean.starts_with('-')
        || clean.contains("..")
        || clean.contains(' ')
        || !clean
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '/' | '.'))
    {
        return Err("Etibarsız branch adı".to_string());
    }
    Ok(clean.to_string())
}

fn run_git_cmd_result(root: &Path, args: &[&str]) -> Result<String, String> {
    let mut cmd = std::process::Command::new("git");
    cmd.args(args)
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd.output().map_err(|e| format!("git icra olunmadı: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if output.status.success() {
        Ok(if stdout.is_empty() { stderr } else { stdout })
    } else {
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}

#[tauri::command]
pub async fn studio_git_branches(state: State<'_, StudioState>) -> Result<GitBranchesInfo, String> {
    let root = {
        let guard = state.project_root.read().map_err(|e| e.to_string())?;
        guard
            .clone()
            .ok_or_else(|| "Layihə qovluğu açılmayıb".to_string())?
    };
    tokio::task::spawn_blocking(move || {
        let current = run_git_cmd(&root, &["rev-parse", "--abbrev-ref", "HEAD"])
            .unwrap_or_default()
            .trim()
            .to_string();
        let raw = run_git_cmd(&root, &["branch", "--format=%(refname:short)"]).unwrap_or_default();
        let branches: Vec<String> = raw
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect();
        Ok(GitBranchesInfo { current, branches })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn studio_git_checkout(
    state: State<'_, StudioState>,
    branch: String,
) -> Result<String, String> {
    let clean = validate_git_branch_name(&branch)?;
    let root = {
        let guard = state.project_root.read().map_err(|e| e.to_string())?;
        guard
            .clone()
            .ok_or_else(|| "Layihə qovluğu açılmayıb".to_string())?
    };
    tokio::task::spawn_blocking(move || run_git_cmd_result(&root, &["checkout", &clean]))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn studio_git_create_branch(
    state: State<'_, StudioState>,
    branch: String,
) -> Result<String, String> {
    let clean = validate_git_branch_name(&branch)?;
    let root = {
        let guard = state.project_root.read().map_err(|e| e.to_string())?;
        guard
            .clone()
            .ok_or_else(|| "Layihə qovluğu açılmayıb".to_string())?
    };
    tokio::task::spawn_blocking(move || run_git_cmd_result(&root, &["checkout", "-b", &clean]))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn studio_git_log(
    state: State<'_, StudioState>,
    limit: Option<usize>,
) -> Result<Vec<GitCommitEntry>, String> {
    let root = {
        let guard = state.project_root.read().map_err(|e| e.to_string())?;
        guard
            .clone()
            .ok_or_else(|| "Layihə qovluğu açılmayıb".to_string())?
    };
    let n = limit.unwrap_or(20).clamp(1, 50).to_string();
    tokio::task::spawn_blocking(move || {
        let raw = run_git_cmd(
            &root,
            &["log", "-n", &n, "--pretty=format:%h|%ad|%an|%s", "--date=short"],
        )
        .unwrap_or_default();
        let mut out = Vec::new();
        for line in raw.lines() {
            let parts: Vec<&str> = line.splitn(4, '|').collect();
            if parts.len() == 4 {
                out.push(GitCommitEntry {
                    hash: parts[0].to_string(),
                    date: parts[1].to_string(),
                    author: parts[2].to_string(),
                    message: parts[3].to_string(),
                });
            }
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn studio_git_sync(
    state: State<'_, StudioState>,
    action: String,
) -> Result<String, String> {
    let verb = match action.as_str() {
        "pull" => "pull",
        "push" => "push",
        _ => return Err("Yalnız pull və ya push icazəlidir".to_string()),
    };
    let root = {
        let guard = state.project_root.read().map_err(|e| e.to_string())?;
        guard
            .clone()
            .ok_or_else(|| "Layihə qovluğu açılmayıb".to_string())?
    };
    tokio::task::spawn_blocking(move || run_git_cmd_result(&root, &[verb]))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolLocation {
    pub path: String,
    pub line_number: usize,
    pub line_text: String,
    pub is_definition: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectScriptItem {
    pub name: String,
    pub command: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudioHttpRequest {
    pub method: String,
    pub url: String,
    pub headers: std::collections::HashMap<String, String>,
    pub body: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudioHttpResponse {
    pub status: u16,
    pub status_text: String,
    pub duration_ms: u64,
    pub size_bytes: usize,
    pub headers: std::collections::HashMap<String, String>,
    pub body: String,
}

fn is_symbol_definition_line(line: &str, symbol: &str) -> bool {
    let trimmed = line.trim();
    let patterns = [
        format!("function {symbol}"),
        format!("class {symbol}"),
        format!("interface {symbol}"),
        format!("type {symbol}"),
        format!("enum {symbol}"),
        format!("const {symbol} "),
        format!("const {symbol}="),
        format!("const {symbol}:"),
        format!("let {symbol} "),
        format!("let {symbol}="),
        format!("def {symbol}("),
        format!("fn {symbol}("),
        format!("fn {symbol}<"),
        format!("struct {symbol}"),
        format!("trait {symbol}"),
        format!("func {symbol}("),
        format!("export default function {symbol}"),
        format!("{symbol}("),
    ];
    for p in &patterns {
        if trimmed.contains(p.as_str()) {
            // Avoid matching plain function calls like foo(bar) unless prefixed by keyword/modifier
            if p.ends_with('(') && !p.contains(' ') {
                if trimmed.starts_with("public ")
                    || trimmed.starts_with("private ")
                    || trimmed.starts_with("protected ")
                    || trimmed.starts_with("async ")
                    || trimmed.starts_with("static ")
                {
                    return true;
                }
            } else {
                return true;
            }
        }
    }
    false
}

#[tauri::command]
pub async fn studio_find_symbol(
    state: State<'_, StudioState>,
    symbol: String,
) -> Result<Vec<SymbolLocation>, String> {
    let sym = symbol.trim().to_string();
    if sym.len() < 2 {
        return Ok(Vec::new());
    }
    let root = {
        let guard = state.project_root.read().map_err(|e| e.to_string())?;
        match *guard {
            Some(ref r) => r.clone(),
            None => return Ok(Vec::new()),
        }
    };

    tokio::task::spawn_blocking(move || {
        let mut all_files = Vec::new();
        collect_files_recursive(&root, &root, &mut all_files, 1200);
        let mut defs = Vec::new();
        let mut refs = Vec::new();

        for rel in all_files {
            if is_sensitive_file_or_dir(Path::new(&rel)) {
                continue;
            }
            let full = root.join(Path::new(&rel));
            let Ok(meta) = fs::metadata(&full) else {
                continue;
            };
            if meta.len() > 512_000 {
                continue;
            }
            let Ok(content) = fs::read_to_string(&full) else {
                continue;
            };
            for (idx, line) in content.lines().enumerate() {
                if !line.contains(&sym) {
                    continue;
                }
                let is_def = is_symbol_definition_line(line, &sym);
                let loc = SymbolLocation {
                    path: rel.clone(),
                    line_number: idx + 1,
                    line_text: line.trim().chars().take(180).collect(),
                    is_definition: is_def,
                };
                if is_def {
                    defs.push(loc);
                } else if refs.len() < 40 {
                    refs.push(loc);
                }
            }
        }

        defs.extend(refs);
        defs.truncate(50);
        defs
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn studio_read_project_scripts(
    state: State<'_, StudioState>,
) -> Result<Vec<ProjectScriptItem>, String> {
    let root = {
        let guard = state.project_root.read().map_err(|e| e.to_string())?;
        match *guard {
            Some(ref r) => r.clone(),
            None => return Ok(Vec::new()),
        }
    };

    let mut scripts = Vec::new();

    // 1. package.json scripts
    let pkg_path = root.join("package.json");
    if pkg_path.is_file() {
        if let Ok(raw) = fs::read_to_string(&pkg_path) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw) {
                if let Some(obj) = json.get("scripts").and_then(|v| v.as_object()) {
                    for (k, _) in obj {
                        scripts.push(ProjectScriptItem {
                            name: k.clone(),
                            command: format!("npm run {k}"),
                            source: "package.json".to_string(),
                        });
                    }
                }
            }
        }
    }

    // 2. Cargo.toml
    if root.join("Cargo.toml").is_file() {
        for (name, cmd) in [
            ("cargo check", "cargo check"),
            ("cargo test", "cargo test"),
            ("cargo run", "cargo run"),
            ("cargo build", "cargo build"),
        ] {
            scripts.push(ProjectScriptItem {
                name: name.to_string(),
                command: cmd.to_string(),
                source: "Cargo.toml".to_string(),
            });
        }
    }

    // 3. Python project
    if root.join("pyproject.toml").is_file() || root.join("requirements.txt").is_file() {
        scripts.push(ProjectScriptItem {
            name: "pytest".to_string(),
            command: "pytest".to_string(),
            source: "Python".to_string(),
        });
        if root.join("main.py").is_file() {
            scripts.push(ProjectScriptItem {
                name: "python main.py".to_string(),
                command: "python main.py".to_string(),
                source: "Python".to_string(),
            });
        } else if root.join("app.py").is_file() {
            scripts.push(ProjectScriptItem {
                name: "python app.py".to_string(),
                command: "python app.py".to_string(),
                source: "Python".to_string(),
            });
        }
    }

    Ok(scripts)
}

#[tauri::command]
pub async fn studio_http_request(request: StudioHttpRequest) -> Result<StudioHttpResponse, String> {
    let url = request.url.trim().to_string();
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("URL must start with http:// or https://".to_string());
    }

    let method = reqwest::Method::from_bytes(request.method.trim().to_uppercase().as_bytes())
        .map_err(|_| "Invalid HTTP method".to_string())?;

    let client = reqwest::Client::builder()
        .user_agent("MintuStudio-ApiTester/0.2.0")
        .timeout(Duration::from_secs(25))
        .build()
        .map_err(|e| e.to_string())?;

    let mut builder = client.request(method, &url);
    for (k, v) in &request.headers {
        if !k.trim().is_empty() {
            builder = builder.header(k.trim(), v.trim());
        }
    }
    if let Some(body) = request.body {
        if !body.is_empty() {
            builder = builder.body(body);
        }
    }

    let started = std::time::Instant::now();
    let resp = builder
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;
    let duration_ms = started.elapsed().as_millis() as u64;

    let status = resp.status().as_u16();
    let status_text = resp.status().canonical_reason().unwrap_or("").to_string();
    let mut headers = std::collections::HashMap::new();
    for (k, v) in resp.headers() {
        headers.insert(k.to_string(), v.to_str().unwrap_or("").to_string());
    }

    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    let size_bytes = bytes.len();
    let cap = bytes.len().min(256_000);
    let body = String::from_utf8_lossy(&bytes[..cap]).to_string();

    Ok(StudioHttpResponse {
        status,
        status_text,
        duration_ms,
        size_bytes,
        headers,
        body,
    })
}

fn strip_html_to_text(html: &str) -> String {
    // Drop script and style blocks first (case-insensitive)
    let mut out = String::with_capacity(html.len().min(32_000));
    let chars: Vec<char> = html.chars().collect();
    let len = chars.len();
    let mut i = 0;
    let mut in_tag = false;

    while i < len && out.len() < 20_000 {
        if chars[i] == '<' {
            let look: String = chars[i..(i + 10).min(len)].iter().collect::<String>().to_lowercase();
            if look.starts_with("<script") {
                if let Some(end_rel) = html[html.char_indices().nth(i).map(|x| x.0).unwrap_or(0)..]
                    .to_lowercase()
                    .find("</script>")
                {
                    let byte_target = html.char_indices().nth(i).map(|x| x.0).unwrap_or(0) + end_rel + 9;
                    while i < len && html.char_indices().nth(i).map(|x| x.0).unwrap_or(usize::MAX) < byte_target {
                        i += 1;
                    }
                    continue;
                }
            }
            if look.starts_with("<style") {
                if let Some(end_rel) = html[html.char_indices().nth(i).map(|x| x.0).unwrap_or(0)..]
                    .to_lowercase()
                    .find("</style>")
                {
                    let byte_target = html.char_indices().nth(i).map(|x| x.0).unwrap_or(0) + end_rel + 8;
                    while i < len && html.char_indices().nth(i).map(|x| x.0).unwrap_or(usize::MAX) < byte_target {
                        i += 1;
                    }
                    continue;
                }
            }
            in_tag = true;
            out.push(' ');
            i += 1;
            continue;
        }
        if chars[i] == '>' {
            in_tag = false;
            i += 1;
            continue;
        }
        if !in_tag {
            out.push(chars[i]);
        }
        i += 1;
    }

    // Collapse whitespace
    let mut collapsed = String::new();
    let mut prev_ws = false;
    for ch in out.chars() {
        if ch.is_whitespace() {
            if !prev_ws {
                collapsed.push(if ch == '\n' { '\n' } else { ' ' });
            }
            prev_ws = true;
        } else {
            collapsed.push(ch);
            prev_ws = false;
        }
        if collapsed.len() >= 15_000 {
            break;
        }
    }
    collapsed.trim().to_string()
}

fn is_blocked_ssrf_host(url_str: &str) -> bool {
    let parsed = match reqwest::Url::parse(url_str) {
        Ok(u) => u,
        Err(_) => return true,
    };
    let host = match parsed.host_str() {
        Some(h) => h.to_ascii_lowercase(),
        None => return true,
    };
    if host == "localhost"
        || host == "0.0.0.0"
        || host == "::1"
        || host == "[::1]"
        || host.ends_with(".local")
        || host.ends_with(".internal")
        || host.starts_with("127.")
        || host.starts_with("10.")
        || host.starts_with("169.254.")
        || host.starts_with("192.168.")
    {
        return true;
    }
    if host.starts_with("172.") {
        if let Some(second) = host.split('.').nth(1).and_then(|s| s.parse::<u8>().ok()) {
            if (16..=31).contains(&second) {
                return true;
            }
        }
    }
    false
}

#[tauri::command]
pub async fn studio_fetch_url_text(url: String) -> Result<String, String> {
    let clean = url.trim().to_string();
    if !clean.starts_with("https://") && !clean.starts_with("http://") {
        return Err("Only http:// and https:// URLs are supported".to_string());
    }
    if is_blocked_ssrf_host(&clean) {
        return Err("Security policy: fetching local or private network URLs is blocked.".to_string());
    }
    let client = reqwest::Client::builder()
        .user_agent("MintuStudio/0.2.0")
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(&clean)
        .send()
        .await
        .map_err(|e| format!("URL fetch failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let body = resp.text().await.map_err(|e| e.to_string())?;
    if body.trim_start().starts_with('<') {
        Ok(strip_html_to_text(&body))
    } else {
        Ok(body.chars().take(15_000).collect())
    }
}

#[tauri::command]
pub async fn studio_search_web(query: String) -> Result<String, String> {
    let q = query.trim();
    if q.is_empty() {
        return Err("Empty search query".to_string());
    }
    let encoded: String = q
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' => (b as char).to_string(),
            b' ' => "+".to_string(),
            _ => format!("%{:02X}", b),
        })
        .collect();
    let search_url = format!("https://html.duckduckgo.com/html/?q={}", encoded);
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) MintuStudio/0.2.0")
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(&search_url)
        .send()
        .await
        .map_err(|e| format!("Web search failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let html = resp.text().await.map_err(|e| e.to_string())?;
    let text = strip_html_to_text(&html);
    Ok(text.chars().take(12_000).collect())
}

const CODE_FILE_EXTENSIONS: &[&str] = &[
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".py", ".rs", ".go", ".c", ".cpp", ".h", ".hpp",
    ".java", ".cs", ".php", ".rb", ".lua",
    ".json", ".yaml", ".yml", ".toml", ".xml", ".csv",
    ".html", ".htm", ".css", ".scss", ".vue", ".svelte",
    ".md", ".txt", ".sql", ".sh", ".ps1", ".bat",
];

#[tauri::command]
pub fn studio_take_startup_target(state: State<'_, StudioState>) -> Option<StartupTarget> {
    if let Ok(mut guard) = state.startup_target.write() {
        guard.take()
    } else {
        None
    }
}

#[tauri::command]
pub fn studio_is_windows_open_with_registered() -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let out = std::process::Command::new("reg")
            .args([
                "query",
                r"HKCU\Software\Classes\Applications\mintu-studio.exe\shell\open\command",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        matches!(out, Ok(o) if o.status.success())
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

pub fn set_windows_open_with_internal(enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        let exe_path = std::env::current_exe()
            .map_err(|e| format!("Failed to locate executable: {e}"))?;
        let exe_str = strip_windows_verbatim(&exe_path).to_string_lossy().to_string();
        let exe_escaped = exe_str.replace('\'', "''");
        let exts_ps = CODE_FILE_EXTENSIONS
            .iter()
            .map(|e| format!("'{e}'"))
            .collect::<Vec<_>>()
            .join(", ");

        let script = if enabled {
            format!(
                r#"
$ErrorActionPreference = 'SilentlyContinue'
$exe = '{exe_escaped}'
$cmd = '"' + $exe + '" "%1"'
$icon = '"' + $exe + '",0'

# 1. Applications\mintu-studio.exe (powers Windows "Open with" list)
$appKey = 'HKCU:\Software\Classes\Applications\mintu-studio.exe'
New-Item -Path "$appKey\shell\open\command" -Force | Out-Null
New-Item -Path "$appKey\DefaultIcon" -Force | Out-Null
New-Item -Path "$appKey\SupportedTypes" -Force | Out-Null
Set-ItemProperty -Path $appKey -Name 'FriendlyAppName' -Value 'Mintu Studio'
Set-ItemProperty -Path "$appKey\DefaultIcon" -Name '(default)' -Value $icon
Set-ItemProperty -Path "$appKey\shell\open" -Name 'FriendlyAppName' -Value 'Mintu Studio'
Set-ItemProperty -Path "$appKey\shell\open" -Name 'Icon' -Value $icon
Set-ItemProperty -Path "$appKey\shell\open\command" -Name '(default)' -Value $cmd

# 2. ProgId MintuStudio.CodeFile
$progKey = 'HKCU:\Software\Classes\MintuStudio.CodeFile'
New-Item -Path "$progKey\shell\open\command" -Force | Out-Null
New-Item -Path "$progKey\DefaultIcon" -Force | Out-Null
Set-ItemProperty -Path $progKey -Name '(default)' -Value 'Mintu Studio Source File'
Set-ItemProperty -Path "$progKey\DefaultIcon" -Name '(default)' -Value $icon
Set-ItemProperty -Path "$progKey\shell\open\command" -Name '(default)' -Value $cmd

# 3. Register all code extensions in SupportedTypes, OpenWithProgids, and OpenWithList
$exts = @({exts_ps})
foreach ($ext in $exts) {{
  New-ItemProperty -Path "$appKey\SupportedTypes" -Name $ext -Value '' -PropertyType String -Force | Out-Null
  $owp = "HKCU:\Software\Classes\$ext\OpenWithProgids"
  New-Item -Path $owp -Force | Out-Null
  New-ItemProperty -Path $owp -Name 'MintuStudio.CodeFile' -Value '' -PropertyType String -Force | Out-Null
  $owl = "HKCU:\Software\Classes\$ext\OpenWithList\mintu-studio.exe"
  New-Item -Path $owl -Force | Out-Null
}}

# 4. Also register on '*' OpenWithList so any unknown code file shows Mintu Studio in Open With
New-Item -Path 'HKCU:\Software\Classes\*\OpenWithList\mintu-studio.exe' -Force | Out-Null

# 5. Folder right-click: "Open with Mintu Studio"
$dirKey = 'HKCU:\Software\Classes\Directory\shell\MintuStudio'
New-Item -Path "$dirKey\command" -Force | Out-Null
Set-ItemProperty -Path $dirKey -Name '(default)' -Value 'Open with Mintu Studio'
Set-ItemProperty -Path $dirKey -Name 'Icon' -Value $icon
Set-ItemProperty -Path "$dirKey\command" -Name '(default)' -Value $cmd

$bgKey = 'HKCU:\Software\Classes\Directory\Background\shell\MintuStudio'
New-Item -Path "$bgKey\command" -Force | Out-Null
Set-ItemProperty -Path $bgKey -Name '(default)' -Value 'Open with Mintu Studio'
Set-ItemProperty -Path $bgKey -Name 'Icon' -Value $icon
Set-ItemProperty -Path "$bgKey\command" -Name '(default)' -Value ('"' + $exe + '" "%V"')

# 6. Notify Windows Shell immediately
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class MintuShell {{ [DllImport("shell32.dll")] public static extern void SHChangeNotify(int wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2); }}'
[MintuShell]::SHChangeNotify(0x08000000, 0x0000, [IntPtr]::Zero, [IntPtr]::Zero)
"#
            )
        } else {
            format!(
                r#"
$ErrorActionPreference = 'SilentlyContinue'
Remove-Item -Path 'HKCU:\Software\Classes\Applications\mintu-studio.exe' -Recurse -Force
Remove-Item -Path 'HKCU:\Software\Classes\MintuStudio.CodeFile' -Recurse -Force
Remove-Item -Path 'HKCU:\Software\Classes\*\OpenWithList\mintu-studio.exe' -Recurse -Force
Remove-Item -Path 'HKCU:\Software\Classes\Directory\shell\MintuStudio' -Recurse -Force
Remove-Item -Path 'HKCU:\Software\Classes\Directory\Background\shell\MintuStudio' -Recurse -Force
$exts = @({exts_ps})
foreach ($ext in $exts) {{
  Remove-ItemProperty -Path "HKCU:\Software\Classes\$ext\OpenWithProgids" -Name 'MintuStudio.CodeFile' -Force
  Remove-Item -Path "HKCU:\Software\Classes\$ext\OpenWithList\mintu-studio.exe" -Recurse -Force
}}
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class MintuShell {{ [DllImport("shell32.dll")] public static extern void SHChangeNotify(int wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2); }}'
[MintuShell]::SHChangeNotify(0x08000000, 0x0000, [IntPtr]::Zero, [IntPtr]::Zero)
"#
            )
        };

        let out = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", &script])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("Failed to update Windows Open With registry: {e}"))?;

        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr);
            return Err(format!("Registry update failed: {err}"));
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = enabled;
        Ok(())
    }
}

#[tauri::command]
pub async fn studio_set_windows_open_with(enabled: bool) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        set_windows_open_with_internal(enabled)?;
        Ok(enabled)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;

    #[test]
    fn test_sensitive_file_detection() {
        assert!(is_sensitive_file_or_dir(Path::new(".env")));
        assert!(is_sensitive_file_or_dir(Path::new(".env.local")));
        assert!(is_sensitive_file_or_dir(Path::new(".env.production")));
        assert!(is_sensitive_file_or_dir(Path::new("subdir/.env")));
        assert!(is_sensitive_file_or_dir(Path::new("server.pem")));
        assert!(is_sensitive_file_or_dir(Path::new("certs/private.key")));
        assert!(is_sensitive_file_or_dir(Path::new("id_rsa")));
        assert!(is_sensitive_file_or_dir(Path::new(".ssh/config")));
        assert!(is_sensitive_file_or_dir(Path::new("secrets.json")));
        assert!(is_sensitive_file_or_dir(Path::new("credentials.yaml")));
        assert!(is_sensitive_file_or_dir(Path::new("db_password.txt")));

        assert!(!is_sensitive_file_or_dir(Path::new(".env.example")));
        assert!(!is_sensitive_file_or_dir(Path::new(".env.sample")));
        assert!(!is_sensitive_file_or_dir(Path::new(".env.template")));
        assert!(!is_sensitive_file_or_dir(Path::new("main.rs")));
        assert!(!is_sensitive_file_or_dir(Path::new("package.json")));
    }

    #[test]
    fn test_read_write_grep_and_traversal_security() {
        let temp_dir = std::env::temp_dir().join("mintu_studio_phase2_test_root");
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(temp_dir.join("src")).unwrap();

        let code_file = temp_dir.join("src").join("main.rs");
        let mut f = File::create(&code_file).unwrap();
        writeln!(f, "fn main() {{ println!(\"HELLO_MINTU\"); }}").unwrap();

        let env_file = temp_dir.join(".env");
        let mut ef = File::create(&env_file).unwrap();
        writeln!(ef, "SECRET_TOKEN=HELLO_MINTU_SECRET").unwrap();

        // Read allowed vs refused
        assert!(read_file_secure(&temp_dir, "src/main.rs").is_ok());
        assert!(read_file_secure(&temp_dir, ".env").is_err());

        // Write allowed vs refused
        assert!(write_file_secure(&temp_dir, "src/new_component.ts", "export const x = 1;").is_ok());
        assert!(write_file_secure(&temp_dir, ".env", "HACK=1").is_err());
        assert!(write_file_secure(&temp_dir, "../escape.txt", "NO").is_err());
        assert!(write_file_secure(&temp_dir, "C:\\Windows\\bad.txt", "NO").is_err());

        // Grep finds code file but NEVER leaks .env
        let hits = grep_search_secure(&temp_dir, "HELLO_MINTU", 50).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "src/main.rs");

        // Traversal rejections
        assert!(validate_and_resolve_path(&temp_dir, "../outside.txt").is_err());
        assert!(validate_and_resolve_path(&temp_dir, "/etc/passwd").is_err());
        assert!(validate_and_resolve_path(&temp_dir, "D:/other/project").is_err());
        assert!(validate_and_resolve_path(&temp_dir, "//server/share").is_err());

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
