/**
 * BottomPanel.ts
 * Bottom workspace panel with tabs:
 * - Terminal (multi-tab interactive Windows PowerShell sessions + "Mintu AI ilə düzəlt")
 * - Kontekst (attached files with sizes and remove buttons)
 * - Fəaliyyət jurnalı (timestamped audit log of file reads, writes, sends, blocked sensitive files)
 * - Problemlər (errors and warnings)
 * - Axtarış (content grep search results when user presses Enter in search box)
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { studioSettings } from "./StudioSettings";
import { CodeDiagnosticItem } from "./CodeDiagnostics";
import { t } from "./i18n";
import { ICON_CLOSE, ICON_LOCK_RED, getFileIconSvg } from "./icons";

export type BottomTabId = "terminal" | "scripts" | "todos" | "context" | "activity" | "problems" | "search";

export interface ProjectScriptItem {
  source: string;
  name: string;
  command: string;
}

export interface TodoScanItem {
  tag: string;
  path: string;
  line_number: number;
  text: string;
}

export interface WorkspaceDiagItem {
  path: string;
  line: number;
  col: number;
  severity: "error" | "warning" | string;
  message: string;
}

export interface ContextFileSummary {
  path: string;
  sizeBytes: number;
}

export interface ActivityLogEntry {
  time: string;
  category: "read" | "send" | "blocked" | "system";
  message: string;
  detail?: string;
}

export interface ProblemEntry {
  time: string;
  severity: "error" | "warning";
  source: string;
  message: string;
}

export interface GrepMatchItem {
  path: string;
  line_number: number;
  line_text: string;
}

interface TerminalOutputEvent {
  session_id: number;
  stream: "stdout" | "stderr" | "system";
  data: string;
}

interface TerminalSessionInfo {
  running: boolean;
  session_id: number;
  cwd: string;
  shell: string;
}

interface TerminalChunk {
  stream: "stdout" | "stderr" | "system" | "cmd";
  text: string;
}

interface TerminalTabState {
  tabId: string;
  title: string;
  sessionId: number;
  running: boolean;
  cwd: string;
  shell: string;
  chunks: TerminalChunk[];
  history: string[];
  historyIdx: number;
  inputDraft: string;
  lastCommand: string;
  lastStderr: string;
}

export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

function nowTime(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export class BottomPanel {
  private container: HTMLElement;
  private activeTab: BottomTabId = "terminal";
  private contextFiles: ContextFileSummary[] = [];
  private activityLog: ActivityLogEntry[] = [];
  private problems: ProblemEntry[] = [];
  private codeDiagnostics: Map<string, CodeDiagnosticItem[]> = new Map();
  private workspaceDiagnostics: WorkspaceDiagItem[] = [];
  private workspaceCheckSummary = "";
  private checkingProject = false;
  private projectScripts: ProjectScriptItem[] = [];
  private extensionScripts: ProjectScriptItem[] = [];
  private todoItems: TodoScanItem[] = [];
  private todoFilter = "ALL";
  private searchQuery = "";
  private searchResults: GrepMatchItem[] = [];
  private isCollapsed = false;
  private animateTabSwitch = false;

  // Multi-tab Real Terminal state
  private termTabs: TerminalTabState[] = [];
  private activeTermTabId: string | null = null;
  private termCounter = 0;
  private termUnlistenOut: UnlistenFn | null = null;
  private termUnlistenExit: UnlistenFn | null = null;
  private currentProjectRoot: string | null = null;

  public onRemoveContextFile?: (path: string) => void;
  public onOpenContextFile?: (path: string, lineNumber?: number) => void;
  public onToggleCollapse?: (collapsed: boolean) => void;
  public onFixTerminalError?: (command: string, stderr: string, cwd: string) => void;
  public onFixDiagnosticError?: (path: string, line: number, message: string) => void;
  public onCheckProjectRequest?: () => Promise<void>;
  public onScanTodosRequest?: () => Promise<void>;
  public onGlobalReplaceRequest?: (query: string, replacement: string, paths: string[]) => Promise<void>;

  constructor(container: HTMLElement) {
    this.container = container;
    this.logActivity("system", "Mintu Studio hazırdır (Kod redaktəsi, Çoxtablı Terminal, Git, Yerli LLM və MCP aktivdir)");
    this.initTerminalListeners();
    this.render();
    void this.openNewTerminal();
    studioSettings.subscribe(() => {
      this.render();
    });
  }

  public setProjectScripts(scripts: ProjectScriptItem[]): void {
    this.projectScripts = scripts;
    if (this.activeTab === "scripts") this.render();
    else this.updateTabBadgesOnly();
  }

  public setExtensionScripts(scripts: ProjectScriptItem[]): void {
    this.extensionScripts = scripts;
    if (this.activeTab === "scripts") this.render();
    else this.updateTabBadgesOnly();
  }

  public async runCommandInTerminal(command: string): Promise<void> {
    this.setActiveTab("terminal");
    if (this.termTabs.length === 0) {
      await this.openNewTerminal();
    }
    await this.submitTerminalCommand(command);
  }

  public setTodos(items: TodoScanItem[]): void {
    this.todoItems = items;
    if (this.activeTab === "todos") this.render();
    else this.updateTabBadgesOnly();
  }

  public setWorkspaceDiagnostics(items: WorkspaceDiagItem[], summary = ""): void {
    this.workspaceDiagnostics = items;
    this.workspaceCheckSummary = summary;
    if (this.activeTab === "problems") this.render();
    else this.updateTabBadgesOnly();
  }

  public setCheckingProject(checking: boolean): void {
    this.checkingProject = checking;
    if (this.activeTab === "problems") this.render();
  }

  public setCodeDiagnostics(path: string, items: CodeDiagnosticItem[]): void {
    if (items.length === 0) {
      this.codeDiagnostics.delete(path);
    } else {
      this.codeDiagnostics.set(path, items);
    }
    if (this.activeTab === "problems") {
      this.render();
    } else {
      this.updateTabBadgesOnly();
    }
  }

  private getTotalProblemsCount(): number {
    let diagCount = 0;
    this.codeDiagnostics.forEach((arr) => {
      diagCount += arr.length;
    });
    return this.problems.length + diagCount + this.workspaceDiagnostics.length;
  }

  private getActiveTermTab(): TerminalTabState | null {
    if (!this.activeTermTabId) return this.termTabs[0] || null;
    return this.termTabs.find((t) => t.tabId === this.activeTermTabId) || this.termTabs[0] || null;
  }

  private async initTerminalListeners(): Promise<void> {
    try {
      this.termUnlistenOut = await listen<TerminalOutputEvent>("studio-terminal-output", (ev) => {
        const p = ev.payload;
        if (!p) return;
        const tab = this.termTabs.find((t) => t.sessionId === p.session_id);
        if (!tab) return;
        const clean = stripAnsi(p.data || "");
        if (!clean) return;
        if (p.stream === "stderr") {
          tab.lastStderr = (tab.lastStderr + clean).slice(-3000);
        }
        this.appendTerminalChunk(tab, p.stream, clean);
      });

      this.termUnlistenExit = await listen<number>("studio-terminal-exit", (ev) => {
        const tab = this.termTabs.find((t) => t.sessionId === ev.payload);
        if (!tab) return;
        tab.running = false;
        this.appendTerminalChunk(
          tab,
          "system",
          "\n[Terminal sessiyası bağlandı. Yenidən başlatmaq üçün 'Yenidən başlat' sıxın.]\n"
        );
        if (tab.tabId === this.activeTermTabId) {
          this.updateTerminalToolbarLive();
        }
      });
    } catch {
      // Ignore outside Tauri runtime
    }
  }

  public async openNewTerminal(cwdOverride?: string | null): Promise<void> {
    this.termCounter++;
    const tabId = `term_${Date.now()}_${this.termCounter}`;
    const shortLabel = cwdOverride ? cwdOverride.split(/[\\/]/).filter(Boolean).pop() : null;
    const title = shortLabel ? `PS ${this.termCounter} (${shortLabel})` : `PS ${this.termCounter}`;

    const newTab: TerminalTabState = {
      tabId,
      title,
      sessionId: 0,
      running: false,
      cwd: cwdOverride || this.currentProjectRoot || "",
      shell: "PowerShell",
      chunks: [],
      history: [],
      historyIdx: -1,
      inputDraft: "",
      lastCommand: "",
      lastStderr: "",
    };

    this.termTabs.push(newTab);
    this.activeTermTabId = tabId;
    if (this.activeTab === "terminal") {
      this.render();
    }

    try {
      const info = await invoke<TerminalSessionInfo>("terminal_create", {
        cwd: cwdOverride || this.currentProjectRoot || null,
      });
      newTab.sessionId = info.session_id;
      newTab.running = info.running;
      newTab.cwd = info.cwd;
      newTab.shell = info.shell || "PowerShell";
      this.appendTerminalChunk(newTab, "system", `${newTab.shell} hazırdır — ${newTab.cwd}\n`);
      if (this.activeTab === "terminal") {
        this.render();
      }
    } catch (e: any) {
      newTab.running = false;
      this.appendTerminalChunk(newTab, "stderr", `Terminal xətası: ${e}\n`);
      if (this.activeTab === "terminal") {
        this.updateTerminalToolbarLive();
      }
    }
  }

  public async closeTerminalTab(tabId: string): Promise<void> {
    const idx = this.termTabs.findIndex((t) => t.tabId === tabId);
    if (idx === -1) return;
    const [removed] = this.termTabs.splice(idx, 1);
    if (removed.sessionId > 0) {
      invoke("terminal_close", { sessionId: removed.sessionId }).catch(() => {});
    }
    if (this.termTabs.length === 0) {
      this.activeTermTabId = null;
      await this.openNewTerminal();
      return;
    }
    if (this.activeTermTabId === tabId) {
      const next = this.termTabs[Math.max(0, idx - 1)] || this.termTabs[0];
      this.activeTermTabId = next.tabId;
    }
    this.render();
  }

  public async setProjectRoot(rootPath: string | null): Promise<void> {
    this.currentProjectRoot = rootPath;
    if (!rootPath || !studioSettings.get().syncTerminalCwd) return;
    const active = this.getActiveTermTab();
    if (!active) {
      await this.openNewTerminal(rootPath);
      return;
    }
    if (active.cwd === rootPath && active.running) return;
    await this.restartTerminalTab(active, rootPath);
  }

  private async restartTerminalTab(tab: TerminalTabState, cwdOverride?: string | null): Promise<void> {
    tab.chunks = [];
    tab.lastStderr = "";
    try {
      const info = await invoke<TerminalSessionInfo>("terminal_restart", {
        sessionId: tab.sessionId || null,
        cwd: cwdOverride || tab.cwd || this.currentProjectRoot || null,
      });
      tab.sessionId = info.session_id;
      tab.running = info.running;
      tab.cwd = info.cwd;
      tab.shell = info.shell || "PowerShell";
      this.appendTerminalChunk(tab, "system", `${tab.shell} hazırdır — ${tab.cwd}\n`);
      if (this.activeTab === "terminal") this.render();
    } catch (e: any) {
      tab.running = false;
      this.appendTerminalChunk(tab, "stderr", `Yenidən başlatma xətası: ${e}\n`);
    }
  }

  public focusTerminal(): void {
    this.setActiveTab("terminal");
    if (this.termTabs.length === 0) {
      void this.openNewTerminal();
    }
    setTimeout(() => {
      const input = this.container.querySelector("#studio-terminal-input") as HTMLInputElement | null;
      input?.focus();
    }, 30);
  }

  private appendTerminalChunk(tab: TerminalTabState, stream: TerminalChunk["stream"], text: string): void {
    const maxChunks = Math.max(200, studioSettings.get().terminalScrollback || 600);
    tab.chunks.push({ stream, text });
    if (tab.chunks.length > maxChunks) {
      tab.chunks.splice(0, tab.chunks.length - Math.floor(maxChunks * 0.75));
    }

    if (tab.tabId !== this.activeTermTabId || this.activeTab !== "terminal" || this.isCollapsed) return;

    const outEl = this.container.querySelector("#studio-terminal-output") as HTMLElement | null;
    if (outEl) {
      const span = document.createElement("span");
      span.className = `term-chunk term-${stream}`;
      span.textContent = text;
      outEl.appendChild(span);
      while (outEl.childNodes.length > maxChunks) {
        outEl.removeChild(outEl.firstChild!);
      }
      outEl.scrollTop = outEl.scrollHeight;
    }
    if (stream === "stderr") {
      this.updateTerminalToolbarLive();
    }
  }

  private updateTerminalToolbarLive(): void {
    const tab = this.getActiveTermTab();
    if (!tab) return;
    const cwdEl = this.container.querySelector("#studio-terminal-cwd") as HTMLElement | null;
    if (cwdEl) {
      cwdEl.textContent = tab.cwd || "PowerShell";
      cwdEl.title = tab.cwd;
    }
    const dotEl = this.container.querySelector("#studio-terminal-dot") as HTMLElement | null;
    if (dotEl) {
      dotEl.className = `term-status-dot ${tab.running ? "is-alive" : "is-dead"}`;
    }
    const fixBtn = this.container.querySelector("#btn-term-fix-ai") as HTMLButtonElement | null;
    if (fixBtn) {
      fixBtn.style.display = studioSettings.get().showTerminalAiFix && tab.lastStderr.trim() ? "inline-flex" : "none";
    }
  }

  private async submitTerminalCommand(rawCmd: string): Promise<void> {
    const tab = this.getActiveTermTab();
    if (!tab) return;
    const cmd = rawCmd.trim();
    if (!cmd) return;

    if (tab.history[tab.history.length - 1] !== cmd) {
      tab.history.push(cmd);
      if (tab.history.length > 100) tab.history.shift();
    }
    tab.historyIdx = tab.history.length;
    tab.inputDraft = "";
    tab.lastCommand = cmd;
    tab.lastStderr = "";
    this.updateTerminalToolbarLive();

    const lower = cmd.toLowerCase();
    if (lower === "cls" || lower === "clear") {
      tab.chunks = [];
      const outEl = this.container.querySelector("#studio-terminal-output") as HTMLElement | null;
      if (outEl) outEl.innerHTML = "";
      return;
    }

    if (!tab.running || tab.sessionId === 0) {
      await this.restartTerminalTab(tab);
    }

    const shortDir = tab.cwd.split(/[\\/]/).filter(Boolean).pop() || "PS";
    const tsPrefix = studioSettings.get().terminalShowTimestamps ? `[${nowTime()}] ` : "";
    this.appendTerminalChunk(tab, "cmd", `${tsPrefix}PS ${shortDir}> ${cmd}\n`);

    try {
      await invoke("terminal_write", { sessionId: tab.sessionId, input: cmd });
    } catch (e: any) {
      this.appendTerminalChunk(tab, "stderr", `Yazma xətası: ${e}\n`);
      tab.running = false;
      this.updateTerminalToolbarLive();
    }
  }

  private async interruptTerminal(): Promise<void> {
    const tab = this.getActiveTermTab();
    if (!tab) return;
    try {
      const info = await invoke<TerminalSessionInfo>("terminal_interrupt", {
        sessionId: tab.sessionId || null,
      });
      tab.sessionId = info.session_id;
      tab.running = info.running;
      tab.cwd = info.cwd;
      this.updateTerminalToolbarLive();
    } catch (e: any) {
      this.appendTerminalChunk(tab, "stderr", `Dayandırma xətası: ${e}\n`);
    }
  }

  public setActiveTab(tab: BottomTabId): void {
    if (this.activeTab !== tab) {
      this.animateTabSwitch = true;
    }
    this.activeTab = tab;
    if (this.isCollapsed) {
      this.setCollapsed(false);
    }
    this.render();
  }

  public setCollapsed(collapsed: boolean): void {
    this.isCollapsed = collapsed;
    this.onToggleCollapse?.(collapsed);
    this.render();
  }

  public getCollapsed(): boolean {
    return this.isCollapsed;
  }

  public updateContextFiles(files: ContextFileSummary[]): void {
    this.contextFiles = files;
    if (this.activeTab === "context") {
      this.render();
    } else {
      this.updateTabBadgesOnly();
    }
  }

  public showSearchResults(query: string, matches: GrepMatchItem[]): void {
    this.searchQuery = query;
    this.searchResults = matches;
    this.activeTab = "search";
    this.animateTabSwitch = true;
    if (this.isCollapsed) {
      this.setCollapsed(false);
    }
    this.render();
  }

  public logActivity(category: ActivityLogEntry["category"], message: string, detail?: string): void {
    this.activityLog.unshift({
      time: nowTime(),
      category,
      message,
      detail,
    });
    if (this.activityLog.length > 200) {
      this.activityLog.pop();
    }
    if (this.activeTab === "activity") {
      this.render();
    }
  }

  public addProblem(severity: ProblemEntry["severity"], source: string, message: string): void {
    this.problems.unshift({
      time: nowTime(),
      severity,
      source,
      message,
    });
    if (this.problems.length > 100) {
      this.problems.pop();
    }
    if (this.activeTab === "problems") {
      this.render();
    } else {
      this.updateTabBadgesOnly();
    }
  }

  public clearActiveTab(): void {
    if (this.activeTab === "terminal") {
      const tab = this.getActiveTermTab();
      if (tab) {
        tab.chunks = [];
        tab.lastStderr = "";
      }
      const outEl = this.container.querySelector("#studio-terminal-output") as HTMLElement | null;
      if (outEl) outEl.innerHTML = "";
      this.updateTerminalToolbarLive();
      return;
    }
    if (this.activeTab === "activity") {
      this.activityLog = [];
    } else if (this.activeTab === "problems") {
      this.problems = [];
    } else if (this.activeTab === "search") {
      this.searchQuery = "";
      this.searchResults = [];
    } else if (this.activeTab === "context") {
      const paths = this.contextFiles.map((f) => f.path);
      for (const p of paths) {
        this.onRemoveContextFile?.(p);
      }
    }
    this.render();
  }

  private updateTabBadgesOnly(): void {
    const ctxTab = this.container.querySelector('.bottom-tab[data-tab="context"]');
    if (ctxTab) {
      const badge = this.contextFiles.length > 0 ? ` <span class="bottom-tab-badge">${this.contextFiles.length}</span>` : "";
      ctxTab.innerHTML = `${t("context")}${badge}`;
    }
    const probTab = this.container.querySelector('.bottom-tab[data-tab="problems"]');
    if (probTab) {
      const totalProb = this.getTotalProblemsCount();
      const badge = totalProb > 0 ? ` <span class="bottom-tab-badge badge-problem">${totalProb}</span>` : "";
      probTab.innerHTML = `${t("problems")}${badge}`;
    }
  }

  private render(): void {
    const existingInput = this.container.querySelector("#studio-terminal-input") as HTMLInputElement | null;
    const prevTab = this.getActiveTermTab();
    if (existingInput && prevTab) {
      prevTab.inputDraft = existingInput.value;
    }

    const totalBytes = this.contextFiles.reduce((acc, f) => acc + f.sizeBytes, 0);
    const totalProblems = this.getTotalProblemsCount();
    const contextBadge = this.contextFiles.length > 0 ? `<span class="bottom-tab-badge">${this.contextFiles.length}</span>` : "";
    const problemsBadge = totalProblems > 0 ? `<span class="bottom-tab-badge badge-problem">${totalProblems}</span>` : "";
    const searchBadge = this.searchResults.length > 0 ? `<span class="bottom-tab-badge">${this.searchResults.length}</span>` : "";
    const termBadge = this.termTabs.length > 1 ? `<span class="bottom-tab-badge">${this.termTabs.length}</span>` : "";

    let bodyHtml = "";
    if (!this.isCollapsed) {
      if (this.activeTab === "terminal") {
        const activeTerm = this.getActiveTermTab();
        const termTabsHtml = this.termTabs
          .map(
            (term) => `
            <div class="term-subtab ${activeTerm && term.tabId === activeTerm.tabId ? "is-active" : ""}" data-term-tab="${this.escapeAttr(term.tabId)}">
              <span class="term-subtab-label">${this.escapeHtml(term.title)}</span>
              ${
                this.termTabs.length > 1
                  ? `<button type="button" class="term-subtab-close" data-term-close="${this.escapeAttr(term.tabId)}" title="${this.escapeAttr(t("closeTerminalTab"))}">${ICON_CLOSE}</button>`
                  : ""
              }
            </div>
          `
          )
          .join("");

        const chunksHtml = (activeTerm?.chunks || [])
          .map((c) => `<span class="term-chunk term-${c.stream}">${this.escapeHtml(c.text)}</span>`)
          .join("");

        const hasError = !!(activeTerm && activeTerm.lastStderr.trim());

        bodyHtml = `
          <div class="studio-terminal-wrap">
            <div class="studio-terminal-toolbar">
              <div class="term-toolbar-left">
                <span id="studio-terminal-dot" class="term-status-dot ${activeTerm?.running ? "is-alive" : "is-dead"}"></span>
                <div class="term-subtabs-strip">
                  ${termTabsHtml}
                  <button type="button" class="term-subtab-add" id="btn-term-new-tab" title="${this.escapeAttr(t("newTerminalTab"))}">+</button>
                </div>
                <span id="studio-terminal-cwd" class="term-cwd-text" title="${this.escapeAttr(activeTerm?.cwd || "")}">${this.escapeHtml(activeTerm?.cwd || t("preparingLabel"))}</span>
              </div>
              <div class="term-toolbar-actions">
                <button type="button" class="studio-btn studio-btn-sm term-fix-ai-btn" id="btn-term-fix-ai" style="display: ${hasError && studioSettings.get().showTerminalAiFix ? "inline-flex" : "none"};" title="${t("fixWithAi")}">${t("fixWithAi")}</button>
                <button type="button" class="studio-btn studio-btn-sm" id="btn-term-restart" title="${t("restart")}">${t("restart")}</button>
              </div>
            </div>
            <div id="studio-terminal-output" class="studio-terminal-output">${chunksHtml}</div>
            <div class="studio-terminal-input-row">
              <span class="term-prompt-chevron">PS&gt;</span>
              <input
                type="text"
                id="studio-terminal-input"
                class="studio-terminal-input"
                placeholder="${t("terminalPlaceholder")}"
                autocomplete="off"
                spellcheck="false"
                value="${this.escapeAttr(activeTerm?.inputDraft || "")}"
              />
              <button type="button" class="studio-btn studio-btn-sm" id="btn-term-run">${t("run")}</button>
            </div>
          </div>
        `;
      } else if (this.activeTab === "scripts") {
        const allScripts = [...this.projectScripts, ...this.extensionScripts];
        if (allScripts.length === 0) {
          bodyHtml = `<div class="bottom-empty">${t("noScriptsFound")}</div>`;
        } else {
          const rows = allScripts
            .map(
              (s) => `
              <div class="bottom-script-row">
                <span class="model-meta-pill">${this.escapeHtml(s.source)}</span>
                <span class="script-name">${this.escapeHtml(s.name)}</span>
                <code class="script-cmd">${this.escapeHtml(s.command)}</code>
                <button type="button" class="studio-btn studio-btn-sm studio-btn-primary" data-run-script="${this.escapeAttr(s.command)}">${t("run")}</button>
              </div>
            `
            )
            .join("");
          bodyHtml = `<div class="bottom-list bottom-mono-list">${rows}</div>`;
        }
      } else if (this.activeTab === "todos") {
        const filtered =
          this.todoFilter === "ALL"
            ? this.todoItems
            : this.todoItems.filter((it) => it.tag === this.todoFilter);
        const tags = ["ALL", "TODO", "FIXME", "BUG", "HACK"];
        const filterBtns = tags
          .map(
            (tg) =>
              `<button type="button" class="catalog-filter-btn ${this.todoFilter === tg ? "active" : ""}" data-todo-filter="${tg}">${tg}</button>`
          )
          .join("");
        const rows = filtered
          .map(
            (it) => `
            <div class="bottom-diag-wrap">
              <button type="button" class="bottom-search-row bottom-diag-row" data-open="${this.escapeAttr(it.path)}" data-line="${it.line_number}">
                <span class="model-meta-pill">${this.escapeHtml(it.tag)}</span>
                <span class="search-hit-loc">${this.escapeHtml(it.path)}:${it.line_number}</span>
                <span class="search-hit-text">${this.escapeHtml(it.text)}</span>
              </button>
              <button type="button" class="studio-btn studio-btn-sm diag-fix-btn" data-fix-path="${this.escapeAttr(it.path)}" data-fix-line="${it.line_number}" data-fix-msg="${this.escapeAttr(`Resolve ${it.tag}: ${it.text}`)}">${t("fixWithAi")}</button>
            </div>
          `
          )
          .join("");
        bodyHtml = `
          <div class="global-replace-bar">
            <div class="catalog-filters">${filterBtns}</div>
            <button type="button" class="studio-btn studio-btn-sm" id="btn-scan-todos">${t("scanTodosBtn")}</button>
          </div>
          ${rows ? `<div class="bottom-list bottom-mono-list">${rows}</div>` : `<div class="bottom-empty">${t("noTodosFound")}</div>`}
        `;
      } else if (this.activeTab === "context") {
        if (this.contextFiles.length === 0) {
          bodyHtml = `
            <div class="bottom-empty">${t("noContextFiles")}</div>
          `;
        } else {
          const rows = this.contextFiles
            .map((f) => {
              const name = f.path.split("/").pop() || f.path;
              return `
                <div class="bottom-context-row" data-path="${this.escapeAttr(f.path)}">
                  <span class="bottom-row-icon">${getFileIconSvg(name)}</span>
                  <button type="button" class="bottom-row-path" data-open="${this.escapeAttr(f.path)}" title="${this.escapeAttr(f.path)}">${this.escapeHtml(f.path)}</button>
                  <span class="bottom-row-size">${formatByteSize(f.sizeBytes)}</span>
                  <button type="button" class="studio-btn-icon bottom-row-remove" data-remove="${this.escapeAttr(f.path)}" title="${t("removeFromContext")}">${ICON_CLOSE}</button>
                </div>
              `;
            })
            .join("");

          bodyHtml = `
            <div class="bottom-context-summary">${this.contextFiles.length} ${t("filesWord")} · ${formatByteSize(totalBytes)} ${t("inContext")}</div>
            <div class="bottom-list">${rows}</div>
          `;
        }
      } else if (this.activeTab === "activity") {
        if (this.activityLog.length === 0) {
          bodyHtml = `<div class="bottom-empty">${t("emptyActivityLog")}</div>`;
        } else {
          const rows = this.activityLog
            .map((entry) => {
              const tagLabel =
                entry.category === "read"
                  ? t("auditRead")
                  : entry.category === "send"
                    ? t("auditSend")
                    : entry.category === "blocked"
                      ? t("auditBlocked")
                      : t("auditSystem");
              const tagClass = `audit-tag audit-tag-${entry.category}`;
              const lockPrefix = entry.category === "blocked" ? `<span class="audit-lock">${ICON_LOCK_RED}</span>` : "";
              return `
                <div class="bottom-audit-row">
                  <span class="audit-time">${entry.time}</span>
                  <span class="${tagClass}">${lockPrefix}${tagLabel}</span>
                  <span class="audit-msg">${this.escapeHtml(entry.message)}</span>
                  ${entry.detail ? `<span class="audit-detail">${this.escapeHtml(entry.detail)}</span>` : ""}
                </div>
              `;
            })
            .join("");
          bodyHtml = `<div class="bottom-list bottom-mono-list">${rows}</div>`;
        }
      } else if (this.activeTab === "search") {
        if (!this.searchQuery) {
          bodyHtml = `<div class="bottom-empty">${t("searchHint")}</div>`;
        } else if (this.searchResults.length === 0) {
          bodyHtml = `<div class="bottom-empty">"${this.escapeHtml(this.searchQuery)}" ${t("noSearchMatches")}</div>`;
        } else {
          const rows = this.searchResults
            .map(
              (m) => `
              <button type="button" class="bottom-search-row" data-open="${this.escapeAttr(m.path)}" data-line="${m.line_number}">
                <span class="search-hit-loc">${this.escapeHtml(m.path)}:${m.line_number}</span>
                <span class="search-hit-text">${this.escapeHtml(m.line_text)}</span>
              </button>
            `
            )
            .join("");
          bodyHtml = `
            <div class="global-replace-bar">
              <span class="bottom-context-summary" style="border:none; padding:0;">"${this.escapeHtml(this.searchQuery)}" · ${this.searchResults.length}</span>
              <div class="global-replace-controls">
                <input type="text" id="global-replace-input" class="studio-input global-replace-input" placeholder="${t("replacePlaceholder")}" autocomplete="off" />
                <button type="button" class="studio-btn studio-btn-sm studio-btn-primary" id="btn-global-replace">${t("replaceAll")}</button>
              </div>
            </div>
            <div class="bottom-list bottom-mono-list">${rows}</div>
          `;
        }
      } else {
        const diagRows: string[] = [];
        for (const wd of this.workspaceDiagnostics) {
          diagRows.push(`
            <div class="bottom-diag-wrap problem-${this.escapeAttr(wd.severity)}">
              <button type="button" class="bottom-search-row bottom-diag-row" data-open="${this.escapeAttr(wd.path)}" data-line="${wd.line}">
                <span class="diag-severity-dot severity-${this.escapeAttr(wd.severity)}"></span>
                <span class="search-hit-loc">${this.escapeHtml(wd.path)}:${wd.line}:${wd.col}</span>
                <span class="search-hit-text">${this.escapeHtml(wd.message)}</span>
              </button>
              <button type="button" class="studio-btn studio-btn-sm diag-fix-btn" data-fix-path="${this.escapeAttr(wd.path)}" data-fix-line="${wd.line}" data-fix-msg="${this.escapeAttr(wd.message)}">${t("fixWithAi")}</button>
            </div>
          `);
        }
        this.codeDiagnostics.forEach((items, filePath) => {
          for (const d of items) {
            diagRows.push(`
              <div class="bottom-diag-wrap problem-${d.severity}">
                <button type="button" class="bottom-search-row bottom-diag-row" data-open="${this.escapeAttr(filePath)}" data-line="${d.line}">
                  <span class="diag-severity-dot severity-${d.severity}"></span>
                  <span class="search-hit-loc">${this.escapeHtml(filePath)}:${d.line}:${d.col}</span>
                  <span class="search-hit-text">${this.escapeHtml(d.message)}</span>
                </button>
                <button type="button" class="studio-btn studio-btn-sm diag-fix-btn" data-fix-path="${this.escapeAttr(filePath)}" data-fix-line="${d.line}" data-fix-msg="${this.escapeAttr(d.message)}">${t("fixWithAi")}</button>
              </div>
            `);
          }
        });
        const sysRows = this.problems.map(
          (p) => `
          <div class="bottom-problem-row problem-${p.severity}">
            <span class="audit-time">${p.time}</span>
            <span class="problem-source">${this.escapeHtml(p.source)}</span>
            <span class="problem-msg">${this.escapeHtml(p.message)}</span>
          </div>
        `
        );
        const checkBar = `
          <div class="global-replace-bar">
            <span class="bottom-context-summary" style="border:none; padding:0;">${this.escapeHtml(this.workspaceCheckSummary || t("problems"))}</span>
            <button type="button" class="studio-btn studio-btn-sm studio-btn-primary" id="btn-check-project" ${this.checkingProject ? "disabled" : ""}>
              ${this.checkingProject ? t("checkingProject") : t("checkProjectBtn")}
            </button>
          </div>
        `;
        if (diagRows.length === 0 && sysRows.length === 0) {
          bodyHtml = `${checkBar}<div class="bottom-empty">${t("noProblems")}</div>`;
        } else {
          bodyHtml = `${checkBar}<div class="bottom-list bottom-mono-list">${diagRows.join("")}${sysRows.join("")}</div>`;
        }
      }
    }

    const scriptsCount = this.projectScripts.length + this.extensionScripts.length;
    const scriptsBadge = scriptsCount > 0 ? `<span class="bottom-tab-badge">${scriptsCount}</span>` : "";
    const todosBadge = this.todoItems.length > 0 ? `<span class="bottom-tab-badge">${this.todoItems.length}</span>` : "";

    this.container.innerHTML = `
      <div class="bottom-panel-header">
        <div class="bottom-tabs" role="tablist">
          <button type="button" class="bottom-tab ${this.activeTab === "terminal" ? "active" : ""}" data-tab="terminal" role="tab">
            ${t("terminal")} ${termBadge}
          </button>
          <button type="button" class="bottom-tab ${this.activeTab === "scripts" ? "active" : ""}" data-tab="scripts" role="tab">
            ${t("scripts")} ${scriptsBadge}
          </button>
          <button type="button" class="bottom-tab ${this.activeTab === "todos" ? "active" : ""}" data-tab="todos" role="tab">
            ${t("todosTab")} ${todosBadge}
          </button>
          <button type="button" class="bottom-tab ${this.activeTab === "context" ? "active" : ""}" data-tab="context" role="tab">
            ${t("context")} ${contextBadge}
          </button>
          <button type="button" class="bottom-tab ${this.activeTab === "activity" ? "active" : ""}" data-tab="activity" role="tab">
            ${t("activity")}
          </button>
          <button type="button" class="bottom-tab ${this.activeTab === "problems" ? "active" : ""}" data-tab="problems" role="tab">
            ${t("problems")} ${problemsBadge}
          </button>
          ${
            this.searchQuery || this.activeTab === "search"
              ? `<button type="button" class="bottom-tab ${this.activeTab === "search" ? "active" : ""}" data-tab="search" role="tab">${t("search")} ${searchBadge}</button>`
              : ""
          }
        </div>
        <div class="bottom-panel-actions">
          <button type="button" class="studio-btn-icon" id="btn-bottom-clear" title="${t("clear")}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
            </svg>
          </button>
          <button type="button" class="studio-btn-icon" id="btn-bottom-toggle" title="${this.isCollapsed ? t("openPanel") : t("collapsePanel")}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true">
              ${this.isCollapsed ? `<polyline points="18 15 12 9 6 15"/>` : `<polyline points="6 9 12 15 18 9"/>`}
            </svg>
          </button>
        </div>
      </div>
      ${this.isCollapsed ? "" : `<div class="bottom-panel-body${this.activeTab === "terminal" ? " is-terminal-body" : ""}${this.animateTabSwitch ? " tab-switch-enter" : ""}">${bodyHtml}</div>`}
    `;
    this.animateTabSwitch = false;

    this.container.querySelectorAll<HTMLButtonElement>(".bottom-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.tab as BottomTabId;
        if (tab) this.setActiveTab(tab);
      });
    });

    this.container.querySelector("#btn-bottom-clear")?.addEventListener("click", () => this.clearActiveTab());
    this.container.querySelector("#btn-bottom-toggle")?.addEventListener("click", () => this.setCollapsed(!this.isCollapsed));

    if (!this.isCollapsed && this.activeTab === "terminal") {
      const outEl = this.container.querySelector("#studio-terminal-output") as HTMLElement | null;
      if (outEl) outEl.scrollTop = outEl.scrollHeight;

      this.container.querySelectorAll<HTMLElement>("[data-term-tab]").forEach((el) => {
        el.addEventListener("click", () => {
          const id = el.dataset.termTab;
          if (id && id !== this.activeTermTabId) {
            this.activeTermTabId = id;
            this.render();
          }
        });
      });

      this.container.querySelectorAll<HTMLButtonElement>("[data-term-close]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const id = btn.dataset.termClose;
          if (id) void this.closeTerminalTab(id);
        });
      });

      this.container.querySelector("#btn-term-new-tab")?.addEventListener("click", () => {
        void this.openNewTerminal();
      });

      this.container.querySelector("#btn-term-fix-ai")?.addEventListener("click", () => {
        const activeTerm = this.getActiveTermTab();
        if (activeTerm && activeTerm.lastStderr.trim()) {
          this.onFixTerminalError?.(activeTerm.lastCommand, activeTerm.lastStderr.trim(), activeTerm.cwd);
        }
      });

      const inputEl = this.container.querySelector("#studio-terminal-input") as HTMLInputElement | null;
      const runBtn = this.container.querySelector("#btn-term-run") as HTMLButtonElement | null;

      const dispatch = () => {
        if (!inputEl) return;
        const val = inputEl.value;
        inputEl.value = "";
        const activeTerm = this.getActiveTermTab();
        if (activeTerm) activeTerm.inputDraft = "";
        void this.submitTerminalCommand(val);
      };

      runBtn?.addEventListener("click", dispatch);
      inputEl?.addEventListener("keydown", (e) => {
        const activeTerm = this.getActiveTermTab();
        if (e.key === "Enter") {
          e.preventDefault();
          dispatch();
        } else if (e.key === "ArrowUp" && activeTerm) {
          if (activeTerm.history.length > 0) {
            e.preventDefault();
            activeTerm.historyIdx = Math.max(0, activeTerm.historyIdx - 1);
            inputEl.value = activeTerm.history[activeTerm.historyIdx] || "";
          }
        } else if (e.key === "ArrowDown" && activeTerm) {
          if (activeTerm.history.length > 0) {
            e.preventDefault();
            activeTerm.historyIdx = Math.min(activeTerm.history.length, activeTerm.historyIdx + 1);
            inputEl.value = activeTerm.history[activeTerm.historyIdx] || "";
          }
        } else if (e.ctrlKey && (e.key === "c" || e.key === "C")) {
          if (inputEl.selectionStart === inputEl.selectionEnd) {
            e.preventDefault();
            void this.interruptTerminal();
          }
        }
      });

      this.container.querySelector("#btn-term-interrupt")?.addEventListener("click", () => {
        void this.interruptTerminal();
      });

      this.container.querySelector("#btn-term-restart")?.addEventListener("click", () => {
        const activeTerm = this.getActiveTermTab();
        if (activeTerm) void this.restartTerminalTab(activeTerm);
      });
    }

    this.container.querySelectorAll<HTMLButtonElement>("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = btn.dataset.remove;
        if (p) this.onRemoveContextFile?.(p);
      });
    });

    this.container.querySelectorAll<HTMLButtonElement>("[data-open]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = btn.dataset.open;
        const line = btn.dataset.line ? Number(btn.dataset.line) : undefined;
        if (p) this.onOpenContextFile?.(p, line);
      });
    });

    this.container.querySelectorAll<HTMLButtonElement>("[data-run-script]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const cmd = btn.dataset.runScript;
        if (cmd) void this.runCommandInTerminal(cmd);
      });
    });

    this.container.querySelectorAll<HTMLButtonElement>("[data-fix-path]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const p = btn.dataset.fixPath;
        const line = Number(btn.dataset.fixLine || 1);
        const msg = btn.dataset.fixMsg || "";
        if (p) this.onFixDiagnosticError?.(p, line, msg);
      });
    });

    this.container.querySelector("#btn-global-replace")?.addEventListener("click", async () => {
      const inp = this.container.querySelector("#global-replace-input") as HTMLInputElement | null;
      if (!inp || !this.searchQuery || this.searchResults.length === 0) return;
      const uniquePaths = Array.from(new Set(this.searchResults.map((r) => r.path)));
      await this.onGlobalReplaceRequest?.(this.searchQuery, inp.value, uniquePaths);
    });

    this.container.querySelector("#btn-check-project")?.addEventListener("click", () => {
      void this.onCheckProjectRequest?.();
    });

    this.container.querySelector("#btn-scan-todos")?.addEventListener("click", () => {
      void this.onScanTodosRequest?.();
    });

    this.container.querySelectorAll<HTMLButtonElement>("[data-todo-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.todoFilter) {
          this.todoFilter = btn.dataset.todoFilter;
          this.render();
        }
      });
    });
  }

  public getRecentTerminalOutput(): string {
    const active = this.getActiveTermTab();
    if (!active || active.chunks.length === 0) return "";
    return active.chunks
      .slice(-80)
      .map((c) => c.text)
      .join("")
      .slice(-6000);
  }

  public getProblemsSummary(): string {
    const lines: string[] = [];
    for (const [path, diags] of this.codeDiagnostics.entries()) {
      for (const d of diags) {
        lines.push(`[${d.severity.toUpperCase()}] ${path}:${d.line}:${d.col} — ${d.message}`);
      }
    }
    for (const d of this.workspaceDiagnostics) {
      lines.push(`[${d.severity.toUpperCase()}] ${d.path}:${d.line}:${d.col} — ${d.message}`);
    }
    for (const p of this.problems) {
      lines.push(`[${p.severity.toUpperCase()}] ${p.source} — ${p.message}`);
    }
    return lines.join("\n");
  }

  public dispose(): void {
    this.termUnlistenOut?.();
    this.termUnlistenExit?.();
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  private escapeAttr(str: string): string {
    return this.escapeHtml(str).replace(/"/g, "&quot;");
  }
}
