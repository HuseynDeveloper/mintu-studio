/**
 * StudioApp.ts
 * Main coordinator for Standalone Mintu Studio (Phase 2: Full Working AI Code IDE + MCP).
 */

import { invoke } from "@tauri-apps/api/core";
import { FileTree, StudioFileEntry } from "./FileTree";
import { CodeViewer, EditorStatusInfo, SymbolMatchItem } from "./CodeViewer";
import { StudioChat } from "./StudioChat";
import { McpServerStatusView } from "./McpModal";
import { ModelsPage, ModelsSubTab } from "./ModelsPage";
import { McpPage } from "./McpPage";
import { ExtensionsPage, MintuExtension } from "./ExtensionsPage";
import { ApiTesterPage } from "./ApiTesterPage";
import { PreviewPortsPage } from "./PreviewPortsPage";
import { DataExplorerPage } from "./DataExplorerPage";
import { openCompareFilesModal, openNewProjectTemplateModal } from "./CompareModal";
import { openTimelineModal, saveTimelineSnapshot } from "./LocalTimeline";
import { SettingsPage, SettingsSectionId, UpdateCheckResult } from "./SettingsPage";
import { BottomPanel, GrepMatchItem, ProjectScriptItem, TodoScanItem, WorkspaceDiagItem } from "./BottomPanel";
import { CommandPalette, PaletteCommand } from "./CommandPalette";
import { GitModal, GitRepoInfo } from "./GitModal";
import { showConfirmDialog, showInputDialog } from "./InputDialog";
import { isSensitiveFileOrDir } from "./sensitiveFilter";
import { studioSettings } from "./StudioSettings";
import { applyI18nToStaticDom, t } from "./i18n";
import { StudioAIClient } from "../ai/StudioAIClient";
import { getAllCloudProviders } from "../ai/cloudCatalog";
import { detectLocalModels, DetectedLocalModel, formatModelDisplayName } from "../ai/LocalModelDetector";

const RECENT_PROJECTS_KEY = "mintu_studio_recent_projects_v1";

interface RecentProjectItem {
  path: string;
  name: string;
}

type ActiveStudioPage = "workspace" | "models" | "mcp" | "extensions" | "api" | "preview" | "data" | "settings";

export class StudioApp {
  private fileTree!: FileTree;
  private codeViewer!: CodeViewer;
  private studioChat!: StudioChat;
  private bottomPanel!: BottomPanel;
  private aiClient!: StudioAIClient;
  private modelsPage!: ModelsPage;
  private mcpPage!: McpPage;
  private extensionsPage!: ExtensionsPage;
  private apiTesterPage!: ApiTesterPage;
  private previewPortsPage!: PreviewPortsPage;
  private dataExplorerPage!: DataExplorerPage;
  private settingsPage!: SettingsPage;
  private commandPalette!: CommandPalette;
  private gitModal!: GitModal;
  private baseCommands: PaletteCommand[] = [];
  private cachedProjectFiles: string[] = [];
  private blameTimer: number | null = null;
  private lastBlameKey = "";

  private activePage: ActiveStudioPage = "workspace";
  private lastFingerprint = "";
  private watcherTimer: number | null = null;
  private clockTimer: number | null = null;

  private currentProjectRoot: string | null = null;
  private detectedLocalModels: DetectedLocalModel[] = [];

  private explorerVisible = true;
  private rightPanelVisible = true;
  private rightPanelExpanded = false;
  private openPopover: HTMLElement | null = null;

  constructor() {
    this.initDOM();
    this.initSubsystems();
    this.initTopBar();
    this.initRail();
    this.initResizers();
    this.initGlobalShortcuts();
    this.checkCurrentProject();
    this.refreshAllModelIndicators();
    this.backgroundDetectLocalModels();
    this.syncMcpServers();
    this.syncExtensions();
    this.startLiveFileWatcher();
    this.backgroundCheckUpdates();
  }

  private initDOM(): void {
    const treeContainer = document.getElementById("studio-file-tree");
    const editorContainer = document.getElementById("studio-editor-container");
    const tabsContainer = document.getElementById("studio-tabs-bar");
    const minimapWrap = document.getElementById("studio-minimap-wrap");
    const minimapCanvas = document.getElementById("studio-minimap-canvas") as HTMLCanvasElement | null;
    const minimapThumb = document.getElementById("studio-minimap-thumb");
    const chatContainer = document.getElementById("studio-chat-container");
    const bottomContainer = document.getElementById("studio-bottom-panel");
    const modelsPageEl = document.getElementById("studio-page-models");
    const mcpPageEl = document.getElementById("studio-page-mcp");
    const extensionsPageEl = document.getElementById("studio-page-extensions");
    const apiPageEl = document.getElementById("studio-page-api");
    const previewPageEl = document.getElementById("studio-page-preview");
    const dataPageEl = document.getElementById("studio-page-data");
    const settingsPageEl = document.getElementById("studio-page-settings");

    if (
      !treeContainer ||
      !editorContainer ||
      !tabsContainer ||
      !minimapWrap ||
      !minimapCanvas ||
      !minimapThumb ||
      !chatContainer ||
      !bottomContainer ||
      !modelsPageEl ||
      !mcpPageEl ||
      !extensionsPageEl ||
      !apiPageEl ||
      !previewPageEl ||
      !dataPageEl ||
      !settingsPageEl
    ) {
      throw new Error("Missing required Studio DOM elements");
    }

    this.aiClient = new StudioAIClient();
    this.modelsPage = new ModelsPage(modelsPageEl, this.aiClient);
    this.mcpPage = new McpPage(mcpPageEl);
    this.extensionsPage = new ExtensionsPage(extensionsPageEl);
    this.apiTesterPage = new ApiTesterPage(apiPageEl);
    this.previewPortsPage = new PreviewPortsPage(previewPageEl);
    this.dataExplorerPage = new DataExplorerPage(dataPageEl);
    this.settingsPage = new SettingsPage(settingsPageEl);
    this.commandPalette = new CommandPalette();
    this.gitModal = new GitModal(this.aiClient);
    this.fileTree = new FileTree(treeContainer);
    this.codeViewer = new CodeViewer(editorContainer, tabsContainer, minimapWrap, minimapCanvas, minimapThumb);
    this.studioChat = new StudioChat(chatContainer, this.aiClient);
    this.bottomPanel = new BottomPanel(bottomContainer);
  }

