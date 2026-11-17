/**
 * StudioApp.ts
 * Main coordinator for Standalone Mintu Studio.
 * Wires:
 * - Custom dark title bar (project dropdown, centered filename search Ctrl+Shift+F, model selector dropdown, settings, native window controls)
 * - Far-left icon rail (Explorer, Axtar, Modellər, bottom Tənzimləmələr)
 * - Explorer panel (with "..." menu and resizable splitter)
 * - Read-only CodeViewer + slim minimap
 * - Resizable BottomPanel (Kontekst, Fəaliyyət jurnalı, Problemlər — NO terminal)
 * - Resizable Right "Mintu AI" panel
 * - Bottom Status Bar (Hazır + language + UTF-8 + Ln/Col + Lokal/Bulud data-flow indicator)
 */

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FileTree, StudioFileEntry } from "./FileTree";
import { CodeViewer, EditorStatusInfo } from "./CodeViewer";
import { StudioChat } from "./StudioChat";
import { SettingsModal } from "./SettingsModal";
import { BottomPanel } from "./BottomPanel";
import { isSensitiveFileOrDir } from "./sensitiveFilter";
import { StudioAIClient } from "../ai/StudioAIClient";
import { CLOUD_PROVIDERS } from "../ai/cloudCatalog";

export class StudioApp {
  private fileTree!: FileTree;
  private codeViewer!: CodeViewer;
  private studioChat!: StudioChat;
  private bottomPanel!: BottomPanel;
  private aiClient!: StudioAIClient;
  private settingsModal!: SettingsModal;

  private currentProjectRoot: string | null = null;

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

    if (
      !treeContainer ||
      !editorContainer ||
      !tabsContainer ||
      !minimapWrap ||
      !minimapCanvas ||
      !minimapThumb ||
      !chatContainer ||
      !bottomContainer
    ) {
      throw new Error("Missing required Studio DOM elements");
    }

