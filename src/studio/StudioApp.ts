/**
 * StudioApp.ts
 * Main coordinator for Standalone Mintu Studio.
 * Connects FileTree, CodeViewer, StudioChat, and SettingsModal with Rust backend commands.
 */

import { invoke } from "@tauri-apps/api/core";
import { FileTree, StudioFileEntry } from "./FileTree";
import { CodeViewer } from "./CodeViewer";
import { StudioChat } from "./StudioChat";
import { SettingsModal } from "./SettingsModal";
import { isSensitiveFileOrDir } from "./sensitiveFilter";
import { StudioAIClient } from "../ai/StudioAIClient";

export class StudioApp {
  private fileTree!: FileTree;
  private codeViewer!: CodeViewer;
  private studioChat!: StudioChat;
  private aiClient!: StudioAIClient;
  private settingsModal!: SettingsModal;

  private currentProjectRoot: string | null = null;
  private currentFolderName: string | null = null;

  public getProjectRoot(): string | null {
    return this.currentProjectRoot;
  }

  public getFolderName(): string | null {
    return this.currentFolderName;
  }

  constructor() {
    this.initDOM();
    this.initSubsystems();
    this.initGlobalEvents();
    this.checkCurrentProject();
  }

  private initDOM(): void {
    const treeContainer = document.getElementById("studio-file-tree");
    const editorContainer = document.getElementById("studio-editor-container");
    const tabsContainer = document.getElementById("studio-tabs-bar");
    const pathDisplay = document.getElementById("studio-active-file-path");
    const statusBar = document.getElementById("studio-editor-status");
    const chatContainer = document.getElementById("studio-chat-container");

    if (!treeContainer || !editorContainer || !tabsContainer || !pathDisplay || !statusBar || !chatContainer) {
      throw new Error("Missing required Studio DOM elements");
    }

    this.aiClient = new StudioAIClient();
    this.settingsModal = new SettingsModal(this.aiClient);
    this.fileTree = new FileTree(treeContainer);
    this.codeViewer = new CodeViewer(editorContainer, tabsContainer, pathDisplay, statusBar);
    this.studioChat = new StudioChat(chatContainer, this.aiClient);
  }

  private initSubsystems(): void {
    this.settingsModal.onSettingsSaved = () => {
      this.studioChat.updateProviderBadge();
      this.showToast("Model və API tənzimləmələri yadda saxlanıldı.", "info");
    };

    this.studioChat.onOpenSettings = () => {
      this.settingsModal.open();
    };

    // 1. File selection from tree -> Open in CodeViewer
    this.fileTree.onFileSelect = async (entry: StudioFileEntry) => {
      if (entry.is_sensitive || isSensitiveFileOrDir(entry.path)) {
        this.showToast("Bu fayl həssas məlumat ehtiva etdiyi üçün açıla bilməz.", "error");
        return;
      }

      try {
        const content: string = await invoke("studio_read_file", { relPath: entry.path });
        this.codeViewer.openFile(entry.path, content);
      } catch (err: any) {
        this.showToast(`Fayl oxunmadı: ${err}`, "error");
      }
    };

    // 2. Toggle attach file from tree -> Add to StudioChat attachment tray
    this.fileTree.onFileToggleAttach = async (entry: StudioFileEntry, attached: boolean) => {
      if (attached) {
        if (entry.is_sensitive || isSensitiveFileOrDir(entry.path)) {
          this.showToast("Həssas faylları çat kontekstinə qoşmaq qadağandır.", "error");
          this.fileTree.setAttached(entry.path, false);
          return;
        }

        try {
          const content: string = await invoke("studio_read_file", { relPath: entry.path });
          this.studioChat.attachFile(entry.path, content);
          this.showToast(`"${entry.name}" çat kontekstinə əlavə olundu.`, "info");
        } catch (err: any) {
          this.fileTree.setAttached(entry.path, false);
          this.showToast(`Fayl qoşulmadı: ${err}`, "error");
        }
      } else {
        this.studioChat.detachFile(entry.path);
      }
    };

    // 3. Remove from chat tray -> Uncheck in file tree
    this.studioChat.onFileRemoved = (path: string) => {
      this.fileTree.setAttached(path, false);
    };

    // 4. Attach active file button in header
    const btnAttachActive = document.getElementById("btn-attach-active-file");
    btnAttachActive?.addEventListener("click", () => {
      const active = this.codeViewer.getActiveFile();
      if (!active) {
        this.showToast("Aktiv fayl yoxdur.", "info");
        return;
      }
      if (isSensitiveFileOrDir(active.path)) {
        this.showToast("Həssas faylı çat kontekstinə qoşmaq qadağandır.", "error");
        return;
      }
      this.studioChat.attachFile(active.path, active.content);
      this.fileTree.setAttached(active.path, true);
      this.showToast(`"${active.name}" çat kontekstinə əlavə olundu.`, "info");
    });
  }

  private initGlobalEvents(): void {
    document.getElementById("btn-open-folder")?.addEventListener("click", () => this.handlePickFolder());
    document.getElementById("btn-close-project")?.addEventListener("click", () => this.handleCloseProject());
    document.getElementById("btn-refresh-tree")?.addEventListener("click", () => this.fileTree.refresh());
    document.getElementById("btn-open-settings")?.addEventListener("click", () => this.settingsModal.open());
  }

  private async checkCurrentProject(): Promise<void> {
    try {
      const info: { root_path: string; folder_name: string } | null = await invoke("studio_get_project_root");
      if (info) {
        this.setProject(info.root_path, info.folder_name);
      } else {
        this.setProject(null, null);
      }
    } catch (e) {
      console.warn("Could not query studio project root", e);
    }
  }

  public async handlePickFolder(): Promise<void> {
    try {
      const info: { root_path: string; folder_name: string } | null = await invoke("studio_pick_folder");
      if (info) {
        this.setProject(info.root_path, info.folder_name);
        this.showToast(`Layihə açıldı: ${info.folder_name}`, "info");
      }
    } catch (err: any) {
      this.showToast(`Qovluq seçilmədi: ${err}`, "error");
    }
  }

  public async handleCloseProject(): Promise<void> {
    try {
      await invoke("studio_close_project");
      this.setProject(null, null);
      this.showToast("Layihə bağlandı.", "info");
    } catch (e: any) {
      this.showToast(`Xəta: ${e}`, "error");
    }
  }

  private setProject(rootPath: string | null, folderName: string | null): void {
    this.currentProjectRoot = rootPath;
    this.currentFolderName = folderName;

    const labelEl = document.getElementById("current-project-label");
    const closeBtn = document.getElementById("btn-close-project");

    if (rootPath && folderName) {
      if (labelEl) {
        labelEl.textContent = folderName;
        labelEl.title = rootPath;
      }
      if (closeBtn) closeBtn.style.display = "inline-flex";
    } else {
      if (labelEl) {
        labelEl.textContent = "Layihə seçilməyib";
        labelEl.title = "";
      }
      if (closeBtn) closeBtn.style.display = "none";
    }

    this.fileTree.setProjectRoot(rootPath);
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
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
}