  private initSubsystems(): void {
    this.aiClient.onAuditLog = (cat, msg, detail) => {
      this.bottomPanel.logActivity(cat, msg, detail);
    };

    this.aiClient.onRoutingAutoResolved = (baseUrl, model) => {
      const mPort = baseUrl.match(/:(\d{2,5})/);
      if (mPort) {
        studioSettings.update({ localPort: Number(mPort[1]) });
      }
      this.refreshAllModelIndicators();
      this.bottomPanel.logActivity("system", `Aktiv yerli port avtomatik tapıldı: ${formatModelDisplayName(model)} (${baseUrl})`);
    };

    this.mcpPage.onServersUpdated = (servers) => {
      this.applyMcpServersState(servers);
    };
    this.mcpPage.onBackToWorkspace = () => this.openPage("workspace");

    this.extensionsPage.onBackToWorkspace = () => this.openPage("workspace");
    this.extensionsPage.onExtensionsChanged = (exts) => {
      this.applyExtensionsState(exts);
    };

    this.apiTesterPage.onBackToWorkspace = () => this.openPage("workspace");
    this.previewPortsPage.onBackToWorkspace = () => this.openPage("workspace");
    this.dataExplorerPage.onBackToWorkspace = () => this.openPage("workspace");

    this.modelsPage.onBackToWorkspace = () => this.openPage("workspace");
    this.modelsPage.onAuditLog = (cat, msg) => {
      this.bottomPanel.logActivity(cat, msg);
    };

    this.settingsPage.onBackToWorkspace = () => this.openPage("workspace");
    this.settingsPage.onOpenModelsPage = (tab) => this.openPage("models", tab);
    this.settingsPage.onOpenMcpPage = () => this.openPage("mcp");
    this.settingsPage.onUpdateChecked = (res) => this.applyUpdateBadge(res);

    const updateStatusClock = () => {
      const clockEl = document.getElementById("status-clock");
      if (!clockEl) return;
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      clockEl.textContent = `${hh}:${mm}`;
    };

    const applyGlobalPrefs = () => {
      const prefs = studioSettings.get();
      document.body.classList.toggle("reduced-motion-forced", !prefs.smoothAnimations);
      document.body.classList.toggle("is-compact-sidebar", !!prefs.compactSidebar);
      document.body.classList.toggle("cursor-block", prefs.cursorStyle === "block");
      document.body.classList.toggle("cursor-underline", prefs.cursorStyle === "underline");
      document.documentElement.style.setProperty("--term-font-size", `${prefs.terminalFontSize || 12}px`);
      (document.documentElement.style as any).zoom = `${prefs.uiScale || 100}%`;
      const statusBar = document.querySelector<HTMLElement>(".studio-statusbar");
      if (statusBar) statusBar.style.display = prefs.showStatusBar ? "flex" : "none";

      const clockEl = document.getElementById("status-clock");
      if (clockEl) {
        if (prefs.showStatusBarClock) {
          clockEl.style.display = "inline-block";
          updateStatusClock();
          if (this.clockTimer === null) {
            this.clockTimer = window.setInterval(updateStatusClock, 15000);
          }
        } else {
          clockEl.style.display = "none";
          if (this.clockTimer !== null) {
            window.clearInterval(this.clockTimer);
            this.clockTimer = null;
          }
        }
      }

      if (!prefs.showInlineGitBlame) {
        const blameEl = document.getElementById("status-git-blame");
        if (blameEl) blameEl.style.display = "none";
        this.lastBlameKey = "";
      }

      applyI18nToStaticDom(!!this.currentProjectRoot);
    };
    applyGlobalPrefs();
    studioSettings.subscribe(() => {
      applyGlobalPrefs();
    });

    // Recent projects + Command Palette + Git Modal wiring
    this.fileTree.setRecentProjects(this.getRecentProjects());
    this.fileTree.onOpenRecentProject = (p) => void this.openRecentProject(p);
    this.fileTree.onContextMenuRequest = (entry, x, y) => this.showTreeContextMenu(entry, x, y);

    this.gitModal.onGitChanged = () => {
      void this.refreshProjectIndexAndGit();
      void this.fileTree.refresh();
    };

    this.gitModal.onReviewDiffWithAi = (diff, files) => {
      this.openPage("workspace");
      this.setRightPanelVisible(true);
      const summary = files.map((f) => `${f.status} ${f.path}`).join("\n");
      const prompt = `Perform a thorough code review of my current Git changes (bugs, security issues, edge cases, performance, code quality).\n\nChanged files:\n<untrusted_data>\n${summary}\n</untrusted_data>\n\nDiff:\n<untrusted_data>\n${diff.slice(0, 10000)}\n</untrusted_data>`;
      this.studioChat.sendPrefilledPrompt(prompt, true);
    };

    document.getElementById("status-git-btn")?.addEventListener("click", () => {
      void this.gitModal.open();
    });

    this.commandPalette.onOpenFile = (relPath) => {
      void this.openProjectFile(relPath, false);
    };
    this.baseCommands = [
      { id: "open-folder", label: t("openFolder"), category: "File", action: () => void this.handlePickFolder() },
      { id: "new-file", label: t("newFile"), category: "File", action: () => void this.handleCreateEntry(false) },
      { id: "new-dir", label: t("newFolder"), category: "File", action: () => void this.handleCreateEntry(true) },
      { id: "inline-ai", label: `${t("inlineEdit")} (Ctrl+K)`, category: "AI", shortcut: "Ctrl+K", action: () => this.codeViewer.openInlineAiEdit() },
      { id: "outline", label: `${t("outline")} (Ctrl+Shift+O)`, category: "Editor", shortcut: "Ctrl+Shift+O", action: () => this.codeViewer.openOutlinePopup() },
      { id: "goto-def", label: `${t("definitionsAndRefs")} (F12)`, category: "Editor", shortcut: "F12", action: () => void this.codeViewer.triggerGoToDefinition() },
      { id: "timeline", label: t("timelineTitle"), category: "Editor", action: () => { const a = this.codeViewer.getActiveFile(); if (a) this.openFileTimeline(a); } },
      { id: "format", label: `${t("formatCode")} (Alt+Shift+F)`, category: "Editor", shortcut: "Alt+Shift+F", action: () => this.codeViewer.formatActiveFile() },
      { id: "split-editor", label: t("splitEditor"), category: "Editor", action: () => this.codeViewer.toggleSplitEditor() },
      { id: "minturules", label: "Create / Open .minturules", category: "AI", action: () => void this.openOrCreateMintuRules() },
      { id: "compact-chat", label: t("compactChat"), category: "AI", action: () => { void this.aiClient.compactConversation(); } },
      { id: "toggle-chat", label: `Mintu AI (Ctrl+L)`, category: "AI", shortcut: "Ctrl+L", action: () => this.setRightPanelVisible(!this.rightPanelVisible) },
      { id: "new-chat", label: t("newChat"), category: "AI", action: () => { this.setRightPanelVisible(true); this.aiClient.createNewSession(t("newChat")); } },
      { id: "focus-term", label: `${t("terminal")} (Ctrl+\`)`, category: "Terminal", shortcut: "Ctrl+`", action: () => this.bottomPanel.focusTerminal() },
      { id: "new-term", label: t("newTerminal"), category: "Terminal", action: () => { this.bottomPanel.setActiveTab("terminal"); void this.bottomPanel.openNewTerminal(); } },
      { id: "scripts", label: t("scripts"), category: "Terminal", action: () => this.bottomPanel.setActiveTab("scripts") },
      { id: "git-modal", label: t("gitStatus"), category: "Git", action: () => void this.gitModal.open() },
      { id: "local-models", label: t("localModelsTab"), category: "Models", action: () => this.openPage("models", "local") },
      { id: "cloud-models", label: t("cloudProvidersTab"), category: "Models", action: () => this.openPage("models", "cloud") },
      { id: "extensions", label: t("extensions"), category: "Tools", action: () => this.openPage("extensions") },
      { id: "api-tester", label: t("apiTester"), category: "Tools", action: () => this.openPage("api") },
      { id: "preview-ports", label: t("previewPortsNav"), category: "Tools", action: () => this.openPage("preview") },
      { id: "data-explorer", label: t("dataExplorerNav"), category: "Tools", action: () => this.openPage("data") },
      { id: "compare-files", label: t("compareFilesMenu"), category: "Tools", action: () => openCompareFilesModal(this.cachedProjectFiles, this.codeViewer.getActiveFile()?.path) },
      { id: "new-template", label: t("newProjectTemplateMenu"), category: "File", action: () => this.openProjectTemplates() },
      { id: "check-project", label: t("checkProjectBtn"), category: "Tools", action: () => void this.runWorkspaceProjectCheck() },
      { id: "scan-todos", label: `${t("todosTab")} — ${t("scanTodosBtn")}`, category: "Tools", action: () => { this.bottomPanel.setActiveTab("todos"); void this.scanWorkspaceTodos(); } },
      { id: "check-updates", label: t("checkUpdatesBtn"), category: "Settings", action: () => this.openPage("settings", "updates") },
      { id: "mcp", label: t("mcpServers"), category: "Tools", action: () => this.openPage("mcp") },
      { id: "settings", label: t("settings"), category: "Settings", action: () => this.openPage("settings") },
      { id: "fullscreen", label: "Fullscreen (F11)", category: "View", shortcut: "F11", action: () => { invoke("studio_toggle_fullscreen").catch(() => {}); } },
    ];
    this.commandPalette.setCommands(this.baseCommands);

    this.codeViewer.onInlineAiGenerate = async (tab, selectedCode, instruction, onDelta, signal) => {
      if (isSensitiveFileOrDir(tab.path)) {
        throw new Error("Həssas fayllar üzərində AI redaktə bloklanıb.");
      }
      const sys = "You are a precise code editor. Return ONLY the replacement code for the selected snippet, with no explanations and no surrounding prose. Preserve indentation and coding style.";
      const prompt = `File: ${tab.path} (${tab.language})\nInstruction: ${instruction}\n\nSelected code:\n<untrusted_data>\n${selectedCode}\n</untrusted_data>\n\nReturn ONLY the updated code snippet:`;
      this.bottomPanel.logActivity("send", `Inline AI redaktə sorğusu: ${tab.path}`);
      return await this.aiClient.generateOneShotText(prompt, sys, onDelta, signal);
    };

    this.studioChat.onMentionAttachFile = async (relPath) => {
      if (isSensitiveFileOrDir(relPath)) {
        this.bottomPanel.logActivity("blocked", `@fayl həssas fayl bloklandı: ${relPath}`);
        this.showToast("Həssas fayl kontekstə qoşula bilməz.", "error");
        return;
      }
      try {
        const content: string = await invoke("studio_read_file", { relPath });
        this.studioChat.attachFile(relPath, content);
        this.fileTree.setAttached(relPath, true);
        this.bottomPanel.logActivity("read", `@fayl ilə kontekstə qoşuldu: ${relPath}`);
      } catch (e: any) {
        this.showToast(`Fayl qoşulmadı: ${e}`, "error");
      }
    };

    this.bottomPanel.onFixTerminalError = (command, stderr, cwd) => {
      this.setRightPanelVisible(true);
      const prompt = `An error occurred running this command in Terminal:\nCWD: ${cwd}\nCommand: \`${command || "(unknown)"}\`\n\nError output:\n\`\`\`\n${stderr.slice(0, 2200)}\n\`\`\`\n\nExplain the root cause concisely and fix it using <mintu_edit> or propose_command.`;
      this.studioChat.sendPrefilledPrompt(prompt, true);
    };

    this.bottomPanel.onFixDiagnosticError = async (path, line, message) => {
      this.openPage("workspace");
      this.setRightPanelVisible(true);
      if (!isSensitiveFileOrDir(path)) {
        try {
          const content = await invoke<string>("studio_read_file", { relPath: path });
          this.studioChat.attachFile(path, content);
          this.fileTree.setAttached(path, true);
        } catch {}
      }
      const prompt = `Fix the code error in \`${path}\` at line ${line}: "${message}". Emit <mintu_edit path="${path}" reason="Fix line ${line}"> with the corrected complete file.`;
      this.studioChat.sendPrefilledPrompt(prompt, true);
    };

    this.bottomPanel.onCheckProjectRequest = async () => {
      await this.runWorkspaceProjectCheck();
    };

    this.bottomPanel.onScanTodosRequest = async () => {
      await this.scanWorkspaceTodos();
    };

    this.modelsPage.onSettingsSaved = () => {
      this.refreshAllModelIndicators();
      this.backgroundDetectLocalModels();
      const routing = this.aiClient.getActiveRouting();
      this.bottomPanel.logActivity(
        "system",
        routing.isLocal
          ? `Model dəyişdirildi: ${formatModelDisplayName(routing.model)}`
          : `Model dəyişdirildi: ${routing.provider} · ${routing.model}`
      );
      this.showToast("Model və API tənzimləmələri yadda saxlanıldı.", "info");
    };

    // Explorer events
    this.fileTree.onOpenFolderRequest = () => this.handlePickFolder();
    this.fileTree.onListError = (relPath, err) => {
      this.bottomPanel.addProblem("error", relPath, err);
    };

    this.fileTree.onFileSelect = async (entry: StudioFileEntry) => {
      await this.openProjectFile(entry.path, entry.is_sensitive);
    };

    this.fileTree.onFileToggleAttach = async (entry: StudioFileEntry, attached: boolean) => {
      if (attached) {
        if (entry.is_sensitive || isSensitiveFileOrDir(entry.path)) {
          this.fileTree.setAttached(entry.path, false);
          this.bottomPanel.logActivity("blocked", `Həssas faylı kontekstə qoşma cəhdi bloklandı: ${entry.path}`);
          this.bottomPanel.addProblem("warning", entry.path, "Həssas fayl çata qoşula bilməz");
          this.showToast("Həssas (xaric edilib): bu faylı kontekstə qoşmaq qadağandır.", "error");
          return;
        }

        try {
          const content: string = await invoke("studio_read_file", { relPath: entry.path });
          this.studioChat.attachFile(entry.path, content);
          this.bottomPanel.logActivity("read", `Kontekstə qoşuldu: ${entry.path}`);
          this.showToast(`"${entry.name}" kontekstə əlavə olundu.`, "info");
        } catch (err: any) {
          const errText = String(err);
          this.fileTree.setAttached(entry.path, false);
          this.bottomPanel.addProblem("error", entry.path, errText);
          this.showToast(`Fayl qoşulmadı: ${errText}`, "error");
        }
      } else {
        this.studioChat.detachFile(entry.path);
      }
    };

    // CodeViewer events
    this.codeViewer.onStatusChange = (info: EditorStatusInfo) => {
      this.updateEditorStatusBar(info);
    };

    this.codeViewer.onTabChange = (tab) => {
      if (tab) this.fileTree.selectFileByPath(tab.path);
      this.aiClient.setActiveEditorSnapshot(tab?.path || null, tab?.content ?? null);
    };

    this.codeViewer.onContentChange = (tab) => {
      this.aiClient.setActiveEditorSnapshot(tab.path, tab.content);
    };

    this.codeViewer.onDiagnosticsChange = (path, diags) => {
      this.bottomPanel.setCodeDiagnostics(path, diags);
      this.aiClient.setActiveEditorDiagnostics(path, diags);
    };

    this.codeViewer.onFindSymbolRequest = async (symbol) => {
      if (!this.currentProjectRoot) return [];
      try {
        return await invoke<SymbolMatchItem[]>("studio_find_symbol", { symbol, maxResults: 40 });
      } catch {
        return [];
      }
    };

    this.codeViewer.onNavigateToLocation = (relPath, line) => {
      void this.openProjectFile(relPath, false, line);
    };

    this.codeViewer.onOpenTimelineRequest = (tab) => {
      this.openFileTimeline(tab);
    };

    this.codeViewer.onOpenInDataExplorer = (relPath) => {
      this.openPage("data", relPath);
    };

    this.codeViewer.onSelectionAiAction = (action, tab, selectedCode, startLine, endLine) => {
      this.openPage("workspace");
      this.setRightPanelVisible(true);
      if (!isSensitiveFileOrDir(tab.path)) {
        this.studioChat.attachFile(tab.path, tab.content);
        this.fileTree.setAttached(tab.path, true);
      }
      const loc = `\`${tab.path}\` (L${startLine}–L${endLine})`;
      const snippet = `\`\`\`${tab.language.toLowerCase()}\n${selectedCode.slice(0, 4000)}\n\`\`\``;
      if (action === "chat") {
        this.studioChat.sendPrefilledPrompt(`Regarding ${loc}:\n${snippet}\n\n`, false);
        return;
      }
      const verb =
        action === "explain"
          ? `Explain this selected code from ${loc} clearly step by step:`
          : action === "fix"
            ? `Find and fix any bugs or issues in this selected code from ${loc} using <mintu_edit>:`
            : action === "refactor"
              ? `Refactor this selected code from ${loc} for clarity and maintainability using <mintu_edit>:`
              : `Write unit tests for this selected code from ${loc} using <mintu_edit>:`;
      this.studioChat.sendPrefilledPrompt(`${verb}\n\n${snippet}`, true);
    };

    this.codeViewer.onGhostTextRequest = async (tab, prefix, suffix, signal) => {
      const sys = "Complete the code at cursor. Return ONLY the short continuation text (1-2 lines max) with no markdown, no code fences, and no explanation.";
      const prompt = `File: ${tab.path} (${tab.language})\nBefore cursor:\n<untrusted_data>\n${prefix}\n</untrusted_data>\nAfter cursor:\n<untrusted_data>\n${suffix}\n</untrusted_data>\nContinue immediately after the cursor:`;
      return await this.aiClient.generateOneShotText(prompt, sys, undefined, signal);
    };

    this.bottomPanel.onGlobalReplaceRequest = async (query, replacement, paths) => {
      const ok = await showConfirmDialog({
        title: t("replaceAll"),
        message: `"${query}" -> "${replacement}" (${paths.length} files)?`,
        confirmText: t("replaceAll"),
      });
      if (!ok) return;
      try {
        const res = await invoke<{ files_changed: number; replacements: number; changed_paths: string[] }>(
          "studio_replace_in_files",
          { query, replacement, relPaths: paths }
        );
        for (const p of res.changed_paths) {
          const open = this.codeViewer.getOpenTabs().find((x) => x.path === p);
          if (open && !open.dirty) {
            const fresh = await invoke<string>("studio_read_file", { relPath: p }).catch(() => null);
            if (fresh !== null) this.codeViewer.reloadFileFromDisk(p, fresh);
          }
        }
        this.showToast(`${res.replacements} replacements across ${res.files_changed} files.`, "info");
        await this.runContentSearch(query);
        await this.refreshProjectIndexAndGit();
      } catch (e: any) {
        this.showToast(`Replace error: ${e}`, "error");
      }
    };

    this.codeViewer.onAttachActiveRequest = (tab) => {
      this.attachActiveFileToChat(tab.path, tab.name, tab.content);
    };

    this.codeViewer.onOpenChatRequest = () => {
      this.setRightPanelVisible(true);
    };

    this.codeViewer.onSaveFileRequest = async (tab) => {
      if (isSensitiveFileOrDir(tab.path)) {
        this.bottomPanel.logActivity("blocked", `Həssas fayl yazılması bloklandı: ${tab.path}`);
        this.showToast("Həssas fayllara yazmaq qadağandır.", "error");
        return false;
      }
      try {
        saveTimelineSnapshot(this.currentProjectRoot || "default", tab.path, tab.savedContent);
        await invoke("studio_write_file", { relPath: tab.path, content: tab.content });
        saveTimelineSnapshot(this.currentProjectRoot || "default", tab.path, tab.content);
        this.bottomPanel.logActivity("system", `Saved: ${tab.path}`);
        this.showToast(`"${tab.name}" saved.`, "info");
        // Update attached context copy if attached
        if (this.fileTree.isAttached(tab.path)) {
          this.studioChat.attachFile(tab.path, tab.content);
        }
        return true;
      } catch (err: any) {
        const msg = String(err);
        this.bottomPanel.addProblem("error", tab.path, msg);
        this.showToast(`Yadda saxlama xətası: ${msg}`, "error");
        return false;
      }
    };

    // StudioChat events
    this.studioChat.onFileRemoved = (path) => {
      this.fileTree.setAttached(path, false);
    };

    this.studioChat.onAttachedChanged = (summaries) => {
      this.bottomPanel.updateContextFiles(summaries);
    };

    this.studioChat.onOpenSettings = () => {
      const routing = this.aiClient.getActiveRouting();
      this.openPage("models", routing.isLocal ? "local" : "cloud");
    };

    this.studioChat.onOpenLocalPermissions = () => {
      this.openPage("settings", "security");
    };

    this.studioChat.onRequestProblemsContext = () => {
      return this.bottomPanel.getProblemsSummary();
    };

    this.studioChat.onRequestTerminalContext = () => {
      return this.bottomPanel.getRecentTerminalOutput();
    };

    this.studioChat.onRequestGitDiffContext = async () => {
      try {
        return await invoke<string>("studio_git_diff", { relPath: null });
      } catch {
        return "";
      }
    };

    this.studioChat.onAttachButtonClick = () => {
      const active = this.codeViewer.getActiveFile();
      if (active) {
        this.attachActiveFileToChat(active.path, active.name, active.content);
      } else {
        this.showToast(t("openFolderFirstMsg"), "info");
      }
    };

    this.studioChat.onExpandToggle = () => {
      const rightPanel = document.getElementById("studio-chat-container");
      if (!rightPanel) return;
      this.rightPanelExpanded = !this.rightPanelExpanded;
      rightPanel.style.width = this.rightPanelExpanded ? "540px" : "360px";
    };

    this.studioChat.onClosePanel = () => this.setRightPanelVisible(false);

    this.studioChat.onMessageDispatched = (routing, files) => {
      const routeLabel = routing.isLocal ? `Lokal (${routing.model})` : `Bulud: ${routing.provider} (${routing.model})`;
      const fileDetail = files.length > 0 ? `${files.length} fayl: ${files.join(", ")}` : "faylsız";
      this.bottomPanel.logActivity("send", `Sorğu göndərildi -> ${routeLabel}`, fileDetail);
    };

    this.studioChat.onBusyStateChange = (busy) => {
      this.setStatusText(busy ? t("thinking") : t("ready"));
    };

    this.studioChat.onFileWrittenByAI = (path, content, isNewFile) => {
      if (isNewFile) {
        this.fileTree.refresh();
        this.codeViewer.openFile(path, content);
      } else {
        this.codeViewer.reloadFileFromDisk(path, content);
        if (!this.codeViewer.getActiveFile() || this.codeViewer.getActiveFile()?.path !== path) {
          this.codeViewer.openFile(path, content);
        }
      }
      if (this.fileTree.isAttached(path)) {
        this.studioChat.attachFile(path, content);
      }
      this.showToast(`${t("appliedLabel")}: ${path}`, "info");
    };

    this.studioChat.onAuditEvent = (cat, msg, detail) => {
      this.bottomPanel.logActivity(cat, msg, detail);
    };

    // BottomPanel events
    this.bottomPanel.onRemoveContextFile = (path) => {
      this.studioChat.detachFile(path);
    };

    this.bottomPanel.onOpenContextFile = async (path, lineNumber) => {
      await this.openProjectFile(path, false, lineNumber);
    };

    this.bottomPanel.onToggleCollapse = (collapsed) => {
      const bottomEl = document.getElementById("studio-bottom-panel");
      if (!bottomEl) return;
      if (collapsed) {
        bottomEl.dataset.prevHeight = bottomEl.style.height || "176px";
        bottomEl.style.height = "34px";
      } else {
        bottomEl.style.height = bottomEl.dataset.prevHeight || "176px";
      }
    };
  }

