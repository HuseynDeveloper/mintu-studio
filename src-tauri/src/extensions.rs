/**
 * extensions.rs
 * Safe, declarative Extension Manager & GitHub Community Marketplace fetcher for Mintu Studio.
 * Extensions are stored in %LOCALAPPDATA%\MintuStudio\extensions\registry.json
 * and can be installed from GitHub Marketplace, created via UI, or imported from .json files.
 * Zero arbitrary eval() — strictly declarative snippets, AI rules, commands, and API templates.
 */

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionSnippet {
    pub prefix: String,
    pub label: String,
    pub body: String,
    #[serde(default)]
    pub languages: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionCommand {
    #[serde(default)]
    pub id: String,
    pub label: String,
    pub command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionApiTemplate {
    pub name: String,
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MintuExtension {
    pub id: String,
    pub name: String,
    #[serde(default = "default_version")]
    pub version: String,
    #[serde(default = "default_author")]
    pub author: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_category")]
    pub category: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub ai_rules: Vec<String>,
    #[serde(default)]
    pub snippets: Vec<ExtensionSnippet>,
    #[serde(default)]
    pub commands: Vec<ExtensionCommand>,
    #[serde(default)]
    pub api_templates: Vec<ExtensionApiTemplate>,
}

fn default_true() -> bool {
    true
}
fn default_version() -> String {
    "1.0.0".to_string()
}
fn default_author() -> String {
    "Community".to_string()
}
fn default_category() -> String {
    "Utility".to_string()
}

fn registry_path() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    base.join("MintuStudio").join("extensions").join("registry.json")
}

fn load_registry() -> Vec<MintuExtension> {
    let p = registry_path();
    let Ok(raw) = fs::read_to_string(&p) else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<MintuExtension>>(&raw).unwrap_or_default()
}

fn save_registry(list: &[MintuExtension]) -> Result<(), String> {
    let p = registry_path();
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create extensions dir: {e}"))?;
    }
    let json = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
    fs::write(&p, json.as_bytes()).map_err(|e| format!("Failed to save extensions registry: {e}"))
}

fn sanitize_ext(mut ext: MintuExtension) -> Result<MintuExtension, String> {
    ext.id = ext
        .id
        .trim()
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        .collect();
    if ext.id.is_empty() || ext.name.trim().is_empty() {
        return Err("Extension must have a valid id and name".to_string());
    }
    ext.name = ext.name.trim().to_string();
    if ext.version.trim().is_empty() {
        ext.version = "1.0.0".to_string();
    }
    if ext.author.trim().is_empty() {
        ext.author = "Community".to_string();
    }
    if ext.category.trim().is_empty() {
        ext.category = "Utility".to_string();
    }
    Ok(ext)
}

#[tauri::command]
pub fn ext_list_installed() -> Result<Vec<MintuExtension>, String> {
    Ok(load_registry())
}

#[tauri::command]
pub fn ext_install(extension: MintuExtension) -> Result<Vec<MintuExtension>, String> {
    let clean = sanitize_ext(extension)?;
    let mut list = load_registry();
    if let Some(existing) = list.iter_mut().find(|e| e.id == clean.id) {
        *existing = clean;
    } else {
        list.push(clean);
    }
    save_registry(&list)?;
    Ok(list)
}

#[tauri::command]
pub fn ext_toggle(id: String, enabled: bool) -> Result<Vec<MintuExtension>, String> {
    let mut list = load_registry();
    for item in list.iter_mut() {
        if item.id == id {
            item.enabled = enabled;
        }
    }
    save_registry(&list)?;
    Ok(list)
}

#[tauri::command]
pub fn ext_uninstall(id: String) -> Result<Vec<MintuExtension>, String> {
    let mut list = load_registry();
    list.retain(|e| e.id != id);
    save_registry(&list)?;
    Ok(list)
}

#[tauri::command]
pub async fn ext_fetch_remote_marketplace(repo: String) -> Result<Vec<MintuExtension>, String> {
    let clean_repo = repo
        .trim()
        .trim_start_matches("https://github.com/")
        .trim_start_matches("http://github.com/")
        .trim_end_matches('/')
        .trim_end_matches(".git");
    let parts: Vec<&str> = clean_repo.split('/').filter(|s| !s.is_empty()).collect();
    if parts.len() != 2 {
        return Err("GitHub repository must be 'owner/repo'".to_string());
    }
    for p in &parts {
        if !p.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.') {
            return Err("Invalid GitHub repository name".to_string());
        }
    }

    let url = format!(
        "https://raw.githubusercontent.com/{}/{}/main/marketplace/registry.json",
        parts[0], parts[1]
    );

    let client = reqwest::Client::builder()
        .user_agent("MintuStudio-Marketplace/0.1")
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Could not fetch GitHub marketplace: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("GitHub marketplace returned HTTP {} ({})", resp.status(), url));
    }

    let body = resp.text().await.map_err(|e| format!("Failed reading marketplace JSON: {e}"))?;
    let parsed: Vec<MintuExtension> =
        serde_json::from_str(&body).map_err(|e| format!("Invalid marketplace registry JSON: {e}"))?;

    let mut clean_list = Vec::new();
    for ext in parsed {
        if let Ok(c) = sanitize_ext(ext) {
            clean_list.push(c);
        }
    }
    Ok(clean_list)
}

#[tauri::command]
pub async fn ext_import_file() -> Result<Option<MintuExtension>, String> {
    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;

            let script = r#"
Add-Type -AssemblyName System.Windows.Forms
$dlg = New-Object System.Windows.Forms.OpenFileDialog
$dlg.Title = 'Import Mintu Extension (.json)'
$dlg.Filter = 'Mintu Extension (*.json)|*.json'
if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    Write-Output $dlg.FileName
}
"#;
            let output = std::process::Command::new("powershell.exe")
                .args(["-NoProfile", "-NonInteractive", "-Command", script])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .map_err(|e| e.to_string())?;

            if !output.status.success() {
                return Ok(None);
            }
            let file_path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if file_path.is_empty() {
                return Ok(None);
            }
            let raw = fs::read_to_string(&file_path)
                .map_err(|e| format!("Failed to read extension file: {e}"))?;
            let parsed: MintuExtension = serde_json::from_str(&raw)
                .map_err(|e| format!("Invalid Mintu extension JSON: {e}"))?;
            let clean = sanitize_ext(parsed)?;
            let mut list = load_registry();
            if let Some(existing) = list.iter_mut().find(|e| e.id == clean.id) {
                *existing = clean.clone();
            } else {
                list.push(clean.clone());
            }
            save_registry(&list)?;
            Ok(Some(clean))
        }
        #[cfg(not(target_os = "windows"))]
        {
            Ok(None)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
