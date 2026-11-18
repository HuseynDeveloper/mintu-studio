/**
 * mcp.rs
 * Real Model Context Protocol (MCP) Client over stdio JSON-RPC 2.0.
 * - Persists server configs in %APPDATA%\MintuStudio\mcp_servers.json
 * - Spawns MCP servers with CREATE_NO_WINDOW
 * - Executes real MCP handshake: initialize -> notifications/initialized -> tools/list
 * - Supports tools/call with 30s timeout
 */

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::State;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    pub id: String,
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolDef {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub input_schema: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerStatusView {
    pub config: McpServerConfig,
    pub status: String, // "connected" | "disconnected" | "error"
    pub error: Option<String>,
    pub tools: Vec<McpToolDef>,
}

struct ActiveMcpConnection {
    child: Child,
    stdin: ChildStdin,
    stdout_reader: BufReader<ChildStdout>,
    next_id: AtomicU64,
    tools: Vec<McpToolDef>,
}

impl ActiveMcpConnection {
    async fn send_json(&mut self, msg: &Value) -> Result<(), String> {
        let mut line = serde_json::to_string(msg).map_err(|e| e.to_string())?;
        line.push('\n');
        self.stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| format!("MCP stdin write failed: {e}"))?;
        self.stdin
            .flush()
            .await
            .map_err(|e| format!("MCP stdin flush failed: {e}"))?;
        Ok(())
    }

    async fn request(&mut self, method: &str, params: Value, timeout_secs: u64) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let req = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        });

        self.send_json(&req).await?;

        let read_future = async {
            let mut line = String::new();
            loop {
                line.clear();
                let n = self
                    .stdout_reader
                    .read_line(&mut line)
                    .await
                    .map_err(|e| format!("MCP stdout read failed: {e}"))?;
                if n == 0 {
                    return Err("MCP server closed stdout unexpectedly".to_string());
                }
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let Ok(val) = serde_json::from_str::<Value>(trimmed) else {
                    continue; // ignore non-JSON log lines on stdout
                };
                // Skip notifications without matching id
                let resp_id = val.get("id").and_then(|v| v.as_u64());
                if resp_id != Some(id) {
                    continue;
                }
                if let Some(err) = val.get("error") {
                    let msg = err
                        .get("message")
                        .and_then(|m| m.as_str())
                        .unwrap_or("Unknown MCP JSON-RPC error");
                    return Err(format!("MCP error: {msg}"));
                }
                return Ok(val.get("result").cloned().unwrap_or(Value::Null));
            }
        };

        tokio::time::timeout(Duration::from_secs(timeout_secs), read_future)
            .await
            .map_err(|_| format!("MCP request '{method}' timed out after {timeout_secs}s"))?
    }

    async fn notify(&mut self, method: &str, params: Value) -> Result<(), String> {
        let notif = json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params
        });
        self.send_json(&notif).await
    }
}

pub struct McpManager {
    configs: Mutex<Vec<McpServerConfig>>,
    connections: Mutex<HashMap<String, Arc<Mutex<ActiveMcpConnection>>>>,
    errors: Mutex<HashMap<String, String>>,
}

impl Default for McpManager {
    fn default() -> Self {
        let initial = load_configs_from_disk();
        Self {
            configs: Mutex::new(initial),
            connections: Mutex::new(HashMap::new()),
            errors: Mutex::new(HashMap::new()),
        }
    }
}

fn config_file_path() -> PathBuf {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    base.join("MintuStudio").join("mcp_servers.json")
}

fn load_configs_from_disk() -> Vec<McpServerConfig> {
    let path = config_file_path();
    let Ok(raw) = fs::read_to_string(&path) else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<McpServerConfig>>(&raw).unwrap_or_default()
}