  private async openProjectFile(relPath: string, markedSensitive = false, jumpToLine?: number): Promise<void> {
    if (markedSensitive || isSensitiveFileOrDir(relPath)) {
      this.bottomPanel.logActivity("blocked", `Sensitive file blocked: ${relPath}`);
      this.bottomPanel.addProblem("warning", relPath, t("sensitiveBlockedMsg"));
      this.showToast(`${t("sensitiveBlockedMsg")} (${relPath})`, "error");
      return;
    }

    this.setStatusText("...");
    try {
      const content: string = await invoke("studio_read_file", { relPath });
      this.codeViewer.openFile(relPath, content, jumpToLine);
      this.bottomPanel.logActivity("read", `Opened file: ${relPath}`);
    } catch (err: any) {
      const errText = String(err);
      this.bottomPanel.logActivity("blocked", `Failed to read: ${relPath}`, errText);
      this.bottomPanel.addProblem("error", relPath, errText);
      this.showToast(`${errText}`, "error");
    } finally {
      this.setStatusText(t("readyStatus"));
    }
  }

  private async handleCreateEntry(isDir: boolean): Promise<void> {
    if (!this.currentProjectRoot) {
      this.showToast(t("openFolderFirstMsg"), "info");
      return;
    }

    const relPath = await showInputDialog({
      title: isDir ? t("newFolderTitle") : t("newFileTitle"),
      label: t("relPathLabel"),
      placeholder: isDir ? "src/utils" : "src/newFile.ts",
      confirmText: t("createBtn"),
    });

    if (!relPath) return;

    if (isSensitiveFileOrDir(relPath)) {
      this.bottomPanel.logActivity("blocked", `Sensitive file creation blocked: ${relPath}`);
      this.showToast(t("sensitiveBlockedMsg"), "error");
      return;
    }

    try {
      await invoke("studio_create_entry", { relPath, isDir });
      await this.fileTree.refresh();
      this.bottomPanel.logActivity("system", `${t("createdLabel")}: ${relPath}`);
      if (!isDir) {
        await this.openProjectFile(relPath);
      }
      this.showToast(`${t("createdLabel")}: ${relPath}`, "info");
    } catch (err: any) {
      const msg = String(err);
      this.bottomPanel.addProblem("error", relPath, msg);
      this.showToast(`${msg}`, "error");
    }
  }

