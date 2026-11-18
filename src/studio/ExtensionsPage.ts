/**
 * ExtensionsPage.ts
 * Dedicated full-screen Mintu Extensions Marketplace & Manager.
 * All extensions are strictly declarative JSON manifests (no eval/arbitrary JS):
 * - Snippets (contributed live to CodeMirror Ctrl+Space autocomplete)
 * - AI Rules (contributed live to Mintu AI system prompt)
 * - Commands (contributed live to Command Palette & Bottom Panel Scripts)
 * - API Templates (contributed live to built-in HTTP/API Tester)
 */

import { invoke } from "@tauri-apps/api/core";
import { copyTextReliable } from "../ai/MarkdownRenderer";
import { studioSettings } from "./StudioSettings";
import { t } from "./i18n";

export interface ExtensionSnippet {
  prefix: string;
  label: string;
  body: string;
  languages: string[];
}

export interface ExtensionCommand {
  id: string;
  label: string;
  command: string;
}

export interface ExtensionApiTemplate {
  name: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface MintuExtension {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  category: string;
  enabled: boolean;
  ai_rules: string[];
  snippets: ExtensionSnippet[];
  commands: ExtensionCommand[];
  api_templates: ExtensionApiTemplate[];
}

const BUILTIN_MARKETPLACE: MintuExtension[] = [
  {
    id: "mintu-react-tailwind",
    name: "React & TypeScript Snippets Pro",
    version: "1.2.0",
    author: "Mintu Team",
    description: "Modern React functional components, hooks, strict TypeScript interfaces, and clean component architecture rules.",
    category: "Frontend",
    enabled: true,
    ai_rules: [
      "When writing React components, prefer functional components with explicit TypeScript Props interfaces and accessible semantic HTML.",
    ],
    snippets: [
      {
        prefix: "rfc",
        label: "React Functional Component (TSX)",
        body: "import React from 'react';\n\ninterface Props {\n  title: string;\n}\n\nexport const Component: React.FC<Props> = ({ title }) => {\n  return (\n    <section>\n      <h2>{title}</h2>\n    </section>\n  );\n};\n",
        languages: ["ts", "tsx", "js", "jsx"],
      },
      {
        prefix: "ust",
        label: "React useState Hook",
        body: "const [value, setValue] = useState<string>('');",
        languages: ["ts", "tsx", "js", "jsx"],
      },
      {
        prefix: "uef",
        label: "React useEffect Hook",
        body: "useEffect(() => {\n  // effect\n  return () => {\n    // cleanup\n  };\n}, []);",
        languages: ["ts", "tsx", "js", "jsx"],
      },
    ],
    commands: [
      { id: "react-typecheck", label: "TypeScript Check (tsc --noEmit)", command: "npx tsc --noEmit" },
    ],
    api_templates: [],
  },
  {
    id: "mintu-python-fastapi",
    name: "Python & FastAPI Kit",
    version: "1.1.0",
    author: "Mintu Team",
    description: "FastAPI endpoints, Pydantic v2 models, pytest templates, and Python typing best practices.",
    category: "Backend",
    enabled: true,
    ai_rules: [
      "When writing Python code, always include full type annotations (typing / PEP 604) and clear docstrings.",
    ],
    snippets: [
      {
        prefix: "fapi",
        label: "FastAPI Route Handler",
        body: "@app.get('/items/{item_id}')\nasync def read_item(item_id: int) -> dict:\n    return {'item_id': item_id}\n",
        languages: ["py"],
      },
      {
        prefix: "pmodel",
        label: "Pydantic BaseModel",
        body: "class ItemSchema(BaseModel):\n    id: int\n    name: str\n    active: bool = True\n",
        languages: ["py"],
      },
      {
        prefix: "pymain",
        label: "Python Main Guard",
        body: "def main() -> None:\n    pass\n\nif __name__ == '__main__':\n    main()\n",
        languages: ["py"],
      },
    ],
    commands: [
      { id: "py-pytest", label: "Run Pytest", command: "pytest -v" },
      { id: "py-venv", label: "Create Python venv", command: "python -m venv .venv" },
    ],
    api_templates: [
      {
        name: "FastAPI Local Healthcheck",
        method: "GET",
        url: "http://127.0.0.1:8000/health",
        headers: { Accept: "application/json" },
        body: "",
      },
    ],
  },
  {
    id: "mintu-rust-systems",
    name: "Rust & Tauri Essentials",
    version: "1.0.0",
    author: "Mintu Team",
    description: "Idiomatic Rust Result/Option patterns, Tauri command boilerplate, and Cargo check commands.",
    category: "Systems",
    enabled: true,
    ai_rules: [
      "In Rust, avoid unwrap()/expect() in production paths; return Result<T, String> or proper error types.",
    ],
    snippets: [
      {
        prefix: "tcmd",
        label: "Tauri Command Function",
        body: "#[tauri::command]\npub async fn my_command(input: String) -> Result<String, String> {\n    Ok(input)\n}\n",
        languages: ["rs"],
      },
      {
        prefix: "rtest",
        label: "Rust Unit Test Module",
        body: "#[cfg(test)]\nmod tests {\n    use super::*;\n\n    #[test]\n    fn it_works() {\n        assert_eq!(2 + 2, 4);\n    }\n}\n",
        languages: ["rs"],
      },
    ],
    commands: [
      { id: "rs-check", label: "Cargo Check", command: "cargo check" },
      { id: "rs-test", label: "Cargo Test", command: "cargo test" },
    ],
    api_templates: [],
  },
  {
    id: "mintu-security-auditor",
    name: "OWASP Security Auditor Rules",
    version: "1.3.0",
    author: "Mintu Security",
    description: "Enforces strict XSS, SQLi, SSRF, and secrets-hygiene rules whenever Mintu AI writes or reviews code.",
    category: "Security",
    enabled: true,
    ai_rules: [
      "Always validate and sanitize external inputs, use parameterized SQL queries, never hardcode credentials, and escape untrusted HTML output.",
      "Prefer strict allowlists over blocklists when handling file paths, URLs, or shell arguments.",
    ],
    snippets: [
      {
        prefix: "tryc",
        label: "Safe Try / Catch Block",
        body: "try {\n  // operation\n} catch (error) {\n  console.error('Operation failed:', error);\n}",
        languages: ["ts", "tsx", "js", "jsx"],
      },
    ],
    commands: [
      { id: "npm-audit", label: "NPM Security Audit", command: "npm audit" },
    ],
    api_templates: [],
  },
  {
    id: "mintu-api-starter",
    name: "REST & Webhook API Templates",
    version: "1.0.0",
    author: "Mintu Team",
    description: "Ready-to-use HTTP/REST test templates (JSONPlaceholder, HTTPBin, Localhost GraphQL) for the built-in API Tester.",
    category: "API",
    enabled: true,
    ai_rules: [],
    snippets: [
      {
        prefix: "fetchj",
        label: "Async Fetch JSON Helper",
        body: "const res = await fetch(url, {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify(payload),\n});\nif (!res.ok) throw new Error(`HTTP ${res.status}`);\nconst data = await res.json();",
        languages: ["ts", "tsx", "js", "jsx"],
      },
    ],
    commands: [],
    api_templates: [
      {
        name: "GET Sample Post (JSONPlaceholder)",
        method: "GET",
        url: "https://jsonplaceholder.typicode.com/posts/1",
        headers: { Accept: "application/json" },
        body: "",
      },
      {
        name: "POST Echo JSON (HTTPBin)",
        method: "POST",
        url: "https://httpbin.org/post",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hello: "Mintu Studio", ok: true }, null, 2),
      },
      {
        name: "Local Ollama Tags Check",
        method: "GET",
        url: "http://127.0.0.1:11434/api/tags",
        headers: { Accept: "application/json" },
        body: "",
      },
    ],
  },
  {
    id: "mintu-git-workflow",
    name: "Git & Clean Code Pack",
    version: "1.0.0",
    author: "Mintu Team",
    description: "Quick Git inspection commands and Conventional Commits guidance for clean repository history.",
    category: "Workflow",
    enabled: true,
    ai_rules: [
      "Keep diffs minimal, modular, and focused strictly on the requested feature or bug fix.",
    ],
    snippets: [],
    commands: [
      { id: "git-st", label: "Git Status Short", command: "git status -sb" },
      { id: "git-lg", label: "Git Log Graph (15)", command: "git log --oneline --graph -n 15" },
    ],
    api_templates: [],
  },
];

