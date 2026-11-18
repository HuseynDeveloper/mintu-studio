# Mintu Studio

**Standalone, Local-First & Security-Hardened AI Code IDE** built with **Tauri v2**, **Rust**, **TypeScript**, and **CodeMirror 6**.

Mintu Studio combines a fast native desktop editor, local & cloud AI coding agent, built-in terminal, Git workflow, MCP server integration, API Tester, SQLite/CSV Explorer, Live Localhost Preview, and a GitHub-powered Community Extension Marketplace — with zero telemetry and strict Rust-enforced workspace security.

---

## Key Features

### Autonomous AI Coding Agent
- **Local-First & Multi-Cloud AI**: Run local GGUF models (`llama-server`, Ollama, LM Studio) or connect to **Google Gemini**, **Anthropic Claude**, **OpenAI**, **DeepSeek**, **Groq**, **Mistral AI**, **xAI Grok**, **OpenRouter**, **Together AI**, **Perplexity Sonar**, **Cerebras**, **Cohere**, **Qwen**, **Kimi**, or unlimited **Custom OpenAI-Compatible Cloud Providers**.
- **Surgical Code Fixes & Diff-Before-Apply**: Automatically receives active file context, line numbers, and live diagnostics; supports targeted `<mintu_replace>` patches and full `<mintu_edit>` proposals with compact collapsible diff cards, live streaming file-write pills, 1-click **Apply**, **Revert**, and **Checkpoints**.
- **Context Picker (Paperclip Menu)**: Attach **Files**, **Folders**, **Mentions** (`@problems`, `@git`, `@terminal`, `@file`), **Actions** (Fix All Errors, Install Missing Package, Review Git, Generate Tests), or **Browser** (fetch web docs/URLs).
- **Local Permissions**: Granular `Ask` / `Allow` / `Deny` controls for AI web fetching (`fetch_url` / `web_search`) and package installation (`pip`, `npm`, `pnpm`, `yarn`, `uv`, `cargo`, `go`).
- **MCP (Model Context Protocol)**: Connect stdio-based external MCP servers and expose their tools safely to Mintu AI.

### Native IDE Experience
- **CodeMirror 6 Editor**: Multi-tab editing, split editor, live red/amber squiggly diagnostics across languages, **minimap with live error/warning markers**, Symbol Outline (`Ctrl+Shift+O`), Go to Definition (`F12`), Inline AI Edit (`Ctrl+K`), Selection Floating AI Bar, Ghost Text, Code Folding, Breadcrumbs, Local Timeline, and Quick Formatter (`Alt+Shift+F`).
- **Developer Tools Built In**: Multi-tab PowerShell/Shell Terminal with 1-click AI Error Fix, Workspace Compiler Check, TODO Scanner, Inline Git Blame, Git Diff & Branch Manager, Live Localhost Preview & Port Monitor, Postman-Lite API Tester (Rust `reqwest`, zero CORS), Read-Only SQLite & CSV/JSON Data Explorer, File Compare, and Project Templates.
- **Windows Shell Integration**: Built-in **Open with -> Mintu Studio** support for 36+ code file types and folder right-click menus, toggleable in **Settings -> General & Appearance**.
- **Fresh Sessions by Default**: Opens a clean workspace and fresh AI chat session on every launch (older chats stay in History), with optional toggles in Settings to restore the previous project or chat session.
- **4 Languages Built In**: Full interface localization in **Azerbaijani (`az`)**, **English (`en`)**, **Turkish (`tr`)**, and **Russian (`ru`)**.

### GitHub Community Extensions & Auto-Updater
- **Declarative Extensions Marketplace**: Browse, install, export, or submit community extensions (`marketplace/registry.json`) for snippets, AI rules, API templates, and terminal scripts — strictly declarative JSON with zero `eval`.
- **GitHub Releases Auto-Updater**: Checks GitHub Releases (`latest.json`), verifies SHA-256 checksums, and launches the installer cleanly.

---

## Security Architecture

- **Rust Workspace Sandbox**: All filesystem operations are canonicalized and confined strictly to the opened project directory.
- **Sensitive File Protection**: `.env*`, `*.pem`, `*.key`, `id_rsa*`, `.ssh`, and credential/secret files are blocked in Rust and never sent to any AI model.
- **Prompt Injection Defense**: Project files, search outputs, and fetched web content are wrapped in `<untrusted_data>` tags.
- **Encrypted API Keys**: Stored in **Windows Credential Manager** and injected directly by the Rust backend.
- **SSRF Protection**: Web fetching blocks localhost and private network ranges.

See [SECURITY.md](./SECURITY.md) for full details.

---

## Download & Installation (Windows x64)

1. Download the latest `Mintu Studio_<version>_x64-setup.exe` from the [GitHub Releases](https://github.com/HuseynDeveloper/mintu-studio/releases) page.
2. *(Optional)* Verify the installer SHA-256 hash against `latest.json` included in the release:
   ```powershell
   Get-FileHash ".\Mintu Studio_0.1.0_x64-setup.exe" -Algorithm SHA256
   ```
3. Run the installer. Because community builds are not yet EV code-signed, Windows SmartScreen may show a warning on first launch — click **More info -> Run anyway** after verifying the SHA-256 hash.

---

## Build From Source

### Prerequisites
- **Node.js** 20+
- **Rust** stable toolchain (`cargo`, `rustc`)
- **Tauri v2** system prerequisites (WebView2 on Windows)

### Development & Verification

```bash
npm install
npx tsc --noEmit
npm test
npx tauri dev
```

### Production Release + NSIS Installer

```bash
npx tauri build --bundles nsis
node scripts/prepare-release.mjs --repo <owner>/<repo> --notes "Release notes"
```

---

## Licensing

Mintu Studio uses a **Split Open-Source License** designed to protect the core IDE while keeping community extensions frictionless:

| Scope | License | Details |
| --- | --- | --- |
| **Mintu Studio Core IDE** (`src/`, `src-tauri/`, `tests/`, `scripts/`) | **GNU GPL-3.0-only** | See [LICENSE](./LICENSE). Copyleft: modifications distributed to others must remain open-source under GPL-3.0. |
| **Community Extensions Marketplace** (`marketplace/`) | **MIT License** | See [marketplace/LICENSE-MIT](./marketplace/LICENSE-MIT). Permissive for community and commercial extensions. |

---

## Contributing

Pull requests, translations, bug reports, and Marketplace extensions are welcome! Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a PR.