  private async runContentSearch(query: string): Promise<void> {
    const trimmed = query.trim();
    if (!trimmed) return;
    if (!this.currentProjectRoot) {
      this.showToast(t("openFolderFirstMsg"), "info");
      return;
    }

    this.setStatusText(t("searchingStatus"));
    try {
      const hits = await invoke<GrepMatchItem[]>("studio_grep_search", {
        query: trimmed,
        maxResults: 80,
      });
      this.bottomPanel.showSearchResults(trimmed, hits);
      this.bottomPanel.logActivity("read", `Search: "${trimmed}" (${hits.length})`);
    } catch (err: any) {
      this.bottomPanel.addProblem("error", "Search", String(err));
    } finally {
      this.setStatusText(t("readyStatus"));
    }
  }

  private async backgroundDetectLocalModels(): Promise<void> {
    try {
      this.detectedLocalModels = await detectLocalModels(this.aiClient.getLocalBaseUrl());

      // Auto-sync to active live local server if current URL isn't in detected list
      if (this.aiClient.getActiveProvider() === "local" && this.detectedLocalModels.length > 0) {
        const curUrl = this.aiClient.getLocalBaseUrl().replace(/\/+$/, "");
        const match = this.detectedLocalModels.find((m) => m.baseUrl.replace(/\/+$/, "") === curUrl);
        if (!match) {
          const best = this.detectedLocalModels[0];
          this.aiClient.setLocalBaseUrl(best.baseUrl);
          this.aiClient.setLocalModel(best.id);
          if (best.port) {
            studioSettings.update({ localPort: best.port });
          }
          this.refreshAllModelIndicators();
          this.bottomPanel.logActivity("system", `Aktiv yerli server avtomatik seçildi: ${best.label}`);
        } else {
          this.refreshAllModelIndicators();
        }
      }
    } catch {
      this.detectedLocalModels = [];
    }
  }

  private async syncMcpServers(): Promise<void> {
    const servers = await this.mcpPage.getServers();
    this.applyMcpServersState(servers);
  }

  private async syncExtensions(): Promise<void> {
    const exts = await this.extensionsPage.loadInstalled();
    this.applyExtensionsState(exts);
  }

  private applyExtensionsState(exts: MintuExtension[]): void {
    const active = exts.filter((e) => e.enabled);
    const snippets = active.flatMap((e) => e.snippets || []);
    const aiRules = active.flatMap((e) => e.ai_rules || []);
    const apiTemplates = active.flatMap((e) => e.api_templates || []);
    const extScripts: ProjectScriptItem[] = active.flatMap((e) =>
      (e.commands || []).map((c) => ({
        source: e.name,
        name: c.label,
        command: c.command,
      }))
    );

    this.codeViewer.setExtensionSnippets(snippets);
    this.aiClient.setExtensionAiRules(aiRules);
    this.apiTesterPage.setTemplates(apiTemplates);
    this.bottomPanel.setExtensionScripts(extScripts);

    const extPaletteCmds: PaletteCommand[] = extScripts.map((s, idx) => ({
      id: `ext-cmd-${idx}`,
      label: `${s.name} (${s.command})`,
      category: "Extension",
      action: () => {
        this.openPage("workspace");
        void this.bottomPanel.runCommandInTerminal(s.command);
      },
    }));
    this.commandPalette.setCommands([...this.baseCommands, ...extPaletteCmds]);

    const badge = document.getElementById("rail-ext-badge");
    if (badge) {
      if (active.length > 0) {
        badge.textContent = String(active.length);
        badge.style.display = "inline-flex";
      } else {
        badge.style.display = "none";
      }
    }
  }

  private openFileTimeline(tab: { path: string; name: string; content: string }): void {
    openTimelineModal(this.currentProjectRoot || "default", tab.path, tab.content, async (restoredContent) => {
      if (isSensitiveFileOrDir(tab.path)) return;
      try {
        await invoke("studio_write_file", { relPath: tab.path, content: restoredContent });
        this.codeViewer.reloadFileFromDisk(tab.path, restoredContent);
        this.bottomPanel.logActivity("system", `Timeline restored: ${tab.path}`);
        this.showToast(`Restored: ${tab.name}`, "info");
      } catch (e: any) {
        this.showToast(`Restore error: ${e}`, "error");
      }
    });
  }

  private applyMcpServersState(servers: McpServerStatusView[]): void {
    this.aiClient.setMcpServers(servers);
    const connectedCount = servers.filter((s) => s.status === "connected").length;
    const badge = document.getElementById("rail-mcp-badge");
    if (badge) {
      if (connectedCount > 0) {
        badge.textContent = String(connectedCount);
        badge.style.display = "inline-flex";
      } else {
        badge.style.display = "none";
      }
    }
  }

  private attachActiveFileToChat(path: string, name: string, content: string): void {
    if (isSensitiveFileOrDir(path)) {
      this.bottomPanel.logActivity("blocked", `Həssas fayl bloklandı: ${path}`);
      this.showToast("Həssas (xaric edilib): bu faylı kontekstə qoşmaq qadağandır.", "error");
      return;
    }
    this.studioChat.attachFile(path, content);
    this.fileTree.setAttached(path, true);
    this.bottomPanel.logActivity("read", `Aktiv fayl kontekstə qoşuldu: ${path}`);
    this.showToast(`"${name}" kontekstə əlavə olundu.`, "info");
  }