export type ExtensionsSubTab = "store" | "installed" | "create";

export class ExtensionsPage {
  private container: HTMLElement;
  private activeTab: ExtensionsSubTab = "store";
  private searchQuery = "";
  private installed: MintuExtension[] = [];
  private remoteMarketplace: MintuExtension[] = [];
  private marketplaceSource = "Built-in";
  private loadingMarketplace = false;
  private notice: { type: "info" | "error"; text: string } | null = null;

  public onBackToWorkspace?: () => void;
  public onExtensionsChanged?: (installed: MintuExtension[]) => void;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  public async loadInstalled(): Promise<MintuExtension[]> {
    try {
      this.installed = await invoke<MintuExtension[]>("ext_list_installed");
    } catch {
      this.installed = [];
    }
    this.onExtensionsChanged?.(this.installed);
    return this.installed;
  }

  public async refreshRemoteMarketplace(): Promise<void> {
    const repo = (studioSettings.get().githubRepo || "HuseynDeveloper/mintu-studio").trim();
    this.loadingMarketplace = true;
    this.render();
    try {
      const list = await invoke<MintuExtension[]>("ext_fetch_remote_marketplace", { repo });
      this.remoteMarketplace = list;
      this.marketplaceSource = `GitHub (${repo}) + Built-in`;
    } catch {
      this.remoteMarketplace = [];
      this.marketplaceSource = "Built-in (Offline)";
    } finally {
      this.loadingMarketplace = false;
      this.render();
    }
  }

