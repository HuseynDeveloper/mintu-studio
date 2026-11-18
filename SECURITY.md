# Security Policy

Security and developer privacy are foundational design principles of **Mintu Studio**.

## Built-in Security Architecture

| Layer | Enforcement |
| --- | --- |
| **Workspace Sandbox (Rust Backend)** | All file reads, writes, renames, deletions, and grep searches are canonicalized and strictly confined to the opened project root. Path traversal (`..`), drive switches, UNC paths, and symlink escapes are blocked in Rust. |
| **Sensitive File Blocking** | `.env*`, `*.pem`, `*.key`, `id_rsa*`, `.ssh`, and credential/secret files are blocked from being read, written, or sent to any AI model. |
| **Prompt Injection Defense** | Project files, search outputs, and fetched web content are wrapped in `<untrusted_data>` envelopes. |
| **Encrypted API Keys** | Cloud provider API keys are stored in **Windows Credential Manager** and injected directly by the Rust backend — never exposed to renderer `localStorage`. |
| **Local Permissions & Human Approval** | File edits show a Diff before apply, terminal commands and MCP tools require explicit user approval, and web fetching (`fetch_url` / `web_search`) and package installation (`install_package`) are governed by **Settings -> Security & Data -> Local Permissions** (`Ask` / `Allow` / `Deny`). |
| **SSRF Protection** | Web fetching blocks loopback and private network addresses (`localhost`, `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`). |
| **Declarative-Only Extensions** | Community extensions cannot execute arbitrary JavaScript. |

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, report vulnerabilities privately via GitHub **Security Advisories** ("Report a vulnerability" in the repository Security tab) with:
1. A clear description of the issue and affected component (`src/` or `src-tauri/`)
2. Minimal reproduction steps or proof-of-concept
3. Potential impact

We aim to acknowledge reports within 48 hours and release a verified patch promptly.
