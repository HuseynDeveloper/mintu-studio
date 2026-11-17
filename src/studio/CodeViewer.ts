/**
 * CodeViewer.ts
 * Read-only CodeMirror 6 viewer with VS Code-style closable tabs,
 * custom screenshot-matched theme, cursor tracking, and a lightweight slim minimap.
 */

import { EditorState, Extension } from "@codemirror/state";
import { EditorView, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from "@codemirror/view";
import { bracketMatching, foldGutter, indentOnInput } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { rust } from "@codemirror/lang-rust";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { mintuStudioTheme } from "./studioTheme";
import { ICON_CLOSE, ICON_PAPERCLIP, getFileIconSvg } from "./icons";

export interface OpenTab {
  path: string;
  name: string;
  content: string;
  language: string;
  sizeBytes: number;
}

export interface EditorStatusInfo {
  language: string;
  line: number;
  col: number;
  hasFile: boolean;
  path: string | null;
}

export class CodeViewer {
  private editorContainer: HTMLElement;
  private tabsContainer: HTMLElement;
  private minimapCanvas: HTMLCanvasElement;
  private minimapThumb: HTMLElement;
  private minimapWrap: HTMLElement;

  private editorView: EditorView | null = null;
  private openTabs: OpenTab[] = [];
  private activePath: string | null = null;

  public onTabChange?: (tab: OpenTab | null) => void;
  public onStatusChange?: (info: EditorStatusInfo) => void;
  public onAttachActiveRequest?: (tab: OpenTab) => void;

  constructor(
    editorContainer: HTMLElement,
    tabsContainer: HTMLElement,
    minimapWrap: HTMLElement,
    minimapCanvas: HTMLCanvasElement,
    minimapThumb: HTMLElement
  ) {
    this.editorContainer = editorContainer;
    this.tabsContainer = tabsContainer;
    this.minimapWrap = minimapWrap;
    this.minimapCanvas = minimapCanvas;
    this.minimapThumb = minimapThumb;

    this.initMinimapInteraction();
    this.renderEmptyState();
  }

  public openFile(relPath: string, content: string): void {
    const existing = this.openTabs.find((t) => t.path === relPath);
    const sizeBytes = new TextEncoder().encode(content).length;
    if (existing) {
      existing.content = content;
      existing.sizeBytes = sizeBytes;
      this.setActiveTab(relPath);
      return;
    }

    const name = relPath.split("/").pop() || relPath;
    const language = this.detectLanguageLabel(name);

    const newTab: OpenTab = {
      path: relPath,
      name,
      content,
      language,
      sizeBytes,
    };

    this.openTabs.push(newTab);
    this.setActiveTab(relPath);
  }

  public setActiveTab(relPath: string): void {
    const tab = this.openTabs.find((t) => t.path === relPath);
    if (!tab) return;

    this.activePath = relPath;
    this.renderTabs();
    this.renderEditor(tab);
    this.onTabChange?.(tab);
  }

  public closeTab(relPath: string): void {
    const idx = this.openTabs.findIndex((t) => t.path === relPath);
    if (idx === -1) return;

    this.openTabs.splice(idx, 1);

    if (this.activePath === relPath) {
      if (this.openTabs.length > 0) {
        const nextTab = this.openTabs[Math.max(0, idx - 1)];
        this.setActiveTab(nextTab.path);
      } else {
        this.activePath = null;
        this.renderTabs();
        this.renderEmptyState();
        this.onTabChange?.(null);
      }
    } else {
      this.renderTabs();
    }
  }

  public getActiveFile(): OpenTab | null {
    if (!this.activePath) return null;
    return this.openTabs.find((t) => t.path === this.activePath) || null;
  }

  public getOpenTabs(): OpenTab[] {
    return [...this.openTabs];
  }

  private renderTabs(): void {
    this.tabsContainer.innerHTML = "";

    const tabsTrack = document.createElement("div");
    tabsTrack.className = "studio-tabs-track";

    for (const tab of this.openTabs) {
      const tabEl = document.createElement("div");
      tabEl.className = `studio-tab${tab.path === this.activePath ? " active" : ""}`;
      tabEl.title = tab.path;

      const iconEl = document.createElement("span");
      iconEl.className = "tab-file-icon";
      iconEl.innerHTML = getFileIconSvg(tab.name);

      const nameSpan = document.createElement("span");
      nameSpan.className = "tab-name";
      nameSpan.textContent = tab.name;

      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "tab-close-btn";
      closeBtn.innerHTML = ICON_CLOSE;
      closeBtn.title = "Tabı bağla";
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.closeTab(tab.path);
      });

      tabEl.addEventListener("click", () => {
        this.setActiveTab(tab.path);
      });

      tabEl.appendChild(iconEl);
      tabEl.appendChild(nameSpan);
      tabEl.appendChild(closeBtn);
      tabsTrack.appendChild(tabEl);
    }

    this.tabsContainer.appendChild(tabsTrack);

    // Right side of tab bar: "Yalnız Oxu" badge + "Aktiv Faylı Qoş" button
    const tabRight = document.createElement("div");
    tabRight.className = "studio-tabs-actions";

    const active = this.getActiveFile();
    if (active) {
      const attachBtn = document.createElement("button");
      attachBtn.type = "button";
      attachBtn.className = "studio-tab-action-btn";
      attachBtn.id = "btn-attach-active-file";
      attachBtn.title = "Hazırda oxunan faylı çata qoş";
      attachBtn.innerHTML = `${ICON_PAPERCLIP}<span>Aktiv Faylı Qoş</span>`;
      attachBtn.addEventListener("click", () => {
        this.onAttachActiveRequest?.(active);
      });
      tabRight.appendChild(attachBtn);
    }

    const roBadge = document.createElement("span");
    roBadge.className = "readonly-pill";
    roBadge.textContent = "Yalnız Oxu";
    roBadge.title = "Faza 1: Fayl yazma deaktiv edilib";
    tabRight.appendChild(roBadge);

    this.tabsContainer.appendChild(tabRight);
  }

  private renderEmptyState(): void {
    if (this.editorView) {
      this.editorView.destroy();
      this.editorView = null;
    }

    this.renderTabs();
    this.minimapWrap.style.display = "none";

    this.editorContainer.innerHTML = `
      <div class="studio-empty-viewer">
        <div class="empty-title">Mintu Studio Kod Oxuyucu</div>
        <div class="empty-subtitle">Soldakı layihə ağacından istənilən faylı seçin. Fayllar sintaksis rənglənməsi ilə yalnız oxuma rejimində açılır.</div>
      </div>
    `;

    this.onStatusChange?.({
      language: "Plain Text",
      line: 1,
      col: 1,
      hasFile: false,
      path: null,
    });
  }

  private renderEditor(tab: OpenTab): void {
    if (this.editorView) {
      this.editorView.destroy();
      this.editorView = null;
    }

    this.editorContainer.innerHTML = "";
    const hostEl = document.createElement("div");
    hostEl.className = "studio-editor-host";
    this.editorContainer.appendChild(hostEl);

    const langExt = this.getLanguageExtension(tab.name);

    const cursorListener = EditorView.updateListener.of((update) => {
      if (update.selectionSet || update.docChanged) {
        const head = update.state.selection.main.head;
        const lineInfo = update.state.doc.lineAt(head);
        this.onStatusChange?.({
          language: tab.language,
          line: lineInfo.number,
          col: head - lineInfo.from + 1,
          hasFile: true,
          path: tab.path,
        });
      }
    });

    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      drawSelection(),
      bracketMatching(),
      foldGutter(),
      indentOnInput(),
      mintuStudioTheme,
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      cursorListener,
    ];

    if (langExt) {
      extensions.push(langExt);
    }

    const state = EditorState.create({
      doc: tab.content,
      extensions,
    });

    this.editorView = new EditorView({
      state,
      parent: hostEl,
    });

    // Attach minimap scroll sync
    this.minimapWrap.style.display = "block";
    this.drawMinimap(tab.content);
    this.syncMinimapThumb();

    const scroller = this.editorView.scrollDOM;
    scroller.addEventListener("scroll", () => this.syncMinimapThumb(), { passive: true });

    this.onStatusChange?.({
      language: tab.language,
      line: 1,
      col: 1,
      hasFile: true,
      path: tab.path,
    });
  }

  private drawMinimap(content: string): void {
    const canvas = this.minimapCanvas;
    const width = 68;
    const lines = content.split("\n");
    const maxLines = Math.min(lines.length, 400);
    const lineHeight = 2.5;
    const height = Math.max(120, Math.ceil(maxLines * lineHeight) + 16);

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const styles = getComputedStyle(document.documentElement);
    const colorKeyword = styles.getPropertyValue("--syn-keyword").trim() || "#9DABD0";
    const colorString = styles.getPropertyValue("--syn-string").trim() || "#CCCCA6";
    const colorPlain = styles.getPropertyValue("--text-subtle").trim() || "#62666F";
    const colorType = styles.getPropertyValue("--syn-type").trim() || "#BBDCBD";

    for (let i = 0; i < maxLines; i++) {
      const line = lines[i];
      if (!line || !line.trim()) continue;
      const indent = line.search(/\S/);
      const trimmed = line.trim();
      const x = Math.min(40, 6 + Math.floor(indent * 0.7));
      const len = Math.min(width - x - 6, Math.max(4, Math.floor(trimmed.length * 0.55)));
      const y = 8 + i * lineHeight;

      if (/^(import|export|function|const|let|return|pub|fn|struct|class|if|else)\b/.test(trimmed)) {
        ctx.fillStyle = colorKeyword;
      } else if (trimmed.includes("'") || trimmed.includes('"') || trimmed.includes("`")) {
        ctx.fillStyle = colorString;
      } else if (/^<\/?[A-Z]/.test(trimmed)) {
        ctx.fillStyle = colorType;
      } else {
        ctx.fillStyle = colorPlain;
      }
      ctx.globalAlpha = 0.55;
      ctx.fillRect(x, y, len, 1.5);
    }
    ctx.globalAlpha = 1;
  }

  private syncMinimapThumb(): void {
    if (!this.editorView) return;
    const scroller = this.editorView.scrollDOM;
    const scrollHeight = scroller.scrollHeight;
    const clientHeight = scroller.clientHeight;
    const wrapHeight = this.minimapWrap.clientHeight;
    if (scrollHeight <= 0 || wrapHeight <= 0) return;

    const visibleRatio = Math.min(1, clientHeight / Math.max(1, scrollHeight));
    const thumbHeight = Math.max(24, Math.floor(wrapHeight * visibleRatio));
    const maxScroll = Math.max(1, scrollHeight - clientHeight);
    const scrollRatio = scroller.scrollTop / maxScroll;
    const maxTop = Math.max(0, wrapHeight - thumbHeight);

    this.minimapThumb.style.height = `${thumbHeight}px`;
    this.minimapThumb.style.transform = `translateY(${Math.floor(scrollRatio * maxTop)}px)`;
  }

  private initMinimapInteraction(): void {
    let dragging = false;

    const jumpToY = (clientY: number) => {
      if (!this.editorView) return;
      const rect = this.minimapWrap.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientY - rect.top) / Math.max(1, rect.height)));
      const scroller = this.editorView.scrollDOM;
      const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      scroller.scrollTop = ratio * maxScroll;
    };

    this.minimapWrap.addEventListener("mousedown", (e) => {
      dragging = true;
      jumpToY(e.clientY);
    });

    window.addEventListener("mousemove", (e) => {
      if (dragging) jumpToY(e.clientY);
    });

    window.addEventListener("mouseup", () => {
      dragging = false;
    });
  }

  private detectLanguageLabel(filename: string): string {
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    const map: Record<string, string> = {
      ts: "TypeScript",
      tsx: "TypeScript JSX",
      js: "JavaScript",
      jsx: "JavaScript JSX",
      rs: "Rust",
      py: "Python",
      json: "JSON",
      css: "CSS",
      scss: "SCSS",
      html: "HTML",
      md: "Markdown",
      toml: "TOML",
      yaml: "YAML",
      yml: "YAML",
      sh: "Shell",
      ps1: "PowerShell",
      sql: "SQL",
    };
    return map[ext] || "Plain Text";
  }

  private getLanguageExtension(filename: string): Extension | null {
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    switch (ext) {
      case "ts":
        return javascript({ typescript: true });
      case "tsx":
        return javascript({ typescript: true, jsx: true });
      case "js":
        return javascript();
      case "jsx":
        return javascript({ jsx: true });
      case "rs":
        return rust();
      case "py":
        return python();
      case "json":
        return json();
      case "css":
      case "scss":
        return css();
      case "html":
      case "htm":
      case "svg":
        return html();
      default:
        return null;
    }
  }
}
