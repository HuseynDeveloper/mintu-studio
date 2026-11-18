/**
 * terminal.rs
 * Multi-tab interactive Windows PowerShell terminal manager for Mintu Studio.
 * - Supports multiple concurrent persistent shells (HashMap<session_id, RunningShell>)
 * - Live streaming stdout/stderr via Tauri events ("studio-terminal-output", "studio-terminal-exit")
 * - Full Windows process-tree cleanup on interrupt, tab close, restart, or app exit
 */

use crate::studio::StudioState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalOutputEvent {
    pub session_id: u64,
    pub stream: String, // "stdout" | "stderr" | "system"
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalSessionInfo {
    pub running: bool,
    pub session_id: u64,
    pub cwd: String,
    pub shell: String,
}

struct RunningShell {
    session_id: u64,
    child: Child,
    stdin: ChildStdin,
    cwd: String,
}

pub struct TerminalManager {
    sessions: Mutex<HashMap<u64, RunningShell>>,
    next_id: AtomicU64,
}

impl Default for TerminalManager {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
        }
    }
}

fn kill_process_tree(child: &mut Child) {
    let pid = child.id();
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

impl TerminalManager {
    pub fn shutdown_sync(&self) {
        if let Ok(mut guard) = self.sessions.lock() {
            for (_, mut running) in guard.drain() {
                drop(running.stdin);
                kill_process_tree(&mut running.child);
            }
        }
    }

    fn resolve_cwd(&self, studio_state: &StudioState, override_cwd: Option<String>) -> PathBuf {
        if let Some(dir) = override_cwd.filter(|s| !s.trim().is_empty()) {
            let p = PathBuf::from(dir);
            if p.is_dir() {
                return p;
            }
        }
        if let Ok(guard) = studio_state.project_root.read() {
            if let Some(ref root) = *guard {
                if root.is_dir() {
                    return root.clone();
                }
            }
        }
        std::env::var_os("USERPROFILE")
            .map(PathBuf::from)
            .filter(|p| p.is_dir())
            .unwrap_or_else(|| PathBuf::from("C:\\"))
    }

    fn spawn_session_with_id(
        &self,
        app: &AppHandle,
        session_id: u64,
        cwd_path: PathBuf,
    ) -> Result<TerminalSessionInfo, String> {
        let cwd_str = cwd_path.to_string_lossy().to_string();

        #[cfg(target_os = "windows")]
        let (shell_name, mut cmd) = {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            let mut c = Command::new("powershell.exe");
            c.args(["-NoLogo", "-NoProfile", "-NoExit", "-Command", "-"])
                .current_dir(&cwd_path)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .creation_flags(CREATE_NO_WINDOW);
            ("PowerShell".to_string(), c)
        };

        #[cfg(not(target_os = "windows"))]
        let (shell_name, mut cmd) = {
            let mut c = Command::new("sh");
            c.current_dir(&cwd_path)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            ("sh".to_string(), c)
        };

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Terminal başladıla bilmədi: {e}"))?;

        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Terminal stdin açıla bilmədi".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Terminal stdout açıla bilmədi".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Terminal stderr açıla bilmədi".to_string())?;

        #[cfg(target_os = "windows")]
        {
            let init_cmd = "[Console]::InputEncoding = [System.Text.Encoding]::UTF8; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8\r\n";
            let _ = stdin.write_all(init_cmd.as_bytes());
            let _ = stdin.flush();
        }

        // Stream stdout
        {
            let app_out = app.clone();
            std::thread::spawn(move || {
                let mut reader = stdout;
                let mut buf = [0u8; 4096];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            let text = String::from_utf8_lossy(&buf[..n]).to_string();
                            let _ = app_out.emit(
                                "studio-terminal-output",
                                TerminalOutputEvent {
                                    session_id,
                                    stream: "stdout".to_string(),
                                    data: text,
                                },
                            );
                        }
                    }
                }
                let _ = app_out.emit("studio-terminal-exit", session_id);
            });
        }

        // Stream stderr
        {
            let app_err = app.clone();
            std::thread::spawn(move || {
                let mut reader = stderr;
                let mut buf = [0u8; 4096];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            let text = String::from_utf8_lossy(&buf[..n]).to_string();
                            let _ = app_err.emit(
                                "studio-terminal-output",
                                TerminalOutputEvent {
                                    session_id,
                                    stream: "stderr".to_string(),
                                    data: text,
                                },
                            );
                        }
                    }
                }
            });
        }

        {
            let mut guard = self.sessions.lock().map_err(|e| e.to_string())?;
            if let Some(mut old) = guard.remove(&session_id) {
                drop(old.stdin);
                kill_process_tree(&mut old.child);
            }
            guard.insert(
                session_id,
                RunningShell {
                    session_id,
                    child,
                    stdin,
                    cwd: cwd_str.clone(),
                },
            );
        }

        Ok(TerminalSessionInfo {
            running: true,
            session_id,
            cwd: cwd_str,
            shell: shell_name,
        })
    }

    fn spawn_new(&self, app: &AppHandle, cwd_path: PathBuf) -> Result<TerminalSessionInfo, String> {
        let session_id = self.next_id.fetch_add(1, Ordering::SeqCst);
        self.spawn_session_with_id(app, session_id, cwd_path)
    }
}

#[tauri::command]
pub fn terminal_create(
    app: AppHandle,
    state: State<'_, TerminalManager>,
    studio_state: State<'_, StudioState>,
    cwd: Option<String>,
) -> Result<TerminalSessionInfo, String> {
    let target_cwd = state.resolve_cwd(&studio_state, cwd);
    state.spawn_new(&app, target_cwd)
}

