/**
 * SettingsPage.ts
 * Dedicated full-screen VS Code-style Settings page with live search and 5 rich categories,
 * 100% localized across AZ / EN / TR / RU.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { studioSettings } from "./StudioSettings";
import { showConfirmDialog } from "./InputDialog";
import { t } from "./i18n";

export interface UpdateCheckResult {
  current_version: string;
  latest_version: string;
  update_available: boolean;
  release_notes: string;
  download_url: string | null;
  sha256: string | null;
  pub_date: string | null;
  source: string;
}

interface UpdateDownloadProgress {
  downloaded_bytes: number;
  total_bytes: number;
  percent: number;
  status: string;
}

export type SettingsSectionId = "general" | "editor" | "terminal" | "agent" | "updates" | "security";

export class SettingsPage {
  private container: HTMLElement;
  private activeSection: SettingsSectionId = "general";
  private searchQuery = "";
  private noticeText = "";
  private currentVersion = "0.1.0";
  private checkingUpdates = false;
  private installingUpdate = false;
  private updateResult: UpdateCheckResult | null = null;
  private updateError: string | null = null;
  private updateProgress: UpdateDownloadProgress | null = null;
  private unlistenUpdate: UnlistenFn | null = null;
  private winOpenWithRegistered = false;
  private winOpenWithBusy = false;

  public onBackToWorkspace?: () => void;
  public onOpenModelsPage?: (tab: "local" | "cloud") => void;
  public onOpenMcpPage?: () => void;
  public onUpdateChecked?: (res: UpdateCheckResult) => void;

  constructor(container: HTMLElement) {
    this.container = container;
    invoke<string>("updater_get_version")
      .then((v) => {
        this.currentVersion = v;
      })
      .catch(() => {});
    invoke<boolean>("studio_is_windows_open_with_registered")
      .then((reg) => {
        this.winOpenWithRegistered = !!reg;
      })
      .catch(() => {});
    listen<UpdateDownloadProgress>("studio-update-progress", (ev) => {
      this.updateProgress = ev.payload;
      if (this.activeSection === "updates") {
        this.render();
      }
    })
      .then((un) => {
        this.unlistenUpdate = un;
      })
      .catch(() => {});
  }

  public setExternalUpdateResult(res: UpdateCheckResult): void {
    this.updateResult = res;
    this.updateError = null;
  }

  public dispose(): void {
    this.unlistenUpdate?.();
  }

  public show(section: SettingsSectionId = "general"): void {
    this.activeSection = section;
    this.noticeText = "";
    this.render();
    invoke<boolean>("studio_is_windows_open_with_registered")
      .then((reg) => {
        if (this.winOpenWithRegistered !== !!reg) {
          this.winOpenWithRegistered = !!reg;
          this.render();
        }
      })
      .catch(() => {});
  }

  private render(): void {
    const prefs = studioSettings.get();
    const q = this.searchQuery.trim().toLowerCase();

    const sections: Array<{ id: SettingsSectionId; label: string }> = [
      { id: "general", label: t("secGeneral") },
      { id: "editor", label: t("secEditor") },
      { id: "terminal", label: t("secTerminal") },
      { id: "agent", label: t("secAgent") },
      { id: "updates", label: t("secUpdates") },
      { id: "security", label: t("secSecurity") },
    ];

    const navHtml = sections
      .map(
        (s) => `
        <button type="button" class="settings-nav-btn ${!q && this.activeSection === s.id ? "active" : ""}" data-sec="${s.id}">
          ${s.label}
        </button>
      `
      )
      .join("");

    const showSec = (id: SettingsSectionId) => !!q || this.activeSection === id;

    const generalHtml = showSec("general")
      ? `
        <div class="settings-card-block" data-sec-group="general">
          <div class="settings-block-title">${t("setGeneralBlock")}</div>

          <div class="settings-toggle-row" data-setting-search="dil language azerbaycan english turkce rus">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setLangTitle")}</div>
              <div class="toggle-desc">${t("setLangDesc")}</div>
            </div>
            <select id="set-language" class="studio-input settings-compact-control">
              <option value="az" ${prefs.language === "az" ? "selected" : ""}>Azərbaycan</option>
              <option value="en" ${prefs.language === "en" ? "selected" : ""}>English</option>
              <option value="tr" ${prefs.language === "tr" ? "selected" : ""}>Türkçe</option>
              <option value="ru" ${prefs.language === "ru" ? "selected" : ""}>Русский</option>
            </select>
          </div>

          <div class="settings-toggle-row" data-setting-search="zoom scale olcu miqyas">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setScaleTitle")}</div>
              <div class="toggle-desc">${t("setScaleDesc")}</div>
            </div>
            <select id="set-ui-scale" class="studio-input settings-compact-control">
              ${[90, 95, 100, 105, 110, 115]
                .map((n) => `<option value="${n}" ${prefs.uiScale === n ? "selected" : ""}>${n}%</option>`)
                .join("")}
            </select>
          </div>

          <div class="settings-toggle-row" data-setting-search="animasiya animation motion smooth">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setAnimTitle")}</div>
              <div class="toggle-desc">${t("setAnimDesc")}</div>
            </div>
            <label class="studio-switch">
              <input type="checkbox" id="set-smooth-anim" ${prefs.smoothAnimations ? "checked" : ""} />
              <span class="studio-switch-track"></span>
            </label>
          </div>

          <div class="settings-toggle-row" data-setting-search="kompakt compact sidebar explorer">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setCompactTitle")}</div>
              <div class="toggle-desc">${t("setCompactDesc")}</div>
            </div>
            <label class="studio-switch">
              <input type="checkbox" id="set-compact-sidebar" ${prefs.compactSidebar ? "checked" : ""} />
              <span class="studio-switch-track"></span>
            </label>
          </div>

          <div class="settings-toggle-row" data-setting-search="status bar bottom">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setStatusBarTitle")}</div>
              <div class="toggle-desc">${t("setStatusBarDesc")}</div>
            </div>
            <label class="studio-switch">
              <input type="checkbox" id="set-show-statusbar" ${prefs.showStatusBar ? "checked" : ""} />
              <span class="studio-switch-track"></span>
            </label>
          </div>

          <div class="settings-toggle-row" data-setting-search="clock saat time status bar">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setClockTitle")}</div>
              <div class="toggle-desc">${t("setClockDesc")}</div>
            </div>
            <label class="studio-switch">
              <input type="checkbox" id="set-statusbar-clock" ${prefs.showStatusBarClock ? "checked" : ""} />
              <span class="studio-switch-track"></span>
            </label>
          </div>

          <div class="settings-toggle-row" data-setting-search="recent reopen last project startup session">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setReopenTitle")}</div>
              <div class="toggle-desc">${t("setReopenDesc")}</div>
            </div>
            <label class="studio-switch">
              <input type="checkbox" id="set-reopen-last" ${prefs.reopenLastProject ? "checked" : ""} />
              <span class="studio-switch-track"></span>
            </label>
          </div>

          <div class="settings-toggle-row" data-setting-search="restore chat session fresh startup new sesiya">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setRestoreChatTitle")}</div>
              <div class="toggle-desc">${t("setRestoreChatDesc")}</div>
            </div>
            <label class="studio-switch">
              <input type="checkbox" id="set-restore-chat" ${prefs.restoreLastChatSession ? "checked" : ""} />
              <span class="studio-switch-track"></span>
            </label>
          </div>

          <div class="settings-toggle-row" data-setting-search="windows open with context menu explorer file association">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setWinOpenWithTitle")}</div>
              <div class="toggle-desc">${t("setWinOpenWithDesc")}</div>
            </div>
            <label class="studio-switch">
              <input type="checkbox" id="set-win-openwith" ${this.winOpenWithRegistered ? "checked" : ""} ${this.winOpenWithBusy ? "disabled" : ""} />
              <span class="studio-switch-track"></span>
            </label>
          </div>

          <div class="settings-toggle-row" data-setting-search="confirm delete silmek tesdiq">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setConfirmDelTitle")}</div>
              <div class="toggle-desc">${t("setConfirmDelDesc")}</div>
            </div>
            <label class="studio-switch">
              <input type="checkbox" id="set-confirm-delete" ${prefs.confirmBeforeDelete ? "checked" : ""} />
              <span class="studio-switch-track"></span>
            </label>
          </div>
        </div>
      `
      : "";

    const editorHtml = showSec("editor")
      ? `
        <div class="settings-card-block" data-sec-group="editor">
          <div class="settings-block-title">${t("setEditorBlock")}</div>

          <div class="settings-toggle-row" data-setting-search="srift font size">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setFontSizeTitle")}</div>
              <div class="toggle-desc">${t("setFontSizeDesc")}</div>
            </div>
            <select id="set-font-size" class="studio-input settings-compact-control">
              ${[11, 12, 13, 14, 15, 16, 18, 20]
                .map((n) => `<option value="${n}" ${prefs.fontSize === n ? "selected" : ""}>${n}px</option>`)
                .join("")}
            </select>
          </div>

          <div class="settings-toggle-row" data-setting-search="setir line height">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setLineHeightTitle")}</div>
              <div class="toggle-desc">${t("setLineHeightDesc")}</div>
            </div>
            <select id="set-line-height" class="studio-input settings-compact-control">
              ${[1.3, 1.4, 1.55, 1.7, 1.9]
                .map((n) => `<option value="${n}" ${prefs.lineHeight === n ? "selected" : ""}>${n}</option>`)
                .join("")}
            </select>
          </div>

          <div class="settings-toggle-row" data-setting-search="font family cascadia jetbrains consolas">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setFontFamilyTitle")}</div>
              <div class="toggle-desc">${t("setFontFamilyDesc")}</div>
            </div>
            <select id="set-font-family" class="studio-input settings-compact-control" style="width: 190px;">
              <option value='"Cascadia Code", "JetBrains Mono", Consolas, monospace' ${prefs.fontFamily.includes("Cascadia") ? "selected" : ""}>Cascadia Code</option>
              <option value='"JetBrains Mono", Consolas, monospace' ${prefs.fontFamily.startsWith('"JetBrains') ? "selected" : ""}>JetBrains Mono</option>
              <option value='Consolas, "Courier New", monospace' ${prefs.fontFamily.startsWith("Consolas") ? "selected" : ""}>Consolas</option>
              <option value='"Fira Code", Consolas, monospace' ${prefs.fontFamily.startsWith('"Fira') ? "selected" : ""}>Fira Code</option>
              <option value='monospace' ${prefs.fontFamily === "monospace" ? "selected" : ""}>${t("setSystemMono")}</option>
            </select>
          </div>

          <div class="settings-toggle-row" data-setting-search="tab size indent spaces">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setTabSizeTitle")}</div>
              <div class="toggle-desc">${t("setTabSizeDesc")}</div>
            </div>
            <select id="set-tab-size" class="studio-input settings-compact-control">
              <option value="2" ${prefs.tabSize === 2 ? "selected" : ""}>2 ${t("spacesWord")}</option>
              <option value="4" ${prefs.tabSize === 4 ? "selected" : ""}>4 ${t("spacesWord")}</option>
              <option value="8" ${prefs.tabSize === 8 ? "selected" : ""}>8 ${t("spacesWord")}</option>
            </select>
          </div>

          <div class="settings-toggle-row" data-setting-search="word wrap">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setWordWrapTitle")}</div>
              <div class="toggle-desc">${t("setWordWrapDesc")}</div>
            </div>
            <label class="studio-switch">
              <input type="checkbox" id="set-word-wrap" ${prefs.wordWrap ? "checked" : ""} />
              <span class="studio-switch-track"></span>
            </label>
          </div>

          <div class="settings-toggle-row" data-setting-search="line numbers">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setLineNumsTitle")}</div>
              <div class="toggle-desc">${t("setLineNumsDesc")}</div>
            </div>
            <label class="studio-switch">
              <input type="checkbox" id="set-line-numbers" ${prefs.showLineNumbers ? "checked" : ""} />
              <span class="studio-switch-track"></span>
            </label>
          </div>

          <div class="settings-toggle-row" data-setting-search="highlight active line">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setActiveLineTitle")}</div>
              <div class="toggle-desc">${t("setActiveLineDesc")}</div>
            </div>
            <label class="studio-switch">
              <input type="checkbox" id="set-active-line" ${prefs.highlightActiveLine ? "checked" : ""} />
              <span class="studio-switch-track"></span>
            </label>
          </div>

          <div class="settings-toggle-row" data-setting-search="minimap">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setMinimapTitle")}</div>
              <div class="toggle-desc">${t("setMinimapDesc")}</div>
            </div>
            <label class="studio-switch">
              <input type="checkbox" id="set-show-minimap" ${prefs.showMinimap ? "checked" : ""} />
              <span class="studio-switch-track"></span>
            </label>
          </div>

          <div class="settings-toggle-row" data-setting-search="bracket matching">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setBracketsTitle")}</div>
              <div class="toggle-desc">${t("setBracketsDesc")}</div>
            </div>
            <label class="studio-switch">
              <input type="checkbox" id="set-brackets" ${prefs.bracketMatching ? "checked" : ""} />
              <span class="studio-switch-track"></span>
            </label>
          </div>

          <div class="settings-toggle-row" data-setting-search="cursor style kursor caret">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setCursorStyleTitle")}</div>
              <div class="toggle-desc">${t("setCursorStyleDesc")}</div>
            </div>
            <select id="set-cursor-style" class="studio-input settings-compact-control">
              <option value="line" ${prefs.cursorStyle === "line" ? "selected" : ""}>Line</option>
              <option value="block" ${prefs.cursorStyle === "block" ? "selected" : ""}>Block</option>
              <option value="underline" ${prefs.cursorStyle === "underline" ? "selected" : ""}>Underline</option>
            </select>
          </div>

          <div class="settings-toggle-row" data-setting-search="auto close brackets quotes moterize">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setAutoCloseTitle")}</div>
              <div class="toggle-desc">${t("setAutoCloseDesc")}</div>
            </div>
            <label class="studio-switch">
              <input type="checkbox" id="set-autoclose-brackets" ${prefs.autoCloseBrackets ? "checked" : ""} />
              <span class="studio-switch-track"></span>
            </label>
          </div>

          <div class="settings-toggle-row" data-setting-search="code folding qatlama">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setFoldingTitle")}</div>
              <div class="toggle-desc">${t("setFoldingDesc")}</div>
            </div>
            <label class="studio-switch">
              <input type="checkbox" id="set-code-folding" ${prefs.codeFolding ? "checked" : ""} />
              <span class="studio-switch-track"></span>
            </label>
          </div>

          <div class="settings-toggle-row" data-setting-search="breadcrumbs path navigation">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setBreadcrumbsTitle")}</div>
              <div class="toggle-desc">${t("setBreadcrumbsDesc")}</div>
            </div>
            <label class="studio-switch">
              <input type="checkbox" id="set-breadcrumbs" ${prefs.showBreadcrumbs ? "checked" : ""} />
              <span class="studio-switch-track"></span>
            </label>
          </div>

          <div class="settings-toggle-row" data-setting-search="git blame inline commit">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setGitBlameTitle")}</div>
              <div class="toggle-desc">${t("setGitBlameDesc")}</div>
            </div>
            <label class="studio-switch">
              <input type="checkbox" id="set-git-blame" ${prefs.showInlineGitBlame ? "checked" : ""} />
              <span class="studio-switch-track"></span>
            </label>
          </div>

          <div class="settings-toggle-row" data-setting-search="diagnostics red squiggle lint error xeta">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setDiagTitle")}</div>
              <div class="toggle-desc">${t("setDiagDesc")}</div>
            </div>
            <label class="studio-switch">
              <input type="checkbox" id="set-code-diag" ${prefs.enableCodeDiagnostics ? "checked" : ""} />
              <span class="studio-switch-track"></span>
            </label>
          </div>

          <div class="settings-toggle-row" data-setting-search="selection floating ai toolbar mini menu">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setSelBarTitle")}</div>
              <div class="toggle-desc">${t("setSelBarDesc")}</div>
            </div>
            <label class="studio-switch">
              <input type="checkbox" id="set-sel-bar" ${prefs.enableSelectionAiBar ? "checked" : ""} />
              <span class="studio-switch-track"></span>
            </label>
          </div>

          <div class="settings-toggle-row" data-setting-search="auto save">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setAutoSaveTitle")}</div>
              <div class="toggle-desc">${t("setAutoSaveDesc")}</div>
            </div>
            <label class="studio-switch">
              <input type="checkbox" id="set-auto-save" ${prefs.autoSave ? "checked" : ""} />
              <span class="studio-switch-track"></span>
            </label>
          </div>

          <div class="settings-toggle-row" data-setting-search="auto save delay">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setAutoSaveDelayTitle")}</div>
              <div class="toggle-desc">${t("setAutoSaveDelayDesc")}</div>
            </div>
            <select id="set-autosave-delay" class="studio-input settings-compact-control">
              <option value="500" ${prefs.autoSaveDelayMs === 500 ? "selected" : ""}>0.5 ${t("secondsWord")}</option>
              <option value="1500" ${prefs.autoSaveDelayMs === 1500 ? "selected" : ""}>1.5 ${t("secondsWord")}</option>
              <option value="3000" ${prefs.autoSaveDelayMs === 3000 ? "selected" : ""}>3.0 ${t("secondsWord")}</option>
              <option value="5000" ${prefs.autoSaveDelayMs === 5000 ? "selected" : ""}>5.0 ${t("secondsWord")}</option>
            </select>
          </div>

          <div class="settings-toggle-row" data-setting-search="trim whitespace">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setTrimWsTitle")}</div>
              <div class="toggle-desc">${t("setTrimWsDesc")}</div>
            </div>
            <label class="studio-switch">
              <input type="checkbox" id="set-trim-ws" ${prefs.trimTrailingWhitespace ? "checked" : ""} />
              <span class="studio-switch-track"></span>
            </label>
          </div>

          <div class="settings-toggle-row" data-setting-search="final newline">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setFinalNlTitle")}</div>
              <div class="toggle-desc">${t("setFinalNlDesc")}</div>
            </div>
            <label class="studio-switch">
              <input type="checkbox" id="set-final-nl" ${prefs.insertFinalNewline ? "checked" : ""} />
              <span class="studio-switch-track"></span>
            </label>
          </div>
        </div>
      `
      : "";

    const terminalHtml = showSec("terminal")
      ? `
        <div class="settings-card-block" data-sec-group="terminal">
          <div class="settings-block-title">${t("setTermBlock")}</div>

          <div class="settings-toggle-row" data-setting-search="terminal font size">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setTermFontTitle")}</div>
              <div class="toggle-desc">${t("setTermFontDesc")}</div>
            </div>
            <select id="set-term-font" class="studio-input settings-compact-control">
              ${[11, 12, 13, 14, 15, 16]
                .map((n) => `<option value="${n}" ${prefs.terminalFontSize === n ? "selected" : ""}>${n}px</option>`)
                .join("")}
            </select>
          </div>

          <div class="settings-toggle-row" data-setting-search="terminal scrollback limit">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setTermScrollTitle")}</div>
              <div class="toggle-desc">${t("setTermScrollDesc")}</div>
            </div>
            <select id="set-term-scrollback" class="studio-input settings-compact-control">
              <option value="300" ${prefs.terminalScrollback === 300 ? "selected" : ""}>300</option>
              <option value="600" ${prefs.terminalScrollback === 600 ? "selected" : ""}>600</option>
              <option value="1200" ${prefs.terminalScrollback === 1200 ? "selected" : ""}>1200</option>
              <option value="2500" ${prefs.terminalScrollback === 2500 ? "selected" : ""}>2500</option>
            </select>
          </div>

          <div class="settings-toggle-row" data-setting-search="terminal ai fix error">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setTermAiFixTitle")}</div>
              <div class="toggle-desc">${t("setTermAiFixDesc")}</div>
            </div>
            <label class="studio-switch">
              <input type="checkbox" id="set-term-aifix" ${prefs.showTerminalAiFix ? "checked" : ""} />
              <span class="studio-switch-track"></span>
            </label>
          </div>

          <div class="settings-toggle-row" data-setting-search="terminal cwd folder sync">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setTermSyncTitle")}</div>
              <div class="toggle-desc">${t("setTermSyncDesc")}</div>
            </div>
            <label class="studio-switch">
              <input type="checkbox" id="set-term-sync" ${prefs.syncTerminalCwd ? "checked" : ""} />
              <span class="studio-switch-track"></span>
            </label>
          </div>

          <div class="settings-toggle-row" data-setting-search="terminal timestamp time vaxt">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setTermTsTitle")}</div>
              <div class="toggle-desc">${t("setTermTsDesc")}</div>
            </div>
            <label class="studio-switch">
              <input type="checkbox" id="set-term-ts" ${prefs.terminalShowTimestamps ? "checked" : ""} />
              <span class="studio-switch-track"></span>
            </label>
          </div>
        </div>
      `
      : "";

    const agentHtml = showSec("agent")
      ? `
        <div class="settings-card-block" data-sec-group="agent">
          <div class="settings-block-title">${t("setAgentBlock")}</div>

          <div class="settings-toggle-row" data-setting-search="temperature creativity">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setTempTitle")}</div>
              <div class="toggle-desc">${t("setTempDesc")}</div>
            </div>
            <select id="set-temp" class="studio-input settings-compact-control">
              <option value="0" ${prefs.temperature === 0 ? "selected" : ""}>${t("tempExact")}</option>
              <option value="0.2" ${prefs.temperature === 0.2 ? "selected" : ""}>${t("tempCode")}</option>
              <option value="0.5" ${prefs.temperature === 0.5 ? "selected" : ""}>${t("tempBalanced")}</option>
              <option value="0.7" ${prefs.temperature === 0.7 ? "selected" : ""}>${t("tempCreative")}</option>
              <option value="1.0" ${prefs.temperature === 1.0 ? "selected" : ""}>${t("tempMax")}</option>
            </select>
          </div>

          <div class="settings-toggle-row" data-setting-search="agent steps limit">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setAgentStepsTitle")}</div>
              <div class="toggle-desc">${t("setAgentStepsDesc")}</div>
            </div>
            <select id="set-agent-steps" class="studio-input settings-compact-control">
              ${[1, 3, 5, 8, 10]
                .map((n) => `<option value="${n}" ${prefs.maxAgentSteps === n ? "selected" : ""}>${n} ${t("stepsWord")}</option>`)
                .join("")}
            </select>
          </div>

          <div class="settings-toggle-row" data-setting-search="tok/s speed stats token">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setPerfStatsTitle")}</div>
              <div class="toggle-desc">${t("setPerfStatsDesc")}</div>
            </div>
            <label class="studio-switch">
              <input type="checkbox" id="set-perf-stats" ${prefs.showPerfStats ? "checked" : ""} />
              <span class="studio-switch-track"></span>
            </label>
          </div>

          <div class="settings-toggle-row" data-setting-search="context meter usage">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setCtxMeterTitle")}</div>
              <div class="toggle-desc">${t("setCtxMeterDesc")}</div>
            </div>
            <label class="studio-switch">
              <input type="checkbox" id="set-ctx-meter" ${prefs.showContextMeter ? "checked" : ""} />
              <span class="studio-switch-track"></span>
            </label>
          </div>

          <div class="settings-toggle-row" data-setting-search="ghost text tab autocomplete">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setGhostTextTitle")}</div>
              <div class="toggle-desc">${t("setGhostTextDesc")}</div>
            </div>
            <label class="studio-switch">
              <input type="checkbox" id="set-ghost-text" ${prefs.enableGhostText ? "checked" : ""} />
              <span class="studio-switch-track"></span>
            </label>
          </div>

          <div class="settings-toggle-row" data-setting-search="auto scroll chat streaming">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setAutoScrollTitle")}</div>
              <div class="toggle-desc">${t("setAutoScrollDesc")}</div>
            </div>
            <label class="studio-switch">
              <input type="checkbox" id="set-auto-scroll" ${prefs.autoScrollChat ? "checked" : ""} />
              <span class="studio-switch-track"></span>
            </label>
          </div>

          <div class="settings-toggle-row" data-setting-search="expand diff collapse compact code card">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setExpandDiffTitle")}</div>
              <div class="toggle-desc">${t("setExpandDiffDesc")}</div>
            </div>
            <label class="studio-switch">
              <input type="checkbox" id="set-expand-diff" ${prefs.expandDiffsByDefault ? "checked" : ""} />
              <span class="studio-switch-track"></span>
            </label>
          </div>

          <div class="form-group" style="margin-top: 8px;" data-setting-search="custom system prompt">
            <label for="set-custom-prompt">${t("setCustomPromptLabel")}</label>
            <textarea id="set-custom-prompt" class="studio-input studio-textarea" rows="3" placeholder="${this.escapeAttr(t("setCustomPromptPlaceholder"))}">${this.escapeHtml(prefs.customSystemPrompt)}</textarea>
          </div>

          <div class="settings-inline-actions">
            <button type="button" class="studio-btn studio-btn-sm" id="btn-goto-local-models">${t("gotoLocalModels")}</button>
            <button type="button" class="studio-btn studio-btn-sm" id="btn-goto-cloud-models">${t("gotoCloudModels")}</button>
            <button type="button" class="studio-btn studio-btn-sm" id="btn-goto-mcp-page">${t("gotoMcpPage")}</button>
          </div>
        </div>
      `
      : "";

    const updatesHtml = showSec("updates")
      ? `
        <div class="settings-card-block" data-sec-group="updates">
          <div class="key-status-row">
            <div class="settings-block-title">${t("updatesBlockTitle")}</div>
            <span class="model-meta-pill">${t("currentVersionLabel")}: v${this.escapeHtml(this.currentVersion)}</span>
          </div>

          <div class="settings-toggle-row" data-setting-search="update github auto check version">
            <div class="toggle-meta">
              <div class="toggle-title">${t("autoCheckUpdatesTitle")}</div>
              <div class="toggle-desc">${t("autoCheckUpdatesDesc")}</div>
            </div>
            <label class="studio-switch">
              <input type="checkbox" id="set-auto-updates" ${prefs.autoCheckUpdates ? "checked" : ""} />
              <span class="studio-switch-track"></span>
            </label>
          </div>

          <div class="form-group" data-setting-search="github repo release">
            <label for="set-github-repo">${t("githubRepoLabel")}</label>
            <input id="set-github-repo" class="studio-input" type="text" placeholder="owner/mintu-studio" value="${this.escapeAttr(prefs.githubRepo || "")}" autocomplete="off" />
            <div class="form-hint">${this.escapeHtml(t("githubRepoDesc"))}</div>
          </div>

          <div class="form-group" data-setting-search="custom update manifest url">
            <label for="set-custom-update-url">${t("customUpdateUrlLabel")}</label>
            <input id="set-custom-update-url" class="studio-input" type="text" placeholder="https://example.com/mintu/latest.json" value="${this.escapeAttr(prefs.customUpdateUrl || "")}" autocomplete="off" />
            <div class="form-hint">${this.escapeHtml(t("customUpdateUrlDesc"))}</div>
          </div>

          <div class="settings-inline-actions">
            <button type="button" class="studio-btn studio-btn-primary" id="btn-check-updates" ${this.checkingUpdates || this.installingUpdate ? "disabled" : ""}>
              ${this.checkingUpdates ? t("checkingUpdates") : t("checkUpdatesBtn")}
            </button>
          </div>

          ${this.updateError ? `<div class="mcp-error-banner">${this.escapeHtml(this.updateError)}</div>` : ""}

          ${
            this.updateResult
              ? this.updateResult.update_available
                ? `
                  <div class="update-result-card">
                    <div class="key-status-row">
                      <span class="local-model-name">v${this.escapeHtml(this.updateResult.current_version)} → v${this.escapeHtml(this.updateResult.latest_version)}</span>
                      <span class="model-meta-pill pill-installed">${t("updateAvailableBadge")}</span>
                    </div>
                    ${this.updateResult.sha256 ? `<div class="form-hint">SHA-256: <code>${this.escapeHtml(this.updateResult.sha256.slice(0, 24))}...</code></div>` : ""}
                    ${this.updateResult.release_notes ? `<pre class="api-resp-pre" style="max-height:160px;">${this.escapeHtml(this.updateResult.release_notes)}</pre>` : ""}
                    ${
                      this.updateProgress
                        ? `<div class="model-dl-progress"><div class="model-dl-bar-track"><div class="model-dl-bar-fill" style="width:${this.updateProgress.percent}%;"></div></div><div class="model-dl-meta">${this.updateProgress.percent}% · ${this.escapeHtml(this.updateProgress.status)}</div></div>`
                        : ""
                    }
                    ${
                      this.updateResult.download_url
                        ? `<div class="settings-inline-actions"><button type="button" class="studio-btn studio-btn-primary" id="btn-install-update" ${this.installingUpdate ? "disabled" : ""}>${t("installUpdateBtn")} (v${this.escapeHtml(this.updateResult.latest_version)})</button></div>`
                        : `<div class="form-hint">No Windows setup.exe asset found in latest release.</div>`
                    }
                  </div>
                `
                : `<div class="form-hint">${t("upToDateMsg")} (v${this.escapeHtml(this.updateResult.latest_version)} · ${this.escapeHtml(this.updateResult.source)})</div>`
              : ""
          }
        </div>
      `
      : "";

    const securityHtml = showSec("security")
      ? `
        <div class="settings-card-block" data-sec-group="security">
          <div class="settings-block-title">${t("setPermBlock")}</div>

          <div class="settings-toggle-row" data-setting-search="local permissions web browser fetch url docs internet">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setPermWebTitle")}</div>
              <div class="toggle-desc">${t("setPermWebDesc")}</div>
            </div>
            <select id="set-perm-web" class="studio-input settings-compact-control">
              <option value="ask" ${prefs.permWebFetch === "ask" ? "selected" : ""}>${t("permModeAsk")}</option>
              <option value="allow" ${prefs.permWebFetch === "allow" ? "selected" : ""}>${t("permModeAllow")}</option>
              <option value="deny" ${prefs.permWebFetch === "deny" ? "selected" : ""}>${t("permModeDeny")}</option>
            </select>
          </div>

          <div class="settings-toggle-row" data-setting-search="local permissions package install pip npm cargo uv">
            <div class="toggle-meta">
              <div class="toggle-title">${t("setPermPkgTitle")}</div>
              <div class="toggle-desc">${t("setPermPkgDesc")}</div>
            </div>
            <select id="set-perm-pkg" class="studio-input settings-compact-control">
              <option value="ask" ${prefs.permPackageInstall === "ask" ? "selected" : ""}>${t("permModeAsk")}</option>
              <option value="allow" ${prefs.permPackageInstall === "allow" ? "selected" : ""}>${t("permModeAllow")}</option>
              <option value="deny" ${prefs.permPackageInstall === "deny" ? "selected" : ""}>${t("permModeDeny")}</option>
            </select>
          </div>

          <div class="form-group" style="margin-top: 6px;" data-setting-search="trusted sources domains pypi npm github">
            <label for="set-perm-sources">${t("setPermSourcesTitle")}</label>
            <input id="set-perm-sources" class="studio-input" type="text" value="${this.escapeAttr(prefs.permTrustedSources || "")}" autocomplete="off" />
            <div class="form-hint">${this.escapeHtml(t("setPermSourcesDesc"))}</div>
          </div>
        </div>

        <div class="settings-card-block" data-sec-group="security">
          <div class="settings-block-title">${t("setSecBlock")}</div>
          <div class="security-rules-grid">
            <div class="security-rule-row">
              <div class="security-rule-title">${this.escapeHtml(t("secRule1Title"))}</div>
              <div class="security-rule-desc">${this.escapeHtml(t("secRule1Desc"))}</div>
            </div>
            <div class="security-rule-row">
              <div class="security-rule-title">${this.escapeHtml(t("secRule2Title"))}</div>
              <div class="security-rule-desc">${this.escapeHtml(t("secRule2Desc"))}</div>
            </div>
            <div class="security-rule-row">
              <div class="security-rule-title">${this.escapeHtml(t("secRule3Title"))}</div>
              <div class="security-rule-desc">${this.escapeHtml(t("secRule3Desc"))}</div>
            </div>
            <div class="security-rule-row">
              <div class="security-rule-title">${this.escapeHtml(t("secRule4Title"))}</div>
              <div class="security-rule-desc">${this.escapeHtml(t("secRule4Desc"))}</div>
            </div>
            <div class="security-rule-row">
              <div class="security-rule-title">${this.escapeHtml(t("secRule5Title"))}</div>
              <div class="security-rule-desc">${this.escapeHtml(t("secRule5Desc"))}</div>
            </div>
          </div>
        </div>

        <div class="settings-card-block" data-sec-group="security">
          <div class="settings-block-title">${t("setManageBlock")}</div>
          <div class="settings-inline-actions">
            <button type="button" class="studio-btn studio-btn-sm" id="btn-export-settings">${t("exportSettingsJson")}</button>
            <button type="button" class="studio-btn studio-btn-sm studio-btn-danger" id="btn-reset-settings">${t("resetAllSettings")}</button>
          </div>
          ${this.noticeText ? `<div class="form-hint">${this.escapeHtml(this.noticeText)}</div>` : ""}
        </div>
      `
      : "";

    this.container.innerHTML = `
      <div class="full-page-shell page-enter">
        <div class="full-page-header">
          <div class="full-page-title-block">
            <button type="button" class="studio-btn studio-btn-sm" id="btn-settings-back">${t("backToEditor")}</button>
            <div>
              <h1 class="full-page-title">${t("settingsPageTitle")}</h1>
              <div class="full-page-subtitle">${t("settingsPageSubtitle")}</div>
            </div>
          </div>
          <div class="settings-search-wrap">
            <input
              type="text"
              id="settings-search-input"
              class="studio-input"
              placeholder="${this.escapeAttr(t("settingsSearchPlaceholder"))}"
              value="${this.escapeAttr(this.searchQuery)}"
              autocomplete="off"
            />
          </div>
        </div>

        <div class="full-page-body">
          <div class="settings-page-layout">
            <aside class="settings-page-sidebar">${navHtml}</aside>
            <div class="settings-page-content" id="settings-page-content">
              ${generalHtml}
              ${editorHtml}
              ${terminalHtml}
              ${agentHtml}
              ${updatesHtml}
              ${securityHtml}
            </div>
          </div>
        </div>
      </div>
    `;

    if (q) {
      const contentEl = this.container.querySelector("#settings-page-content") as HTMLElement;
      contentEl.querySelectorAll<HTMLElement>("[data-setting-search]").forEach((row) => {
        const hay = `${row.dataset.settingSearch || ""} ${row.textContent || ""}`.toLowerCase();
        row.style.display = hay.includes(q) ? "" : "none";
      });
      contentEl.querySelectorAll<HTMLElement>("[data-sec-group]").forEach((card) => {
        const rows = Array.from(card.querySelectorAll<HTMLElement>("[data-setting-search]"));
        if (rows.length > 0 && rows.every((r) => r.style.display === "none")) {
          card.style.display = "none";
        }
      });
    }

    this.container.querySelector("#btn-settings-back")?.addEventListener("click", () => this.onBackToWorkspace?.());

    const searchIn = this.container.querySelector("#settings-search-input") as HTMLInputElement | null;
    searchIn?.addEventListener("input", () => {
      this.searchQuery = searchIn.value;
      const pos = searchIn.selectionStart || this.searchQuery.length;
      this.render();
      const nextIn = this.container.querySelector("#settings-search-input") as HTMLInputElement | null;
      if (nextIn) {
        nextIn.focus();
        nextIn.setSelectionRange(pos, pos);
      }
    });

    this.container.querySelectorAll<HTMLButtonElement>("[data-sec]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.searchQuery = "";
        this.activeSection = btn.dataset.sec as SettingsSectionId;
        this.render();
      });
    });

    this.bindSelect("#set-language", (v) => {
      studioSettings.update({ language: v as any });
      this.render();
    });
    this.bindSelect("#set-ui-scale", (v) => studioSettings.update({ uiScale: Number(v) }));
    this.bindCheck("#set-smooth-anim", (v) => studioSettings.update({ smoothAnimations: v }));
    this.bindCheck("#set-compact-sidebar", (v) => studioSettings.update({ compactSidebar: v }));
    this.bindCheck("#set-show-statusbar", (v) => studioSettings.update({ showStatusBar: v }));
    this.bindCheck("#set-statusbar-clock", (v) => studioSettings.update({ showStatusBarClock: v }));
    this.bindCheck("#set-reopen-last", (v) => studioSettings.update({ reopenLastProject: v }));
    this.bindCheck("#set-restore-chat", (v) => studioSettings.update({ restoreLastChatSession: v }));
    this.bindCheck("#set-confirm-delete", (v) => studioSettings.update({ confirmBeforeDelete: v }));

    const winOpenWithEl = this.container.querySelector("#set-win-openwith") as HTMLInputElement | null;
    winOpenWithEl?.addEventListener("change", async () => {
      const next = winOpenWithEl.checked;
      this.winOpenWithBusy = true;
      this.render();
      try {
        const res = await invoke<boolean>("studio_set_windows_open_with", { enabled: next });
        this.winOpenWithRegistered = res;
        this.noticeText = res ? t("winOpenWithEnabledNotice") : t("winOpenWithDisabledNotice");
      } catch (e: any) {
        this.noticeText = String(e);
      } finally {
        this.winOpenWithBusy = false;
        this.render();
      }
    });

    this.bindSelect("#set-font-size", (v) => studioSettings.update({ fontSize: Number(v) }));
    this.bindSelect("#set-line-height", (v) => studioSettings.update({ lineHeight: Number(v) }));
    this.bindSelect("#set-font-family", (v) => studioSettings.update({ fontFamily: v }));
    this.bindSelect("#set-tab-size", (v) => studioSettings.update({ tabSize: Number(v) }));
    this.bindSelect("#set-cursor-style", (v) => studioSettings.update({ cursorStyle: v as any }));
    this.bindCheck("#set-word-wrap", (v) => studioSettings.update({ wordWrap: v }));
    this.bindCheck("#set-line-numbers", (v) => studioSettings.update({ showLineNumbers: v }));
    this.bindCheck("#set-active-line", (v) => studioSettings.update({ highlightActiveLine: v }));
    this.bindCheck("#set-show-minimap", (v) => studioSettings.update({ showMinimap: v }));
    this.bindCheck("#set-brackets", (v) => studioSettings.update({ bracketMatching: v }));
    this.bindCheck("#set-autoclose-brackets", (v) => studioSettings.update({ autoCloseBrackets: v }));
    this.bindCheck("#set-code-folding", (v) => studioSettings.update({ codeFolding: v }));
    this.bindCheck("#set-breadcrumbs", (v) => studioSettings.update({ showBreadcrumbs: v }));
    this.bindCheck("#set-git-blame", (v) => studioSettings.update({ showInlineGitBlame: v }));
    this.bindCheck("#set-code-diag", (v) => studioSettings.update({ enableCodeDiagnostics: v }));
    this.bindCheck("#set-sel-bar", (v) => studioSettings.update({ enableSelectionAiBar: v }));
    this.bindCheck("#set-auto-save", (v) => studioSettings.update({ autoSave: v }));
    this.bindSelect("#set-autosave-delay", (v) => studioSettings.update({ autoSaveDelayMs: Number(v) }));
    this.bindCheck("#set-trim-ws", (v) => studioSettings.update({ trimTrailingWhitespace: v }));
    this.bindCheck("#set-final-nl", (v) => studioSettings.update({ insertFinalNewline: v }));

    this.bindSelect("#set-term-font", (v) => studioSettings.update({ terminalFontSize: Number(v) }));
    this.bindSelect("#set-term-scrollback", (v) => studioSettings.update({ terminalScrollback: Number(v) }));
    this.bindCheck("#set-term-aifix", (v) => studioSettings.update({ showTerminalAiFix: v }));
    this.bindCheck("#set-term-sync", (v) => studioSettings.update({ syncTerminalCwd: v }));
    this.bindCheck("#set-term-ts", (v) => studioSettings.update({ terminalShowTimestamps: v }));

    this.bindSelect("#set-temp", (v) => studioSettings.update({ temperature: Number(v) }));
    this.bindSelect("#set-agent-steps", (v) => studioSettings.update({ maxAgentSteps: Number(v) }));
    this.bindCheck("#set-perf-stats", (v) => studioSettings.update({ showPerfStats: v }));
    this.bindCheck("#set-ctx-meter", (v) => studioSettings.update({ showContextMeter: v }));
    this.bindCheck("#set-ghost-text", (v) => studioSettings.update({ enableGhostText: v }));
    this.bindCheck("#set-auto-scroll", (v) => studioSettings.update({ autoScrollChat: v }));
    this.bindCheck("#set-expand-diff", (v) => studioSettings.update({ expandDiffsByDefault: v }));

    const promptArea = this.container.querySelector("#set-custom-prompt") as HTMLTextAreaElement | null;
    promptArea?.addEventListener("change", () => {
      studioSettings.update({ customSystemPrompt: promptArea.value });
    });

    this.container.querySelector("#btn-goto-local-models")?.addEventListener("click", () => this.onOpenModelsPage?.("local"));
    this.container.querySelector("#btn-goto-cloud-models")?.addEventListener("click", () => this.onOpenModelsPage?.("cloud"));
    this.container.querySelector("#btn-goto-mcp-page")?.addEventListener("click", () => this.onOpenMcpPage?.());

    // Updates listeners
    this.bindCheck("#set-auto-updates", (v) => studioSettings.update({ autoCheckUpdates: v }));
    const repoIn = this.container.querySelector("#set-github-repo") as HTMLInputElement | null;
    repoIn?.addEventListener("change", () => studioSettings.update({ githubRepo: repoIn.value.trim() }));
    const urlIn = this.container.querySelector("#set-custom-update-url") as HTMLInputElement | null;
    urlIn?.addEventListener("change", () => studioSettings.update({ customUpdateUrl: urlIn.value.trim() }));

    this.container.querySelector("#btn-check-updates")?.addEventListener("click", async () => {
      if (repoIn) studioSettings.update({ githubRepo: repoIn.value.trim() });
      if (urlIn) studioSettings.update({ customUpdateUrl: urlIn.value.trim() });
      const cur = studioSettings.get();
      this.checkingUpdates = true;
      this.updateError = null;
      this.updateProgress = null;
      this.render();
      try {
        const res = await invoke<UpdateCheckResult>("updater_check", {
          repo: cur.githubRepo || "HuseynDeveloper/mintu-studio",
          customManifestUrl: cur.customUpdateUrl || null,
        });
        this.updateResult = res;
        this.onUpdateChecked?.(res);
      } catch (e: any) {
        this.updateError = String(e);
        this.updateResult = null;
      } finally {
        this.checkingUpdates = false;
        this.render();
      }
    });

    this.container.querySelector("#btn-install-update")?.addEventListener("click", async () => {
      if (!this.updateResult?.download_url || this.installingUpdate) return;
      this.installingUpdate = true;
      this.updateError = null;
      this.render();
      try {
        await invoke("updater_download_and_install", {
          downloadUrl: this.updateResult.download_url,
          expectedSha256: this.updateResult.sha256,
        });
      } catch (e: any) {
        this.updateError = String(e);
        this.installingUpdate = false;
        this.render();
      }
    });

    this.bindSelect("#set-perm-web", (v) => studioSettings.update({ permWebFetch: v as any }));
    this.bindSelect("#set-perm-pkg", (v) => studioSettings.update({ permPackageInstall: v as any }));
    const permSourcesIn = this.container.querySelector("#set-perm-sources") as HTMLInputElement | null;
    permSourcesIn?.addEventListener("change", () => {
      studioSettings.update({ permTrustedSources: permSourcesIn.value.trim() });
    });

    this.container.querySelector("#btn-export-settings")?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(JSON.stringify(studioSettings.get(), null, 2));
        this.noticeText = t("settingsCopiedNotice");
        this.render();
      } catch {}
    });

    this.container.querySelector("#btn-reset-settings")?.addEventListener("click", async () => {
      const ok = await showConfirmDialog({
        title: t("settingsResetTitle"),
        message: t("settingsResetMsg"),
        confirmText: t("settingsResetConfirm"),
        danger: true,
      });
      if (ok) {
        studioSettings.reset();
        this.noticeText = t("settingsResetNotice");
        this.render();
      }
    });
  }

  private bindSelect(sel: string, cb: (val: string) => void): void {
    const el = this.container.querySelector(sel) as HTMLSelectElement | null;
    el?.addEventListener("change", () => cb(el.value));
  }

  private bindCheck(sel: string, cb: (checked: boolean) => void): void {
    const el = this.container.querySelector(sel) as HTMLInputElement | null;
    el?.addEventListener("change", () => cb(el.checked));
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  private escapeAttr(str: string): string {
    return this.escapeHtml(str).replace(/"/g, "&quot;");
  }
}
