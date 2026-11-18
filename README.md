<div align="center">

<img src="src-tauri/icons/128x128@2x.png" alt="Mintu Studio Logo" width="88" height="88" />

# Mintu Studio

**Standalone, Local-First & Security-Hardened AI Code IDE**

*Built with Tauri v2, Rust, TypeScript, and CodeMirror 6 — fast native performance (~5 MB installer), zero telemetry, local & multi-cloud AI, and Rust-enforced workspace security.*

<p>
  <a href="https://github.com/HuseynDeveloper/mintu-studio/releases/latest">
    <img src="https://img.shields.io/github/v/release/HuseynDeveloper/mintu-studio?style=for-the-badge&color=3DDC97&labelColor=161719&label=Download" alt="Latest Release" />
  </a>
  <a href="./LICENSE">
    <img src="https://img.shields.io/badge/Core%20License-GPL--3.0-blue?style=for-the-badge&labelColor=161719" alt="GPL-3.0 License" />
  </a>
  <a href="./marketplace/LICENSE-MIT">
    <img src="https://img.shields.io/badge/Marketplace-MIT-lightgrey?style=for-the-badge&labelColor=161719" alt="MIT Marketplace License" />
  </a>
  <img src="https://img.shields.io/badge/Platform-Windows%20x64-1E1F23?style=for-the-badge&labelColor=161719" alt="Windows x64" />
  <img src="https://img.shields.io/badge/Installer-~5%20MB-1E1F23?style=for-the-badge&labelColor=161719" alt="5 MB Installer" />
</p>

<p>
  <a href="#why-mintu-studio">Why Mintu Studio</a> |
  <a href="#comparison">Comparison</a> |
  <a href="#complete-feature-overview">Features</a> |
  <a href="#security-architecture">Security</a> |
  <a href="#download--installation">Download</a> |
  <a href="#build-from-source">Build</a> |
  <a href="#licensing">License</a>
</p>

</div>

---

## Why Mintu Studio?

Modern AI IDEs often weigh 200–500 MB (Electron), lock you into a single vendor subscription, collect telemetry, and silently send sensitive project files to remote servers.

**Mintu Studio** takes a fundamentally different approach:

| Pillar | What Makes Mintu Studio Different |
| --- | --- |
| **Ultra-Light Native Footprint (~5 MB)** | Powered by **Tauri v2 + Rust** instead of Electron, using native WebView2 and low RAM. |
| **Zero Vendor Lock-In** | Run **100% offline local GGUF models** (`llama-server`, Ollama, LM Studio) OR bring your own API key across **14 built-in Cloud AI providers** and **unlimited Custom OpenAI-compatible endpoints**. |
| **Security Enforced in Rust** | Workspace sandboxing, `.env`/private-key blocking, Windows Credential Manager encryption, SSRF protection, and `<untrusted_data>` prompt-injection envelopes are enforced directly in the Rust backend. |
| **All-in-One Engineering Workbench** | Code Editor, Autonomous AI Agent, Multi-Tab Terminal, Git Manager, MCP Client, Postman-Lite API Tester, Read-Only SQLite/CSV Explorer, Live Localhost Preview & Port Monitor, and Community Extension Marketplace — all inside one unified dark desktop app. |

---

## Comparison

| Capability | Mintu Studio | Cursor / Windsurf | Standard VS Code |
| --- | --- | --- | --- |
| **Runtime & Installer Size** | Tauri v2 + Rust (**~5 MB**) | Electron (~150–300 MB) | Electron (~100–140 MB) |
| **Core Source Code** | **100% Open-Source (GPL-3.0)** | Closed-Source | Open Core (Proprietary binaries) |
| **Telemetry / Tracking** | **Zero telemetry** | Telemetry / Cloud sync | Telemetry enabled by default |
| **Offline Local GGUF Manager** | Built-in downloader + `llama-server` + Ollama/LM Studio | Limited / BYOK proxy | Requires extensions |
| **Cloud AI Providers (BYOK)** | **14 built-in + Custom Cloud Creator** | Vendor-managed / Limited | Requires extensions |
| **Rust-Enforced `.env` & Key Blocking** | **Always-on in Rust backend** | Best-effort ignore files | Extension-dependent |
| **API Key Storage** | **Windows Credential Manager** (never in renderer) | App storage / Cloud | Extension-dependent |
| **Local Permissions (`Ask / Allow / Deny`)** | Built-in for Web Fetch & Package Install | Auto / Prompt | Extension-dependent |
| **Built-in API Tester, SQLite Viewer, Port Monitor** | **Native, zero plugins needed** | Requires extensions | Requires extensions |
| **Declarative Zero-`eval` Extensions** | **GitHub-synced JSON Marketplace** | JS/Node runtime | JS/Node runtime |
| **Multilingual UI** | **AZ / EN / TR / RU** (100% parity) | English-first | Language packs |