  private getMergedMarketplace(): MintuExtension[] {
    const map = new Map<string, MintuExtension>();
    for (const ext of BUILTIN_MARKETPLACE) {
      map.set(ext.id, ext);
    }
    for (const ext of this.remoteMarketplace) {
      map.set(ext.id, ext);
    }
    return Array.from(map.values());
  }

  private exportExtensionJson(ext: MintuExtension): void {
    const blob = new Blob([JSON.stringify(ext, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${ext.id}.mintu-extension.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private async publishExtensionToGitHub(ext: MintuExtension): Promise<void> {
    const repo = (studioSettings.get().githubRepo || "HuseynDeveloper/mintu-studio").trim();
    const json = JSON.stringify(ext, null, 2);
    await copyTextReliable(json);
    const title = encodeURIComponent(`[Extension Submission] ${ext.name} (${ext.id})`);
    const body = encodeURIComponent(
      `### Mintu Studio Community Extension Submission\n\nAdd the following JSON entry to \`marketplace/registry.json\`:\n\n\`\`\`json\n${json}\n\`\`\`\n`
    );
    const url = `https://github.com/${repo}/issues/new?title=${title}&body=${body}`;
    window.open(url, "_blank", "noopener,noreferrer");
    this.notice = {
      type: "info",
      text: `${ext.name} JSON copied to clipboard and GitHub Marketplace submission opened (${repo}).`,
    };
    this.render();
  }

  public getInstalled(): MintuExtension[] {
    return this.installed;
  }

  public async show(tab: ExtensionsSubTab = "store"): Promise<void> {
    this.activeTab = tab;
    this.notice = null;
    await this.loadInstalled();
    this.render();
    if (tab === "store" && this.remoteMarketplace.length === 0) {
      void this.refreshRemoteMarketplace();
    }
  }

  private render(): void {
    const installedMap = new Map<string, MintuExtension>();
    for (const ext of this.installed) {
      installedMap.set(ext.id, ext);
    }

    const q = this.searchQuery.trim().toLowerCase();

    const renderMetaPills = (ext: MintuExtension) => {
      const parts: string[] = [];
      if (ext.snippets.length) parts.push(`<span class="model-meta-pill">${ext.snippets.length} ${t("extSnippetsCount")}</span>`);
      if (ext.ai_rules.length) parts.push(`<span class="model-meta-pill">${ext.ai_rules.length} ${t("extRulesCount")}</span>`);
      if (ext.commands.length) parts.push(`<span class="model-meta-pill">${ext.commands.length} ${t("extCommandsCount")}</span>`);
      if (ext.api_templates.length) parts.push(`<span class="model-meta-pill">${ext.api_templates.length} ${t("extApiCount")}</span>`);
      return parts.join("");
    };

    let bodyHtml = "";

    if (this.activeTab === "store") {
      const mergedCatalog = this.getMergedMarketplace();
      const list = mergedCatalog.filter((e) => {
        if (!q) return true;
        return `${e.name} ${e.description} ${e.category} ${e.author}`.toLowerCase().includes(q);
      });

      const cards = list
        .map((ext) => {
          const inst = installedMap.get(ext.id);
          const actions = inst
            ? `
              <span class="model-meta-pill pill-installed">${t("extInstalled")}</span>
              <button type="button" class="studio-btn studio-btn-sm" data-ext-toggle="${this.escapeAttr(ext.id)}" data-next-en="${inst.enabled ? "0" : "1"}">${inst.enabled ? t("extDisable") : t("extEnable")}</button>
              <button type="button" class="studio-btn studio-btn-sm studio-btn-danger" data-ext-remove="${this.escapeAttr(ext.id)}">${t("extUninstall")}</button>
            `
            : `<button type="button" class="studio-btn studio-btn-sm studio-btn-primary" data-ext-install="${this.escapeAttr(ext.id)}">${t("extInstall")}</button>`;

          return `
            <div class="local-model-card ${inst?.enabled ? "is-active-card" : ""}">
              <div class="local-model-top">
                <div class="local-model-title-group">
                  <span class="local-model-name">${this.escapeHtml(ext.name)}</span>
                  <span class="model-meta-pill">v${this.escapeHtml(ext.version)}</span>
                  <span class="model-meta-pill">${this.escapeHtml(ext.category)}</span>
                  <span class="model-meta-pill">${this.escapeHtml(ext.author)}</span>
                  ${renderMetaPills(ext)}
                </div>
                <div class="local-model-actions">${actions}</div>
              </div>
              <div class="local-model-desc">${this.escapeHtml(ext.description)}</div>
            </div>
          `;
        })
        .join("");

      bodyHtml = `
        <div class="page-content-narrow tab-switch-enter">
          <div class="ext-toolbar-row">
            <input type="text" id="ext-search-input" class="studio-input" placeholder="${t("extSearchPlaceholder")}" value="${this.escapeAttr(this.searchQuery)}" autocomplete="off" />
            <span class="model-meta-pill">${this.escapeHtml(this.marketplaceSource)}</span>
            <button type="button" class="studio-btn studio-btn-sm" id="btn-ext-sync-gh" ${this.loadingMarketplace ? "disabled" : ""}>${this.loadingMarketplace ? "..." : t("extSyncGithub")}</button>
            <button type="button" class="studio-btn studio-btn-sm" id="btn-ext-import-json">${t("extImportJson")}</button>
          </div>
          ${this.notice ? `<div class="${this.notice.type === "error" ? "mcp-error-banner" : "form-hint"}">${this.escapeHtml(this.notice.text)}</div>` : ""}
          <div class="local-models-list">${cards || `<div class="bottom-empty">${t("noModelsInFilter")}</div>`}</div>
        </div>
      `;
    } else if (this.activeTab === "installed") {
      const cards = this.installed
        .map((ext) => {
          return `
            <div class="local-model-card ${ext.enabled ? "is-active-card" : ""}">
              <div class="local-model-top">
                <div class="local-model-title-group">
                  <span class="local-model-name">${this.escapeHtml(ext.name)}</span>
                  <span class="model-meta-pill">v${this.escapeHtml(ext.version)}</span>
                  <span class="model-meta-pill">${this.escapeHtml(ext.category)}</span>
                  ${renderMetaPills(ext)}
                </div>
                <div class="local-model-actions">
                  <button type="button" class="studio-btn studio-btn-sm" data-ext-export="${this.escapeAttr(ext.id)}">${t("extExportJson")}</button>
                  <button type="button" class="studio-btn studio-btn-sm studio-btn-primary" data-ext-publish="${this.escapeAttr(ext.id)}">${t("extPublishGithub")}</button>
                  <button type="button" class="studio-btn studio-btn-sm" data-ext-toggle="${this.escapeAttr(ext.id)}" data-next-en="${ext.enabled ? "0" : "1"}">${ext.enabled ? t("extDisable") : t("extEnable")}</button>
                  <button type="button" class="studio-btn studio-btn-sm studio-btn-danger" data-ext-remove="${this.escapeAttr(ext.id)}">${t("extUninstall")}</button>
                </div>
              </div>
              <div class="local-model-desc">${this.escapeHtml(ext.description)}</div>
            </div>
          `;
        })
        .join("");

      bodyHtml = `
        <div class="page-content-narrow tab-switch-enter">
          <div class="ext-toolbar-row">
            <span class="settings-block-title" style="margin:0;">${t("extTabInstalled")} (${this.installed.length})</span>
            <button type="button" class="studio-btn studio-btn-sm" id="btn-ext-import-json">${t("extImportJson")}</button>
          </div>
          ${this.notice ? `<div class="${this.notice.type === "error" ? "mcp-error-banner" : "form-hint"}">${this.escapeHtml(this.notice.text)}</div>` : ""}
          <div class="local-models-list">${cards || `<div class="bottom-empty">${t("extNoInstalled")}</div>`}</div>
        </div>
      `;
    } else {
      bodyHtml = `
        <div class="page-content-narrow tab-switch-enter">
          <div class="settings-card-block">
            <div class="settings-block-title">${t("extCreateTitle")}</div>
            <div class="form-hint">${t("extCreateHint")}</div>
            ${this.notice ? `<div class="${this.notice.type === "error" ? "mcp-error-banner" : "form-hint"}">${this.escapeHtml(this.notice.text)}</div>` : ""}

            <div class="mcp-form-grid">
              <div class="form-group">
                <label for="ext-c-name">${t("extNameLabel")}</label>
                <input id="ext-c-name" class="studio-input" type="text" placeholder="My Team Helper Pack" />
              </div>
              <div class="form-group">
                <label for="ext-c-author">${t("extAuthorLabel")}</label>
                <input id="ext-c-author" class="studio-input" type="text" placeholder="Community" />
              </div>
            </div>

            <div class="form-group">
              <label for="ext-c-desc">${t("extDescLabel")}</label>
              <input id="ext-c-desc" class="studio-input" type="text" placeholder="Custom snippets, AI rules, and commands" />
            </div>

            <div class="form-group">
              <label for="ext-c-rule">${t("extAiRuleLabel")}</label>
              <textarea id="ext-c-rule" class="studio-input studio-textarea" rows="2" placeholder="Always add unit tests for new functions..."></textarea>
            </div>

            <div class="mcp-form-grid">
              <div class="form-group">
                <label for="ext-c-snip-prefix">${t("extSnippetPrefixLabel")}</label>
                <input id="ext-c-snip-prefix" class="studio-input" type="text" placeholder="mylog" />
              </div>
              <div class="form-group">
                <label for="ext-c-cmd">${t("extCommandLabel")}</label>
                <input id="ext-c-cmd" class="studio-input" type="text" placeholder="npm run lint" />
              </div>
            </div>

            <div class="form-group">
              <label for="ext-c-snip-body">${t("extSnippetBodyLabel")}</label>
              <textarea id="ext-c-snip-body" class="studio-input studio-textarea" rows="3" placeholder="console.log('[DEBUG]', value);"></textarea>
            </div>

            <div class="settings-inline-actions">
              <button type="button" class="studio-btn studio-btn-primary" id="btn-ext-create-save">${t("extSaveBtn")}</button>
              <button type="button" class="studio-btn" id="btn-ext-import-json">${t("extImportJson")}</button>
            </div>
          </div>
        </div>
      `;
    }

    this.container.innerHTML = `
      <div class="full-page-shell page-enter">
        <div class="full-page-header">
          <div class="full-page-title-block">
            <button type="button" class="studio-btn studio-btn-sm" id="btn-ext-back">${t("backToEditor")}</button>
            <div>
              <h1 class="full-page-title">${t("extPageTitle")}</h1>
              <div class="full-page-subtitle">${t("extPageSubtitle")}</div>
            </div>
          </div>
          <div class="full-page-subtabs">
            <button type="button" class="full-subtab-btn ${this.activeTab === "store" ? "active" : ""}" data-ext-tab="store">${t("extTabStore")}</button>
            <button type="button" class="full-subtab-btn ${this.activeTab === "installed" ? "active" : ""}" data-ext-tab="installed">${t("extTabInstalled")} (${this.installed.length})</button>
            <button type="button" class="full-subtab-btn ${this.activeTab === "create" ? "active" : ""}" data-ext-tab="create">${t("extTabCreate")}</button>
          </div>
        </div>
        <div class="full-page-body">${bodyHtml}</div>
      </div>
    `;

    this.container.querySelector("#btn-ext-back")?.addEventListener("click", () => this.onBackToWorkspace?.());

    this.container.querySelectorAll<HTMLButtonElement>("[data-ext-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const next = btn.dataset.extTab as ExtensionsSubTab;
        if (next && next !== this.activeTab) {
          this.activeTab = next;
          this.notice = null;
          this.render();
        }
      });
    });

    const searchIn = this.container.querySelector("#ext-search-input") as HTMLInputElement | null;
    searchIn?.addEventListener("input", () => {
      this.searchQuery = searchIn.value;
      const pos = searchIn.selectionStart || this.searchQuery.length;
      this.render();
      const next = this.container.querySelector("#ext-search-input") as HTMLInputElement | null;
      if (next) {
        next.focus();
        next.setSelectionRange(pos, pos);
      }
    });

    this.container.querySelector("#btn-ext-import-json")?.addEventListener("click", async () => {
      try {
        const res = await invoke<MintuExtension | null>("ext_import_file");
        if (res) {
          this.notice = { type: "info", text: `${res.name} (${res.id}) imported.` };
          await this.loadInstalled();
          this.render();
        }
      } catch (e: any) {
        this.notice = { type: "error", text: String(e) };
        this.render();
      }
    });

    this.container.querySelector("#btn-ext-sync-gh")?.addEventListener("click", () => {
      void this.refreshRemoteMarketplace();
    });

    this.container.querySelectorAll<HTMLButtonElement>("[data-ext-export]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const ext = this.installed.find((e) => e.id === btn.dataset.extExport);
        if (ext) this.exportExtensionJson(ext);
      });
    });

    this.container.querySelectorAll<HTMLButtonElement>("[data-ext-publish]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const ext = this.installed.find((e) => e.id === btn.dataset.extPublish);
        if (ext) void this.publishExtensionToGitHub(ext);
      });
    });

    this.container.querySelectorAll<HTMLButtonElement>("[data-ext-install]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.extInstall;
        const item = this.getMergedMarketplace().find((e) => e.id === id);
        if (!item) return;
        try {
          this.installed = await invoke<MintuExtension[]>("ext_install", { extension: item });
          this.onExtensionsChanged?.(this.installed);
          this.notice = { type: "info", text: `${item.name} installed.` };
        } catch (e: any) {
          this.notice = { type: "error", text: String(e) };
        }
        this.render();
      });
    });

    this.container.querySelectorAll<HTMLButtonElement>("[data-ext-toggle]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.extToggle;
        const enabled = btn.dataset.nextEn === "1";
        if (!id) return;
        try {
          this.installed = await invoke<MintuExtension[]>("ext_toggle", { id, enabled });
          this.onExtensionsChanged?.(this.installed);
        } catch (e: any) {
          this.notice = { type: "error", text: String(e) };
        }
        this.render();
      });
    });

    this.container.querySelectorAll<HTMLButtonElement>("[data-ext-remove]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.extRemove;
        if (!id) return;
        try {
          this.installed = await invoke<MintuExtension[]>("ext_uninstall", { id });
          this.onExtensionsChanged?.(this.installed);
        } catch (e: any) {
          this.notice = { type: "error", text: String(e) };
        }
        this.render();
      });
    });

    this.container.querySelector("#btn-ext-create-save")?.addEventListener("click", async () => {
      const name = (this.container.querySelector("#ext-c-name") as HTMLInputElement)?.value.trim();
      const author = (this.container.querySelector("#ext-c-author") as HTMLInputElement)?.value.trim() || "User";
      const description = (this.container.querySelector("#ext-c-desc") as HTMLInputElement)?.value.trim() || "Custom Mintu Extension";
      const aiRule = (this.container.querySelector("#ext-c-rule") as HTMLTextAreaElement)?.value.trim();
      const snipPrefix = (this.container.querySelector("#ext-c-snip-prefix") as HTMLInputElement)?.value.trim();
      const snipBody = (this.container.querySelector("#ext-c-snip-body") as HTMLTextAreaElement)?.value;
      const cmdStr = (this.container.querySelector("#ext-c-cmd") as HTMLInputElement)?.value.trim();

      if (!name) {
        this.notice = { type: "error", text: "Extension name is required." };
        this.render();
        return;
      }

      const id = name.toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 48) || `custom-${Date.now()}`;
      const newExt: MintuExtension = {
        id,
        name,
        version: "1.0.0",
        author,
        description,
        category: "Custom",
        enabled: true,
        ai_rules: aiRule ? [aiRule] : [],
        snippets:
          snipPrefix && snipBody
            ? [{ prefix: snipPrefix, label: `${name}: ${snipPrefix}`, body: snipBody, languages: [] }]
            : [],
        commands: cmdStr ? [{ id: `${id}-cmd`, label: `${name}: ${cmdStr}`, command: cmdStr }] : [],
        api_templates: [],
      };

      try {
        this.installed = await invoke<MintuExtension[]>("ext_install", { extension: newExt });
        this.onExtensionsChanged?.(this.installed);
        this.activeTab = "installed";
        this.notice = { type: "info", text: `${name} created and enabled.` };
      } catch (e: any) {
        this.notice = { type: "error", text: String(e) };
      }
      this.render();
    });
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  private escapeAttr(str: string): string {
    return this.escapeHtml(str).replace(/"/g, "&quot;");
  }
}
