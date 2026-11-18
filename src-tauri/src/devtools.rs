//! devtools.rs
//! Pro Developer Utilities for Mintu Studio:
//! - Localhost Port & Process Monitor (list active listening ports + safe kill)
//! - Workspace Compiler / Health Check (tsc / cargo check / py_compile -> structured Problems)
//! - TODO / FIXME / BUG / HACK Workspace Scanner
//! - Inline Git Blame (author, date, commit summary for cursor line)
//! - Read-Only SQLite Inspector & Query Runner (via Python stdlib sqlite3 in ?mode=ro)
//! - Project Template Scaffolder (React+TS+Vite, Python FastAPI, Node Express, Web Starter)

use crate::studio::{is_sensitive_file_or_dir, validate_and_resolve_path, StudioState};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;
use tauri::State;

fn read_root(state: &State<'_, StudioState>) -> Result<PathBuf, String> {
    let guard = state
        .project_root
        .read()
        .map_err(|_| "Studio state lock poisoned".to_string())?;
    guard
        .clone()
        .ok_or_else(|| "No project folder is currently open.".to_string())
}

fn is_sensitive_str(p: &str) -> bool {
    is_sensitive_file_or_dir(Path::new(p))
}

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn run_hidden_cmd(program: &str, args: &[&str], cwd: Option<&Path>) -> Result<(i32, String, String), String> {
    let mut cmd = std::process::Command::new(program);
    cmd.args(args);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let out = cmd.output().map_err(|e| format!("Failed to execute {}: {}", program, e))?;
    let code = out.status.code().unwrap_or(-1);
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    Ok((code, stdout, stderr))
}

// ==========================================
// 1. Localhost Port & Process Monitor
// ==========================================

#[derive(Debug, Clone, Serialize)]
pub struct ActivePortItem {
    pub port: u16,
    pub pid: u32,
    pub process_name: String,
    pub address: String,
}

