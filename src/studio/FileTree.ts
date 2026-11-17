/**
 * FileTree.ts
 * Project file tree explorer for Mintu Studio.
 * Enforces sensitive file warnings and attachment prevention.
 */

import { invoke } from "@tauri-apps/api/core";
import { isSensitiveFileOrDir } from "./sensitiveFilter";

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
  private entriesMap: Map<string, StudioFileEntry[]> = new Map();
  private expandedDirs: Set<string> = new Set();
  private selectedPath: string | null = null;
  private attachedPaths: Set<string> = new Set();

  public onFileSelect?: (entry: StudioFileEntry) => void;
  public onFileToggleAttach?: (entry: StudioFileEntry, attached: boolean) => void;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  public setProjectRoot(rootPath: string | null) {
    this.currentRoot = rootPath;
    this.entriesMap.clear();
    this.expandedDirs.clear();
    this.selectedPath = null;
    this.attachedPaths.clear();

    if (!rootPath) {
      this.renderEmpty();
    } else {
      this.loadDir("");
    }
  }

  public async refresh() {
    if (!this.currentRoot) {
      this.renderEmpty();
      return;
    }
    const currentExpanded = Array.from(this.expandedDirs);
    this.entriesMap.clear();
    await this.loadDir("");
    for (const dir of currentExpanded) {
      await this.loadDir(dir);
    }
  }

  public async loadDir(relPath: string) {
    try {
      const entries: StudioFileEntry[] = await invoke("studio_list_dir", {
        relPath: relPath || null,
      });

      // Augment sensitive check with both Rust response and TS check
      const augmented = entries.map((e) => ({
        ...e,
        is_sensitive: e.is_sensitive || isSensitiveFileOrDir(e.path),
      }));

      this.entriesMap.set(relPath, augmented);
      if (relPath) {
        this.expandedDirs.add(relPath);
      }
      this.render();
    } catch (err: any) {
      console.error("Failed to list dir:", err);
      this.showError(`Xəta: ${err}`);
    }
  }

  public toggleDir(relPath: string) {
    if (this.expandedDirs.has(relPath)) {
      this.expandedDirs.delete(relPath);
      this.render();
    } else {
      this.loadDir(relPath);
    }
  }

  public selectFile(entry: StudioFileEntry) {
    if (entry.is_dir) {
      this.toggleDir(entry.path);
      return;
    }
    this.selectedPath = entry.path;
    this.render();
    if (this.onFileSelect) {
      this.onFileSelect(entry);
    }
  }

  public toggleAttach(entry: StudioFileEntry) {
    if (entry.is_dir || entry.is_sensitive) return;

    const isAttached = this.attachedPaths.has(entry.path);
    if (isAttached) {
      this.attachedPaths.delete(entry.path);
    } else {
      this.attachedPaths.add(entry.path);
    }
    this.render();

    if (this.onFileToggleAttach) {
      this.onFileToggleAttach(entry, !isAttached);
    }
  }

  public isAttached(path: string): boolean {
    return this.attachedPaths.has(path);
  }

  public setAttached(path: string, attached: boolean) {
    if (attached) {
      this.attachedPaths.add(path);
    } else {
      this.attachedPaths.delete(path);
    }
    this.render();
  }

  private renderEmpty() {
    this.container.innerHTML = `
      <div class="tree-empty-state">
        <div class="tree-empty-icon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
        </div>
        <div class="tree-empty-text">Heç bir layihə açılmayıb</div>
        <button id="btn-tree-open-folder" class="studio-btn studio-btn-primary">Qovluq Seç</button>
      </div>
    `;

    const openBtn = this.container.querySelector("#btn-tree-open-folder");
    if (openBtn) {
      openBtn.addEventListener("click", () => {
        const topBtn = document.getElementById("btn-open-folder");
        if (topBtn) topBtn.click();
      });
    }
  }

  private showError(msg: string) {
    this.container.innerHTML = `
      <div class="tree-error-state">
        <span class="error-msg">${msg}</span>
      </div>
    `;
  }

  public render() {
    if (!this.currentRoot) {
      this.renderEmpty();
      return;
    }

    const rootEntries = this.entriesMap.get("") || [];
    if (rootEntries.length === 0) {
      this.container.innerHTML = `
        <div class="tree-empty-state">
          <div class="tree-empty-text">Qovluq boşdur</div>
        </div>
      `;
      return;
    }

    this.container.innerHTML = "";
    const listEl = document.createElement("div");
    listEl.className = "tree-list";

    this.renderSubtree("", listEl, 0);
    this.container.appendChild(listEl);
  }

  private renderSubtree(relPath: string, parentEl: HTMLElement, depth: number) {
    const entries = this.entriesMap.get(relPath) || [];

    for (const entry of entries) {
      const itemEl = document.createElement("div");
      itemEl.className = `tree-item ${entry.is_dir ? "is-dir" : "is-file"} ${
        entry.path === this.selectedPath ? "selected" : ""
      } ${entry.is_sensitive ? "is-sensitive" : ""}`;
      itemEl.style.paddingLeft = `${depth * 14 + 10}px`;

      // Icon
      const iconEl = document.createElement("span");
      iconEl.className = "item-icon";
      if (entry.is_dir) {
        const isExpanded = this.expandedDirs.has(entry.path);
        iconEl.innerHTML = isExpanded
          ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>`
          : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
      } else {
        iconEl.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>`;
      }

      // Name
      const nameEl = document.createElement("span");
      nameEl.className = "item-name";
      nameEl.textContent = entry.name;
      nameEl.title = entry.path;

      itemEl.appendChild(iconEl);
      itemEl.appendChild(nameEl);

      // Sensitive file badge
      if (entry.is_sensitive) {
        const sensitiveBadge = document.createElement("span");
        sensitiveBadge.className = "badge-sensitive";
        sensitiveBadge.textContent = "excluded (sensitive)";
        sensitiveBadge.title = "Təhlükəsizlik qaydası: Həssas faylların oxunması və AI-ya göndərilməsi qadağandır.";
        itemEl.appendChild(sensitiveBadge);
      } else if (!entry.is_dir) {
        // Attach checkbox / pill
        const isAtt = this.attachedPaths.has(entry.path);
        const attachBtn = document.createElement("button");
        attachBtn.className = `btn-attach-pill ${isAtt ? "attached" : ""}`;
        attachBtn.title = isAtt ? "Çat kontekstindən çıxar" : "Çat kontekstinə əlavə et";
        attachBtn.textContent = isAtt ? "Qoşulub" : "+ Qoş";

        attachBtn.onclick = (e) => {
          e.stopPropagation();
          this.toggleAttach(entry);
        };
        itemEl.appendChild(attachBtn);
      }

      itemEl.onclick = () => this.selectFile(entry);
      parentEl.appendChild(itemEl);

      // If directory is expanded, render children recursively
      if (entry.is_dir && this.expandedDirs.has(entry.path)) {
        this.renderSubtree(entry.path, parentEl, depth + 1);
      }
    }
  }
}
