/**
 * FileTree.ts
 * Explorer panel for Mintu Studio.
 * - Project root header row with chevron
 * - Nested folders with chevrons, vertical indent guides, and file-type inline SVG icons
 * - Sensitive files show a small red lock + "Həssas" tag and cannot be opened or attached
 * - Live filename filtering from the top search field
 */

import { invoke } from "@tauri-apps/api/core";
import { isSensitiveFileOrDir } from "./sensitiveFilter";
import { studioSettings } from "./StudioSettings";
import { t } from "./i18n";
import {
  ICON_CHEVRON_DOWN,
  ICON_CHEVRON_RIGHT,
  ICON_FOLDER,
  ICON_LOCK_RED,
  getFileIconSvg,
} from "./icons";

export interface StudioFileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  is_sensitive: boolean;
  size: number;
}

export class FileTree {
  private container: HTMLElement;
  private currentRoot: string | null = null;
  private currentFolderName: string | null = null;
  private rootExpanded = true;
  private entriesMap: Map<string, StudioFileEntry[]> = new Map();
  private expandedDirs: Set<string> = new Set();
  private lastExpandedDir: string | null = null;
  private selectedPath: string | null = null;
  private attachedPaths: Set<string> = new Set();
  private searchQuery = "";
  private gitStatusMap: Map<string, string> = new Map();
  private recentProjects: Array<{ path: string; name: string }> = [];