---

## Complete Feature Overview

### 1. Autonomous AI Coding Agent (`Ask` / `Plan` / `Code` Modes)

**Live Active-File & Diagnostic Awareness**
Automatically supplies the open editor file (with exact line numbers) and live syntax/compiler errors so you can simply say *"fix line 14"* or paste a screenshot without manual file attachment.

**Surgical Patches & Self-Healing Retries**
Supports targeted `<mintu_replace>` (`SEARCH/REPLACE` and `start_line..end_line` ranges) plus `<mintu_edit>` full file creation/rewrites. If a search hunk misses, the agent automatically self-corrects on the next turn.

**Clean Streaming UX**
Live file-writing progress pills (`Writing file: src/app.ts | 42 L [View Code]`) hide raw code walls while streaming. Finished changes render as compact collapsible diff cards with `+added / -removed` stats, 1-click **View Code**, **Apply**, **Apply All**, **Revert**, and **Multi-File Checkpoints**. Smart Auto-Scroll never pulls you back down when you scroll up during streaming, and every AI code or terminal block has a CSP-safe Copy button.

**Context Picker (Paperclip Menu)**

| Category | Capability |
| --- | --- |
| **Files** | Attach active file, upload images/screenshots (drag-and-drop & clipboard paste), or search & attach any workspace file. |
| **Folders** | Attach a folder's directory structure cleanly to context. |
| **Mentions** | Instant `@problems` (live diagnostics), `@git` (current Git diff), `@terminal` (recent terminal output), `@file`, and `@url https://...`. |
| **Actions** | 1-click workflows: *Fix All Code Errors*, *Find & Install Missing Package*, *Review Git Changes*, *Generate Tests*, *Optimize File*. |
| **Browser** | Fetch documentation, GitHub raw files, PyPI, or npm pages directly into chat context via Rust. |

**Slash Commands & Multi-Session History**
Built-in `/review`, `/security`, `/optimize`, `/docs`, `/tests`, `/explain`, `/fix-all`, custom user slash prompts, chat compaction, Markdown `.md` export, and multi-session chat history.

---

### 2. Local & Cloud AI Engine

**Built-in Local GGUF Model Hub**
Curated catalog (coding, reasoning, general models) plus custom HuggingFace `.gguf` URL downloader, localized download review modal with disk & RAM compatibility indicators, manual launch controls (Context Size, CPU Threads, GPU Layers, Port), and automatic discovery of running **Ollama** and **LM Studio** servers.

**14 Built-in Cloud Providers + Custom Cloud Creator**
Google Gemini, Anthropic Claude, OpenAI, DeepSeek, Groq, Mistral AI, xAI Grok, OpenRouter, Together AI, Perplexity Sonar, Cerebras, Cohere, Qwen (DashScope), and Kimi (Moonshot) — plus **+ Add Custom Cloud Model** for unlimited OpenAI-compatible endpoints (Name, Base URL, Model ID, API Key) selectable straight from the topbar.

---

### 3. Native CodeMirror 6 Editor

**Live Diagnostics & Minimap Markers**
Real-time red/amber squiggly underlines across languages, live error & warning markers drawn directly on the Minimap, and Workspace Compiler Check (`devtools_check_project`).

**Editing & Navigation**
Multi-tab & Split Editor side-by-side view, Inline AI Edit (`Ctrl+K`), Floating Selection AI Bar (`Explain / Fix / Refactor / Tests / Chat`), Ghost Text inline completion, Symbol Outline (`Ctrl+Shift+O`), Go to Definition & References (`F12`), Quick File & Command Palette (`Ctrl+P` / `Ctrl+Shift+P`), Global Search & Replace, Code Folding, Breadcrumbs, Auto-Close Brackets, Quick Formatter (`Alt+Shift+F`), Local File Timeline, and Side-by-Side File Compare.

---

### 4. Built-In Engineering Tools

