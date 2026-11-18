/**
 * local_llm.rs
 * Local GGUF Model Downloader & Manual llama-server Process Manager for Mintu Studio.
 * - Hardware inspection (RAM, CPU cores, free disk space)
 * - Safe GGUF downloads with live Tauri progress events & cancellation
 * - Strictly MANUAL model start/stop via llama-server.exe (never auto-starts after download)
 * - Clean child shutdown when Mintu Studio closes
 */

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardwareInfo {
    pub total_ram_gb: f64,
    pub cpu_cores: usize,
    pub models_dir: String,
    pub free_disk_gb: f64,
    pub llama_server_found: bool,
    pub llama_server_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledModelInfo {
    pub id: String,
    pub filename: String,
    pub path: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelDownloadProgress {
    pub model_id: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub speed_mbps: f64,
    pub status: String, // "downloading" | "completed" | "cancelled" | "error"
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartServerOptions {
    pub model_id: String,
    pub model_path: String,
    pub port: u16,
    pub ctx_size: u32,
    pub threads: u32,
    pub gpu_layers: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalServerStatus {
    pub running: bool,
    pub model_id: Option<String>,
    pub model_path: Option<String>,
    pub port: u16,
    pub base_url: Option<String>,
}

struct RunningLlamaProcess {
    child: Child,
    model_id: String,
    model_path: String,
    port: u16,
}

pub struct LocalLlmManager {
    running: Mutex<Option<RunningLlamaProcess>>,
    cancel_flags: Mutex<HashMap<String, Arc<AtomicBool>>>,
    stream_abort_flags: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl Default for LocalLlmManager {
    fn default() -> Self {
        Self {
            running: Mutex::new(None),
            cancel_flags: Mutex::new(HashMap::new()),
            stream_abort_flags: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredLocalServer {
    pub id: String,
    pub label: String,
    pub source: String,
    pub base_url: String,
    pub port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatImageAttachment {
    pub mime_type: String,
    pub base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalChatMessage {
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub images: Option<Vec<ChatImageAttachment>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalChatStreamRequest {
    pub stream_id: String,
    pub base_url: String,
    pub model: String,
    pub messages: Vec<LocalChatMessage>,
    pub temperature: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalChatStreamEvent {
    pub stream_id: String,
    pub delta: Option<String>,
    pub done: bool,
    pub error: Option<String>,
    pub resolved_base_url: Option<String>,
    pub resolved_model: Option<String>,
}

fn clean_model_display_name(raw: &str) -> String {
    let trimmed = raw.trim();
    let base = trimmed
        .rsplit(|c| c == '\\' || c == '/')
        .next()
        .unwrap_or(trimmed);
    base.strip_suffix(".gguf")
        .or_else(|| base.strip_suffix(".GGUF"))
        .unwrap_or(base)
        .to_string()
}

fn pick_available_port(preferred: u16) -> u16 {
    let start = if preferred < 1024 { 8090 } else { preferred };
    if std::net::TcpListener::bind(("127.0.0.1", start)).is_ok() {
        return start;
    }
    for p in 8090..=8150 {
        if p == start {
            continue;
        }
        if std::net::TcpListener::bind(("127.0.0.1", p)).is_ok() {
            return p;
        }
    }
    start
}

impl LocalLlmManager {
    pub fn shutdown_sync(&self) {
        if let Ok(mut guard) = self.running.lock() {
            if let Some(mut proc) = guard.take() {
                let _ = proc.child.kill();
                let _ = proc.child.wait();
            }
        }
    }
}

pub fn default_models_dir() -> PathBuf {
    let d_dir = PathBuf::from("D:\\Mintu-Models");
    if Path::new("D:\\").exists() {
        return d_dir;
    }
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    base.join("MintuStudio").join("models")
}

pub fn find_llama_server_binary() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("binaries").join("llama").join("llama-server.exe"));
            candidates.push(dir.join("llama-server.exe"));
        }
    }

    candidates.push(PathBuf::from("D:\\llama-cpu\\llama-server.exe"));
    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        candidates.push(
            PathBuf::from(&user_profile)
                .join("OneDrive")
                .join("Desktop")
                .join("Mintu")
                .join("src-tauri")
                .join("binaries")
                .join("llama")
                .join("llama-server.exe"),
        );
    }

    for c in candidates {
        if c.is_file() {
            return Some(c);
        }
    }

    // Fallback: search PATH
    if let Ok(path_var) = std::env::var("PATH") {
        for part in path_var.split(';') {
            let p = PathBuf::from(part.trim()).join("llama-server.exe");
            if p.is_file() {
                return Some(p);
            }
        }
    }

    None
}

#[cfg(target_os = "windows")]
fn get_total_ram_gb() -> f64 {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    unsafe {
        let mut status: MEMORYSTATUSEX = std::mem::zeroed();
        status.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
        if GlobalMemoryStatusEx(&mut status) != 0 {
            return (status.ullTotalPhys as f64) / (1024.0 * 1024.0 * 1024.0);
        }
    }
    8.0
}

#[cfg(not(target_os = "windows"))]
fn get_total_ram_gb() -> f64 {
    8.0
}

#[cfg(target_os = "windows")]
fn get_free_disk_gb(dir: &Path) -> f64 {
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

    let probe = if dir.exists() {
        dir.to_path_buf()
    } else if let Some(parent) = dir.parent() {
        if parent.exists() {
            parent.to_path_buf()
        } else {
            PathBuf::from("C:\\")
        }
    } else {
        PathBuf::from("C:\\")
    };

    let wide: Vec<u16> = probe
        .to_string_lossy()
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    let mut free_avail: u64 = 0;
    let mut total_bytes: u64 = 0;
    let mut total_free: u64 = 0;

    unsafe {
        if GetDiskFreeSpaceExW(wide.as_ptr(), &mut free_avail, &mut total_bytes, &mut total_free) != 0 {
            return (free_avail as f64) / (1024.0 * 1024.0 * 1024.0);
        }
    }
    0.0
}

#[cfg(not(target_os = "windows"))]
fn get_free_disk_gb(_dir: &Path) -> f64 {
    50.0
}

fn sanitize_model_id(id: &str) -> Result<String, String> {
    let clean = id.trim();
    if clean.is_empty()
        || clean.contains('/')
        || clean.contains('\\')
        || clean.contains("..")
        || clean.contains(':')
    {
        return Err("Invalid model identifier".to_string());
    }
    Ok(clean.to_string())
}

#[tauri::command]
pub fn llm_get_hardware_info(models_dir: Option<String>) -> HardwareInfo {
    let dir = models_dir
        .filter(|s| !s.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(default_models_dir);

    let total_ram_gb = (get_total_ram_gb() * 10.0).round() / 10.0;
    let cpu_cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    let free_disk_gb = (get_free_disk_gb(&dir) * 10.0).round() / 10.0;
    let llama_path = find_llama_server_binary();

    HardwareInfo {
        total_ram_gb,
        cpu_cores,
        models_dir: dir.to_string_lossy().to_string(),
        free_disk_gb,
        llama_server_found: llama_path.is_some(),
        llama_server_path: llama_path.map(|p| p.to_string_lossy().to_string()),
    }
}

#[tauri::command]
pub async fn llm_pick_models_dir() -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;

            let script = r#"
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Yerli LLM Modelləri Üçün Qovluq Seçin'
$dialog.ShowNewFolderButton = $true
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
                let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !s.is_empty() {
                    return Ok(Some(s));
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
pub fn llm_list_installed_models(models_dir: Option<String>) -> Result<Vec<InstalledModelInfo>, String> {
    let dir = models_dir
        .filter(|s| !s.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(default_models_dir);

    if !dir.exists() {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(&dir).map_err(|e| format!("Failed to read models dir: {e}"))?;
    let mut out = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let filename = entry.file_name().to_string_lossy().to_string();
        if !filename.to_lowercase().ends_with(".gguf") {
            continue;
        }
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if meta.len() < 10_000_000 {
            continue; // skip corrupted tiny stubs
        }
        let id = filename
            .strip_suffix(".gguf")
            .or_else(|| filename.strip_suffix(".GGUF"))
            .unwrap_or(&filename)
            .to_string();

        out.push(InstalledModelInfo {
            id,
            filename,
            path: path.to_string_lossy().to_string(),
            size_bytes: meta.len(),
        });
    }

    out.sort_by(|a, b| a.id.to_lowercase().cmp(&b.id.to_lowercase()));
    Ok(out)
}

#[tauri::command]
pub async fn llm_download_model(
    app: AppHandle,
    state: State<'_, LocalLlmManager>,
    model_id: String,
    url: String,
    models_dir: Option<String>,
) -> Result<String, String> {
    let clean_id = sanitize_model_id(&model_id)?;

    if !url.starts_with("https://huggingface.co/") {
        return Err("Yalnız rəsmi https://huggingface.co/ mənbəsindən yükləməyə icazə verilir".to_string());
    }

    let dir = models_dir
        .filter(|s| !s.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(default_models_dir);

    fs::create_dir_all(&dir).map_err(|e| format!("Qovluq yaradılmadı: {e}"))?;

    let final_path = dir.join(format!("{clean_id}.gguf"));
    let part_path = dir.join(format!("{clean_id}.gguf.part"));

    let cancel_flag = Arc::new(AtomicBool::new(false));
    {
        let mut flags = state.cancel_flags.lock().map_err(|e| e.to_string())?;
        flags.insert(clean_id.clone(), cancel_flag.clone());
    }

    let emit_progress = |downloaded: u64, total: u64, speed: f64, status: &str, err: Option<String>| {
        let _ = app.emit(
            "studio-model-download-progress",
            ModelDownloadProgress {
                model_id: clean_id.clone(),
                downloaded_bytes: downloaded,
                total_bytes: total,
                speed_mbps: speed,
                status: status.to_string(),
                error: err,
            },
        );
    };

    let client = reqwest::Client::builder()
        .user_agent("MintuStudio/0.2.0")
        .connect_timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;

    let response = match client.get(&url).send().await {
        Ok(r) => r,
        Err(e) => {
            let msg = format!("Bağlantı xətası: {e}");
            emit_progress(0, 0, 0.0, "error", Some(msg.clone()));
            let _ = state.cancel_flags.lock().map(|mut m| m.remove(&clean_id));
            return Err(msg);
        }
    };

    if !response.status().is_success() {
        let msg = format!("Server xətası: HTTP {}", response.status());
        emit_progress(0, 0, 0.0, "error", Some(msg.clone()));
        let _ = state.cancel_flags.lock().map(|mut m| m.remove(&clean_id));
        return Err(msg);
    }

    let total_bytes = response.content_length().unwrap_or(0);
    let mut file = fs::File::create(&part_path).map_err(|e| format!("Fayl yaradılmadı: {e}"))?;
    let mut stream = response.bytes_stream();

    let mut downloaded: u64 = 0;
    let start_time = Instant::now();
    let mut last_emit = Instant::now();

    emit_progress(0, total_bytes, 0.0, "downloading", None);

    while let Some(chunk_res) = stream.next().await {
        if cancel_flag.load(Ordering::SeqCst) {
            drop(file);
            let _ = fs::remove_file(&part_path);
            emit_progress(downloaded, total_bytes, 0.0, "cancelled", None);
            let _ = state.cancel_flags.lock().map(|mut m| m.remove(&clean_id));
            return Err("Yükləmə istifadəçi tərəfindən ləğv edildi".to_string());
        }

        match chunk_res {
            Ok(bytes) => {
                if let Err(e) = file.write_all(&bytes) {
                    drop(file);
                    let _ = fs::remove_file(&part_path);
                    let msg = format!("Diskə yazma xətası: {e}");
                    emit_progress(downloaded, total_bytes, 0.0, "error", Some(msg.clone()));
                    let _ = state.cancel_flags.lock().map(|mut m| m.remove(&clean_id));
                    return Err(msg);
                }
                downloaded += bytes.len() as u64;

                if last_emit.elapsed() >= Duration::from_millis(160) {
                    let secs = start_time.elapsed().as_secs_f64().max(0.001);
                    let speed_mbps = (downloaded as f64 / (1024.0 * 1024.0)) / secs;
                    emit_progress(downloaded, total_bytes, speed_mbps, "downloading", None);
                    last_emit = Instant::now();
                }
            }
            Err(e) => {
                drop(file);
                let _ = fs::remove_file(&part_path);
                let msg = format!("Axın xətası: {e}");
                emit_progress(downloaded, total_bytes, 0.0, "error", Some(msg.clone()));
                let _ = state.cancel_flags.lock().map(|mut m| m.remove(&clean_id));
                return Err(msg);
            }
        }
    }

    let _ = file.flush();
    drop(file);

    if final_path.exists() {
        let _ = fs::remove_file(&final_path);
    }
    fs::rename(&part_path, &final_path).map_err(|e| format!("Fayl yekunlaşdırılmadı: {e}"))?;

    let secs = start_time.elapsed().as_secs_f64().max(0.001);
    let speed_mbps = (downloaded as f64 / (1024.0 * 1024.0)) / secs;
    emit_progress(downloaded, total_bytes.max(downloaded), speed_mbps, "completed", None);
    let _ = state.cancel_flags.lock().map(|mut m| m.remove(&clean_id));

    Ok(final_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn llm_cancel_download(state: State<'_, LocalLlmManager>, model_id: String) -> Result<(), String> {
    let clean_id = sanitize_model_id(&model_id)?;
    let flags = state.cancel_flags.lock().map_err(|e| e.to_string())?;
    if let Some(flag) = flags.get(&clean_id) {
        flag.store(true, Ordering::SeqCst);
    }
    Ok(())
}

#[tauri::command]
pub fn llm_delete_model(
    state: State<'_, LocalLlmManager>,
    model_id: String,
    models_dir: Option<String>,
) -> Result<(), String> {
    let clean_id = sanitize_model_id(&model_id)?;

    // Stop server if this model is currently running
    {
        let mut guard = state.running.lock().map_err(|e| e.to_string())?;
        if let Some(ref proc) = *guard {
            if proc.model_id == clean_id {
                if let Some(mut p) = guard.take() {
                    let _ = p.child.kill();
                    let _ = p.child.wait();
                }
            }
        }
    }

    let dir = models_dir
        .filter(|s| !s.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(default_models_dir);

    let target = dir.join(format!("{clean_id}.gguf"));
    if target.is_file() {
        fs::remove_file(&target).map_err(|e| format!("Model silinmədi: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn llm_start_server(
    state: State<'_, LocalLlmManager>,
    options: StartServerOptions,
) -> Result<LocalServerStatus, String> {
    let model_path = PathBuf::from(&options.model_path);
    if !model_path.is_file()
        || !model_path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("gguf"))
            .unwrap_or(false)
    {
        return Err("Seçilmiş .gguf model faylı tapılmadı".to_string());
    }

    let llama_bin = find_llama_server_binary().ok_or_else(|| {
        "llama-server.exe tapılmadı. D:\\llama-cpu\\llama-server.exe və ya binaries/llama qovluğunu yoxlayın."
            .to_string()
    })?;

    // Stop any previous running server managed by Mintu Studio
    state.shutdown_sync();

    let requested_port = if options.port == 0 { 8090 } else { options.port };
    let port = pick_available_port(requested_port);
    let ctx_size = options.ctx_size.clamp(1024, 32768);
    let threads = if options.threads == 0 {
        std::thread::available_parallelism()
            .map(|n| (n.get().saturating_sub(1)).max(2) as u32)
            .unwrap_or(4)
    } else {
        options.threads.clamp(1, 32)
    };

    let mut cmd = Command::new(&llama_bin);
    if let Some(bin_dir) = llama_bin.parent() {
        cmd.current_dir(bin_dir);
    }

    cmd.arg("-m")
        .arg(&model_path)
        .arg("-a")
        .arg(&options.model_id)
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .arg("--cors-origins")
        .arg("*")
        .arg("-c")
        .arg(ctx_size.to_string())
        .arg("-t")
        .arg(threads.to_string())
        .arg("-ngl")
        .arg(options.gpu_layers.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let child = cmd
        .spawn()
        .map_err(|e| format!("llama-server işə düşmədi: {e}"))?;

    {
        let mut guard = state.running.lock().map_err(|e| e.to_string())?;
        *guard = Some(RunningLlamaProcess {
            child,
            model_id: options.model_id.clone(),
            model_path: options.model_path.clone(),
            port,
        });
    }

    // Poll /health until ready (up to 25 seconds for larger 7B models)
    let health_url = format!("http://127.0.0.1:{port}/health");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;

    let deadline = Instant::now() + Duration::from_secs(25);
    let mut ready = false;

    while Instant::now() < deadline {
        // Verify process hasn't exited early
        {
            let mut guard = state.running.lock().map_err(|e| e.to_string())?;
            if let Some(ref mut proc) = *guard {
                if let Ok(Some(exit_status)) = proc.child.try_wait() {
                    *guard = None;
                    return Err(format!(
                        "Model serveri açılarkən dayandı (exit: {exit_status}). RAM və ya GPU qatlarını azaldıb yenidən yoxlayın."
                    ));
                }
            }
        }

        if let Ok(resp) = client.get(&health_url).send().await {
            if resp.status().is_success() {
                ready = true;
                break;
            }
        }
        tokio::time::sleep(Duration::from_millis(350)).await;
    }

    if !ready {
        state.shutdown_sync();
        return Err("Model serveri 25 saniyə ərzində cavab vermədi.".to_string());
    }

    Ok(LocalServerStatus {
        running: true,
        model_id: Some(options.model_id),
        model_path: Some(options.model_path),
        port,
        base_url: Some(format!("http://127.0.0.1:{port}/v1")),
    })
}

#[tauri::command]
pub fn llm_stop_server(state: State<'_, LocalLlmManager>) -> Result<LocalServerStatus, String> {
    state.shutdown_sync();
    Ok(LocalServerStatus {
        running: false,
        model_id: None,
        model_path: None,
        port: 8090,
        base_url: None,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudChatStreamRequest {
    pub stream_id: String,
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub messages: Vec<LocalChatMessage>,
    pub temperature: Option<f64>,
}

fn repair_cloud_config(provider: &str, raw_url: &str, raw_model: &str) -> (String, String, &'static str) {
    let mut url = raw_url.trim().trim_matches('"').trim_matches('\'').trim_end_matches('/').to_string();
    if !url.is_empty() && !url.starts_with("http://") && !url.starts_with("https://") {
        url = format!("https://{url}");
    }
    for suffix in ["/chat/completions", "/messages", "/completions", "/models"] {
        if let Some(stripped) = url.strip_suffix(suffix) {
            url = stripped.trim_end_matches('/').to_string();
        }
    }

    let lower = url.to_lowercase();
    let mut model = raw_model.trim().to_string();

    let wire_mode: &'static str = match provider {
        "gemini" => {
            if url.is_empty()
                || lower.contains("aistudio.google.com")
                || lower.contains("ai.google.dev")
                || lower.contains("makersuite.google.com")
            {
                url = "https://generativelanguage.googleapis.com/v1beta".to_string();
            } else if lower == "https://generativelanguage.googleapis.com" {
                url = "https://generativelanguage.googleapis.com/v1beta".to_string();
            }
            if let Some(stripped) = model.strip_prefix("models/") {
                model = stripped.to_string();
            }
            if model.is_empty() {
                model = "gemini-2.5-flash".to_string();
            }
            if url.to_lowercase().contains("/openai") {
                "openai"
            } else {
                "gemini"
            }
        }
        "anthropic" => {
            if url.is_empty() || lower.contains("console.anthropic.com") {
                url = "https://api.anthropic.com/v1".to_string();
            } else if lower == "https://api.anthropic.com" {
                url = "https://api.anthropic.com/v1".to_string();
            }
            if model.is_empty() || model == "claude-3-7-sonnet" {
                model = "claude-sonnet-4-20250514".to_string();
            }
            "anthropic"
        }
        "openai" => {
            if url.is_empty() || lower.contains("platform.openai.com") || lower == "https://api.openai.com" {
                url = "https://api.openai.com/v1".to_string();
            }
            if model.is_empty() {
                model = "gpt-4o".to_string();
            }
            "openai"
        }
        "deepseek" => {
            if url.is_empty() || lower.contains("platform.deepseek.com") || lower == "https://api.deepseek.com" {
                url = "https://api.deepseek.com/v1".to_string();
            }
            if model.is_empty() {
                model = "deepseek-chat".to_string();
            }
            "openai"
        }
        "groq" => {
            if url.is_empty()
                || lower.contains("console.groq.com")
                || lower == "https://api.groq.com"
                || lower == "https://api.groq.com/v1"
                || lower == "https://api.groq.com/openai"
            {
                url = "https://api.groq.com/openai/v1".to_string();
            }
            if model.is_empty() {
                model = "llama-3.3-70b-versatile".to_string();
            }
            "openai"
        }
        "qwen" => {
            if url.is_empty()
                || lower.contains("dashscope.console.aliyun.com")
                || lower == "https://dashscope.aliyuncs.com"
            {
                url = "https://dashscope.aliyuncs.com/compatible-mode/v1".to_string();
            }
            if model.is_empty() {
                model = "qwen-max".to_string();
            }
            "openai"
        }
        "kimi" => {
            if url.is_empty() || lower.contains("platform.moonshot.cn") || lower == "https://api.moonshot.cn" {
                url = "https://api.moonshot.cn/v1".to_string();
            }
            if model.is_empty() {
                model = "moonshot-v1-8k".to_string();
            }
            "openai"
        }
        "mistral" => {
            if url.is_empty() || lower.contains("console.mistral.ai") || lower == "https://api.mistral.ai" {
                url = "https://api.mistral.ai/v1".to_string();
            }
            if model.is_empty() {
                model = "mistral-large-latest".to_string();
            }
            "openai"
        }
        "xai" => {
            if url.is_empty() || lower.contains("console.x.ai") || lower == "https://api.x.ai" {
                url = "https://api.x.ai/v1".to_string();
            }
            if model.is_empty() {
                model = "grok-3-mini".to_string();
            }
            "openai"
        }
        "openrouter" => {
            if url.is_empty() || lower == "https://openrouter.ai" || lower == "https://openrouter.ai/api" {
                url = "https://openrouter.ai/api/v1".to_string();
            }
            if model.is_empty() {
                model = "anthropic/claude-sonnet-4".to_string();
            }
            "openai"
        }
        "together" => {
            if url.is_empty() || lower == "https://api.together.xyz" {
                url = "https://api.together.xyz/v1".to_string();
            }
            if model.is_empty() {
                model = "meta-llama/Llama-3.3-70B-Instruct-Turbo".to_string();
            }
            "openai"
        }
        "perplexity" => {
            if url.is_empty() || lower == "https://api.perplexity.ai/v1" {
                url = "https://api.perplexity.ai".to_string();
            }
            if model.is_empty() {
                model = "sonar-pro".to_string();
            }
            "openai"
        }
        "cerebras" => {
            if url.is_empty() || lower == "https://api.cerebras.ai" {
                url = "https://api.cerebras.ai/v1".to_string();
            }
            if model.is_empty() {
                model = "llama-3.3-70b".to_string();
            }
            "openai"
        }
        "cohere" => {
            if url.is_empty() || lower == "https://api.cohere.ai" || lower == "https://api.cohere.com" {
                url = "https://api.cohere.ai/compatibility/v1".to_string();
            }
            if model.is_empty() {
                model = "command-a-03-2025".to_string();
            }
            "openai"
        }
        _ => {
            if model.is_empty() {
                model = "gpt-4o".to_string();
            }
            "openai"
        }
    };

    (url, model, wire_mode)
}

fn parse_provider_error(status: reqwest::StatusCode, endpoint: &str, model: &str, err_body: &str) -> String {
    let trimmed = err_body.trim();
    let extracted = if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
        v.pointer("/error/message")
            .or_else(|| v.pointer("/0/error/message"))
            .or_else(|| v.pointer("/message"))
            .or_else(|| v.pointer("/detail"))
            .and_then(|m| m.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| trimmed.chars().take(320).collect())
    } else if trimmed.starts_with('<') {
        format!("Server HTML səhifə qaytardı (Base URL və ya model adını yoxlayın)")
    } else {
        trimmed.chars().take(320).collect()
    };

    let clean_endpoint = endpoint.split('?').next().unwrap_or(endpoint);
    if extracted.is_empty() {
        format!("HTTP {status} — Endpoint: {clean_endpoint} | Model: {model}. Base URL və Model adını yoxlayın.")
    } else {
        format!("HTTP {status}: {extracted} (Model: {model})")
    }
}

async fn send_cloud_request(
    client: &reqwest::Client,
    wire_mode: &str,
    base_url: &str,
    model: &str,
    api_key: &Option<String>,
    messages: &[LocalChatMessage],
    temperature: f64,
    stream: bool,
) -> (String, Result<reqwest::Response, reqwest::Error>) {
    if wire_mode == "gemini" {
        let key = api_key.clone().unwrap_or_default();
        let mut system_text = String::new();
        let mut contents: Vec<serde_json::Value> = Vec::new();
        for m in messages {
            if m.role == "system" {
                if !system_text.is_empty() {
                    system_text.push_str("\n\n");
                }
                system_text.push_str(&m.content);
            } else {
                let role = if m.role == "assistant" { "model" } else { "user" };
                let mut parts: Vec<serde_json::Value> = vec![serde_json::json!({ "text": m.content })];
                if let Some(ref imgs) = m.images {
                    for img in imgs {
                        parts.push(serde_json::json!({
                            "inlineData": {
                                "mimeType": img.mime_type,
                                "data": img.base64
                            }
                        }));
                    }
                }
                contents.push(serde_json::json!({
                    "role": role,
                    "parts": parts
                }));
            }
        }
        let mut body = serde_json::json!({
            "contents": contents,
            "generationConfig": { "temperature": temperature }
        });
        if !system_text.is_empty() {
            body["systemInstruction"] = serde_json::json!({
                "parts": [{ "text": system_text }]
            });
        }
        let endpoint = if stream {
            format!("{base_url}/models/{model}:streamGenerateContent?alt=sse")
        } else {
            format!("{base_url}/models/{model}:generateContent")
        };
        let res = client
            .post(&endpoint)
            .header("Content-Type", "application/json")
            .header("x-goog-api-key", key)
            .body(body.to_string())
            .send()
            .await;
        (endpoint, res)
    } else if wire_mode == "anthropic" {
        let key = api_key.clone().unwrap_or_default();
        let mut system_text = String::new();
        let mut msgs: Vec<serde_json::Value> = Vec::new();
        for m in messages {
            if m.role == "system" {
                if !system_text.is_empty() {
                    system_text.push_str("\n\n");
                }
                system_text.push_str(&m.content);
            } else if let Some(ref imgs) = m.images.as_ref().filter(|v| !v.is_empty()) {
                let mut blocks: Vec<serde_json::Value> = Vec::new();
                for img in *imgs {
                    blocks.push(serde_json::json!({
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": img.mime_type,
                            "data": img.base64
                        }
                    }));
                }
                blocks.push(serde_json::json!({ "type": "text", "text": m.content }));
                msgs.push(serde_json::json!({ "role": m.role, "content": blocks }));
            } else {
                msgs.push(serde_json::json!({
                    "role": m.role,
                    "content": m.content
                }));
            }
        }
        let mut body = serde_json::json!({
            "model": model,
            "max_tokens": if stream { 4096 } else { 32 },
            "messages": msgs,
            "stream": stream,
            "temperature": temperature
        });
        if !system_text.is_empty() {
            body["system"] = serde_json::Value::String(system_text);
        }
        let endpoint = format!("{base_url}/messages");
        let res = client
            .post(&endpoint)
            .header("Content-Type", "application/json")
            .header("x-api-key", key)
            .header("anthropic-version", "2023-06-01")
            .body(body.to_string())
            .send()
            .await;
        (endpoint, res)
    } else {
        let endpoint = format!("{base_url}/chat/completions");
        let serialized_msgs: Vec<serde_json::Value> = messages
            .iter()
            .map(|m| {
                if let Some(ref imgs) = m.images.as_ref().filter(|v| !v.is_empty()) {
                    let mut parts: Vec<serde_json::Value> = vec![serde_json::json!({
                        "type": "text",
                        "text": m.content
                    })];
                    for img in *imgs {
                        parts.push(serde_json::json!({
                            "type": "image_url",
                            "image_url": {
                                "url": format!("data:{};base64,{}", img.mime_type, img.base64)
                            }
                        }));
                    }
                    serde_json::json!({ "role": m.role, "content": parts })
                } else {
                    serde_json::json!({ "role": m.role, "content": m.content })
                }
            })
            .collect();
        let mut payload = serde_json::json!({
            "model": model,
            "messages": serialized_msgs,
            "stream": stream,
            "temperature": temperature
        });
        if !stream {
            payload["max_tokens"] = serde_json::json!(24);
        }
        let mut req_builder = client
            .post(&endpoint)
            .header("Content-Type", "application/json")
            .body(payload.to_string());
        if let Some(ref key) = api_key {
            req_builder = req_builder.header("Authorization", format!("Bearer {key}"));
        }
        let res = req_builder.send().await;
        (endpoint, res)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudTestResult {
    pub ok: bool,
    pub message: String,
    pub resolved_base_url: String,
    pub resolved_model: String,
}

#[tauri::command]
pub async fn llm_test_cloud_connection(
    provider: String,
    base_url: String,
    model: String,
) -> Result<CloudTestResult, String> {
    let prov = provider.trim().to_lowercase();
    let api_key = crate::credentials::get_api_key(&prov)
        .map_err(|e| format!("API açarı oxunmadı: {e}"))?
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());

    if api_key.is_none() && !prov.starts_with("custom") {
        return Ok(CloudTestResult {
            ok: false,
            message: "API açarı saxlanılmayıb. Əvvəlcə API açarını daxil edib Saxla düyməsini basın.".to_string(),
            resolved_base_url: base_url,
            resolved_model: model,
        });
    }

    let (mut fixed_url, mut fixed_model, wire_mode) = repair_cloud_config(&prov, &base_url, &model);
    let client = reqwest::Client::builder()
        .user_agent("MintuStudio/0.2.0")
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let ping = vec![LocalChatMessage {
        role: "user".to_string(),
        content: "Reply with OK".to_string(),
        images: None,
    }];

    let (mut endpoint, mut res) =
        send_cloud_request(&client, wire_mode, &fixed_url, &fixed_model, &api_key, &ping, 0.0, false).await;

    // Auto-retry once on 404 for common URL/model fallbacks
    if let Ok(ref r) = res {
        if r.status() == reqwest::StatusCode::NOT_FOUND {
            if wire_mode == "gemini" && fixed_model != "gemini-2.5-flash" {
                fixed_model = "gemini-2.5-flash".to_string();
                let retry = send_cloud_request(&client, wire_mode, &fixed_url, &fixed_model, &api_key, &ping, 0.0, false).await;
                endpoint = retry.0;
                res = retry.1;
            } else if wire_mode == "openai" && !fixed_url.ends_with("/v1") {
                fixed_url = format!("{fixed_url}/v1");
                let retry = send_cloud_request(&client, wire_mode, &fixed_url, &fixed_model, &api_key, &ping, 0.0, false).await;
                endpoint = retry.0;
                res = retry.1;
            }
        }
    }

    match res {
        Ok(r) if r.status().is_success() => Ok(CloudTestResult {
            ok: true,
            message: format!("Bağlantı uğurludur ({fixed_model})."),
            resolved_base_url: fixed_url,
            resolved_model: fixed_model,
        }),
        Ok(r) => {
            let status = r.status();
            let body = r.text().await.unwrap_or_default();
            Ok(CloudTestResult {
                ok: false,
                message: parse_provider_error(status, &endpoint, &fixed_model, &body),
                resolved_base_url: fixed_url,
                resolved_model: fixed_model,
            })
        }
        Err(e) => Ok(CloudTestResult {
            ok: false,
            message: format!("Bağlantı xətası ({fixed_url}): {e}"),
            resolved_base_url: fixed_url,
            resolved_model: fixed_model,
        }),
    }
}

#[tauri::command]
pub async fn llm_cloud_chat_stream(
    app: AppHandle,
    state: State<'_, LocalLlmManager>,
    request: CloudChatStreamRequest,
) -> Result<(), String> {
    let stream_id = request.stream_id.clone();
    let abort_flag = Arc::new(AtomicBool::new(false));
    {
        let mut flags = state.stream_abort_flags.lock().map_err(|e| e.to_string())?;
        flags.insert(stream_id.clone(), abort_flag.clone());
    }

    let cleanup = |state: &LocalLlmManager, sid: &str| {
        if let Ok(mut flags) = state.stream_abort_flags.lock() {
            flags.remove(sid);
        }
    };

    let emit_evt = |evt: LocalChatStreamEvent| {
        let _ = app.emit("studio-llm-stream-event", evt);
    };

    let emit_err = |msg: String| {
        cleanup(&state, &stream_id);
        emit_evt(LocalChatStreamEvent {
            stream_id: stream_id.clone(),
            delta: None,
            done: true,
            error: Some(msg),
            resolved_base_url: None,
            resolved_model: None,
        });
    };

    let provider = request.provider.trim().to_lowercase();
    let api_key = match crate::credentials::get_api_key(&provider) {
        Ok(k) => k.map(|v| v.trim().to_string()).filter(|v| !v.is_empty()),
        Err(e) => {
            emit_err(format!("API açarı oxunmadı: {e}"));
            return Ok(());
        }
    };

    if api_key.is_none() && !provider.starts_with("custom") {
        emit_err(format!(
            "{} üçün API açarı tapılmadı. Modellər > Bulud Provayderləri səhifəsindən API açarınızı əlavə edib yadda saxlayın.",
            request.provider
        ));
        return Ok(());
    }

    let (mut base_url, mut model, wire_mode) = repair_cloud_config(&provider, &request.base_url, &request.model);
    if base_url.is_empty() {
        emit_err("Base URL boşdur. Modellər > Bulud Provayderləri səhifəsini yoxlayın.".to_string());
        return Ok(());
    }

    let temperature = request.temperature.unwrap_or(0.2);

    let client = match reqwest::Client::builder()
        .user_agent("MintuStudio/0.2.0")
        .connect_timeout(Duration::from_secs(20))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            emit_err(format!("HTTP klient xətası: {e}"));
            return Ok(());
        }
    };

    let (mut endpoint, mut response_res) = send_cloud_request(
        &client,
        wire_mode,
        &base_url,
        &model,
        &api_key,
        &request.messages,
        temperature,
        true,
    )
    .await;

    // Auto-fallback on 404 (e.g. deprecated Gemini model name or missing /v1 on custom proxy)
    if let Ok(ref r) = response_res {
        if r.status() == reqwest::StatusCode::NOT_FOUND {
            if wire_mode == "gemini" && model != "gemini-2.5-flash" {
                model = "gemini-2.5-flash".to_string();
                let retry = send_cloud_request(
                    &client,
                    wire_mode,
                    &base_url,
                    &model,
                    &api_key,
                    &request.messages,
                    temperature,
                    true,
                )
                .await;
                endpoint = retry.0;
                response_res = retry.1;
            } else if wire_mode == "openai" && !base_url.ends_with("/v1") {
                base_url = format!("{base_url}/v1");
                let retry = send_cloud_request(
                    &client,
                    wire_mode,
                    &base_url,
                    &model,
                    &api_key,
                    &request.messages,
                    temperature,
                    true,
                )
                .await;
                endpoint = retry.0;
                response_res = retry.1;
            }
        }
    }

    let response = match response_res {
        Ok(r) => r,
        Err(e) => {
            emit_err(format!("Şəbəkə / server bağlantı xətası ({base_url}): {e}"));
            return Ok(());
        }
    };

    if !response.status().is_success() {
        let status = response.status();
        let err_body = response.text().await.unwrap_or_default();
        emit_err(parse_provider_error(status, &endpoint, &model, &err_body));
        return Ok(());
    }

    let mut byte_stream = response.bytes_stream();
    let mut sse_buffer = String::new();
    let mut emitted_any = false;

    while let Some(chunk_res) = byte_stream.next().await {
        if abort_flag.load(Ordering::SeqCst) {
            emit_err("__ABORTED__".to_string());
            return Ok(());
        }

        match chunk_res {
            Ok(bytes) => {
                sse_buffer.push_str(&String::from_utf8_lossy(&bytes));

                while let Some(pos) = sse_buffer.find('\n') {
                    let line = sse_buffer[..pos].trim().to_string();
                    sse_buffer = sse_buffer[pos + 1..].to_string();

                    if line.is_empty() || !line.starts_with("data:") {
                        continue;
                    }
                    let payload = line[5..].trim();
                    if payload == "[DONE]" {
                        cleanup(&state, &stream_id);
                        emit_evt(LocalChatStreamEvent {
                            stream_id,
                            delta: None,
                            done: true,
                            error: None,
                            resolved_base_url: None,
                            resolved_model: None,
                        });
                        return Ok(());
                    }

                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(payload) {
                        let delta_text: Option<String> = if wire_mode == "gemini" {
                            parsed
                                .pointer("/candidates/0/content/parts")
                                .and_then(|v| v.as_array())
                                .map(|parts| {
                                    let mut combined = String::new();
                                    for p in parts {
                                        if p.get("thought").and_then(|t| t.as_bool()) == Some(true) {
                                            continue;
                                        }
                                        if let Some(txt) = p.get("text").and_then(|t| t.as_str()) {
                                            combined.push_str(txt);
                                        }
                                    }
                                    combined
                                })
                                .filter(|s| !s.is_empty())
                        } else if wire_mode == "anthropic" {
                            if parsed.get("type").and_then(|v| v.as_str()) == Some("content_block_delta") {
                                parsed
                                    .pointer("/delta/text")
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.to_string())
                            } else {
                                None
                            }
                        } else {
                            parsed
                                .pointer("/choices/0/delta/content")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string())
                        };

                        if let Some(txt) = delta_text {
                            if !txt.is_empty() {
                                emitted_any = true;
                                emit_evt(LocalChatStreamEvent {
                                    stream_id: stream_id.clone(),
                                    delta: Some(txt),
                                    done: false,
                                    error: None,
                                    resolved_base_url: None,
                                    resolved_model: None,
                                });
                            }
                        }
                    }
                }
            }
            Err(e) => {
                emit_err(format!("Axın xətası: {e}"));
                return Ok(());
            }
        }
    }

    // Fallback for non-SSE JSON responses
    if !emitted_any && !sse_buffer.trim().is_empty() {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(sse_buffer.trim()) {
            let fallback_txt = if wire_mode == "gemini" {
                parsed
                    .pointer("/candidates/0/content/parts/0/text")
                    .or_else(|| parsed.pointer("/0/candidates/0/content/parts/0/text"))
                    .and_then(|v| v.as_str())
            } else if wire_mode == "anthropic" {
                parsed.pointer("/content/0/text").and_then(|v| v.as_str())
            } else {
                parsed
                    .pointer("/choices/0/message/content")
                    .and_then(|v| v.as_str())
            };
            if let Some(txt) = fallback_txt {
                if !txt.is_empty() {
                    emit_evt(LocalChatStreamEvent {
                        stream_id: stream_id.clone(),
                        delta: Some(txt.to_string()),
                        done: false,
                        error: None,
                        resolved_base_url: None,
                        resolved_model: None,
                    });
                }
            }
        }
    }

    cleanup(&state, &stream_id);
    emit_evt(LocalChatStreamEvent {
        stream_id,
        delta: None,
        done: true,
        error: None,
        resolved_base_url: None,
        resolved_model: None,
    });
    Ok(())
}

async fn probe_openai_port(
    client: &reqwest::Client,
    port: u16,
    source_label: &str,
) -> Vec<DiscoveredLocalServer> {
    let base_url = format!("http://127.0.0.1:{port}/v1");
    let models_url = format!("{base_url}/models");
    let Ok(resp) = client.get(&models_url).send().await else {
        return Vec::new();
    };
    if !resp.status().is_success() {
        return Vec::new();
    }
    let Ok(body_text) = resp.text().await else {
        return Vec::new();
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&body_text) else {
        return Vec::new();
    };

    let mut found = Vec::new();
    if let Some(arr) = json.get("data").and_then(|v| v.as_array()) {
        for item in arr {
            if let Some(raw_id) = item.get("id").and_then(|v| v.as_str()) {
                let id = raw_id.trim();
                if !id.is_empty() {
                    let clean = clean_model_display_name(id);
                    found.push(DiscoveredLocalServer {
                        id: id.to_string(),
                        label: format!("{clean} ({source_label} :{port})"),
                        source: source_label.to_string(),
                        base_url: base_url.clone(),
                        port,
                    });
                }
            }
        }
    }
    found
}

async fn probe_ollama(client: &reqwest::Client) -> Vec<DiscoveredLocalServer> {
    let Ok(resp) = client.get("http://127.0.0.1:11434/api/tags").send().await else {
        return Vec::new();
    };
    if !resp.status().is_success() {
        return Vec::new();
    }
    let Ok(body_text) = resp.text().await else {
        return Vec::new();
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&body_text) else {
        return Vec::new();
    };

    let mut found = Vec::new();
    if let Some(arr) = json.get("models").and_then(|v| v.as_array()) {
        for item in arr {
            let name = item
                .get("name")
                .or_else(|| item.get("model"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            if !name.is_empty() {
                found.push(DiscoveredLocalServer {
                    id: name.to_string(),
                    label: format!("{name} (Ollama :11434)"),
                    source: "Ollama".to_string(),
                    base_url: "http://127.0.0.1:11434/v1".to_string(),
                    port: 11434,
                });
            }
        }
    }
    found
}

async fn discover_servers_internal(
    state: &LocalLlmManager,
    preferred_port: Option<u16>,
) -> Vec<DiscoveredLocalServer> {
    let mut results: Vec<DiscoveredLocalServer> = Vec::new();
    let mut seen_ports: Vec<u16> = Vec::new();

    // 1. Check managed Mintu Studio llama-server first
    let managed_info: Option<(String, u16)> = {
        if let Ok(mut guard) = state.running.lock() {
            if let Some(ref mut proc) = *guard {
                if proc.child.try_wait().ok().flatten().is_some() {
                    *guard = None;
                    None
                } else {
                    Some((proc.model_id.clone(), proc.port))
                }
            } else {
                None
            }
        } else {
            None
        }
    };

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_millis(900))
        .build()
    {
        Ok(c) => c,
        Err(_) => return results,
    };

    if let Some((model_id, port)) = managed_info {
        seen_ports.push(port);
        let probed = probe_openai_port(&client, port, "Mintu Lokal").await;
        if !probed.is_empty() {
            results.extend(probed);
        } else {
            let clean = clean_model_display_name(&model_id);
            results.push(DiscoveredLocalServer {
                id: model_id,
                label: format!("{clean} (Mintu Lokal :{port})"),
                source: "Mintu Lokal".to_string(),
                base_url: format!("http://127.0.0.1:{port}/v1"),
                port,
            });
        }
    }

    // 2. Build candidate port list
    let mut candidate_ports: Vec<(u16, &str)> = Vec::new();
    if let Some(p) = preferred_port {
        if p >= 1024 && !seen_ports.contains(&p) {
            candidate_ports.push((p, "Local"));
            seen_ports.push(p);
        }
    }
    for (p, lbl) in [
        (8090, "llama.cpp"),
        (8091, "llama.cpp"),
        (8092, "llama.cpp"),
        (8080, "llama.cpp"),
        (1234, "LM Studio"),
    ] {
        if !seen_ports.contains(&p) {
            candidate_ports.push((p, lbl));
            seen_ports.push(p);
        }
    }

    let mut handles = Vec::new();
    for (port, lbl) in candidate_ports {
        let c = client.clone();
        let label = lbl.to_string();
        handles.push(tokio::spawn(async move {
            probe_openai_port(&c, port, &label).await
        }));
    }

    let ollama_client = client.clone();
    let ollama_handle = tokio::spawn(async move { probe_ollama(&ollama_client).await });

    for h in handles {
        if let Ok(items) = h.await {
            results.extend(items);
        }
    }
    if let Ok(ollama_items) = ollama_handle.await {
        results.extend(ollama_items);
    }

    results
}

#[tauri::command]
pub async fn llm_discover_active_servers(
    state: State<'_, LocalLlmManager>,
    preferred_port: Option<u16>,
) -> Result<Vec<DiscoveredLocalServer>, String> {
    Ok(discover_servers_internal(&state, preferred_port).await)
}

fn is_loopback_http_url(url: &str) -> bool {
    let lower = url.trim().to_lowercase();
    lower.starts_with("http://127.0.0.1:")
        || lower.starts_with("http://localhost:")
        || lower.starts_with("http://[::1]:")
}

#[tauri::command]
pub fn llm_abort_chat_stream(
    state: State<'_, LocalLlmManager>,
    stream_id: String,
) -> Result<(), String> {
    let flags = state.stream_abort_flags.lock().map_err(|e| e.to_string())?;
    if let Some(flag) = flags.get(&stream_id) {
        flag.store(true, Ordering::SeqCst);
    }
    Ok(())
}

#[tauri::command]
pub async fn llm_local_chat_stream(
    app: AppHandle,
    state: State<'_, LocalLlmManager>,
    request: LocalChatStreamRequest,
) -> Result<(), String> {
    let stream_id = request.stream_id.clone();
    let abort_flag = Arc::new(AtomicBool::new(false));
    {
        let mut flags = state.stream_abort_flags.lock().map_err(|e| e.to_string())?;
        flags.insert(stream_id.clone(), abort_flag.clone());
    }

    let cleanup = |state: &LocalLlmManager, sid: &str| {
        if let Ok(mut flags) = state.stream_abort_flags.lock() {
            flags.remove(sid);
        }
    };

    let emit_evt = |evt: LocalChatStreamEvent| {
        let _ = app.emit("studio-llm-stream-event", evt);
    };

    let mut active_base_url = request.base_url.trim().trim_end_matches('/').to_string();
    let mut active_model = request.model.trim().to_string();
    let mut was_resolved = false;

    if !is_loopback_http_url(&active_base_url) {
        active_base_url = "http://127.0.0.1:8090/v1".to_string();
    }

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(3))
        .build()
        .map_err(|e| {
            cleanup(&state, &stream_id);
            e.to_string()
        })?;

    let send_chat = |base: &str, model: &str| {
        let endpoint = format!("{}/chat/completions", base.trim_end_matches('/'));
        let payload = serde_json::json!({
            "model": model,
            "messages": request.messages,
            "stream": true,
            "temperature": request.temperature.unwrap_or(0.2),
        });
        client
            .post(endpoint)
            .header("Content-Type", "application/json")
            .body(payload.to_string())
            .send()
    };

    let mut resp_result = send_chat(&active_base_url, &active_model).await;

    // Auto-discover active port & server if the saved endpoint didn't respond or returned 404/model error
    let needs_discovery = match &resp_result {
        Err(_) => true,
        Ok(r) => !r.status().is_success(),
    };

    if needs_discovery {
        let discovered = discover_servers_internal(&state, None).await;
        if let Some(first) = discovered.first() {
            active_base_url = first.base_url.clone();
            active_model = first.id.clone();
            was_resolved = true;
            resp_result = send_chat(&active_base_url, &active_model).await;
        }
    }

    let response = match resp_result {
        Ok(r) => r,
        Err(e) => {
            cleanup(&state, &stream_id);
            let msg = format!(
                "Yerli model serverinə ({active_base_url}) qoşulmaq mümkün olmadı: {e}\n\nAyarlar > Yerli Modellər bölməsindən bir modeli işə salın və ya Ollama / LM Studio serverini başladın."
            );
            emit_evt(LocalChatStreamEvent {
                stream_id,
                delta: None,
                done: true,
                error: Some(msg),
                resolved_base_url: None,
                resolved_model: None,
            });
            return Ok(());
        }
    };

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        cleanup(&state, &stream_id);
        emit_evt(LocalChatStreamEvent {
            stream_id,
            delta: None,
            done: true,
            error: Some(format!("Yerli model HTTP {status}: {}", body.chars().take(280).collect::<String>())),
            resolved_base_url: if was_resolved { Some(active_base_url) } else { None },
            resolved_model: if was_resolved { Some(active_model) } else { None },
        });
        return Ok(());
    }

    if was_resolved {
        emit_evt(LocalChatStreamEvent {
            stream_id: stream_id.clone(),
            delta: None,
            done: false,
            error: None,
            resolved_base_url: Some(active_base_url.clone()),
            resolved_model: Some(active_model.clone()),
        });
    }

    let mut byte_stream = response.bytes_stream();
    let mut sse_buffer = String::new();
    let mut emitted_any = false;

    while let Some(chunk_res) = byte_stream.next().await {
        if abort_flag.load(Ordering::SeqCst) {
            cleanup(&state, &stream_id);
            emit_evt(LocalChatStreamEvent {
                stream_id,
                delta: None,
                done: true,
                error: Some("__ABORTED__".to_string()),
                resolved_base_url: None,
                resolved_model: None,
            });
            return Ok(());
        }

        match chunk_res {
            Ok(bytes) => {
                sse_buffer.push_str(&String::from_utf8_lossy(&bytes));

                while let Some(pos) = sse_buffer.find('\n') {
                    let line = sse_buffer[..pos].trim().to_string();
                    sse_buffer = sse_buffer[pos + 1..].to_string();

                    if line.is_empty() || !line.starts_with("data:") {
                        continue;
                    }
                    let payload = line[5..].trim();
                    if payload == "[DONE]" {
                        cleanup(&state, &stream_id);
                        emit_evt(LocalChatStreamEvent {
                            stream_id,
                            delta: None,
                            done: true,
                            error: None,
                            resolved_base_url: None,
                            resolved_model: None,
                        });
                        return Ok(());
                    }

                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(payload) {
                        if let Some(delta) = parsed
                            .pointer("/choices/0/delta/content")
                            .and_then(|v| v.as_str())
                        {
                            if !delta.is_empty() {
                                emitted_any = true;
                                emit_evt(LocalChatStreamEvent {
                                    stream_id: stream_id.clone(),
                                    delta: Some(delta.to_string()),
                                    done: false,
                                    error: None,
                                    resolved_base_url: None,
                                    resolved_model: None,
                                });
                            }
                        }
                    }
                }
            }
            Err(e) => {
                cleanup(&state, &stream_id);
                emit_evt(LocalChatStreamEvent {
                    stream_id,
                    delta: None,
                    done: true,
                    error: Some(format!("Axın kəsildi: {e}")),
                    resolved_base_url: None,
                    resolved_model: None,
                });
                return Ok(());
            }
        }
    }

    // Non-SSE JSON fallback if server ignored stream:true
    if !emitted_any && !sse_buffer.trim().is_empty() {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(sse_buffer.trim()) {
            if let Some(text) = parsed
                .pointer("/choices/0/message/content")
                .and_then(|v| v.as_str())
            {
                if !text.is_empty() {
                    emit_evt(LocalChatStreamEvent {
                        stream_id: stream_id.clone(),
                        delta: Some(text.to_string()),
                        done: false,
                        error: None,
                        resolved_base_url: None,
                        resolved_model: None,
                    });
                }
            }
        }
    }

    cleanup(&state, &stream_id);
    emit_evt(LocalChatStreamEvent {
        stream_id,
        delta: None,
        done: true,
        error: None,
        resolved_base_url: None,
        resolved_model: None,
    });
    Ok(())
}

#[tauri::command]
pub fn llm_get_server_status(state: State<'_, LocalLlmManager>) -> Result<LocalServerStatus, String> {
    let mut guard = state.running.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut proc) = *guard {
        if let Ok(Some(_)) = proc.child.try_wait() {
            *guard = None;
        } else {
            return Ok(LocalServerStatus {
                running: true,
                model_id: Some(proc.model_id.clone()),
                model_path: Some(proc.model_path.clone()),
                port: proc.port,
                base_url: Some(format!("http://127.0.0.1:{}/v1", proc.port)),
            });
        }
    }

    Ok(LocalServerStatus {
        running: false,
        model_id: None,
        model_path: None,
        port: 8090,
        base_url: None,
    })
}