fn save_configs_to_disk(configs: &[McpServerConfig]) -> Result<(), String> {
    let path = config_file_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json_str = serde_json::to_string_pretty(configs).map_err(|e| e.to_string())?;
    fs::write(&path, json_str).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mcp_list_servers(state: State<'_, McpManager>) -> Result<Vec<McpServerStatusView>, String> {
    let configs = state.configs.lock().await.clone();
    let conns = state.connections.lock().await;
    let errors = state.errors.lock().await;

    let mut out = Vec::with_capacity(configs.len());
    for cfg in configs {
        if let Some(conn_arc) = conns.get(&cfg.id) {
            let conn = conn_arc.lock().await;
            out.push(McpServerStatusView {
                config: cfg,
                status: "connected".to_string(),
                error: None,
                tools: conn.tools.clone(),
            });
        } else if let Some(err) = errors.get(&cfg.id) {
            out.push(McpServerStatusView {
                config: cfg,
                status: "error".to_string(),
                error: Some(err.clone()),
                tools: Vec::new(),
            });
        } else {
            out.push(McpServerStatusView {
                config: cfg,
                status: "disconnected".to_string(),
                error: None,
                tools: Vec::new(),
            });
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn mcp_save_server(
    state: State<'_, McpManager>,
    config: McpServerConfig,
) -> Result<Vec<McpServerStatusView>, String> {
    if config.name.trim().is_empty() || config.command.trim().is_empty() {
        return Err("MCP server name and command are required".to_string());
    }

    {
        let mut configs = state.configs.lock().await;
        if let Some(existing) = configs.iter_mut().find(|c| c.id == config.id) {
            *existing = config;
        } else {
            configs.push(config);
        }
        save_configs_to_disk(&configs)?;
    }

    mcp_list_servers(state).await
}

#[tauri::command]
pub async fn mcp_delete_server(
    state: State<'_, McpManager>,
    id: String,
) -> Result<Vec<McpServerStatusView>, String> {
    // Disconnect if running
    if let Some(conn_arc) = state.connections.lock().await.remove(&id) {
        let mut conn = conn_arc.lock().await;
        let _ = conn.child.kill().await;
    }
    state.errors.lock().await.remove(&id);

    {
        let mut configs = state.configs.lock().await;
        configs.retain(|c| c.id != id);
        save_configs_to_disk(&configs)?;
    }

    mcp_list_servers(state).await
}

#[tauri::command]
pub async fn mcp_disconnect_server(
    state: State<'_, McpManager>,
    id: String,
) -> Result<Vec<McpServerStatusView>, String> {
    if let Some(conn_arc) = state.connections.lock().await.remove(&id) {
        let mut conn = conn_arc.lock().await;
        let _ = conn.child.kill().await;
    }
    state.errors.lock().await.remove(&id);
    mcp_list_servers(state).await
}

#[tauri::command]
pub async fn mcp_connect_server(
    state: State<'_, McpManager>,
    id: String,
) -> Result<McpServerStatusView, String> {
    // Clean up any existing connection first
    if let Some(old_arc) = state.connections.lock().await.remove(&id) {
        let mut old = old_arc.lock().await;
        let _ = old.child.kill().await;
    }

    let cfg = {
        let configs = state.configs.lock().await;
        configs
            .iter()
            .find(|c| c.id == id)
            .cloned()
            .ok_or_else(|| format!("MCP server '{id}' not found"))?
    };

    // On Windows, commands like `npx` / `uvx` / `node` may be `.cmd` shims, so run through cmd.exe /C when needed or directly
    let mut cmd = {
        #[cfg(target_os = "windows")]
        {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            let lower = cfg.command.to_lowercase();
            let mut c = if lower == "npx" || lower == "npm" || lower.ends_with(".cmd") || lower.ends_with(".bat") {
                let mut wrapper = Command::new("cmd.exe");
                wrapper.arg("/C").arg(&cfg.command);
                for arg in &cfg.args {
                    wrapper.arg(arg);
                }
                wrapper
            } else {
                let mut direct = Command::new(&cfg.command);
                direct.args(&cfg.args);
                direct
            };
            c.creation_flags(CREATE_NO_WINDOW);
            c
        }
        #[cfg(not(target_os = "windows"))]
        {
            let mut direct = Command::new(&cfg.command);
            direct.args(&cfg.args);
            direct
        }
    };

    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    for (k, v) in &cfg.env {
        cmd.env(k, v);
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let err_msg = format!("Server işə salınmadı ({}): {e}", cfg.command);
            state.errors.lock().await.insert(id.clone(), err_msg.clone());
            return Err(err_msg);
        }
    };

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to capture MCP stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture MCP stdout".to_string())?;

    let mut conn = ActiveMcpConnection {
        child,
        stdin,
        stdout_reader: BufReader::new(stdout),
        next_id: AtomicU64::new(1),
        tools: Vec::new(),
    };

    // 1. MCP Initialize handshake
    let init_res = conn
        .request(
            "initialize",
            json!({
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {
                    "name": "mintu-studio",
                    "version": "0.2.0"
                }
            }),
            20,
        )
        .await;

    if let Err(e) = init_res {
        let _ = conn.child.kill().await;
        state.errors.lock().await.insert(id.clone(), e.clone());
        return Err(e);
    }

    // 2. Send initialized notification
    let _ = conn.notify("notifications/initialized", json!({})).await;

    // 3. Discover tools via tools/list
    let tools_val = conn.request("tools/list", json!({}), 15).await;
    let mut tools = Vec::new();
    if let Ok(val) = tools_val {
        if let Some(arr) = val.get("tools").and_then(|t| t.as_array()) {
            for t in arr {
                let name = t
                    .get("name")
                    .and_then(|s| s.as_str())
                    .unwrap_or("")
                    .to_string();
                if name.is_empty() {
                    continue;
                }
                let description = t
                    .get("description")
                    .and_then(|s| s.as_str())
                    .unwrap_or("")
                    .to_string();
                let input_schema = t.get("inputSchema").cloned().unwrap_or(json!({}));
                tools.push(McpToolDef {
                    name,
                    description,
                    input_schema,
                });
            }
        }
    }

    conn.tools = tools.clone();
    state.errors.lock().await.remove(&id);
    state
        .connections
        .lock()
        .await
        .insert(id.clone(), Arc::new(Mutex::new(conn)));

    Ok(McpServerStatusView {
        config: cfg,
        status: "connected".to_string(),
        error: None,
        tools,
    })
}

#[tauri::command]
pub async fn mcp_call_tool(
    state: State<'_, McpManager>,
    server_id: String,
    tool_name: String,
    arguments: Value,
) -> Result<String, String> {
    let conn_arc = {
        let conns = state.connections.lock().await;
        conns
            .get(&server_id)
            .cloned()
            .ok_or_else(|| format!("MCP server '{server_id}' is not connected"))?
    };

    let mut conn = conn_arc.lock().await;
    let result = conn
        .request(
            "tools/call",
            json!({
                "name": tool_name,
                "arguments": arguments
            }),
            30,
        )
        .await?;

    // Extract text content blocks if present
    if let Some(content_arr) = result.get("content").and_then(|c| c.as_array()) {
        let mut parts = Vec::new();
        for block in content_arr {
            if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                parts.push(text.to_string());
            } else {
                parts.push(block.to_string());
            }
        }
        if !parts.is_empty() {
            return Ok(parts.join("\n"));
        }
    }

    serde_json::to_string_pretty(&result).map_err(|e| e.to_string())
}