#[tauri::command]
pub fn terminal_start(
    app: AppHandle,
    state: State<'_, TerminalManager>,
    studio_state: State<'_, StudioState>,
    cwd: Option<String>,
) -> Result<TerminalSessionInfo, String> {
    if cwd.is_none() {
        let mut guard = state.sessions.lock().map_err(|e| e.to_string())?;
        let mut alive_info: Option<TerminalSessionInfo> = None;
        for (_, running) in guard.iter_mut() {
            if running.child.try_wait().ok().flatten().is_none() {
                alive_info = Some(TerminalSessionInfo {
                    running: true,
                    session_id: running.session_id,
                    cwd: running.cwd.clone(),
                    shell: "PowerShell".to_string(),
                });
                break;
            }
        }
        if let Some(info) = alive_info {
            return Ok(info);
        }
    }

    let target_cwd = state.resolve_cwd(&studio_state, cwd);
    state.spawn_new(&app, target_cwd)
}

#[tauri::command]
pub fn terminal_write(
    state: State<'_, TerminalManager>,
    session_id: Option<u64>,
    input: String,
) -> Result<(), String> {
    let mut guard = state.sessions.lock().map_err(|e| e.to_string())?;
    let key = match session_id {
        Some(id) => id,
        None => *guard
            .keys()
            .next()
            .ok_or_else(|| "Aktiv terminal sessiyası tapılmadı".to_string())?,
    };

    let running = guard
        .get_mut(&key)
        .ok_or_else(|| "Terminal sessiyası aktiv deyil. Yenidən başladın.".to_string())?;

    if running.child.try_wait().ok().flatten().is_some() {
        guard.remove(&key);
        return Err("Terminal sessiyası bağlanıb. Yenidən başladın.".to_string());
    }

    let line = if input.ends_with('\n') {
        input
    } else {
        format!("{input}\r\n")
    };

    running
        .stdin
        .write_all(line.as_bytes())
        .map_err(|e| format!("Terminala yazma xətası: {e}"))?;
    running
        .stdin
        .flush()
        .map_err(|e| format!("Terminal flush xətası: {e}"))?;

    Ok(())
}

#[tauri::command]
pub fn terminal_restart(
    app: AppHandle,
    state: State<'_, TerminalManager>,
    studio_state: State<'_, StudioState>,
    session_id: Option<u64>,
    cwd: Option<String>,
) -> Result<TerminalSessionInfo, String> {
    let prev_cwd = {
        let guard = state.sessions.lock().map_err(|e| e.to_string())?;
        session_id.and_then(|id| guard.get(&id).map(|s| s.cwd.clone()))
    };
    let target_cwd = state.resolve_cwd(&studio_state, cwd.or(prev_cwd));
    if let Some(id) = session_id {
        // Kill old process and respawn with fresh id so old exit events never collide
        {
            let mut guard = state.sessions.lock().map_err(|e| e.to_string())?;
            if let Some(mut old) = guard.remove(&id) {
                drop(old.stdin);
                kill_process_tree(&mut old.child);
            }
        }
    }
    state.spawn_new(&app, target_cwd)
}

#[tauri::command]
pub fn terminal_interrupt(
    app: AppHandle,
    state: State<'_, TerminalManager>,
    studio_state: State<'_, StudioState>,
    session_id: Option<u64>,
) -> Result<TerminalSessionInfo, String> {
    let prev_cwd = {
        let mut guard = state.sessions.lock().map_err(|e| e.to_string())?;
        let target_id = session_id.or_else(|| guard.keys().next().copied());
        if let Some(id) = target_id {
            if let Some(mut old) = guard.remove(&id) {
                let cwd = old.cwd.clone();
                drop(old.stdin);
                kill_process_tree(&mut old.child);
                Some(cwd)
            } else {
                None
            }
        } else {
            None
        }
    };

    let target_cwd = state.resolve_cwd(&studio_state, prev_cwd);
    let info = state.spawn_new(&app, target_cwd)?;
    let _ = app.emit(
        "studio-terminal-output",
        TerminalOutputEvent {
            session_id: info.session_id,
            stream: "system".to_string(),
            data: "^C — Proses dayandırıldı və yeni sessiya hazırdır.\n".to_string(),
        },
    );
    Ok(info)
}

#[tauri::command]
pub fn terminal_close(state: State<'_, TerminalManager>, session_id: u64) -> Result<(), String> {
    let mut guard = state.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(mut old) = guard.remove(&session_id) {
        drop(old.stdin);
        kill_process_tree(&mut old.child);
    }
    Ok(())
}

#[tauri::command]
pub fn terminal_get_status(state: State<'_, TerminalManager>) -> Result<Vec<TerminalSessionInfo>, String> {
    let mut guard = state.sessions.lock().map_err(|e| e.to_string())?;
    let mut dead_ids = Vec::new();
    let mut list = Vec::new();

    for (id, running) in guard.iter_mut() {
        if running.child.try_wait().ok().flatten().is_some() {
            dead_ids.push(*id);
        } else {
            list.push(TerminalSessionInfo {
                running: true,
                session_id: running.session_id,
                cwd: running.cwd.clone(),
                shell: "PowerShell".to_string(),
            });
        }
    }
    for id in dead_ids {
        guard.remove(&id);
    }
    list.sort_by_key(|s| s.session_id);
    Ok(list)
}
