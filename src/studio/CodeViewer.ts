/**
 * CodeViewer.ts
 * Multi-tab read-only code viewer powered by CodeMirror 6.
 * Adheres strictly to no-eval CSP and lightweight bundle constraints.
 */

import { EditorView, basicSetup } from "codemirror";
import { EditorState, Compartment } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";

export interface OpenTab {
  path: string;
  name: string;
  content: string;
}

export class CodeViewer {
  private container: HTMLElement;
  private tabsContainer: HTMLElement;
  private pathDisplay: HTMLElement;
  private editorHost: HTMLElement;
  private statusBar: HTMLElement;

  private openTabs: Map<string, OpenTab> = new Map();
  private activePath: string | null = null;
  private editorView: EditorView | null = null;
  private langCompartment: Compartment = new Compartment();

  public onTabChanged?: (activePath: string | null) => void;
  public onFileAttached?: (path: string, content: string) => void;

  constructor(
    container: HTMLElement,
    tabsContainer: HTMLElement,
    pathDisplay: HTMLElement,
    statusBar: HTMLElement
  ) {
    this.container = container;
    this.tabsContainer = tabsContainer;
    this.pathDisplay = pathDisplay;
    this.statusBar = statusBar;

    this.editorHost = document.createElement("div");
    this.editorHost.className = "studio-editor-host";
    this.container.appendChild(this.editorHost);

    this.initEmptyState();
  }

  private initEmptyState() {
    this.editorHost.innerHTML = `
      <div class="studio-empty-viewer">
        <div class="empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <polyline points="16 18 22 12 16 6"></polyline>
            <polyline points="8 6 2 12 8 18"></polyline>
          </svg>
        </div>
        <div class="empty-title">Fayl seçilməyib</div>
        <div class="empty-subtitle">Layihə ağacından fayl seçərək kodunu burada oxuya bilərsiniz</div>
      </div>
    `;
    this.pathDisplay.textContent = "";
    this.statusBar.textContent = "Hazır";
  }

  private getLanguageExtension(filename: string) {
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    switch (ext) {
      case "js":
      case "mjs":
      case "cjs":
        return javascript();
      case "jsx":
        return javascript({ jsx: true });
      case "ts":
      case "mts":
      case "cts":
        return javascript({ typescript: true });
      case "tsx":
        return javascript({ typescript: true, jsx: true });
      case "py":
        return python();
      case "rs":
        return rust();
      case "html":
      case "htm":
        return html();
      case "css":
      case "scss":
      case "less":
        return css();
      case "json":
        return json();
      default:
        return [];
    }
  }

  public openFile(path: string, content: string) {
    const name = path.split("/").pop() || path;

    if (!this.openTabs.has(path)) {
      this.openTabs.set(path, { path, name, content });
    }

    this.switchTab(path);
    this.renderTabs();
  }

  public switchTab(path: string) {
    const tab = this.openTabs.get(path);
    if (!tab) return;

    this.activePath = path;
    this.pathDisplay.textContent = path;

    // Destroy existing editor view if present
    if (this.editorView) {
      this.editorView.destroy();
      this.editorView = null;
    }
    this.editorHost.innerHTML = "";

    const langExt = this.getLanguageExtension(tab.name);
    const lineCount = (tab.content.match(/\n/g) || []).length + 1;
    const sizeKb = (new Blob([tab.content]).size / 1024).toFixed(1);

    const state = EditorState.create({
      doc: tab.content,
      extensions: [
        basicSetup,
        oneDark,
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        this.langCompartment.of(langExt),
        EditorView.theme({
          "&": {
            height: "100%",
            fontSize: "13px",
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
            backgroundColor: "#0d1117",
          },
          ".cm-scroller": {
            overflow: "auto",
            lineHeight: "1.6",
          },
          ".cm-content": {
            padding: "8px 0",
          },
          ".cm-line": {
            padding: "0 12px",
          },
        }),
      ],
    });

    this.editorView = new EditorView({
      state,
      parent: this.editorHost,
    });

    this.statusBar.innerHTML = `
      <span class="status-item">${lineCount} sətir</span>
      <span class="status-item">${sizeKb} KB</span>
      <span class="status-item badge-readonly">Yalnız Oxu</span>
    `;

    this.renderTabs();
    if (this.onTabChanged) {
      this.onTabChanged(this.activePath);
    }
  }

  public closeTab(path: string) {
    this.openTabs.delete(path);

    if (this.activePath === path) {
      const keys = Array.from(this.openTabs.keys());
      if (keys.length > 0) {
        this.switchTab(keys[keys.length - 1]);
      } else {
        this.activePath = null;
        if (this.editorView) {
          this.editorView.destroy();
          this.editorView = null;
        }
        this.initEmptyState();
        if (this.onTabChanged) {
          this.onTabChanged(null);
        }
      }
    }

    this.renderTabs();
  }

  public getActiveFile(): OpenTab | null {
    if (!this.activePath) return null;
    return this.openTabs.get(this.activePath) || null;
  }

  public getOpenFiles(): OpenTab[] {
    return Array.from(this.openTabs.values());
  }

  public renderTabs() {
    this.tabsContainer.innerHTML = "";

    this.openTabs.forEach((tab, path) => {
      const tabEl = document.createElement("div");
      tabEl.className = `studio-tab ${path === this.activePath ? "active" : ""}`;

      const nameSpan = document.createElement("span");
      nameSpan.className = "tab-name";
      nameSpan.textContent = tab.name;
      nameSpan.title = path;
      nameSpan.onclick = () => this.switchTab(path);

      const closeBtn = document.createElement("button");
      closeBtn.className = "tab-close-btn";
      closeBtn.innerHTML = "&times;";
      closeBtn.title = "Bağla";
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        this.closeTab(path);
      };

      tabEl.appendChild(nameSpan);
      tabEl.appendChild(closeBtn);
      this.tabsContainer.appendChild(tabEl);
    });
  }
}