    this.aiClient = new StudioAIClient();
    this.settingsModal = new SettingsModal(this.aiClient);
    this.fileTree = new FileTree(treeContainer);
    this.codeViewer = new CodeViewer(editorContainer, tabsContainer, minimapWrap, minimapCanvas, minimapThumb);
    this.studioChat = new StudioChat(chatContainer, this.aiClient);
    this.bottomPanel = new BottomPanel(bottomContainer);
  }

  private initSubsystems(): void {
    this.settingsModal.onSettingsSaved = () => {
      this.refreshAllModelIndicators();
      const routing = this.aiClient.getActiveRouting();
      this.bottomPanel.logActivity(
        "system",
        routing.isLocal
          ? `Model dəyişdirildi: Lokal (${routing.model})`
          : `Model dəyişdirildi: Bulud (${routing.provider} · ${routing.model})`
      );
      this.showToast("Model və API tənzimləmələri yadda saxlanıldı.", "info");
    };

    // Explorer events
    this.fileTree.onOpenFolderRequest = () => this.handlePickFolder();
    this.fileTree.onListError = (relPath, err) => {
      this.bottomPanel.addProblem("error", relPath, err);
    };

    this.fileTree.onFileSelect = async (entry: StudioFileEntry) => {
      if (entry.is_sensitive || isSensitiveFileOrDir(entry.path)) {
        const msg = `Həssas (xaric edilib): "${entry.path}" açıla bilməz.`;
        this.bottomPanel.logActivity("blocked", `Həssas fayl bloklandı: ${entry.path}`);
        this.bottomPanel.addProblem("warning", entry.path, "Həssas fayl təhlükəsizlik qaydasına görə bloklandı");
        this.showToast(msg, "error");
        return;
      }

      this.setStatusText("Oxunur...");
      try {
        const content: string = await invoke("studio_read_file", { relPath: entry.path });
        this.codeViewer.openFile(entry.path, content);
        this.bottomPanel.logActivity("read", `Fayl oxundu: ${entry.path}`);
      } catch (err: any) {
        const errText = String(err);
        this.bottomPanel.logActivity("blocked", `Fayl oxunmadı: ${entry.path}`, errText);
        this.bottomPanel.addProblem("error", entry.path, errText);
        this.showToast(`Fayl oxunmadı: ${errText}`, "error");
      } finally {
        this.setStatusText("Hazır");
      }
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
      if (tab) {
        this.fileTree.selectFileByPath(tab.path);
      }
    };

    this.codeViewer.onAttachActiveRequest = (tab) => {
      this.attachActiveFileToChat(tab.path, tab.name, tab.content);
    };

    // StudioChat events
    this.studioChat.onFileRemoved = (path) => {
      this.fileTree.setAttached(path, false);
    };

    this.studioChat.onAttachedChanged = (summaries) => {
      this.bottomPanel.updateContextFiles(summaries);
    };

    this.studioChat.onOpenSettings = () => {
      this.settingsModal.open();
    };

    this.studioChat.onAttachButtonClick = () => {
      const active = this.codeViewer.getActiveFile();
      if (active) {
        this.attachActiveFileToChat(active.path, active.name, active.content);
      } else {
        this.showToast("Qoşmaq üçün əvvəlcə fayl açın və ya ağacdan '+' düyməsini sıxın.", "info");
      }
    };

    this.studioChat.onExpandToggle = () => {
      const rightPanel = document.getElementById("studio-chat-container");
      if (!rightPanel) return;
      this.rightPanelExpanded = !this.rightPanelExpanded;
      rightPanel.style.width = this.rightPanelExpanded ? "520px" : "340px";
    };

    this.studioChat.onClosePanel = () => {
      this.setRightPanelVisible(false);
    };

    this.studioChat.onMessageDispatched = (routing, files) => {
      const routeLabel = routing.isLocal ? `Lokal (${routing.model})` : `Bulud: ${routing.provider} (${routing.model})`;
      const fileDetail = files.length > 0 ? `${files.length} fayl: ${files.join(", ")}` : "faylsız";
      this.bottomPanel.logActivity("send", `Sorğu göndərildi -> ${routeLabel}`, fileDetail);
    };

    this.studioChat.onBusyStateChange = (busy) => {
      this.setStatusText(busy ? "Düşünür..." : "Hazır");
    };

    // BottomPanel events
    this.bottomPanel.onRemoveContextFile = (path) => {
      this.studioChat.detachFile(path);
    };

    this.bottomPanel.onOpenContextFile = async (path) => {
      if (isSensitiveFileOrDir(path)) return;
      try {
        const content: string = await invoke("studio_read_file", { relPath: path });
        this.codeViewer.openFile(path, content);
      } catch {}
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
    // Project dropdown button
    const projBtn = document.getElementById("btn-project-dropdown");
    projBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.togglePopover(projBtn, [
        { label: "Qovluq Aç...", action: () => this.handlePickFolder() },
        { label: "Yenilə", action: () => this.fileTree.refresh(), disabled: !this.currentProjectRoot },
        { label: "Layihəni Bağla", action: () => this.handleCloseProject(), disabled: !this.currentProjectRoot },
      ]);
    });

    // Centered search field -> filters loaded file names in Explorer
    const searchInput = document.getElementById("studio-search-input") as HTMLInputElement | null;
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        if (!this.explorerVisible) {
          this.setExplorerVisible(true);
        }
        this.fileTree.setSearchFilter(searchInput.value);
      });
      searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          searchInput.value = "";
          this.fileTree.setSearchFilter("");
          searchInput.blur();
        }
      });
    }

    // Model selector dropdown (right side of top bar)
    const modelBtn = document.getElementById("btn-model-selector");
    modelBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      const activeProv = this.aiClient.getActiveProvider();
      const items: Array<{ label: string; active?: boolean; action: () => void }> = [
        {
          label: `Lokal (${this.aiClient.getLocalModel()})`,
          active: activeProv === "local",
          action: () => {
            this.aiClient.setActiveProvider("local");
            this.refreshAllModelIndicators();
            this.bottomPanel.logActivity("system", `Aktiv model: Lokal (${this.aiClient.getLocalModel()})`);
          },
        },
        ...Object.values(CLOUD_PROVIDERS).map((p) => ({
          label: `Bulud: ${p.name}`,
          active: activeProv === p.id,
          action: () => {
            this.aiClient.setActiveProvider(p.id);
            this.refreshAllModelIndicators();
            this.bottomPanel.logActivity("system", `Aktiv model: Bulud (${p.name})`);
          },
        })),
        {
          label: "Model və API Tənzimləmələri...",
          action: () => this.settingsModal.open(),
        },
      ];
      this.togglePopover(modelBtn, items, true);
    });

    // Top bar Settings button
    document.getElementById("btn-topbar-settings")?.addEventListener("click", () => {
      this.settingsModal.open();
    });

    // Explorer "..." menu
    const expMenuBtn = document.getElementById("btn-explorer-menu");
    expMenuBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.togglePopover(expMenuBtn, [
        { label: "Qovluq Aç", action: () => this.handlePickFolder() },
        { label: "Yenilə", action: () => this.fileTree.refresh(), disabled: !this.currentProjectRoot },
        { label: "Qovluqları Yığ", action: () => this.fileTree.collapseAll(), disabled: !this.currentProjectRoot },
      ]);
    });

    // Status bar data-flow click -> open Settings or re-open Mintu AI panel
    document.getElementById("status-dataflow-btn")?.addEventListener("click", () => {
      if (!this.rightPanelVisible) {
        this.setRightPanelVisible(true);
      } else {
        this.settingsModal.open();
      }
    });

    // Window controls (custom dark title bar)
    const appWindow = getCurrentWindow();
    document.getElementById("btn-win-min")?.addEventListener("click", () => {
      appWindow.minimize().catch(() => {});
    });
    document.getElementById("btn-win-max")?.addEventListener("click", () => {
      appWindow.toggleMaximize().catch(() => {});
    });
    document.getElementById("btn-win-close")?.addEventListener("click", () => {
      appWindow.close().catch(() => {});
    });

    // Close popovers on outside click
    document.addEventListener("click", () => this.closePopover());
  }

  private initRail(): void {
    const railExplorer = document.getElementById("rail-btn-explorer");
    const railSearch = document.getElementById("rail-btn-search");
    const railModels = document.getElementById("rail-btn-models");
    const railSettings = document.getElementById("rail-btn-settings");

    const setActiveRail = (activeBtn: HTMLElement | null) => {
      document.querySelectorAll(".rail-btn").forEach((b) => b.classList.remove("active"));
      activeBtn?.classList.add("active");
    };

    railExplorer?.addEventListener("click", () => {
      this.setExplorerVisible(!this.explorerVisible);
      setActiveRail(this.explorerVisible ? railExplorer : null);
    });

    railSearch?.addEventListener("click", () => {
      if (!this.explorerVisible) this.setExplorerVisible(true);
      setActiveRail(railSearch);
      const searchInput = document.getElementById("studio-search-input") as HTMLInputElement | null;
      searchInput?.focus();
      searchInput?.select();
    });

    railModels?.addEventListener("click", () => {
      this.setRightPanelVisible(true);
      this.settingsModal.open();
    });

    railSettings?.addEventListener("click", () => {
      this.settingsModal.open();
    });
  }

  private initResizers(): void {
    // 1. Left Explorer splitter
    const leftResizer = document.getElementById("resizer-left");
    const leftPanel = document.getElementById("studio-left-panel");
    if (leftResizer && leftPanel) {
      this.bindHorizontalResizer(leftResizer, (dx, startW) => {
        const next = Math.max(180, Math.min(420, startW + dx));
        leftPanel.style.width = `${next}px`;
      }, () => leftPanel.getBoundingClientRect().width);
    }

    // 2. Right Mintu AI splitter
    const rightResizer = document.getElementById("resizer-right");
    const rightPanel = document.getElementById("studio-chat-container");
    if (rightResizer && rightPanel) {
      this.bindHorizontalResizer(rightResizer, (dx, startW) => {
        const next = Math.max(280, Math.min(560, startW - dx));
        rightPanel.style.width = `${next}px`;
      }, () => rightPanel.getBoundingClientRect().width);
    }

    // 3. Bottom panel splitter
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
      }
    });
  }

  private setExplorerVisible(visible: boolean): void {
    this.explorerVisible = visible;
    const panel = document.getElementById("studio-left-panel");
    const resizer = document.getElementById("resizer-left");
    if (panel) panel.style.display = visible ? "flex" : "none";
    if (resizer) resizer.style.display = visible ? "block" : "none";
  }

  private setRightPanelVisible(visible: boolean): void {
    this.rightPanelVisible = visible;
    const panel = document.getElementById("studio-chat-container");
    const resizer = document.getElementById("resizer-right");
    if (panel) panel.style.display = visible ? "flex" : "none";
    if (resizer) resizer.style.display = visible ? "block" : "none";
  }

  private refreshAllModelIndicators(): void {
    const routing = this.aiClient.getActiveRouting();

    // 1. Top bar model selector label
    const topLabel = document.getElementById("topbar-model-label");
    if (topLabel) {
      topLabel.textContent = routing.isLocal ? routing.model : `${routing.provider}`;
    }

    // 2. Right panel Mintu AI header pill
    this.studioChat.updateProviderBadge();

    // 3. Bottom status bar data-flow indicator
    const statusFlow = document.getElementById("status-dataflow-btn");
    const statusLabel = document.getElementById("status-dataflow-label");
    if (statusFlow && statusLabel) {
      if (routing.isLocal) {
        statusFlow.className = "status-dataflow is-local";
        statusLabel.textContent = "Lokal";
        statusFlow.title = `Lokal model: ${routing.model}`;
      } else {
        statusFlow.className = "status-dataflow is-cloud";
        statusLabel.textContent = `Bulud: ${routing.provider}`;
        statusFlow.title = `Bulud modeli: ${routing.provider} (${routing.model})`;
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

    const labelEl = document.getElementById("current-project-label");
    if (labelEl) {
      if (rootPath && folderName) {
        labelEl.textContent = folderName;
        labelEl.title = rootPath;
      } else {
        labelEl.textContent = "Qovluq Aç";
        labelEl.title = "Layihə qovluğu seçin";
      }
    }

    this.fileTree.setProjectRoot(rootPath, folderName);
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