  private initTopBar(): void {
    const projBtn = document.getElementById("btn-project-dropdown");
    projBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      const recent = this.getRecentProjects().filter((r) => r.path !== this.currentProjectRoot).slice(0, 5);
      const items: Array<{ label: string; disabled?: boolean; action: () => void }> = [
        { label: `${t("openFolder")}...`, action: () => this.handlePickFolder() },
        { label: t("quickOpenFiles"), action: () => this.commandPalette.open("files"), disabled: !this.currentProjectRoot },
        { label: t("commandPaletteMenu"), action: () => this.commandPalette.open("commands") },
        { label: t("newFile"), action: () => this.handleCreateEntry(false), disabled: !this.currentProjectRoot },
        { label: t("newFolder"), action: () => this.handleCreateEntry(true), disabled: !this.currentProjectRoot },
        { label: t("newProjectTemplateMenu"), action: () => this.openProjectTemplates(), disabled: !this.currentProjectRoot },
        { label: t("compareFilesMenu"), action: () => openCompareFilesModal(this.cachedProjectFiles, this.codeViewer.getActiveFile()?.path), disabled: !this.currentProjectRoot },
        { label: `${t("gitStatus")}...`, action: () => void this.gitModal.open(), disabled: !this.currentProjectRoot },
        { label: t("refresh"), action: () => { void this.fileTree.refresh(); void this.refreshProjectIndexAndGit(); }, disabled: !this.currentProjectRoot },
        { label: t("closeProject"), action: () => this.handleCloseProject(), disabled: !this.currentProjectRoot },
      ];
      for (const r of recent) {
        items.push({
          label: `${t("recentPrefix")}: ${r.name}`,
          action: () => void this.openRecentProject(r.path),
        });
      }
      this.togglePopover(projBtn, items);
    });

    const searchInput = document.getElementById("studio-search-input") as HTMLInputElement | null;
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        if (!this.explorerVisible) this.setExplorerVisible(true);
        this.fileTree.setSearchFilter(searchInput.value);
      });
      searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.runContentSearch(searchInput.value);
        } else if (e.key === "Escape") {
          searchInput.value = "";
          this.fileTree.setSearchFilter("");
          searchInput.blur();
        }
      });
    }

    const modelBtn = document.getElementById("btn-model-selector");
    modelBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      const activeProv = this.aiClient.getActiveProvider();
      const activeLocalModel = this.aiClient.getLocalModel();
      const items: Array<{ label: string; active?: boolean; action: () => void }> = [];

      if (this.detectedLocalModels.length > 0) {
        for (const m of this.detectedLocalModels) {
          items.push({
            label: `Lokal: ${m.label}`,
            active: activeProv === "local" && activeLocalModel === m.id,
            action: () => {
              this.aiClient.setActiveProvider("local");
              this.aiClient.setLocalBaseUrl(m.baseUrl);
              this.aiClient.setLocalModel(m.id);
              this.refreshAllModelIndicators();
              this.bottomPanel.logActivity("system", `Aktiv model: Lokal (${m.label})`);
            },
          });
        }
      } else {
        items.push({
          label: `Lokal (${activeLocalModel})`,
          active: activeProv === "local",
          action: () => {
            this.aiClient.setActiveProvider("local");
            this.refreshAllModelIndicators();
            this.bottomPanel.logActivity("system", `Aktiv model: Lokal (${activeLocalModel})`);
          },
        });
      }

      for (const p of Object.values(getAllCloudProviders())) {
        items.push({
          label: p.name,
          active: activeProv === p.id,
          action: () => {
            this.aiClient.setActiveProvider(p.id);
            this.refreshAllModelIndicators();
            this.bottomPanel.logActivity("system", `Aktiv model: ${p.name}`);
          },
        });
      }

      items.push({
        label: `${t("localModelsTab")}...`,
        action: () => this.openPage("models", "local"),
      });
      items.push({
        label: `${t("cloudProvidersTab")}...`,
        action: () => this.openPage("models", "cloud"),
      });
      items.push({
        label: `${t("extensions")}...`,
        action: () => this.openPage("extensions"),
      });
      items.push({
        label: `${t("apiTester")}...`,
        action: () => this.openPage("api"),
      });
      items.push({
        label: `${t("mcpServers")}...`,
        action: () => this.openPage("mcp"),
      });
      items.push({
        label: `${t("settings")}...`,
        action: () => this.openPage("settings"),
      });

      this.togglePopover(modelBtn, items, true);
    });

    document.getElementById("btn-topbar-chat")?.addEventListener("click", () => {
      if (this.activePage !== "workspace") {
        this.openPage("workspace");
        this.setRightPanelVisible(true);
      } else {
        this.setRightPanelVisible(!this.rightPanelVisible);
      }
    });

    document.getElementById("btn-topbar-update")?.addEventListener("click", () => {
      this.openPage("settings", "updates");
    });

    document.getElementById("btn-topbar-settings")?.addEventListener("click", () => {
      this.openPage(this.activePage === "settings" ? "workspace" : "settings");
    });

    const expMenuBtn = document.getElementById("btn-explorer-menu");
    expMenuBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.togglePopover(expMenuBtn, [
        { label: t("openFolder"), action: () => this.handlePickFolder() },
        { label: t("newFile"), action: () => this.handleCreateEntry(false), disabled: !this.currentProjectRoot },
        { label: t("newFolder"), action: () => this.handleCreateEntry(true), disabled: !this.currentProjectRoot },
        { label: t("refresh"), action: () => this.fileTree.refresh(), disabled: !this.currentProjectRoot },
        { label: t("collapseFolders"), action: () => this.fileTree.collapseAll(), disabled: !this.currentProjectRoot },
      ]);
    });

    document.getElementById("status-dataflow-btn")?.addEventListener("click", () => {
      const routing = this.aiClient.getActiveRouting();
      this.openPage("models", routing.isLocal ? "local" : "cloud");
    });

    const updateWinButtons = (state: { maximized: boolean; fullscreen: boolean }) => {
      const maxBtn = document.getElementById("btn-win-max");
      if (maxBtn) {
        maxBtn.title = state.maximized ? "Əvvəlki ölçüyə qaytar" : "Böyüt";
        maxBtn.innerHTML = state.maximized
          ? `<svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><rect x="3.5" y="1.5" width="7" height="7" rx="0.8"/><path d="M1.5 3.5V9.7C1.5 10.1 1.9 10.5 2.3 10.5H8.5"/></svg>`
          : `<svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><rect x="2" y="2" width="8" height="8" rx="1"/></svg>`;
      }
      const fsBtn = document.getElementById("btn-win-fullscreen");
      if (fsBtn) {
        fsBtn.classList.toggle("is-active", state.fullscreen);
        fsBtn.title = state.fullscreen ? "Tam ekrandan çıx (F11)" : "Tam ekran (F11)";
      }
    };

    const handleToggleMax = async () => {
      try {
        const st = await invoke<{ maximized: boolean; fullscreen: boolean }>("studio_toggle_maximize");
        updateWinButtons(st);
      } catch {}
    };

    const handleToggleFullscreen = async () => {
      try {
        const st = await invoke<{ maximized: boolean; fullscreen: boolean }>("studio_toggle_fullscreen");
        updateWinButtons(st);
      } catch {}
    };

    document.getElementById("btn-win-fullscreen")?.addEventListener("click", () => void handleToggleFullscreen());
    document.getElementById("btn-win-min")?.addEventListener("click", () => {
      invoke("studio_minimize_window").catch(() => {});
    });
    document.getElementById("btn-win-max")?.addEventListener("click", () => void handleToggleMax());
    document.getElementById("btn-win-close")?.addEventListener("click", () => {
      invoke("studio_close_window").catch(() => {});
    });

    // Double-click empty top bar area maximizes/restores window (standard Windows behavior)
    document.querySelector(".studio-topbar")?.addEventListener("dblclick", (e) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest("button, input, .topbar-search-box, .window-controls")) return;
      void handleToggleMax();
    });

    // Sync initial window state icon
    invoke<{ maximized: boolean; fullscreen: boolean }>("studio_window_state")
      .then(updateWinButtons)
      .catch(() => {});

    document.addEventListener("click", () => this.closePopover());
  }

  private initRail(): void {
    const railExplorer = document.getElementById("rail-btn-explorer");
    const railSearch = document.getElementById("rail-btn-search");
    const railModels = document.getElementById("rail-btn-models");
    const railMcp = document.getElementById("rail-btn-mcp");
    const railExtensions = document.getElementById("rail-btn-extensions");
    const railApi = document.getElementById("rail-btn-api");
    const railPreview = document.getElementById("rail-btn-preview");
    const railData = document.getElementById("rail-btn-data");
    const railTerminal = document.getElementById("rail-btn-terminal");
    const railChat = document.getElementById("rail-btn-chat");
    const railSettings = document.getElementById("rail-btn-settings");

    railExplorer?.addEventListener("click", () => {
      if (this.activePage !== "workspace") {
        this.openPage("workspace");
        this.setExplorerVisible(true);
        return;
      }
      this.setExplorerVisible(!this.explorerVisible);
      railExplorer.classList.toggle("active", this.explorerVisible);
    });

    railSearch?.addEventListener("click", () => {
      if (this.activePage !== "workspace") this.openPage("workspace");
      if (!this.explorerVisible) this.setExplorerVisible(true);
      const searchInput = document.getElementById("studio-search-input") as HTMLInputElement | null;
      searchInput?.focus();
      searchInput?.select();
    });

    railModels?.addEventListener("click", () => {
      this.openPage(this.activePage === "models" ? "workspace" : "models", "local");
    });

    railMcp?.addEventListener("click", () => {
      this.openPage(this.activePage === "mcp" ? "workspace" : "mcp");
    });

    railExtensions?.addEventListener("click", () => {
      this.openPage(this.activePage === "extensions" ? "workspace" : "extensions");
    });

    railApi?.addEventListener("click", () => {
      this.openPage(this.activePage === "api" ? "workspace" : "api");
    });

    railPreview?.addEventListener("click", () => {
      this.openPage(this.activePage === "preview" ? "workspace" : "preview");
    });

    railData?.addEventListener("click", () => {
      this.openPage(this.activePage === "data" ? "workspace" : "data");
    });

    railTerminal?.addEventListener("click", () => {
      if (this.activePage !== "workspace") this.openPage("workspace");
      this.bottomPanel.focusTerminal();
    });

    railChat?.addEventListener("click", () => {
      if (this.activePage !== "workspace") {
        this.openPage("workspace");
        this.setRightPanelVisible(true);
      } else {
        this.setRightPanelVisible(!this.rightPanelVisible);
      }
    });

    railSettings?.addEventListener("click", () => {
      this.openPage(this.activePage === "settings" ? "workspace" : "settings");
    });
  }

  public openPage(
    page: ActiveStudioPage,
    subParam?: ModelsSubTab | SettingsSectionId | string
  ): void {
    this.activePage = page;

    const ideEl = document.getElementById("studio-ide-view");
    const modelsEl = document.getElementById("studio-page-models");
    const mcpEl = document.getElementById("studio-page-mcp");
    const extEl = document.getElementById("studio-page-extensions");
    const apiEl = document.getElementById("studio-page-api");
    const previewEl = document.getElementById("studio-page-preview");
    const dataEl = document.getElementById("studio-page-data");
    const settingsEl = document.getElementById("studio-page-settings");

    if (ideEl) ideEl.style.display = page === "workspace" ? "flex" : "none";
    if (modelsEl) modelsEl.style.display = page === "models" ? "flex" : "none";
    if (mcpEl) mcpEl.style.display = page === "mcp" ? "flex" : "none";
    if (extEl) extEl.style.display = page === "extensions" ? "flex" : "none";
    if (apiEl) apiEl.style.display = page === "api" ? "flex" : "none";
    if (previewEl) previewEl.style.display = page === "preview" ? "flex" : "none";
    if (dataEl) dataEl.style.display = page === "data" ? "flex" : "none";
    if (settingsEl) settingsEl.style.display = page === "settings" ? "flex" : "none";

    if (page !== "models") this.modelsPage.hide();

    if (page === "models") {
      const tab: ModelsSubTab = subParam === "cloud" ? "cloud" : "local";
      void this.modelsPage.show(tab);
    } else if (page === "mcp") {
      void this.mcpPage.show();
    } else if (page === "extensions") {
      void this.extensionsPage.show("store");
    } else if (page === "api") {
      this.apiTesterPage.show();
    } else if (page === "preview") {
      void this.previewPortsPage.show(typeof subParam === "string" && subParam.startsWith("http") ? subParam : undefined);
    } else if (page === "data") {
      void this.dataExplorerPage.show(typeof subParam === "string" ? subParam : undefined);
    } else if (page === "settings") {
      const sec: SettingsSectionId =
        subParam === "editor" || subParam === "terminal" || subParam === "agent" || subParam === "updates" || subParam === "security"
          ? subParam
          : "general";
      this.settingsPage.show(sec);
    }

    document.getElementById("rail-btn-explorer")?.classList.toggle("active", page === "workspace" && this.explorerVisible);
    document.getElementById("rail-btn-models")?.classList.toggle("active", page === "models");
    document.getElementById("rail-btn-mcp")?.classList.toggle("active", page === "mcp");
    document.getElementById("rail-btn-extensions")?.classList.toggle("active", page === "extensions");
    document.getElementById("rail-btn-api")?.classList.toggle("active", page === "api");
    document.getElementById("rail-btn-preview")?.classList.toggle("active", page === "preview");
    document.getElementById("rail-btn-data")?.classList.toggle("active", page === "data");
    document.getElementById("rail-btn-settings")?.classList.toggle("active", page === "settings");
  }

  private initResizers(): void {
    const leftResizer = document.getElementById("resizer-left");
    const leftPanel = document.getElementById("studio-left-panel");
    if (leftResizer && leftPanel) {
      this.bindHorizontalResizer(
        leftResizer,
        (dx, startW) => {
          leftPanel.style.width = `${Math.max(180, Math.min(420, startW + dx))}px`;
        },
        () => leftPanel.getBoundingClientRect().width
      );
    }

    const rightResizer = document.getElementById("resizer-right");
    const rightPanel = document.getElementById("studio-chat-container");
    if (rightResizer && rightPanel) {
      this.bindHorizontalResizer(
        rightResizer,
        (dx, startW) => {
          rightPanel.style.width = `${Math.max(280, Math.min(600, startW - dx))}px`;
        },
        () => rightPanel.getBoundingClientRect().width
      );
    }

    const bottomResizer = document.getElementById("resizer-bottom");
    const bottomPanelEl = document.getElementById("studio-bottom-panel");
    if (bottomResizer && bottomPanelEl) {
      let dragging = false;
      let startY = 0;
      let startH = 0;

      bottomResizer.addEventListener("mousedown", (e) => {
        dragging = true;
        startY = e.clientY;
        startH = bottomPanelEl.getBoundingClientRect().height;
        document.body.classList.add("is-resizing-row");
        e.preventDefault();
      });

      window.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        const dy = startY - e.clientY;
        const next = Math.max(90, Math.min(420, startH + dy));
        if (this.bottomPanel.getCollapsed() && next > 60) {
          this.bottomPanel.setCollapsed(false);
        }
        bottomPanelEl.style.height = `${next}px`;
      });

      window.addEventListener("mouseup", () => {
        if (!dragging) return;
        dragging = false;
        document.body.classList.remove("is-resizing-row");
      });
    }
  }

  private bindHorizontalResizer(
    handle: HTMLElement,
    onDrag: (dx: number, startW: number) => void,
    getStartW: () => number
  ): void {
    let dragging = false;
    let startX = 0;
    let startW = 0;

    handle.addEventListener("mousedown", (e) => {
      dragging = true;
      startX = e.clientX;
      startW = getStartW();
      document.body.classList.add("is-resizing-col");
      e.preventDefault();
    });

    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      onDrag(e.clientX - startX, startW);
    });

    window.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove("is-resizing-col");
    });
  }

  private initGlobalShortcuts(): void {
    window.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "F" || e.key === "f")) {
        e.preventDefault();
        if (!this.explorerVisible) this.setExplorerVisible(true);
        const searchInput = document.getElementById("studio-search-input") as HTMLInputElement | null;
        searchInput?.focus();
        searchInput?.select();
      } else if (e.ctrlKey && e.shiftKey && (e.key === "P" || e.key === "p")) {
        e.preventDefault();
        this.commandPalette.open("commands");
      } else if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        this.commandPalette.open("files");
      } else if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        this.codeViewer.openInlineAiEdit();
      } else if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === "l" || e.key === "L")) {
        e.preventDefault();
        this.setRightPanelVisible(!this.rightPanelVisible);
      } else if (e.ctrlKey && (e.key === "`" || e.code === "Backquote")) {
        e.preventDefault();
        this.bottomPanel.focusTerminal();
      } else if (e.key === "F11") {
        e.preventDefault();
        invoke<{ maximized: boolean; fullscreen: boolean }>("studio_toggle_fullscreen")
          .then((st) => {
            const fsBtn = document.getElementById("btn-win-fullscreen");
            if (fsBtn) {
              fsBtn.classList.toggle("is-active", st.fullscreen);
              fsBtn.title = st.fullscreen ? "Tam ekrandan çıx (F11)" : "Tam ekran (F11)";
            }
          })
          .catch(() => {});
      }
    });
  }

  private setExplorerVisible(visible: boolean): void {
    this.explorerVisible = visible;
    const panel = document.getElementById("studio-left-panel");
    const resizer = document.getElementById("resizer-left");
    if (panel) panel.classList.toggle("is-collapsed", !visible);
    if (resizer) resizer.classList.toggle("is-hidden", !visible);
  }

  private setRightPanelVisible(visible: boolean): void {
    this.rightPanelVisible = visible;
    const panel = document.getElementById("studio-chat-container");
    const resizer = document.getElementById("resizer-right");
    if (panel) panel.classList.toggle("is-collapsed", !visible);
    if (resizer) resizer.classList.toggle("is-hidden", !visible);

    const topChatBtn = document.getElementById("btn-topbar-chat");
    if (topChatBtn) {
      topChatBtn.classList.toggle("is-open", visible);
      topChatBtn.title = visible ? "Mintu AI Çatı gizlət (Ctrl+L)" : "Mintu AI Çatı aç (Ctrl+L)";
    }
    const railChatBtn = document.getElementById("rail-btn-chat");
    if (railChatBtn) {
      railChatBtn.classList.toggle("active", visible);
    }
    this.codeViewer.setChatPanelVisible(visible);
  }

  private refreshAllModelIndicators(): void {
    const routing = this.aiClient.getActiveRouting();
    const cleanModel = formatModelDisplayName(routing.model);

    const topLabel = document.getElementById("topbar-model-label");
    if (topLabel) {
      topLabel.textContent = routing.isLocal ? cleanModel : `${routing.provider}`;
      topLabel.title = routing.isLocal ? `${cleanModel} (${this.aiClient.getLocalBaseUrl()})` : `${routing.provider} · ${routing.model}`;
    }

    this.studioChat.updateProviderBadge();

    const statusFlow = document.getElementById("status-dataflow-btn");
    const statusLabel = document.getElementById("status-dataflow-label");
    if (statusFlow && statusLabel) {
      statusFlow.className = "status-dataflow";
      if (routing.isLocal) {
        statusLabel.textContent = cleanModel;
        statusFlow.title = `Lokal model: ${cleanModel}`;
      } else {
        statusLabel.textContent = routing.provider;
        statusFlow.title = `${routing.provider} (${routing.model})`;
      }
    }
  }

  private setStatusText(text: string): void {
    const el = document.getElementById("status-left-text");
    if (el) el.textContent = text;
  }

  private updateEditorStatusBar(info: EditorStatusInfo): void {
    const langEl = document.getElementById("status-language");
    const posEl = document.getElementById("status-cursor");
    if (langEl) langEl.textContent = info.language;
    if (posEl) posEl.textContent = `Ln ${info.line}, Col ${info.col}`;

    const blameEl = document.getElementById("status-git-blame");
    if (!blameEl) return;
    if (!studioSettings.get().showInlineGitBlame || !info.hasFile || !info.path || !this.currentProjectRoot) {
      blameEl.style.display = "none";
      return;
    }
    const key = `${info.path}:${info.line}`;
    if (key === this.lastBlameKey) return;
    this.lastBlameKey = key;

    if (this.blameTimer) window.clearTimeout(this.blameTimer);
    this.blameTimer = window.setTimeout(async () => {
      try {
        const res = await invoke<{ hash: string; author: string; date: string; summary: string } | null>(
          "devtools_git_blame_line",
          { relPath: info.path, line: info.line }
        );
        if (this.lastBlameKey !== key) return;
        if (res) {
          blameEl.textContent = `${res.author} · ${res.date} — ${res.summary.slice(0, 48)}`;
          blameEl.title = `${res.hash} · ${res.author} (${res.date}): ${res.summary}`;
          blameEl.style.display = "inline-block";
        } else {
          blameEl.style.display = "none";
        }
      } catch {
        blameEl.style.display = "none";
      }
    }, 450);
  }

  private togglePopover(
    anchor: HTMLElement,
    items: Array<{ label: string; active?: boolean; disabled?: boolean; action: () => void }>,
    alignRight = false
  ): void {
    if (this.openPopover && this.openPopover.dataset.anchorId === anchor.id) {
      this.closePopover();
      return;
    }
    this.closePopover();

    const rect = anchor.getBoundingClientRect();
    const menu = document.createElement("div");
    menu.className = "studio-popover";
    menu.dataset.anchorId = anchor.id;
    menu.style.top = `${rect.bottom + 4}px`;
    if (alignRight) {
      menu.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
    } else {
      menu.style.left = `${rect.left}px`;
    }

    for (const item of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `studio-popover-item${item.active ? " is-active" : ""}`;
      btn.disabled = !!item.disabled;
      btn.textContent = item.label;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.closePopover();
        item.action();
      });
      menu.appendChild(btn);
    }

    document.body.appendChild(menu);
    this.openPopover = menu;
  }

  private closePopover(): void {
    if (this.openPopover) {
      this.openPopover.remove();
      this.openPopover = null;
    }
  }

  private async checkCurrentProject(): Promise<void> {
    try {
      // Auto-register Windows "Open with -> Mintu Studio" once on first run (non-blocking)
      if (!localStorage.getItem("mintu_studio_openwith_init_v1")) {
        localStorage.setItem("mintu_studio_openwith_init_v1", "1");
        invoke("studio_set_windows_open_with", { enabled: true }).catch(() => {});
      }

      // 1. Highest priority: file or folder passed via Windows "Open with -> Mintu Studio"
      const startupTarget = await invoke<{
        folder_path: string;
        folder_name: string;
        file_rel_path: string | null;
      } | null>("studio_take_startup_target");
      if (startupTarget) {
        this.setProject(startupTarget.folder_path, startupTarget.folder_name);
        if (startupTarget.file_rel_path) {
          await this.openProjectFile(startupTarget.file_rel_path, false);
        }
        return;
      }

      const info: { root_path: string; folder_name: string } | null = await invoke("studio_get_project_root");
      if (info) {
        this.setProject(info.root_path, info.folder_name);
        return;
      }
      if (studioSettings.get().reopenLastProject) {
        const recent = this.getRecentProjects();
        if (recent.length > 0) {
          await this.openRecentProject(recent[0].path);
          return;
        }
      }
      this.setProject(null, null);
    } catch (e) {
      console.warn("Could not query studio project root", e);
    }
  }

  public async handlePickFolder(): Promise<void> {
    try {
      const info: { root_path: string; folder_name: string } | null = await invoke("studio_pick_folder");
      if (info) {
        this.setProject(info.root_path, info.folder_name);
        this.bottomPanel.logActivity("system", `Layihə qovluğu açıldı: ${info.folder_name}`);
        this.showToast(`Layihə açıldı: ${info.folder_name}`, "info");
      }
    } catch (err: any) {
      const msg = String(err);
      this.bottomPanel.addProblem("error", "Qovluq", msg);
      this.showToast(`Qovluq seçilmədi: ${msg}`, "error");
    }
  }

  public async handleCloseProject(): Promise<void> {
    try {
      await invoke("studio_close_project");
      this.setProject(null, null);
      this.bottomPanel.logActivity("system", "Layihə qovluğu bağlandı");
      this.showToast("Layihə bağlandı.", "info");
    } catch (e: any) {
      this.showToast(`Xəta: ${e}`, "error");
    }
  }

  private setProject(rootPath: string | null, folderName: string | null): void {
    this.currentProjectRoot = rootPath;
    this.aiClient.setProjectFolderName(folderName);

    const labelEl = document.getElementById("current-project-label");
    if (labelEl) {
      if (rootPath && folderName) {
        labelEl.textContent = folderName;
        labelEl.title = rootPath;
      } else {
        labelEl.textContent = t("openFolder");
        labelEl.title = t("openFolder");
      }
    }

    this.fileTree.setProjectRoot(rootPath, folderName);
    void this.bottomPanel.setProjectRoot(rootPath);
    if (rootPath && folderName) {
      this.rememberRecentProject(rootPath, folderName);
    }
    this.fileTree.setRecentProjects(this.getRecentProjects());
    void this.refreshProjectIndexAndGit();
  }

  private getRecentProjects(): RecentProjectItem[] {
    try {
      const raw = localStorage.getItem(RECENT_PROJECTS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  }

  private rememberRecentProject(path: string, name: string): void {
    const list = this.getRecentProjects().filter((r) => r.path !== path);
    list.unshift({ path, name });
    try {
      localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(list.slice(0, 8)));
    } catch {}
  }

  private async openRecentProject(path: string): Promise<void> {
    try {
      const info = await invoke<{ root_path: string; folder_name: string }>("studio_open_folder_path", { path });
      this.setProject(info.root_path, info.folder_name);
      this.bottomPanel.logActivity("system", `Son layihə açıldı: ${info.folder_name}`);
      this.showToast(`Layihə açıldı: ${info.folder_name}`, "info");
    } catch (e: any) {
      this.showToast(`Layihə açılmadı: ${e}`, "error");
    }
  }

  private async refreshProjectIndexAndGit(): Promise<void> {
    if (!this.currentProjectRoot) {
      this.cachedProjectFiles = [];
      this.commandPalette.setFiles([]);
      this.studioChat.setProjectFiles([]);
      this.dataExplorerPage.setProjectFiles([]);
      this.aiClient.setProjectContextInfo([], null, null);
      this.bottomPanel.setProjectScripts([]);
      this.bottomPanel.setTodos([]);
      this.bottomPanel.setWorkspaceDiagnostics([], "");
      this.fileTree.setGitStatusMap(new Map());
      const gitBtn = document.getElementById("status-git-btn");
      if (gitBtn) gitBtn.style.display = "none";
      return;
    }

    let allFiles: string[] = [];
    try {
      allFiles = await invoke<string[]>("studio_list_all_files", { maxFiles: 1500 });
      this.cachedProjectFiles = allFiles;
      this.commandPalette.setFiles(allFiles);
      this.studioChat.setProjectFiles(allFiles);
      this.dataExplorerPage.setProjectFiles(allFiles);
    } catch {
      this.cachedProjectFiles = [];
      this.commandPalette.setFiles([]);
      this.studioChat.setProjectFiles([]);
      this.dataExplorerPage.setProjectFiles([]);
    }

    void this.scanWorkspaceTodos();

    try {
      const scripts = await invoke<ProjectScriptItem[]>("studio_read_project_scripts");
      this.bottomPanel.setProjectScripts(scripts);
    } catch {
      this.bottomPanel.setProjectScripts([]);
    }

    let rules: string | null = null;
    try {
      rules = await invoke<string | null>("studio_read_project_rules");
    } catch {}
    this.aiClient.setProjectContextInfo(allFiles, this.codeViewer.getActiveFile()?.path || null, rules);

    try {
      const git = await invoke<GitRepoInfo>("studio_git_info");
      const map = new Map<string, string>();
      for (const f of git.files) {
        map.set(f.path, f.status);
      }
      this.fileTree.setGitStatusMap(map);

      const gitBtn = document.getElementById("status-git-btn");
      const gitLbl = document.getElementById("status-git-label");
      if (gitBtn && gitLbl) {
        if (git.is_git_repo && git.branch) {
          gitBtn.style.display = "inline-flex";
          gitLbl.textContent = git.files.length > 0 ? `${git.branch} (${git.files.length})` : git.branch;
        } else {
          gitBtn.style.display = "none";
        }
      }
    } catch {}
  }

  private showTreeContextMenu(entry: StudioFileEntry, clientX: number, clientY: number): void {
    this.closePopover();
    const menu = document.createElement("div");
    menu.className = "studio-popover";
    menu.dataset.anchorId = "tree-ctx";
    menu.style.left = `${Math.min(clientX, window.innerWidth - 210)}px`;
    menu.style.top = `${Math.min(clientY, window.innerHeight - 240)}px`;

    const parentDir = entry.is_dir
      ? entry.path
      : entry.path.includes("/")
        ? entry.path.slice(0, entry.path.lastIndexOf("/"))
        : "";

    const items: Array<{ label: string; disabled?: boolean; action: () => void }> = [];

    if (!entry.is_dir) {
      items.push({
        label: t("openFileAction"),
        disabled: entry.is_sensitive,
        action: () => void this.openProjectFile(entry.path, entry.is_sensitive),
      });
      items.push({
        label: this.fileTree.isAttached(entry.path) ? t("removeFromContext") : t("attachToChat"),
        disabled: entry.is_sensitive,
        action: () => this.fileTree.toggleAttach(entry),
      });
    } else {
      items.push({
        label: t("openTermHere"),
        action: () => {
          if (this.currentProjectRoot) {
            const fullDir = `${this.currentProjectRoot}\\${entry.path.replace(/\//g, "\\")}`;
            this.bottomPanel.setActiveTab("terminal");
            void this.bottomPanel.openNewTerminal(fullDir);
          }
        },
      });
    }

    items.push({
      label: t("newFile"),
      action: () => void this.handleCreateEntryInDir(false, parentDir),
    });
    items.push({
      label: t("newFolder"),
      action: () => void this.handleCreateEntryInDir(true, parentDir),
    });
    items.push({
      label: t("rename"),
      disabled: entry.is_sensitive,
      action: () => void this.handleRenameEntry(entry),
    });
    items.push({
      label: t("delete"),
      disabled: entry.is_sensitive,
      action: () => void this.handleDeleteEntry(entry),
    });
    items.push({
      label: t("copyRelPath"),
      action: () => {
        navigator.clipboard?.writeText(entry.path).catch(() => {});
        this.showToast(`${entry.path}`, "info");
      },
    });

    for (const item of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "studio-popover-item";
      btn.disabled = !!item.disabled;
      btn.textContent = item.label;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.closePopover();
        item.action();
      });
      menu.appendChild(btn);
    }

    document.body.appendChild(menu);
    this.openPopover = menu;
  }

  private async handleCreateEntryInDir(isDir: boolean, baseDir: string): Promise<void> {
    if (!this.currentProjectRoot) return;
    const prefix = baseDir ? `${baseDir}/` : "";
    const relPath = await showInputDialog({
      title: isDir ? t("newFolderTitle") : t("newFileTitle"),
      label: t("relPathLabel"),
      placeholder: `${prefix}${isDir ? "newFolder" : "newFile.ts"}`,
      defaultValue: prefix,
      confirmText: t("createBtn"),
    });
    if (!relPath) return;
    if (isSensitiveFileOrDir(relPath)) {
      this.bottomPanel.logActivity("blocked", `Sensitive file creation blocked: ${relPath}`);
      this.showToast(t("sensitiveBlockedMsg"), "error");
      return;
    }
    try {
      await invoke("studio_create_entry", { relPath, isDir });
      await this.fileTree.refresh();
      await this.refreshProjectIndexAndGit();
      if (!isDir) await this.openProjectFile(relPath);
      this.showToast(`${t("createdLabel")}: ${relPath}`, "info");
    } catch (e: any) {
      this.showToast(`${e}`, "error");
    }
  }

  private async handleRenameEntry(entry: StudioFileEntry): Promise<void> {
    const nextPath = await showInputDialog({
      title: t("renameTitle"),
      label: `${t("renameCurrentPath")}: ${entry.path}`,
      placeholder: entry.path,
      defaultValue: entry.path,
      confirmText: t("renameBtn"),
    });
    if (!nextPath || nextPath === entry.path) return;
    try {
      await invoke("studio_rename_entry", { oldRelPath: entry.path, newRelPath: nextPath });
      this.codeViewer.renameOpenTab(entry.path, nextPath);
      await this.fileTree.refresh();
      await this.refreshProjectIndexAndGit();
      this.bottomPanel.logActivity("system", `${t("renamedLabel")}: ${entry.path} -> ${nextPath}`);
      this.showToast(`${t("renamedLabel")}: ${nextPath}`, "info");
    } catch (e: any) {
      this.showToast(`${e}`, "error");
    }
  }

  private async handleDeleteEntry(entry: StudioFileEntry): Promise<void> {
    if (studioSettings.get().confirmBeforeDelete) {
      const ok = await showConfirmDialog({
        title: entry.is_dir ? t("deleteFolderTitle") : t("deleteFileTitle"),
        message: `"${entry.path}" ${t("deleteConfirmMsg")}`,
        confirmText: t("deleteBtn"),
        danger: true,
      });
      if (!ok) return;
    }
    try {
      await invoke("studio_delete_entry", { relPath: entry.path });
      this.codeViewer.closeTab(entry.path);
      this.studioChat.detachFile(entry.path);
      await this.fileTree.refresh();
      await this.refreshProjectIndexAndGit();
      this.bottomPanel.logActivity("system", `${t("deletedLabel")}: ${entry.path}`);
      this.showToast(`${t("deletedLabel")}: ${entry.path}`, "info");
    } catch (e: any) {
      this.showToast(`${e}`, "error");
    }
  }

  private async openOrCreateMintuRules(): Promise<void> {
    if (!this.currentProjectRoot) {
      this.showToast(t("noFolderSelected"), "info");
      return;
    }
    try {
      const existing = await invoke<string | null>("studio_read_project_rules");
      if (existing === null) {
        const template = `# Mintu Studio Project Rules (.minturules)\n# Mintu AI reads this file automatically on every request in this workspace.\n\n- Follow the existing project conventions and architecture.\n- Keep changes minimal, clean, and well-typed.\n`;
        await invoke("studio_write_file", { relPath: ".minturules", content: template });
        await this.fileTree.refresh();
      }
      await this.openProjectFile(".minturules", false);
      await this.refreshProjectIndexAndGit();
    } catch (e: any) {
      this.showToast(`Error: ${e}`, "error");
    }
  }

  private startLiveFileWatcher(): void {
    if (this.watcherTimer) window.clearInterval(this.watcherTimer);
    this.watcherTimer = window.setInterval(async () => {
      if (!this.currentProjectRoot || document.hidden) return;
      try {
        const fp = await invoke<string>("studio_project_fingerprint");
        if (this.lastFingerprint && fp && fp !== this.lastFingerprint) {
          this.lastFingerprint = fp;
          await this.fileTree.refresh();
          await this.refreshProjectIndexAndGit();
          // Reload clean (non-dirty) open editor tabs if changed externally
          for (const tab of this.codeViewer.getOpenTabs()) {
            if (!tab.dirty) {
              const fresh = await invoke<string>("studio_read_file", { relPath: tab.path }).catch(() => null);
              if (fresh !== null && fresh !== tab.content) {
                this.codeViewer.reloadFileFromDisk(tab.path, fresh);
              }
            }
          }
        } else if (!this.lastFingerprint && fp) {
          this.lastFingerprint = fp;
        }
      } catch {}
    }, 3000);
  }

  private async backgroundCheckUpdates(): Promise<void> {
    const prefs = studioSettings.get();
    if (!prefs.autoCheckUpdates) return;
    const repo = (prefs.githubRepo || "").trim();
    const customUrl = (prefs.customUpdateUrl || "").trim();
    if (!repo && !customUrl) return;
    try {
      const res = await invoke<UpdateCheckResult>("updater_check", {
        repo: repo || "HuseynDeveloper/mintu-studio",
        customManifestUrl: customUrl || null,
      });
      this.settingsPage.setExternalUpdateResult(res);
      this.applyUpdateBadge(res);
    } catch {
      // Silent on startup if offline or no release published yet
    }
  }

  private applyUpdateBadge(res: UpdateCheckResult): void {
    const btn = document.getElementById("btn-topbar-update");
    const lbl = document.getElementById("topbar-update-label");
    if (!btn || !lbl) return;
    if (res.update_available) {
      lbl.textContent = `${t("updateAvailableBadge")}: v${res.latest_version}`;
      btn.style.display = "inline-flex";
    } else {
      btn.style.display = "none";
    }
  }

  private async runWorkspaceProjectCheck(): Promise<void> {
    if (!this.currentProjectRoot) {
      this.showToast(t("noFolderSelected"), "info");
      return;
    }
    this.bottomPanel.setActiveTab("problems");
    this.bottomPanel.setCheckingProject(true);
    try {
      const res = await invoke<{
        tool: string;
        exit_code: number;
        diagnostics: WorkspaceDiagItem[];
        raw_summary: string;
      }>("devtools_check_project");
      this.bottomPanel.setWorkspaceDiagnostics(res.diagnostics, `${res.tool} · ${res.raw_summary.split("\n")[0]}`);
      const extMap = new Map<string, Array<{ line: number; col: number; severity: "error" | "warning"; message: string }>>();
      for (const d of res.diagnostics) {
        const norm = d.path.replace(/\\/g, "/");
        const arr = extMap.get(norm) || [];
        arr.push({
          line: d.line,
          col: d.col,
          severity: d.severity === "warning" ? "warning" : "error",
          message: d.message,
        });
        extMap.set(norm, arr);
      }
      this.codeViewer.setExternalDiagnostics(extMap);
      this.bottomPanel.logActivity("system", `${res.tool}: ${res.diagnostics.length} diagnostic(s)`);
    } catch (e: any) {
      this.bottomPanel.setWorkspaceDiagnostics([], String(e));
    } finally {
      this.bottomPanel.setCheckingProject(false);
    }
  }

  private async scanWorkspaceTodos(): Promise<void> {
    if (!this.currentProjectRoot) {
      this.bottomPanel.setTodos([]);
      return;
    }
    try {
      const items = await invoke<TodoScanItem[]>("devtools_scan_todos", { maxResults: 150 });
      this.bottomPanel.setTodos(items);
    } catch {
      this.bottomPanel.setTodos([]);
    }
  }

  private openProjectTemplates(): void {
    if (!this.currentProjectRoot) {
      this.showToast(t("noFolderSelected"), "info");
      return;
    }
    openNewProjectTemplateModal(async (created) => {
      await this.fileTree.refresh();
      await this.refreshProjectIndexAndGit();
      if (created.length > 0) {
        await this.openProjectFile(created[0], false);
        this.showToast(`Created ${created.length} template file(s).`, "info");
      } else {
        this.showToast("Template files already exist in folder.", "info");
      }
    });
  }

  private showToast(message: string, type: "info" | "error" = "info"): void {
    const existing = document.querySelector(".studio-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.className = `studio-toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.classList.add("toast-fadeout");
      setTimeout(() => toast.remove(), 250);
    }, 3000);
  }
}