  public onFileSelect?: (entry: StudioFileEntry) => void;
  public onFileToggleAttach?: (entry: StudioFileEntry, attached: boolean) => void;
  public onOpenFolderRequest?: () => void;
  public onOpenRecentProject?: (path: string) => void;
  public onContextMenuRequest?: (entry: StudioFileEntry, clientX: number, clientY: number) => void;
  public onListError?: (relPath: string, error: string) => void;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderEmpty();
    studioSettings.subscribe(() => {
      if (!this.currentRoot) this.renderEmpty();
      else this.render();
    });
  }

  public setProjectRoot(rootPath: string | null, folderName?: string | null): void {
    this.currentRoot = rootPath;
    this.currentFolderName = folderName || (rootPath ? rootPath.split(/[\\/]/).pop() || rootPath : null);
    this.rootExpanded = true;
    this.entriesMap.clear();
    this.expandedDirs.clear();
    this.selectedPath = null;
    this.attachedPaths.clear();

    if (!rootPath) {
      this.renderEmpty();
      return;
    }

    this.loadDir("");
  }

  public setGitStatusMap(map: Map<string, string>): void {
    this.gitStatusMap = map;
    if (this.currentRoot) this.render();
  }

  public setRecentProjects(items: Array<{ path: string; name: string }>): void {
    this.recentProjects = items;
    if (!this.currentRoot) this.renderEmpty();
  }

  public setSearchFilter(query: string): void {
    this.searchQuery = query.trim().toLowerCase();
    this.render();
  }

  public collapseAll(): void {
    this.expandedDirs.clear();
    this.render();
  }

  public getLoadedFiles(): StudioFileEntry[] {
    const out: StudioFileEntry[] = [];
    this.entriesMap.forEach((entries) => {
      for (const e of entries) {
        if (!e.is_dir && !e.is_sensitive) {
          out.push(e);
        }
      }
    });
    return out;
  }

  public async refresh(): Promise<void> {
    if (!this.currentRoot) {
      this.renderEmpty();
      return;
    }
    const prevExpanded = Array.from(this.expandedDirs);
    this.entriesMap.clear();
    await this.loadDir("");
    for (const dir of prevExpanded) {
      await this.loadDir(dir);
    }
  }

  private async loadDir(relPath: string): Promise<void> {
    try {
      const entries: StudioFileEntry[] = await invoke("studio_list_dir", {
        relPath: relPath || null,
      });

      const enriched = entries.map((e) => ({
        ...e,
        is_sensitive: e.is_sensitive || isSensitiveFileOrDir(e.path),
      }));

      this.entriesMap.set(relPath, enriched);
      if (relPath) {
        this.expandedDirs.add(relPath);
        this.lastExpandedDir = relPath;
      }
      this.render();
    } catch (err: any) {
      const msg = String(err);
      console.error("Failed to list dir:", msg);
      this.onListError?.(relPath || "/", msg);
      this.showError(`Error: ${msg}`);
    }
  }

  private toggleDir(relPath: string): void {
    if (this.expandedDirs.has(relPath)) {
      this.expandedDirs.delete(relPath);
      this.render();
    } else if (this.entriesMap.has(relPath)) {
      this.expandedDirs.add(relPath);
      this.lastExpandedDir = relPath;
      this.render();
    } else {
      this.loadDir(relPath);
    }
  }

  public selectFileByPath(relPath: string): void {
    this.selectedPath = relPath;
    this.render();
  }

  public selectFile(entry: StudioFileEntry): void {
    if (entry.is_dir) {
      this.toggleDir(entry.path);
      return;
    }
    if (!entry.is_sensitive) {
      this.selectedPath = entry.path;
      this.render();
    }
    this.onFileSelect?.(entry);
  }

  public toggleAttach(entry: StudioFileEntry): void {
    if (entry.is_dir || entry.is_sensitive) return;
    const isCurrentlyAttached = this.attachedPaths.has(entry.path);
    if (isCurrentlyAttached) {
      this.attachedPaths.delete(entry.path);
    } else {
      this.attachedPaths.add(entry.path);
    }
    this.render();
    this.onFileToggleAttach?.(entry, !isCurrentlyAttached);
  }

  public isAttached(path: string): boolean {
    return this.attachedPaths.has(path);
  }

  public setAttached(path: string, attached: boolean): void {
    if (attached) {
      this.attachedPaths.add(path);
    } else {
      this.attachedPaths.delete(path);
    }
    this.render();
  }

  private renderEmpty(): void {
    const recentHtml =
      this.recentProjects.length > 0
        ? `
          <div class="tree-recent-box">
            <div class="tree-recent-title">${t("recentProjects")}</div>
            ${this.recentProjects
              .slice(0, 6)
              .map(
                (r) => `
                <button type="button" class="tree-recent-item" data-recent-path="${this.escapeHtml(r.path).replace(/"/g, "&quot;")}" title="${this.escapeHtml(r.path).replace(/"/g, "&quot;")}">
                  <span class="tree-recent-name">${this.escapeHtml(r.name)}</span>
                  <span class="tree-recent-path">${this.escapeHtml(r.path)}</span>
                </button>
              `
              )
              .join("")}
          </div>
        `
        : "";

    this.container.innerHTML = `
      <div class="tree-empty-state">
        <div class="tree-empty-icon">${ICON_FOLDER}</div>
        <div class="tree-empty-text">${t("noFolderSelected")}</div>
        <button type="button" class="studio-btn studio-btn-sm" id="btn-tree-open-folder">${t("openFolder")}</button>
        ${recentHtml}
      </div>
    `;
    this.container.querySelector("#btn-tree-open-folder")?.addEventListener("click", () => {
      this.onOpenFolderRequest?.();
    });
    this.container.querySelectorAll<HTMLButtonElement>("[data-recent-path]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = btn.dataset.recentPath;
        if (p) this.onOpenRecentProject?.(p);
      });
    });
  }

  private showError(msg: string): void {
    this.container.innerHTML = `
      <div class="tree-empty-state">
        <div class="tree-empty-text tree-error-text">${this.escapeHtml(msg)}</div>
      </div>
    `;
  }

  private matchesSearchInSubtree(entry: StudioFileEntry): boolean {
    if (!this.searchQuery) return true;
    if (entry.name.toLowerCase().includes(this.searchQuery) || entry.path.toLowerCase().includes(this.searchQuery)) {
      return true;
    }
    if (entry.is_dir) {
      const children = this.entriesMap.get(entry.path) || [];
      return children.some((c) => this.matchesSearchInSubtree(c));
    }
    return false;
  }

  private render(): void {
    if (!this.currentRoot) {
      this.renderEmpty();
      return;
    }

    const rootEntries = this.entriesMap.get("") || [];
    this.container.innerHTML = "";

    // Project root header row (e.g. MY-APP)
    const rootRow = document.createElement("div");
    rootRow.className = "tree-root-row";
    rootRow.title = this.currentRoot;
    rootRow.innerHTML = `
      <span class="tree-chevron">${this.rootExpanded ? ICON_CHEVRON_DOWN : ICON_CHEVRON_RIGHT}</span>
      <span class="tree-root-name">${this.escapeHtml((this.currentFolderName || t("workspace")).toUpperCase())}</span>
    `;
    rootRow.addEventListener("click", () => {
      this.rootExpanded = !this.rootExpanded;
      this.render();
    });
    this.container.appendChild(rootRow);

    if (!this.rootExpanded) return;

    const listEl = document.createElement("div");
    listEl.className = "tree-list";
    const renderedCount = this.renderEntries(listEl, rootEntries, 0);

    if (this.searchQuery && renderedCount === 0) {
      const noMatch = document.createElement("div");
      noMatch.className = "tree-empty-state";
      noMatch.innerHTML = `<div class="tree-empty-text">"${this.escapeHtml(this.searchQuery)}" ${this.escapeHtml(t("noFilesFoundQuery"))}</div>`;
      this.container.appendChild(noMatch);
      return;
    }

    this.container.appendChild(listEl);
    this.lastExpandedDir = null;
  }

  private renderEntries(parentEl: HTMLElement, entries: StudioFileEntry[], depth: number, parentDir = ""): number {
    let count = 0;

    for (const entry of entries) {
      if (!this.matchesSearchInSubtree(entry)) continue;
      count++;

      const isExpanded = this.expandedDirs.has(entry.path) || (!!this.searchQuery && entry.is_dir && this.entriesMap.has(entry.path));
      const isSelected = this.selectedPath === entry.path;
      const isAttached = this.attachedPaths.has(entry.path);
      const isFreshBranch = !!this.lastExpandedDir && parentDir === this.lastExpandedDir;

      const itemEl = document.createElement("div");
      itemEl.className = `tree-item${isSelected ? " selected" : ""}${entry.is_sensitive ? " sensitive" : ""}${isFreshBranch ? " tree-branch-enter" : ""}`;
      itemEl.style.paddingLeft = `${10 + depth * 14}px`;
      itemEl.title = entry.is_sensitive ? `${entry.path} — ${t("sensitiveExcluded")}` : entry.path;

      // Vertical indent guides for nested depth
      for (let i = 0; i < depth; i++) {
        const guide = document.createElement("span");
        guide.className = "tree-indent-guide";
        guide.style.left = `${16 + i * 14}px`;
        itemEl.appendChild(guide);
      }

      // Chevron slot (for dirs; spacer for files)
      const chevronEl = document.createElement("span");
      chevronEl.className = "tree-chevron";
      if (entry.is_dir) {
        chevronEl.innerHTML = isExpanded ? ICON_CHEVRON_DOWN : ICON_CHEVRON_RIGHT;
      }
      itemEl.appendChild(chevronEl);

      // File or folder icon
      const iconEl = document.createElement("span");
      iconEl.className = entry.is_dir ? "item-icon item-icon-folder" : "item-icon";
      iconEl.innerHTML = entry.is_dir ? ICON_FOLDER : getFileIconSvg(entry.name);
      itemEl.appendChild(iconEl);

      // Name label
      const nameEl = document.createElement("span");
      nameEl.className = "item-name";
      nameEl.textContent = entry.name;
      itemEl.appendChild(nameEl);

      if (entry.is_sensitive) {
        const badge = document.createElement("span");
        badge.className = "badge-sensitive";
        badge.title = t("sensitiveExcluded");
        badge.innerHTML = `${ICON_LOCK_RED}<span>${t("sensitiveTag")}</span>`;
        itemEl.appendChild(badge);
      } else if (!entry.is_dir) {
        const gitSt = this.gitStatusMap.get(entry.path);
        if (gitSt) {
          const gitBadge = document.createElement("span");
          gitBadge.className = `tree-git-badge git-badge-${gitSt.toLowerCase()}`;
          gitBadge.textContent = gitSt;
          gitBadge.title = `Git status: ${gitSt}`;
          itemEl.appendChild(gitBadge);
        }

        const attachBtn = document.createElement("button");
        attachBtn.type = "button";
        attachBtn.className = `btn-attach-pill${isAttached ? " attached" : ""}`;
        attachBtn.textContent = isAttached ? t("attachedPill") : "+";
        attachBtn.title = isAttached ? t("removeFromContext") : t("attachToChat");
        attachBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.toggleAttach(entry);
        });
        itemEl.appendChild(attachBtn);
      }

      itemEl.addEventListener("click", () => {
        this.selectFile(entry);
      });

      itemEl.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.onContextMenuRequest?.(entry, e.clientX, e.clientY);
      });

      parentEl.appendChild(itemEl);

      if (entry.is_dir && isExpanded) {
        const children = this.entriesMap.get(entry.path);
        if (children && children.length > 0) {
          count += this.renderEntries(parentEl, children, depth + 1, entry.path);
        }
      }
    }

    return count;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
}