| Tool | Description |
| --- | --- |
| **Multi-Tab Terminal** | Native PowerShell/Shell tabs synced to workspace root, optional line timestamps, and **1-click "Fix with AI"** when a command fails. |
| **Git Manager** | Branch switcher & creation, live status, unified diff viewer, inline Git Blame in the status bar, commit/sync controls, and 1-click AI Code Review. |
| **MCP Servers** | Add, connect, and inspect stdio-based external MCP servers with approval-gated tool execution. |
| **API Tester (Postman-Lite)** | `GET / POST / PUT / PATCH / DELETE` and GraphQL requests via Rust `reqwest` (zero CORS), timing/headers/pretty JSON, history, and Extension templates. |
| **Live Preview & Port Monitor** | Inspect active listening local ports, preview localhost apps inside Mintu Studio, or stop stuck dev servers cleanly. |
| **Read-Only Data Explorer** | Inspect local SQLite databases (tables + read-only queries), CSV tables, and formatted JSON files. |
| **TODO Scanner & Templates** | Scan `TODO / FIXME / HACK / NOTE` across the project and scaffold starter project templates. |

---

### 5. GitHub Community Extensions & Auto-Updater

**GitHub Marketplace (`marketplace/registry.json`)**
Live sync from GitHub, install/toggle/uninstall extensions, import/export `.json`, and 1-click **Publish to GitHub** (copies JSON and opens a pre-filled Marketplace submission issue). Extensions are 100% declarative JSON (snippets, AI rules, API templates, terminal scripts) with zero `eval`.

**GitHub Releases Auto-Updater**
Automatic startup update check against `latest.json`, SHA-256 verification before launch, and 1-click installer download.

---

### 6. Windows Integration, Session Control & Settings

**Windows "Open with -> Mintu Studio"**
Automatic per-user (`HKCU`, no admin required) registration for 36+ code file extensions plus folder right-click **"Open with Mintu Studio"** — toggleable anytime in **Settings -> General & Appearance**.

**Fresh Sessions by Default**
Every launch starts with a clean empty workspace and fresh AI chat session (older chats stay safely in History). Users who prefer restoring their last project or previous AI chat session can enable either toggle in **Settings -> General & Appearance**.

**Live Settings & 4 Languages**
UI scale, smooth animations, compact explorer, status bar clock, delete confirmation, font family/size/line-height, cursor style (`line` / `block` / `underline`), tab size, word wrap, auto-save, trailing whitespace/final newline, terminal font/scrollback/timestamps, temperature, max agent steps, custom system prompt, `.minturules` project rules, Local Permissions, and full 4-language parity across **Azerbaijani (`az`)**, **English (`en`)**, **Turkish (`tr`)**, and **Russian (`ru`)**.

---

## Architecture

```
+-----------------------------------------------------------------------+
|                    Frontend Renderer (TypeScript)                     |
|  CodeMirror 6 | Mintu AI Chat | Diff/Proposals | Full-Page Views      |
|  (Models, MCP, Extensions, API Tester, Preview/Ports, Data, Settings) |
+-----------------------------------+-----------------------------------+
                                    | Tauri v2 IPC (strict CSP)
+-----------------------------------v-----------------------------------+
|                      Rust Backend (src-tauri/)                        |
|  studio.rs     -> Sandboxed FS, Grep, Git, HTTP, SSRF-safe Web Fetch, |
|                   CLI Open-With Target, Windows Registry Integration  |
|  local_llm.rs  -> GGUF Downloader, llama-server, Local/Cloud Streams  |
|  credentials.rs-> Windows Credential Manager (Encrypted API Keys)     |
|  terminal.rs   -> Multi-tab PTY / Shell Process Manager               |
|  mcp.rs        -> Stdio MCP Client & Tool Execution                   |
|  extensions.rs -> Local Store + GitHub Marketplace Sync               |
|  devtools.rs   -> Compiler Check, TODO Scan, Blame, Ports, SQLite     |
|  updater.rs    -> GitHub Releases Check + SHA-256 Verified Install    |
+-----------------------------------------------------------------------+
```

---

## Security Architecture

Security is enforced at the Rust layer rather than relying on frontend trust:

