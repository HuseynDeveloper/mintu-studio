/**
 * StudioSettings.ts
 * Comprehensive persistent settings store for Mintu Studio
 * (General/UI, Editor, Terminal, Local LLM Engine, AI & Agent).
 */

export type StudioLanguage = "az" | "en" | "tr" | "ru";
export type PermissionMode = "ask" | "allow" | "deny";

export interface StudioPreferences {
  // General & Appearance
  language: StudioLanguage;
  uiScale: number; // 90..115 (%)
  smoothAnimations: boolean;
  compactSidebar: boolean;
  showStatusBar: boolean;
  showStatusBarClock: boolean;
  reopenLastProject: boolean;
  restoreLastChatSession: boolean;
  confirmBeforeDelete: boolean;

  // Editor
  fontSize: number; // 11..20
  lineHeight: number; // 1.3..1.9
  fontFamily: string;
  tabSize: number; // 2 | 4 | 8
  cursorStyle: "line" | "block" | "underline";
  wordWrap: boolean;
  showLineNumbers: boolean;
  highlightActiveLine: boolean;
  showMinimap: boolean;
  bracketMatching: boolean;
  autoCloseBrackets: boolean;
  codeFolding: boolean;
  showBreadcrumbs: boolean;
  showInlineGitBlame: boolean;
  enableCodeDiagnostics: boolean;
  enableSelectionAiBar: boolean;
  autoSave: boolean;
  autoSaveDelayMs: number; // 500..5000
  trimTrailingWhitespace: boolean;
  insertFinalNewline: boolean;

  // Terminal
  terminalFontSize: number; // 11..16
  terminalScrollback: number; // 300..2500
  showTerminalAiFix: boolean;
  syncTerminalCwd: boolean;
  terminalShowTimestamps: boolean;

  // Local LLM Engine (manual launch parameters)
  modelsDir: string;
  localPort: number;
  ctxSize: number;
  threads: number; // 0 = auto
  gpuLayers: number;
  temperature: number;

  // AI & Agent
  maxAgentSteps: number;
  showPerfStats: boolean;
  showContextMeter: boolean;
  enableGhostText: boolean;
  autoScrollChat: boolean;
  expandDiffsByDefault: boolean;
  customSystemPrompt: string;

  // GitHub Auto-Updater
  githubRepo: string;
  autoCheckUpdates: boolean;
  customUpdateUrl: string;

  // Local Permissions (Web Fetching & Package Auto-Install)
  permWebFetch: PermissionMode;
  permPackageInstall: PermissionMode;
  permTrustedSources: string;
}

const PREFS_KEY = "mintu_studio_preferences_v1";

export const DEFAULT_PREFERENCES: StudioPreferences = {
  language: "az",
  uiScale: 100,
  smoothAnimations: true,
  compactSidebar: false,
  showStatusBar: true,
  showStatusBarClock: false,
  reopenLastProject: false,
  restoreLastChatSession: false,
  confirmBeforeDelete: true,

  fontSize: 13,
  lineHeight: 1.55,
  fontFamily: '"Cascadia Code", "JetBrains Mono", Consolas, "Courier New", monospace',
  tabSize: 2,
  cursorStyle: "line",
  wordWrap: false,
  showLineNumbers: true,
  highlightActiveLine: true,
  showMinimap: true,
  bracketMatching: true,
  autoCloseBrackets: true,
  codeFolding: true,
  showBreadcrumbs: true,
  showInlineGitBlame: true,
  enableCodeDiagnostics: true,
  enableSelectionAiBar: true,
  autoSave: false,
  autoSaveDelayMs: 1500,
  trimTrailingWhitespace: false,
  insertFinalNewline: false,

  terminalFontSize: 12,
  terminalScrollback: 600,
  showTerminalAiFix: true,
  syncTerminalCwd: true,
  terminalShowTimestamps: false,

  modelsDir: "",
  localPort: 8090,
  ctxSize: 4096,
  threads: 0,
  gpuLayers: 0,
  temperature: 0.2,

  maxAgentSteps: 5,
  showPerfStats: true,
  showContextMeter: true,
  enableGhostText: false,
  autoScrollChat: true,
  expandDiffsByDefault: false,
  customSystemPrompt: "",

  githubRepo: "HuseynDeveloper/mintu-studio",
  autoCheckUpdates: true,
  customUpdateUrl: "",

  permWebFetch: "ask",
  permPackageInstall: "ask",
  permTrustedSources:
    "pypi.org, registry.npmjs.org, crates.io, github.com, raw.githubusercontent.com, docs.python.org, developer.mozilla.org",
};

type PrefsListener = (prefs: StudioPreferences) => void;

class StudioSettingsStore {
  private prefs: StudioPreferences;
  private listeners: Set<PrefsListener> = new Set();

  constructor() {
    this.prefs = this.load();
  }

  private load(): StudioPreferences {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const merged: StudioPreferences = { ...DEFAULT_PREFERENCES, ...parsed };
        // One-time migration: switch default startup behavior to fresh session unless user re-enables in Settings
        if (!localStorage.getItem("mintu_studio_fresh_session_v1")) {
          merged.reopenLastProject = false;
          merged.restoreLastChatSession = false;
          localStorage.setItem("mintu_studio_fresh_session_v1", "1");
          localStorage.setItem(PREFS_KEY, JSON.stringify(merged));
        }
        if (merged.githubRepo === "mintu-studio/mintu-studio") {
          merged.githubRepo = "HuseynDeveloper/mintu-studio";
          localStorage.setItem(PREFS_KEY, JSON.stringify(merged));
        }
        return merged;
      }
      localStorage.setItem("mintu_studio_fresh_session_v1", "1");
    } catch {}
    return { ...DEFAULT_PREFERENCES };
  }

  public get(): StudioPreferences {
    return { ...this.prefs };
  }

  public update(patch: Partial<StudioPreferences>): StudioPreferences {
    this.prefs = { ...this.prefs, ...patch };
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
    } catch {}
    this.listeners.forEach((fn) => fn(this.get()));
    return this.get();
  }

  public reset(): StudioPreferences {
    this.prefs = { ...DEFAULT_PREFERENCES };
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
    } catch {}
    this.listeners.forEach((fn) => fn(this.get()));
    return this.get();
  }

  public subscribe(listener: PrefsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const studioSettings = new StudioSettingsStore();