#[tauri::command]
pub async fn devtools_list_ports() -> Result<Vec<ActivePortItem>, String> {
    tokio::task::spawn_blocking(move || {
        let (_, task_out, _) = run_hidden_cmd("tasklist", &["/FO", "CSV", "/NH"], None).unwrap_or((0, String::new(), String::new()));
        let mut pid_names: HashMap<u32, String> = HashMap::new();
        for line in task_out.lines() {
            let trimmed = line.trim();
            if !trimmed.starts_with('"') {
                continue;
            }
            let cols: Vec<&str> = trimmed.split("\",\"").collect();
            if cols.len() >= 2 {
                let name = cols[0].trim_start_matches('"').to_string();
                let pid_str = cols[1].trim_matches('"');
                if let Ok(pid) = pid_str.parse::<u32>() {
                    pid_names.insert(pid, name);
                }
            }
        }

        let (_, net_out, _) = run_hidden_cmd("netstat", &["-ano", "-p", "TCP"], None)?;
        let mut seen: HashMap<u16, ActivePortItem> = HashMap::new();

        for line in net_out.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 5 {
                continue;
            }
            if !parts[0].eq_ignore_ascii_case("TCP") || !parts[3].eq_ignore_ascii_case("LISTENING") {
                continue;
            }
            let local_addr = parts[1];
            let port_str = match local_addr.rsplit(':').next() {
                Some(p) => p,
                None => continue,
            };
            let port: u16 = match port_str.parse() {
                Ok(p) if p >= 80 => p,
                _ => continue,
            };
            let pid: u32 = match parts[4].parse() {
                Ok(p) if p > 4 => p,
                _ => continue,
            };
            let proc_name = pid_names
                .get(&pid)
                .cloned()
                .unwrap_or_else(|| format!("PID {}", pid));

            // Filter out noisy Windows ephemeral RPC ports above 49151 unless known dev tools
            if port >= 49152 && !proc_name.to_lowercase().contains("node") && !proc_name.to_lowercase().contains("python") {
                continue;
            }

            seen.entry(port).or_insert(ActivePortItem {
                port,
                pid,
                process_name: proc_name,
                address: local_addr.to_string(),
            });
        }

        let mut list: Vec<ActivePortItem> = seen.into_values().collect();
        list.sort_by_key(|p| p.port);
        Ok(list)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
pub async fn devtools_kill_pid(pid: u32) -> Result<String, String> {
    if pid <= 4 || pid == std::process::id() {
        return Err("Cannot terminate system or Mintu Studio process.".to_string());
    }
    tokio::task::spawn_blocking(move || {
        let (code, stdout, stderr) = run_hidden_cmd("taskkill", &["/PID", &pid.to_string(), "/F"], None)?;
        if code == 0 {
            Ok(stdout.trim().to_string())
        } else {
            Err(stderr.trim().to_string())
        }
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

// ==========================================
// 2. Workspace Compiler / Health Check
// ==========================================

#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceDiagnosticItem {
    pub path: String,
    pub line: u32,
    pub col: u32,
    pub severity: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProjectCheckResult {
    pub tool: String,
    pub exit_code: i32,
    pub diagnostics: Vec<WorkspaceDiagnosticItem>,
    pub raw_summary: String,
}

#[tauri::command]
pub async fn devtools_check_project(state: State<'_, StudioState>) -> Result<ProjectCheckResult, String> {
    let root = read_root(&state)?;
    tokio::task::spawn_blocking(move || {
        let mut diagnostics: Vec<WorkspaceDiagnosticItem> = Vec::new();

        // 1. TypeScript (tsconfig.json)
        if root.join("tsconfig.json").exists() {
            let (code, stdout, stderr) = run_hidden_cmd("cmd", &["/C", "npx tsc --noEmit --pretty false"], Some(&root))?;
            let combined = format!("{}\n{}", stdout, stderr);
            for line in combined.lines() {
                if let Some(paren_idx) = line.find('(') {
                    if let Some(close_idx) = line[paren_idx..].find("):") {
                        let path_raw = line[..paren_idx].trim().replace('\\', "/");
                        let coords = &line[paren_idx + 1..paren_idx + close_idx];
                        let msg = line[paren_idx + close_idx + 2..].trim();
                        let mut cparts = coords.split(',');
                        let ln = cparts.next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(1);
                        let col = cparts.next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(1);
                        let sev = if msg.to_lowercase().contains("warning") { "warning" } else { "error" };
                        if !path_raw.is_empty() && !is_sensitive_str(&path_raw) {
                            diagnostics.push(WorkspaceDiagnosticItem {
                                path: path_raw,
                                line: ln,
                                col,
                                severity: sev.to_string(),
                                message: msg.to_string(),
                            });
                        }
                    }
                }
            }
            return Ok(ProjectCheckResult {
                tool: "TypeScript (tsc --noEmit)".to_string(),
                exit_code: code,
                diagnostics,
                raw_summary: if code == 0 { "0 TypeScript errors.".to_string() } else { combined.chars().take(1200).collect() },
            });
        }

        // 2. Rust (Cargo.toml or src-tauri/Cargo.toml)
        let cargo_dir = if root.join("Cargo.toml").exists() {
            Some(root.clone())
        } else if root.join("src-tauri").join("Cargo.toml").exists() {
            Some(root.join("src-tauri"))
        } else {
            None
        };
        if let Some(cdir) = cargo_dir {
            let (code, stdout, stderr) = run_hidden_cmd("cargo", &["check", "--message-format=short"], Some(&cdir))?;
            let combined = format!("{}\n{}", stdout, stderr);
            for line in combined.lines() {
                let parts: Vec<&str> = line.splitn(4, ':').collect();
                if parts.len() == 4 {
                    if let (Ok(ln), Ok(col)) = (parts[1].trim().parse::<u32>(), parts[2].trim().parse::<u32>()) {
                        let msg = parts[3].trim();
                        let sev = if msg.starts_with("warning") { "warning" } else { "error" };
                        let p = parts[0].trim().replace('\\', "/");
                        if !is_sensitive_str(&p) {
                            diagnostics.push(WorkspaceDiagnosticItem {
                                path: p,
                                line: ln,
                                col,
                                severity: sev.to_string(),
                                message: msg.to_string(),
                            });
                        }
                    }
                }
            }
            return Ok(ProjectCheckResult {
                tool: "Rust (cargo check)".to_string(),
                exit_code: code,
                diagnostics,
                raw_summary: if code == 0 { "Cargo check passed.".to_string() } else { combined.chars().take(1200).collect() },
            });
        }

        // 3. Python syntax check across project .py files
        let py_script = r#"
import os, ast, json, sys
root = sys.argv[1]
errs = []
skip = {'node_modules', '.git', '.venv', 'venv', '__pycache__', 'dist', 'build', 'target'}
for dirpath, dirnames, filenames in os.walk(root):
    dirnames[:] = [d for d in dirnames if d not in skip]
    for fn in filenames:
        if not fn.endswith('.py'): continue
        full = os.path.join(dirpath, fn)
        rel = os.path.relpath(full, root).replace('\\', '/')
        try:
            with open(full, 'r', encoding='utf-8', errors='replace') as f:
                ast.parse(f.read(), filename=rel)
        except SyntaxError as e:
            errs.append({'path': rel, 'line': e.lineno or 1, 'col': e.offset or 1, 'severity': 'error', 'message': f'SyntaxError: {e.msg}'})
print(json.dumps(errs))
"#;
        if let Ok((code, stdout, _)) = run_hidden_cmd("python", &["-c", py_script, &root.to_string_lossy()], Some(&root)) {
            if code == 0 {
                if let Ok(arr) = serde_json::from_str::<Vec<serde_json::Value>>(stdout.trim()) {
                    for v in arr {
                        let p = v.get("path").and_then(|x| x.as_str()).unwrap_or("").to_string();
                        if !p.is_empty() && !is_sensitive_str(&p) {
                            diagnostics.push(WorkspaceDiagnosticItem {
                                path: p,
                                line: v.get("line").and_then(|x| x.as_u64()).unwrap_or(1) as u32,
                                col: v.get("col").and_then(|x| x.as_u64()).unwrap_or(1) as u32,
                                severity: "error".to_string(),
                                message: v.get("message").and_then(|x| x.as_str()).unwrap_or("SyntaxError").to_string(),
                            });
                        }
                    }
                    let count = diagnostics.len();
                    return Ok(ProjectCheckResult {
                        tool: "Python (AST check)".to_string(),
                        exit_code: if count == 0 { 0 } else { 1 },
                        diagnostics,
                        raw_summary: format!("Python check finished: {} error(s).", count),
                    });
                }
            }
        }

        Ok(ProjectCheckResult {
            tool: "Workspace Check".to_string(),
            exit_code: 0,
            diagnostics: Vec::new(),
            raw_summary: "No tsconfig.json, Cargo.toml, or Python compiler detected in project root.".to_string(),
        })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

// ==========================================
// 3. TODO / FIXME / BUG / HACK Scanner
// ==========================================

#[derive(Debug, Clone, Serialize)]
pub struct TodoItem {
    pub tag: String,
    pub path: String,
    pub line_number: usize,
    pub text: String,
}

fn walk_todos(root: &Path, dir: &Path, out: &mut Vec<TodoItem>, limit: usize) {
    if out.len() >= limit {
        return;
    }
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    const SKIP_DIRS: &[&str] = &[
        "node_modules", ".git", "target", "dist", "build", ".next", "__pycache__", ".venv", "venv",
    ];
    for entry in entries.flatten() {
        if out.len() >= limit {
            break;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if is_sensitive_str(&name) {
            continue;
        }
        if path.is_dir() {
            if !SKIP_DIRS.iter().any(|s| s.eq_ignore_ascii_case(&name)) {
                walk_todos(root, &path, out, limit);
            }
            continue;
        }
        let rel = match path.strip_prefix(root) {
            Ok(r) => r.to_string_lossy().replace('\\', "/"),
            Err(_) => continue,
        };
        if is_sensitive_str(&rel) {
            continue;
        }
        let meta = match fs::metadata(&path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.len() > 512_000 {
            continue;
        }
        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        for (idx, line) in content.lines().enumerate() {
            let upper = line.to_uppercase();
            let found_tag = if upper.contains("FIXME") {
                Some("FIXME")
            } else if upper.contains("TODO") {
                Some("TODO")
            } else if upper.contains("HACK:") || upper.contains("// HACK") || upper.contains("# HACK") {
                Some("HACK")
            } else if upper.contains("BUG:") || upper.contains("// BUG") || upper.contains("# BUG") {
                Some("BUG")
            } else {
                None
            };
            if let Some(tag) = found_tag {
                let trimmed = line.trim();
                if trimmed.contains("//") || trimmed.contains('#') || trimmed.contains("/*") || trimmed.contains("--") || trimmed.contains('*') {
                    out.push(TodoItem {
                        tag: tag.to_string(),
                        path: rel.clone(),
                        line_number: idx + 1,
                        text: trimmed.chars().take(180).collect(),
                    });
                    if out.len() >= limit {
                        break;
                    }
                }
            }
        }
    }
}

#[tauri::command]
pub async fn devtools_scan_todos(
    state: State<'_, StudioState>,
    max_results: Option<usize>,
) -> Result<Vec<TodoItem>, String> {
    let root = read_root(&state)?;
    let limit = max_results.unwrap_or(150).min(300);
    tokio::task::spawn_blocking(move || {
        let mut results = Vec::new();
        walk_todos(&root, &root, &mut results, limit);
        Ok(results)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

// ==========================================
// 4. Inline Git Blame (Single Line)
// ==========================================

#[derive(Debug, Clone, Serialize)]
pub struct GitBlameLine {
    pub hash: String,
    pub author: String,
    pub date: String,
    pub summary: String,
}

#[tauri::command]
pub async fn devtools_git_blame_line(
    state: State<'_, StudioState>,
    rel_path: String,
    line: u32,
) -> Result<Option<GitBlameLine>, String> {
    let root = read_root(&state)?;
    let _validated = validate_and_resolve_path(&root, &rel_path)?;
    let range = format!("{},{}", line.max(1), line.max(1));

    tokio::task::spawn_blocking(move || {
        let (code, stdout, _) = run_hidden_cmd(
            "git",
            &["blame", "-L", &range, "--porcelain", "--", &rel_path],
            Some(&root),
        )?;
        if code != 0 || stdout.trim().is_empty() {
            return Ok(None);
        }

        let mut hash = String::new();
        let mut author = String::new();
        let mut summary = String::new();
        let mut author_time: i64 = 0;

        for (i, l) in stdout.lines().enumerate() {
            if i == 0 {
                if let Some(first) = l.split_whitespace().next() {
                    hash = first.chars().take(8).collect();
                }
            } else if let Some(rest) = l.strip_prefix("author ") {
                author = rest.trim().to_string();
            } else if let Some(rest) = l.strip_prefix("author-time ") {
                author_time = rest.trim().parse().unwrap_or(0);
            } else if let Some(rest) = l.strip_prefix("summary ") {
                summary = rest.trim().to_string();
            }
        }

        if author.is_empty() {
            return Ok(None);
        }

        let now_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let diff = (now_secs - author_time).max(0);
        let date = if hash == "00000000" {
            "Uncommitted".to_string()
        } else if diff < 3600 {
            format!("{}m ago", (diff / 60).max(1))
        } else if diff < 86400 {
            format!("{}h ago", diff / 3600)
        } else {
            format!("{}d ago", diff / 86400)
        };

        Ok(Some(GitBlameLine {
            hash,
            author,
            date,
            summary,
        }))
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

// ==========================================
// 5. Read-Only SQLite Explorer (via Python stdlib sqlite3)
// ==========================================

#[derive(Debug, Clone, Serialize)]
pub struct SqliteTableInfo {
    pub name: String,
    pub row_count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct SqliteQueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub truncated: bool,
    pub duration_ms: u64,
}

#[tauri::command]
pub async fn devtools_sqlite_tables(
    state: State<'_, StudioState>,
    rel_path: String,
) -> Result<Vec<SqliteTableInfo>, String> {
    let root = read_root(&state)?;
    if is_sensitive_str(&rel_path) {
        return Err("Sensitive file blocked.".to_string());
    }
    let full = validate_and_resolve_path(&root, &rel_path)?;

    tokio::task::spawn_blocking(move || {
        let script = r#"
import sqlite3, json, sys, urllib.parse
p = sys.argv[1].replace('\\', '/')
uri = f'file:{urllib.parse.quote(p)}?mode=ro'
conn = sqlite3.connect(uri, uri=True)
cur = conn.cursor()
cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
tables = []
for (name,) in cur.fetchall():
    try:
        safe = name.replace('"', '""')
        cur.execute(f'SELECT COUNT(*) FROM "{safe}"')
        cnt = cur.fetchone()[0]
    except Exception:
        cnt = -1
    tables.append({'name': name, 'row_count': cnt})
conn.close()
print(json.dumps(tables))
"#;
        let (code, stdout, stderr) = run_hidden_cmd("python", &["-c", script, &full.to_string_lossy()], None)?;
        if code != 0 {
            return Err(format!("SQLite read error (requires Python 3): {}", stderr.trim()));
        }
        let items: Vec<serde_json::Value> =
            serde_json::from_str(stdout.trim()).map_err(|e| format!("Parse error: {}", e))?;
        let mut out = Vec::new();
        for item in items {
            out.push(SqliteTableInfo {
                name: item.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                row_count: item.get("row_count").and_then(|v| v.as_i64()).unwrap_or(0),
            });
        }
        Ok(out)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
pub async fn devtools_sqlite_query(
    state: State<'_, StudioState>,
    rel_path: String,
    query: String,
    limit: Option<usize>,
) -> Result<SqliteQueryResult, String> {
    let root = read_root(&state)?;
    if is_sensitive_str(&rel_path) {
        return Err("Sensitive file blocked.".to_string());
    }
    let full = validate_and_resolve_path(&root, &rel_path)?;

    let trimmed = query.trim().to_string();
    let upper = trimmed.to_uppercase();
    if !(upper.starts_with("SELECT") || upper.starts_with("PRAGMA") || upper.starts_with("EXPLAIN") || upper.starts_with("WITH")) {
        return Err("SQLite Explorer runs strictly read-only queries (SELECT / WITH / PRAGMA / EXPLAIN).".to_string());
    }
    let max_rows = limit.unwrap_or(200).min(1000);

    tokio::task::spawn_blocking(move || {
        let started = Instant::now();
        let script = r#"
import sqlite3, json, sys, urllib.parse
p, q, lim = sys.argv[1].replace('\\', '/'), sys.argv[2], int(sys.argv[3])
uri = f'file:{urllib.parse.quote(p)}?mode=ro'
conn = sqlite3.connect(uri, uri=True)
cur = conn.cursor()
cur.execute(q)
cols = [d[0] for d in (cur.description or [])]
fetched = cur.fetchmany(lim + 1)
trunc = len(fetched) > lim
rows = [[('NULL' if c is None else str(c)[:400]) for c in r] for r in fetched[:lim]]
conn.close()
print(json.dumps({'columns': cols, 'rows': rows, 'truncated': trunc}))
"#;
        let (code, stdout, stderr) = run_hidden_cmd(
            "python",
            &["-c", script, &full.to_string_lossy(), &trimmed, &max_rows.to_string()],
            None,
        )?;
        let elapsed = started.elapsed().as_millis() as u64;
        if code != 0 {
            return Err(format!("SQL query error: {}", stderr.trim()));
        }
        let val: serde_json::Value =
            serde_json::from_str(stdout.trim()).map_err(|e| format!("Result parse error: {}", e))?;
        let columns: Vec<String> = val
            .get("columns")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
            .unwrap_or_default();
        let rows: Vec<Vec<String>> = val
            .get("rows")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .map(|r| {
                        r.as_array()
                            .map(|cells| cells.iter().filter_map(|c| c.as_str().map(|s| s.to_string())).collect())
                            .unwrap_or_default()
                    })
                    .collect()
            })
            .unwrap_or_default();
        let truncated = val.get("truncated").and_then(|v| v.as_bool()).unwrap_or(false);

        Ok(SqliteQueryResult {
            columns,
            rows,
            truncated,
            duration_ms: elapsed,
        })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

// ==========================================
// 6. Project Template Scaffolder
// ==========================================

#[tauri::command]
pub async fn devtools_scaffold_project(
    state: State<'_, StudioState>,
    template_id: String,
    project_name: String,
) -> Result<Vec<String>, String> {
    let root = read_root(&state)?;
    let safe_name: String = project_name
        .trim()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect();
    let app_name = if safe_name.is_empty() { "mintu-app".to_string() } else { safe_name };

    let files: Vec<(String, String)> = match template_id.as_str() {
        "react-ts-vite" => vec![
            (
                "package.json".to_string(),
                format!(
                    "{{\n  \"name\": \"{}\",\n  \"private\": true,\n  \"version\": \"0.1.0\",\n  \"type\": \"module\",\n  \"scripts\": {{\n    \"dev\": \"vite\",\n    \"build\": \"tsc && vite build\"\n  }},\n  \"dependencies\": {{\n    \"react\": \"^19.0.0\",\n    \"react-dom\": \"^19.0.0\"\n  }},\n  \"devDependencies\": {{\n    \"@types/react\": \"^19.0.0\",\n    \"@types/react-dom\": \"^19.0.0\",\n    \"typescript\": \"^5.7.0\",\n    \"vite\": \"^6.0.0\"\n  }}\n}}\n",
                    app_name
                ),
            ),
            (
                "index.html".to_string(),
                format!(
                    "<!DOCTYPE html>\n<html lang=\"en\">\n  <head>\n    <meta charset=\"UTF-8\" />\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />\n    <title>{}</title>\n  </head>\n  <body>\n    <div id=\"root\"></div>\n    <script type=\"module\" src=\"/src/main.tsx\"></script>\n  </body>\n</html>\n",
                    app_name
                ),
            ),
            (
                "src/main.tsx".to_string(),
                "import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport { App } from './App';\n\nReactDOM.createRoot(document.getElementById('root')!).render(\n  <React.StrictMode>\n    <App />\n  </React.StrictMode>\n);\n".to_string(),
            ),
            (
                "src/App.tsx".to_string(),
                format!(
                    "import React, {{ useState }} from 'react';\n\nexport const App: React.FC = () => {{\n  const [count, setCount] = useState(0);\n  return (\n    <main style={{{{ fontFamily: 'sans-serif', padding: 32 }}}}>\n      <h1>{}</h1>\n      <button onClick={{() => setCount((c) => c + 1)}}>Count: {{count}}</button>\n    </main>\n  );\n}};\n",
                    app_name
                ),
            ),
        ],
        "python-fastapi" => vec![
            (
                "requirements.txt".to_string(),
                "fastapi>=0.115.0\nuvicorn[standard]>=0.32.0\npydantic>=2.9.0\n".to_string(),
            ),
            (
                "main.py".to_string(),
                format!(
                    "from fastapi import FastAPI\nfrom pydantic import BaseModel\n\napp = FastAPI(title=\"{}\")\n\n\nclass Item(BaseModel):\n    name: str\n    price: float\n\n\n@app.get(\"/health\")\nasync def health() -> dict:\n    return {{\"status\": \"ok\", \"service\": \"{}\"}}\n\n\n@app.post(\"/items\")\nasync def create_item(item: Item) -> dict:\n    return {{\"created\": item.model_dump()}}\n",
                    app_name, app_name
                ),
            ),
            (
                "README.md".to_string(),
                format!("# {}\n\n```bash\npip install -r requirements.txt\nuvicorn main:app --reload\n```\n", app_name),
            ),
        ],
        "node-express" => vec![
            (
                "package.json".to_string(),
                format!(
                    "{{\n  \"name\": \"{}\",\n  \"version\": \"0.1.0\",\n  \"type\": \"module\",\n  \"scripts\": {{\n    \"dev\": \"node --watch src/server.js\",\n    \"start\": \"node src/server.js\"\n  }},\n  \"dependencies\": {{\n    \"express\": \"^4.21.0\"\n  }}\n}}\n",
                    app_name
                ),
            ),
            (
                "src/server.js".to_string(),
                format!(
                    "import express from 'express';\n\nconst app = express();\napp.use(express.json());\n\napp.get('/health', (_req, res) => {{\n  res.json({{ status: 'ok', app: '{}' }});\n}});\n\nconst PORT = process.env.PORT || 3000;\napp.listen(PORT, () => {{\n  console.log(`Server running on http://127.0.0.1:${{PORT}}`);\n}});\n",
                    app_name
                ),
            ),
        ],
        "web-starter" => vec![
            (
                "index.html".to_string(),
                format!(
                    "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"UTF-8\" />\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />\n  <title>{}</title>\n  <link rel=\"stylesheet\" href=\"style.css\" />\n</head>\n<body>\n  <main class=\"card\">\n    <h1>{}</h1>\n    <p id=\"status\">Ready.</p>\n    <button id=\"action-btn\">Click Me</button>\n  </main>\n  <script src=\"app.js\"></script>\n</body>\n</html>\n",
                    app_name, app_name
                ),
            ),
            (
                "style.css".to_string(),
                "body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #161618; color: #eceef2; font-family: system-ui, sans-serif; }\n.card { padding: 32px; border: 1px solid #2b2d33; border-radius: 12px; background: #1e1f23; text-align: center; }\nbutton { padding: 8px 16px; border-radius: 6px; border: 1px solid #34363d; background: #eceef2; color: #121315; cursor: pointer; font-weight: 600; }\n".to_string(),
            ),
            (
                "app.js".to_string(),
                "let clicks = 0;\ndocument.getElementById('action-btn').addEventListener('click', () => {\n  clicks++;\n  document.getElementById('status').textContent = `Clicked ${clicks} time(s).`;\n});\n".to_string(),
            ),
        ],
        _ => return Err(format!("Unknown template: {}", template_id)),
    };

    let mut created = Vec::new();
    for (rel, content) in files {
        let target = root.join(&rel);
        if target.exists() {
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("mkdir failed: {}", e))?;
        }
        fs::write(&target, content).map_err(|e| format!("write failed ({}): {}", rel, e))?;
        created.push(rel);
    }

    Ok(created)
}