| Protection | Mechanism |
| --- | --- |
| **Workspace Sandbox** | All read/write/create/rename/delete/grep operations are canonicalized inside the opened project root; `..`, symlink escapes, UNC paths, and drive switches are rejected. |
| **Sensitive File Blocking** | `.env*`, `*.pem`, `*.key`, `id_rsa*`, `.ssh`, and credential/secret files are strictly excluded from reads, writes, search, and AI context. |
| **Prompt Injection Isolation** | Workspace files, grep results, and fetched web pages are enclosed in `<untrusted_data>` envelopes. |
| **Encrypted Credentials** | Cloud API keys are saved in **Windows Credential Manager** and attached to outbound requests directly in Rust. |
| **Local Permissions** | `Settings -> Security & Data -> Local Permissions` governs AI web fetching (`fetch_url` / `web_search`) and package installation (`install_package`) with `Ask` (safe default), `Allow`, or `Deny`. |
| **SSRF Guard** | Web fetching blocks `localhost`, `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, and `::1`. |
| **Strict CSP & Zero `eval`** | No inline `onclick` handlers; declarative JSON-only extensions. |

See [SECURITY.md](./SECURITY.md) for vulnerability reporting and full security documentation.

---

<details>
<summary><strong>Keyboard Shortcuts & Supported File Extensions (click to expand)</strong></summary>

### Essential Shortcuts
| Shortcut | Action |
| --- | --- |
| `Ctrl+P` | Quick File Open |
| `Ctrl+Shift+P` | Command Palette |
| `Ctrl+K` | Inline AI Edit on selection/cursor |
| `Ctrl+L` | Toggle Mintu AI Chat panel |
| `Ctrl+S` | Save active file |
| `Ctrl+Shift+O` | Symbol Outline |
| `F12` | Go to Definition / References |
| `Alt+Shift+F` | Format active file |
| `F11` | Toggle Fullscreen |

### Registered Windows "Open with" Extensions (36+)
`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`, `.rs`, `.go`, `.c`, `.cpp`, `.h`, `.hpp`, `.java`, `.cs`, `.php`, `.rb`, `.lua`, `.json`, `.yaml`, `.yml`, `.toml`, `.xml`, `.csv`, `.html`, `.htm`, `.css`, `.scss`, `.vue`, `.svelte`, `.md`, `.txt`, `.sql`, `.sh`, `.ps1`, `.bat` — plus folder right-click **Open with Mintu Studio**.

</details>

---

## Download & Installation

### Windows (x64)
1. Download the latest installer (`Mintu Studio_0.1.0_x64-setup.exe`, ~5 MB) from [GitHub Releases](https://github.com/HuseynDeveloper/mintu-studio/releases).
2. *(Recommended)* Verify the SHA-256 hash against `latest.json`:
   ```powershell
   Get-FileHash ".\Mintu Studio_0.1.0_x64-setup.exe" -Algorithm SHA256
   ```
3. Run the installer. Because community builds are not yet EV code-signed, Windows SmartScreen may show a warning on first launch — verify the SHA-256 checksum and click **More info -> Run anyway**.

---

## Build From Source

### Prerequisites
**Node.js 20+**, **Rust stable toolchain (`cargo`, `rustc`)**, and **Tauri v2 prerequisites** (WebView2 Runtime on Windows).

### Develop & Test

```bash
git clone https://github.com/HuseynDeveloper/mintu-studio.git
cd mintu-studio
npm install

# Typecheck & run automated unit tests (i18n parity, CSS token audit, toolParser, security filter)
npx tsc --noEmit
npm test

# Verify Rust backend
cd src-tauri && cargo check && cd ..

# Launch desktop app in dev mode
npx tauri dev
```

### Build Production Release & NSIS Installer

```bash
npx tauri build --bundles nsis
node scripts/prepare-release.mjs --repo HuseynDeveloper/mintu-studio --notes "Release notes"
```

---

## Contributing

Contributions, translations, bug reports, and Community Marketplace extensions are warmly welcome!
Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a Pull Request, or submit declarative extensions directly via Mintu Studio (**Extensions -> Create Extension -> Publish to GitHub**) or a PR editing [marketplace/registry.json](./marketplace/registry.json).

---

## Licensing

Mintu Studio uses a **Split Open-Source License** that protects the core IDE while keeping community extensions completely frictionless:

| Scope | License | Purpose |
| --- | --- | --- |
| **Mintu Studio Core IDE** (`src/`, `src-tauri/`, `tests/`, `scripts/`) | **GNU GPL-3.0-only** ([LICENSE](./LICENSE)) | Strong copyleft: distributed modifications to the IDE must remain open-source under GPL-3.0. |
| **Community Extensions Marketplace** (`marketplace/`) | **MIT License** ([marketplace/LICENSE-MIT](./marketplace/LICENSE-MIT)) | Permissive license so developers and teams can freely build and share extensions. |

---

<div align="center">
  Built with care by <a href="https://github.com/HuseynDeveloper">HuseynDeveloper</a> and the Mintu Studio community.
</div>
