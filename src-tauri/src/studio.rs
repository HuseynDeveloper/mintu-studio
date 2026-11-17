/**
 * studio.rs
 * Mintu Studio Standalone Backend Module (Phase 1)
 *
 * Security rules:
 * - Project root is chosen ONLY via native OS folder-picker dialog in Rust.
 * - All file operations take relative paths validated & canonicalized inside root.
 * - Blocks `..`, symlinks/junctions escaping root, absolute paths, UNC paths, drive-letter switches.
 * - Rust-enforced sensitive file exclusion (.env*, *.pem, *.key, id_rsa*, .ssh, secret patterns).
 * - Max file size 1 MB, binary rejection, skip node_modules/.git/target by default.
 */

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, RwLock};
use tauri::{AppHandle, Manager, State};

pub const MAX_STUDIO_FILE_SIZE: u64 = 1_048_576; // 1 MB

const SKIPPED_DIRS: &[&str] = &["node_modules", ".git", "target", "dist", ".next", "__pycache__"];

#[derive(Default)]
pub struct StudioState {
    pub project_root: Arc<RwLock<Option<PathBuf>>>,
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

/// Checks whether a given relative path or any of its segments match sensitive/secret patterns.
pub fn is_sensitive_file_or_dir(rel_path: &Path) -> bool {
    for component in rel_path.components() {
        let seg = component.as_os_str().to_string_lossy().to_lowercase();

        // 1. SSH directory or keys
        if seg == ".ssh" || seg.starts_with(".ssh/") || seg.starts_with(".ssh\\") {
            return true;
        }

        // 2. Env files (.env, .env.local, .env.production, etc.)
        // Allowed templates: .env.example, .env.sample, .env.template
        if seg.starts_with(".env") {
            if !seg.ends_with(".example")
                && !seg.ends_with(".sample")
                && !seg.ends_with(".template")
            {
                return true;
            }
        }

        // 3. Private keys, certificates, keystores
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

        // 4. Standard OpenSSH private key names
        if seg.starts_with("id_rsa")
            || seg.starts_with("id_ed25519")
            || seg.starts_with("id_ecdsa")
            || seg.starts_with("id_dsa")
        {
            return true;
        }

        // 5. Common secret credential patterns
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

/// Validates that a user-provided relative path is strictly relative and stays inside root.
pub fn validate_and_resolve_path(root: &Path, rel_path_str: &str) -> Result<PathBuf, String> {
    let clean_str = rel_path_str.trim().replace('\\', "/");

    if clean_str.is_empty() {
        return root
            .canonicalize()
            .map_err(|e| format!("Cannot resolve project root: {e}"));
    }

    if clean_str.starts_with('/') || clean_str.starts_with('\\') {
        return Err("Path traversal rejected: path cannot be absolute".to_string());
    }

    // Reject Windows drive letters (e.g. C:, D:) and UNC paths (//, \\)
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

    let combined = root.join(rel_path);

    let canonical_root = root
        .canonicalize()
        .map_err(|e| format!("Cannot resolve project root: {e}"))?;

    let canonical_target = combined
        .canonicalize()
        .map_err(|e| format!("Cannot resolve target path: {e}"))?;

    if !canonical_target.starts_with(&canonical_root) {
        return Err("Security boundary violation: target path escapes project root".to_string());
    }

    Ok(canonical_target)
}

/// Core secure file reader used by the Tauri command and unit tests.
pub fn read_file_secure(root: &Path, rel_path: &str) -> Result<String, String> {
    let clean_rel = rel_path.trim().replace('\\', "/");
    if clean_rel.is_empty() {
        return Err("File path cannot be empty".to_string());
    }

    // Rust-enforced sensitive file check on relative path
    if is_sensitive_file_or_dir(Path::new(&clean_rel)) {
        return Err(
            "Security block: sensitive/secret files cannot be read or sent to AI models"
                .to_string(),
        );
    }

    let target_file = validate_and_resolve_path(root, &clean_rel)?;

    // Also check canonicalized relative path inside root (defends against symlink to .env)
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

        // Skip heavy or internal directories by default
        if is_dir && SKIPPED_DIRS.iter().any(|&skip| skip.eq_ignore_ascii_case(&name)) {
            continue;
        }

        // Verify symlink stays inside root
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

    // Sort: directories first, then alphabetically case-insensitive
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
pub fn studio_open_devtools(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        win.open_devtools();
    }
    Ok(())
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
        assert!(!is_sensitive_file_or_dir(Path::new("src/components/App.tsx")));
    }

    #[test]
    fn test_path_traversal_and_sensitive_read_refusal() {
        let temp_dir = std::env::temp_dir().join("mintu_studio_standalone_test_root");
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(temp_dir.join("src")).unwrap();

        let code_file = temp_dir.join("src").join("main.rs");
        let mut f = File::create(&code_file).unwrap();
        writeln!(f, "fn main() {{}}").unwrap();

        let env_file = temp_dir.join(".env");
        let mut ef = File::create(&env_file).unwrap();
        writeln!(ef, "API_SECRET=12345").unwrap();

        // 1. Valid relative code file
        let content = read_file_secure(&temp_dir, "src/main.rs");
        assert!(content.is_ok());
        assert!(content.unwrap().contains("fn main()"));

        // 2. Sensitive file must be refused directly in Rust
        let env_res = read_file_secure(&temp_dir, ".env");
        assert!(env_res.is_err());

        // 3. Traversal with ..
        assert!(validate_and_resolve_path(&temp_dir, "../outside.txt").is_err());
        assert!(validate_and_resolve_path(&temp_dir, "src/../../outside.txt").is_err());

        // 4. Absolute paths
        assert!(validate_and_resolve_path(&temp_dir, "/etc/passwd").is_err());
        assert!(validate_and_resolve_path(&temp_dir, "C:\\Windows\\notepad.exe").is_err());

        // 5. Drive letter switch
        assert!(validate_and_resolve_path(&temp_dir, "D:/other/project").is_err());

        // 6. UNC path
        assert!(validate_and_resolve_path(&temp_dir, "//server/share").is_err());

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
