/**
 * CodeViewer.ts
 * Editable CodeMirror 6 editor with VS Code-style closable tabs,
 * dirty-state tracking, Ctrl+S save, custom screenshot-matched theme,
 * cursor tracking, and a lightweight slim minimap.
 */

import { EditorState, Extension, StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, indentOnInput } from "@codemirror/language";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { search, searchKeymap } from "@codemirror/search";
import { ExtensionSnippet } from "./ExtensionsPage";
import { javascript } from "@codemirror/lang-javascript";
import { rust } from "@codemirror/lang-rust";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { cpp } from "@codemirror/lang-cpp";
import { go } from "@codemirror/lang-go";
import { sql } from "@codemirror/lang-sql";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { xml } from "@codemirror/lang-xml";
import { mintuStudioTheme } from "./studioTheme";
import { studioSettings } from "./StudioSettings";
import { computeLineDiff } from "./DiffUtils";
import { CodeDiagnosticItem, createStudioLinter, extractSymbols, formatCodeDocument } from "./CodeDiagnostics";
import { MarkdownRenderer } from "../ai/MarkdownRenderer";
import { t } from "./i18n";
import { ICON_CLOSE, ICON_PAPERCLIP, getFileIconSvg } from "./icons";

const setGhostTextEffect = StateEffect.define<{ pos: number; text: string } | null>();

class GhostTextWidget extends WidgetType {
  constructor(private readonly text: string) {
    super();
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-ghost-text";
    span.textContent = this.text;
    return span;
  }
}

const ghostTextState = StateField.define<{ pos: number; text: string } | null>({
  create: () => null,
  update(val, tr) {
    for (const e of tr.effects) {
      if (e.is(setGhostTextEffect)) return e.value;
    }
    if (tr.docChanged || tr.selection) return null;
    return val;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (val): DecorationSet => {
      if (!val || !val.text) return Decoration.none;
      return Decoration.set([
        Decoration.widget({ widget: new GhostTextWidget(val.text), side: 1 }).range(val.pos),
      ]);
    }),
});

export interface OpenTab {
  path: string;
  name: string;
  content: string;
  savedContent: string;
  dirty: boolean;
  language: string;
  sizeBytes: number;
}

export interface SymbolMatchItem {
  path: string;
  line_number: number;
  line_text: string;
  is_definition: boolean;
}

const LANG_KEYWORDS: Record<string, string[]> = {
  ts: ["async", "await", "const", "let", "function", "interface", "type", "class", "export", "import", "return", "extends", "implements", "private", "public", "readonly", "Promise", "Record", "Partial", "console.log", "try", "catch", "finally", "switch", "case"],
  js: ["async", "await", "const", "let", "function", "class", "export", "import", "return", "Promise", "console.log", "try", "catch", "finally", "document.querySelector", "addEventListener"],
  py: ["def", "async def", "class", "import", "from", "return", "yield", "with", "as", "try", "except", "finally", "raise", "lambda", "isinstance", "enumerate", "dataclass", "Optional", "List", "Dict"],
  rs: ["fn", "pub fn", "async fn", "struct", "enum", "impl", "trait", "match", "let", "let mut", "use", "mod", "Result", "Option", "Vec", "String", "HashMap", "Some", "None", "Ok", "Err", "println!"],
  go: ["func", "type", "struct", "interface", "package", "import", "return", "defer", "go", "chan", "select", "range", "make", "append", "error", "fmt.Println"],
  css: ["display", "flex", "grid", "position", "background", "color", "border", "border-radius", "padding", "margin", "gap", "align-items", "justify-content", "transition", "var(--"],
  html: ["div", "section", "header", "footer", "main", "aside", "button", "input", "textarea", "select", "form", "label", "span", "ul", "li"],
};

export interface EditorStatusInfo {
  language: string;
  line: number;
  col: number;
  hasFile: boolean;
  path: string | null;
  dirty: boolean;
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
  private newlyOpenedPath: string | null = null;
  private suppressDocChange = false;
  private autoSaveTimer: number | null = null;
  private chatPanelVisible = true;
  private inlineAiBarEl: HTMLElement | null = null;
  private inlineAiAbort: AbortController | null = null;
  private outlinePopupEl: HTMLElement | null = null;
  private symbolPopupEl: HTMLElement | null = null;
  private selectionBarEl: HTMLElement | null = null;
  private breadcrumbsEl: HTMLElement | null = null;
  private extensionSnippets: ExtensionSnippet[] = [];
  private previewEnabled = false;
  private splitEnabled = false;
  private splitTabPath: string | null = null;
  private ghostTimer: number | null = null;
  private ghostAbort: AbortController | null = null;
  private activeDiagnostics: CodeDiagnosticItem[] = [];
  private externalDiagnosticsByPath: Map<string, CodeDiagnosticItem[]> = new Map();

  public onTabChange?: (tab: OpenTab | null) => void;
  public onContentChange?: (tab: OpenTab) => void;
  public onStatusChange?: (info: EditorStatusInfo) => void;
  public onAttachActiveRequest?: (tab: OpenTab) => void;
  public onSaveFileRequest?: (tab: OpenTab) => Promise<boolean>;
  public onOpenChatRequest?: () => void;
  public onOpenTimelineRequest?: (tab: OpenTab) => void;
  public onOpenInDataExplorer?: (path: string) => void;
  public onSelectionAiAction?: (
    action: "explain" | "fix" | "refactor" | "tests" | "chat",
    tab: OpenTab,
    selectedCode: string,
    startLine: number,
    endLine: number
  ) => void;
  public onFindSymbolRequest?: (symbol: string) => Promise<SymbolMatchItem[]>;
  public onNavigateToLocation?: (relPath: string, line: number) => void;
  public onDiagnosticsChange?: (path: string, diagnostics: CodeDiagnosticItem[]) => void;
  public onGhostTextRequest?: (
    tab: OpenTab,
    prefix: string,
    suffix: string,
    signal: AbortSignal
  ) => Promise<string>;
  public onInlineAiGenerate?: (
    tab: OpenTab,
    selectedCode: string,
    instruction: string,
    onDelta: (chunk: string) => void,
    signal: AbortSignal
  ) => Promise<string>;

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

    studioSettings.subscribe(() => {
      const active = this.getActiveFile();
      if (active) {
        this.renderTabs();
        this.renderEditor(active);
      } else {
        this.renderEmptyState();
      }
    });
  }

  public openFile(relPath: string, content: string, jumpToLine?: number): void {
    const existing = this.openTabs.find((t) => t.path === relPath);
    const sizeBytes = new TextEncoder().encode(content).length;
    if (existing) {
      if (!existing.dirty) {
        existing.content = content;
        existing.savedContent = content;
        existing.sizeBytes = sizeBytes;
      }
      this.setActiveTab(relPath, jumpToLine);
      return;
    }

    const name = relPath.split("/").pop() || relPath;
    const language = this.detectLanguageLabel(name);

    const newTab: OpenTab = {
      path: relPath,
      name,
      content,
      savedContent: content,
      dirty: false,
      language,
      sizeBytes,
    };

    this.openTabs.push(newTab);
    this.newlyOpenedPath = relPath;
    this.setActiveTab(relPath, jumpToLine);
  }

  /** Force-reload a file from disk (e.g. after applying an AI Diff edit). */
  public reloadFileFromDisk(relPath: string, newContent: string): void {
    const tab = this.openTabs.find((t) => t.path === relPath);
    if (!tab) return;
    tab.content = newContent;
    tab.savedContent = newContent;
    tab.dirty = false;
    tab.sizeBytes = new TextEncoder().encode(newContent).length;

    if (this.activePath === relPath && this.editorView) {
      this.suppressDocChange = true;
      this.editorView.dispatch({
        changes: { from: 0, to: this.editorView.state.doc.length, insert: newContent },
      });
      this.suppressDocChange = false;
      this.drawMinimap(newContent);
      this.syncMinimapThumb();
    }
    this.renderTabs();
  }

  public async saveActiveFile(): Promise<boolean> {
    const tab = this.getActiveFile();
    if (!tab || !this.onSaveFileRequest) return false;

    const prefs = studioSettings.get();
    let nextContent = tab.content;
    if (prefs.trimTrailingWhitespace) {
      nextContent = nextContent.replace(/[ \t]+(\r?\n)/g, "$1").replace(/[ \t]+$/, "");
    }
    if (prefs.insertFinalNewline && nextContent.length > 0 && !nextContent.endsWith("\n")) {
      nextContent += "\n";
    }
    if (nextContent !== tab.content) {
      tab.content = nextContent;
      if (this.editorView) {
        this.suppressDocChange = true;
        this.editorView.dispatch({
          changes: { from: 0, to: this.editorView.state.doc.length, insert: nextContent },
        });
        this.suppressDocChange = false;
      }
    }

    const ok = await this.onSaveFileRequest(tab);
    if (ok) {
      tab.savedContent = tab.content;
      tab.dirty = false;
      tab.sizeBytes = new TextEncoder().encode(tab.content).length;
      this.renderTabs();
      this.drawMinimap(tab.content);
    }
    return ok;
  }

  public setActiveTab(relPath: string, jumpToLine?: number): void {
    const tab = this.openTabs.find((t) => t.path === relPath);
    if (!tab) return;

    this.activePath = relPath;
    this.renderTabs();
    this.renderEditor(tab, jumpToLine);
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

  public setChatPanelVisible(visible: boolean): void {
    if (this.chatPanelVisible === visible) return;
    this.chatPanelVisible = visible;
    this.renderTabs();
  }

  public renameOpenTab(oldPath: string, newPath: string): void {
    const tab = this.openTabs.find((t) => t.path === oldPath);
    if (!tab) return;
    tab.path = newPath;
    tab.name = newPath.split("/").pop() || newPath;
    tab.language = this.detectLanguageLabel(tab.name);
    if (this.activePath === oldPath) {
      this.activePath = newPath;
      this.renderEditor(tab);
    }
    this.renderTabs();
  }

  public formatActiveFile(): void {
    const active = this.getActiveFile();
    if (!active || !this.editorView) return;
    const formatted = formatCodeDocument(active.content, active.name, studioSettings.get().tabSize || 2);
    if (formatted === active.content) return;
    this.editorView.dispatch({
      changes: { from: 0, to: this.editorView.state.doc.length, insert: formatted },
    });
  }

  public togglePreview(): void {
    const active = this.getActiveFile();
    if (!active) return;
    this.previewEnabled = !this.previewEnabled;
    if (this.previewEnabled) this.splitEnabled = false;
    this.renderTabs();
    this.renderEditor(active);
  }

  public toggleSplitEditor(): void {
    const active = this.getActiveFile();
    if (!active) return;
    this.splitEnabled = !this.splitEnabled;
    if (this.splitEnabled) {
      this.previewEnabled = false;
      const other = this.openTabs.find((x) => x.path !== active.path) || active;
      this.splitTabPath = other.path;
    }
    this.renderTabs();
    this.renderEditor(active);
  }

  public closeOutlinePopup(): void {
    if (this.outlinePopupEl) {
      this.outlinePopupEl.remove();
      this.outlinePopupEl = null;
    }
  }

  public setExtensionSnippets(snippets: ExtensionSnippet[]): void {
    this.extensionSnippets = snippets;
  }

  public closeSymbolPopup(): void {
    if (this.symbolPopupEl) {
      this.symbolPopupEl.remove();
      this.symbolPopupEl = null;
    }
  }

  private getWordAtPos(view: EditorView, pos: number): string | null {
    const line = view.state.doc.lineAt(pos);
    const col = pos - line.from;
    const text = line.text;
    let start = col;
    let end = col;
    while (start > 0 && /[A-Za-z0-9_$]/.test(text[start - 1])) start--;
    while (end < text.length && /[A-Za-z0-9_$]/.test(text[end])) end++;
    const word = text.slice(start, end);
    return word.length >= 2 ? word : null;
  }

  public async triggerGoToDefinition(posOverride?: number): Promise<void> {
    if (!this.editorView || !this.onFindSymbolRequest) return;
    const pos = posOverride ?? this.editorView.state.selection.main.head;
    const word = this.getWordAtPos(this.editorView, pos);
    if (!word) return;

    this.closeSymbolPopup();
    const matches = await this.onFindSymbolRequest(word).catch(() => []);
    if (matches.length === 0) {
      this.showSymbolPopup(word, []);
      return;
    }
    const defs = matches.filter((m) => m.is_definition);
    const active = this.getActiveFile();
    if (defs.length === 1 && (defs[0].path !== active?.path || defs[0].line_number !== this.editorView.state.doc.lineAt(pos).number)) {
      this.onNavigateToLocation?.(defs[0].path, defs[0].line_number);
      return;
    }
    this.showSymbolPopup(word, matches);
  }

  private showSymbolPopup(symbol: string, matches: SymbolMatchItem[]): void {
    this.closeSymbolPopup();
    const pop = document.createElement("div");
    pop.className = "outline-popup";
    pop.innerHTML = `
      <div class="inline-ai-head">
        <span class="inline-ai-title">${t("definitionsAndRefs")} — <code>${this.escapeHtml(symbol)}</code> (${matches.length})</span>
        <button type="button" class="studio-btn-icon" id="btn-sym-close" title="Esc">${ICON_CLOSE}</button>
      </div>
      <div class="outline-list">
        ${
          matches.length === 0
            ? `<div class="bottom-empty">${t("noSymbolMatches")}</div>`
            : matches
                .map(
                  (m) => `
                  <button type="button" class="outline-row" data-sym-path="${this.escapeHtml(m.path).replace(/"/g, "&quot;")}" data-sym-line="${m.line_number}">
                    <span class="outline-kind ${m.is_definition ? "kind-class" : "kind-var"}">${m.is_definition ? t("definitionBadge") : t("referenceBadge")}</span>
                    <span class="outline-name">${this.escapeHtml(m.path)}:${m.line_number} — ${this.escapeHtml(m.line_text.slice(0, 68))}</span>
                  </button>
                `
                )
                .join("")
        }
      </div>
    `;
    this.editorContainer.appendChild(pop);
    this.symbolPopupEl = pop;
    pop.querySelector("#btn-sym-close")?.addEventListener("click", () => this.closeSymbolPopup());
    pop.querySelectorAll<HTMLButtonElement>("[data-sym-path]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = btn.dataset.symPath;
        const ln = Number(btn.dataset.symLine || 1);
        this.closeSymbolPopup();
        if (p) this.onNavigateToLocation?.(p, ln);
      });
    });
  }

  private buildOfflineCompletionSource(filename: string) {
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    const langKey = ext === "tsx" ? "ts" : ext === "jsx" ? "js" : ext === "scss" ? "css" : ext === "htm" ? "html" : ext;

    return (context: CompletionContext): CompletionResult | null => {
      const word = context.matchBefore(/[A-Za-z_$][A-Za-z0-9_$]*/);
      if (!word || (word.from === word.to && !context.explicit)) return null;

      const options: Completion[] = [];
      const seen = new Set<string>();

      // 1. Enabled Extension Snippets (highest priority)
      for (const snip of this.extensionSnippets) {
        if (snip.languages.length > 0 && !snip.languages.includes(ext) && !snip.languages.includes(langKey)) {
          continue;
        }
        options.push({
          label: snip.prefix,
          detail: snip.label,
          apply: snip.body,
          type: "snippet",
          boost: 50,
        });
        seen.add(snip.prefix);
      }

      // 2. Language keywords
      const kwList = LANG_KEYWORDS[langKey] || [];
      for (const kw of kwList) {
        if (seen.has(kw)) continue;
        seen.add(kw);
        options.push({ label: kw, type: "keyword", boost: 20 });
      }

      // 3. Current document identifiers
      const docText = context.state.doc.toString();
      const idMatches = docText.match(/\b[A-Za-z_$][A-Za-z0-9_$]{2,40}\b/g);
      if (idMatches) {
        for (const id of idMatches) {
          if (seen.has(id) || id === word.text) continue;
          seen.add(id);
          options.push({ label: id, type: "variable" });
          if (seen.size > 240) break;
        }
      }

      return {
        from: word.from,
        options,
        validFor: /^[A-Za-z0-9_$]*$/,
      };
    };
  }

  private updateBreadcrumbs(tab: OpenTab, cursorLine: number): void {
    if (!this.breadcrumbsEl) return;
    const parts = tab.path.split("/").filter(Boolean);
    const symbols = extractSymbols(tab.content, tab.name);
    let currentSym: string | null = null;
    for (const s of symbols) {
      if (s.line <= cursorLine) currentSym = `${s.kind} ${s.name}`;
      else break;
    }

    const segs = parts
      .map((p, idx) => `<span class="bc-seg ${idx === parts.length - 1 ? "is-file" : ""}">${this.escapeHtml(p)}</span>`)
      .join(`<span class="bc-sep">›</span>`);

    const symHtml = currentSym
      ? `<span class="bc-sep">›</span><button type="button" class="bc-sym-btn" id="btn-bc-outline" title="${t("outline")} (Ctrl+Shift+O)">${this.escapeHtml(currentSym)}</button>`
      : "";

    this.breadcrumbsEl.innerHTML = `${segs}${symHtml}`;
    this.breadcrumbsEl.querySelector("#btn-bc-outline")?.addEventListener("click", () => this.openOutlinePopup());
  }

  public openOutlinePopup(): void {
    const active = this.getActiveFile();
    if (!active || !this.editorView) return;
    this.closeOutlinePopup();

    const symbols = extractSymbols(active.content, active.name);
    const pop = document.createElement("div");
    pop.className = "outline-popup";
    pop.innerHTML = `
      <div class="inline-ai-head">
        <span class="inline-ai-title">${t("outline")} — ${this.escapeHtml(active.name)} (${symbols.length})</span>
        <button type="button" class="studio-btn-icon" id="btn-outline-close" title="Esc">${ICON_CLOSE}</button>
      </div>
      <div class="outline-list">
        ${
          symbols.length === 0
            ? `<div class="bottom-empty">${t("noSymbolsFound")}</div>`
            : symbols
                .map(
                  (s) => `
                  <button type="button" class="outline-row" data-jump-line="${s.line}">
                    <span class="outline-kind kind-${s.kind}">${s.kind}</span>
                    <span class="outline-name">${this.escapeHtml(s.name)}</span>
                    <span class="outline-line">:${s.line}</span>
                  </button>
                `
                )
                .join("")
        }
      </div>
    `;

    this.editorContainer.appendChild(pop);
    this.outlinePopupEl = pop;
    pop.querySelector("#btn-outline-close")?.addEventListener("click", () => this.closeOutlinePopup());
    pop.querySelectorAll<HTMLButtonElement>("[data-jump-line]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const ln = Number(btn.dataset.jumpLine || 1);
        this.closeOutlinePopup();
        if (this.editorView && ln >= 1 && ln <= this.editorView.state.doc.lines) {
          const line = this.editorView.state.doc.line(ln);
          this.editorView.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
          this.editorView.focus();
        }
      });
    });
  }

  private renderSecondaryPane(active: OpenTab): HTMLElement | null {
    if (this.previewEnabled) {
      const ext = active.name.split(".").pop()?.toLowerCase() || "";
      const pane = document.createElement("div");
      pane.className = "editor-secondary-pane";
      pane.innerHTML = `<div class="secondary-pane-header"><span>${t("preview")} · ${this.escapeHtml(active.name)}</span><button type="button" class="studio-btn-icon" id="btn-close-secondary">${ICON_CLOSE}</button></div>`;
      if (ext === "html" || ext === "htm") {
        const frame = document.createElement("iframe");
        frame.className = "editor-html-preview";
        frame.setAttribute("sandbox", "");
        frame.srcdoc = active.content;
        pane.appendChild(frame);
      } else {
        const mdWrap = document.createElement("div");
        mdWrap.className = "editor-md-preview";
        mdWrap.innerHTML = MarkdownRenderer.render(active.content);
        pane.appendChild(mdWrap);
      }
      pane.querySelector("#btn-close-secondary")?.addEventListener("click", () => this.togglePreview());
      return pane;
    }

    if (this.splitEnabled) {
      const splitTab = this.openTabs.find((x) => x.path === this.splitTabPath) || active;
      this.splitTabPath = splitTab.path;
      const pane = document.createElement("div");
      pane.className = "editor-secondary-pane";
      const opts = this.openTabs
        .map(
          (x) =>
            `<option value="${this.escapeHtml(x.path).replace(/"/g, "&quot;")}" ${x.path === splitTab.path ? "selected" : ""}>${this.escapeHtml(x.name)}</option>`
        )
        .join("");
      pane.innerHTML = `
        <div class="secondary-pane-header">
          <select id="split-tab-select" class="studio-input split-select">${opts}</select>
          <button type="button" class="studio-btn-icon" id="btn-close-secondary">${ICON_CLOSE}</button>
        </div>
        <pre class="split-code-view">${this.escapeHtml(splitTab.content)}</pre>
      `;
      pane.querySelector("#split-tab-select")?.addEventListener("change", (e) => {
        this.splitTabPath = (e.target as HTMLSelectElement).value;
        this.renderEditor(active);
      });
      pane.querySelector("#btn-close-secondary")?.addEventListener("click", () => this.toggleSplitEditor());
      return pane;
    }

    return null;
  }

  private scheduleGhostText(tab: OpenTab): void {
    if (this.ghostTimer) window.clearTimeout(this.ghostTimer);
    if (this.ghostAbort) {
      this.ghostAbort.abort();
      this.ghostAbort = null;
    }
    if (!studioSettings.get().enableGhostText || !this.onGhostTextRequest || !this.editorView) return;

    const view = this.editorView;
    const head = view.state.selection.main.head;
    if (!view.state.selection.main.empty) return;
    const line = view.state.doc.lineAt(head);
    if (head < line.to) return; // only trigger at end of line

    this.ghostTimer = window.setTimeout(async () => {
      if (!this.editorView || this.getActiveFile()?.path !== tab.path) return;
      const curHead = this.editorView.state.selection.main.head;
      if (curHead !== head) return;
      const prefix = this.editorView.state.sliceDoc(Math.max(0, curHead - 1200), curHead);
      const suffix = this.editorView.state.sliceDoc(curHead, Math.min(this.editorView.state.doc.length, curHead + 300));
      if (!prefix.trim()) return;

      this.ghostAbort = new AbortController();
      try {
        const suggestion = await this.onGhostTextRequest!(tab, prefix, suffix, this.ghostAbort.signal);
        const clean = suggestion.replace(/^```[\s\S]*?\n|```$/g, "").split("\n").slice(0, 2).join("\n");
        if (clean && this.editorView && this.editorView.state.selection.main.head === curHead) {
          this.editorView.dispatch({ effects: setGhostTextEffect.of({ pos: curHead, text: clean }) });
        }
      } catch {}
    }, 950);
  }

  public getOpenTabs(): OpenTab[] {
    return this.openTabs;
  }

  public closeInlineAiEdit(): void {
    if (this.inlineAiAbort) {
      this.inlineAiAbort.abort();
      this.inlineAiAbort = null;
    }
    if (this.inlineAiBarEl) {
      this.inlineAiBarEl.remove();
      this.inlineAiBarEl = null;
    }
  }

  public openInlineAiEdit(): void {
    const active = this.getActiveFile();
    if (!active || !this.editorView || !this.onInlineAiGenerate) return;

    this.closeInlineAiEdit();

    const sel = this.editorView.state.selection.main;
    let from = sel.from;
    let to = sel.to;
    if (from === to) {
      const line = this.editorView.state.doc.lineAt(sel.head);
      from = line.from;
      to = line.to;
    }
    const originalSlice = this.editorView.state.sliceDoc(from, to);
    const startLine = this.editorView.state.doc.lineAt(from).number;
    const endLine = this.editorView.state.doc.lineAt(to).number;

    const bar = document.createElement("div");
    bar.className = "inline-ai-bar";
    bar.innerHTML = `
      <div class="inline-ai-head">
        <span class="inline-ai-title">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z"/></svg>
          ${t("inlineEdit")} (Ctrl+K) · L${startLine}${endLine > startLine ? `–${endLine}` : ""}
        </span>
        <button type="button" class="studio-btn-icon" id="btn-inline-ai-close" title="${t("close")} (Esc)">${ICON_CLOSE}</button>
      </div>
      <div class="inline-ai-input-row">
        <input type="text" id="inline-ai-input" class="studio-input" placeholder="${t("inlineAiPlaceholder")}" autocomplete="off" />
        <button type="button" class="studio-btn studio-btn-sm studio-btn-primary" id="btn-inline-ai-run">${t("generate")}</button>
      </div>
      <div id="inline-ai-preview" class="inline-ai-preview" style="display: none;"></div>
    `;

    this.editorContainer.appendChild(bar);
    this.inlineAiBarEl = bar;

    const input = bar.querySelector("#inline-ai-input") as HTMLInputElement;
    const runBtn = bar.querySelector("#btn-inline-ai-run") as HTMLButtonElement;
    const previewEl = bar.querySelector("#inline-ai-preview") as HTMLElement;

    bar.querySelector("#btn-inline-ai-close")?.addEventListener("click", () => this.closeInlineAiEdit());

    const stripCodeFences = (raw: string): string => {
      const t = raw.trim();
      const fenceMatch = t.match(/^```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)\r?\n?```$/);
      if (fenceMatch) return fenceMatch[1];
      return t;
    };

    const runGenerate = async () => {
      const instruction = input.value.trim();
      if (!instruction || !this.onInlineAiGenerate) return;

      if (this.inlineAiAbort) this.inlineAiAbort.abort();
      this.inlineAiAbort = new AbortController();

      runBtn.disabled = true;
      runBtn.textContent = t("generatingLabel");
      previewEl.style.display = "block";
      previewEl.innerHTML = `<div class="bottom-empty">${t("aiPreparingLabel")}</div>`;

      try {
        let streamed = "";
        const full = await this.onInlineAiGenerate(
          active,
          originalSlice,
          instruction,
          (delta) => {
            streamed += delta;
            previewEl.innerHTML = `<pre class="inline-ai-stream">${this.escapeHtml(streamed)}</pre>`;
          },
          this.inlineAiAbort.signal
        );

        const proposed = stripCodeFences(full || streamed);
        const diffRes = computeLineDiff(originalSlice, proposed, 120);
        const diffHtml = diffRes.lines
          .map((d) => {
            const cls = d.type === "add" ? "diff-add" : d.type === "del" ? "diff-del" : "diff-context";
            const prefix = d.type === "add" ? "+" : d.type === "del" ? "-" : " ";
            return `<div class="diff-line ${cls}"><span class="diff-sign">${prefix}</span><span class="diff-text">${this.escapeHtml(d.text)}</span></div>`;
          })
          .join("");

        previewEl.innerHTML = `
          <div class="inline-ai-diff">${diffHtml || `<div class="bottom-empty">${t("noChangesDetected")}</div>`}</div>
          <div class="inline-ai-actions">
            <button type="button" class="studio-btn studio-btn-sm studio-btn-primary" id="btn-inline-ai-apply">${t("apply")}</button>
            <button type="button" class="studio-btn studio-btn-sm" id="btn-inline-ai-discard">${t("cancel")}</button>
          </div>
        `;

        previewEl.querySelector("#btn-inline-ai-apply")?.addEventListener("click", () => {
          if (this.editorView) {
            this.editorView.dispatch({
              changes: { from, to, insert: proposed },
              selection: { anchor: from + proposed.length },
            });
            this.editorView.focus();
          }
          this.closeInlineAiEdit();
        });

        previewEl.querySelector("#btn-inline-ai-discard")?.addEventListener("click", () => {
          this.closeInlineAiEdit();
        });
      } catch (e: any) {
        if (e?.name !== "AbortError") {
          previewEl.innerHTML = `<div class="mcp-error-banner">Xəta: ${this.escapeHtml(String(e?.message || e))}</div>`;
        }
      } finally {
        runBtn.disabled = false;
        runBtn.textContent = "Yarat";
      }
    };

    runBtn.addEventListener("click", () => void runGenerate());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void runGenerate();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.closeInlineAiEdit();
      }
    });

    input.focus();
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  private renderTabs(): void {
    this.tabsContainer.innerHTML = "";

    const tabsTrack = document.createElement("div");
    tabsTrack.className = "studio-tabs-track";

    for (const tab of this.openTabs) {
      const tabEl = document.createElement("div");
      const isNew = tab.path === this.newlyOpenedPath;
      tabEl.className = `studio-tab${tab.path === this.activePath ? " active" : ""}${tab.dirty ? " is-dirty" : ""}${isNew ? " tab-enter" : ""}`;
      tabEl.title = tab.dirty ? `${tab.path} (${t("unsavedLabel")})` : tab.path;

      const iconEl = document.createElement("span");
      iconEl.className = "tab-file-icon";
      iconEl.innerHTML = getFileIconSvg(tab.name);

      const nameSpan = document.createElement("span");
      nameSpan.className = "tab-name";
      nameSpan.textContent = tab.dirty ? `${tab.name} •` : tab.name;

      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "tab-close-btn";
      closeBtn.innerHTML = ICON_CLOSE;
      closeBtn.title = t("closeTab");
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
    this.newlyOpenedPath = null;

    const tabRight = document.createElement("div");
    tabRight.className = "studio-tabs-actions";

    const active = this.getActiveFile();
    if (active) {
      if (active.dirty) {
        const saveBtn = document.createElement("button");
        saveBtn.type = "button";
        saveBtn.className = "studio-tab-action-btn studio-tab-save-btn";
        saveBtn.id = "btn-save-active-file";
        saveBtn.title = t("saveCtrlS");
        saveBtn.textContent = t("saveCtrlS");
        saveBtn.addEventListener("click", () => {
          this.saveActiveFile();
        });
        tabRight.appendChild(saveBtn);
      }

      const ext = active.name.split(".").pop()?.toLowerCase() || "";
      if (ext === "md" || ext === "markdown" || ext === "html" || ext === "htm") {
        const prevBtn = document.createElement("button");
        prevBtn.type = "button";
        prevBtn.className = `studio-tab-action-btn${this.previewEnabled ? " is-active-toggle" : ""}`;
        prevBtn.textContent = t("preview");
        prevBtn.addEventListener("click", () => this.togglePreview());
        tabRight.appendChild(prevBtn);
      } else if (ext === "csv" || ext === "json") {
        const tblBtn = document.createElement("button");
        tblBtn.type = "button";
        tblBtn.className = "studio-tab-action-btn";
        tblBtn.textContent = t("tableViewBtn");
        tblBtn.title = t("dataExplorerNav");
        tblBtn.addEventListener("click", () => this.onOpenInDataExplorer?.(active.path));
        tabRight.appendChild(tblBtn);
      }

      const splitBtn = document.createElement("button");
      splitBtn.type = "button";
      splitBtn.className = `studio-tab-action-btn${this.splitEnabled ? " is-active-toggle" : ""}`;
      splitBtn.textContent = t("splitEditor");
      splitBtn.title = t("splitEditor");
      splitBtn.addEventListener("click", () => this.toggleSplitEditor());
      tabRight.appendChild(splitBtn);

      const outlineBtn = document.createElement("button");
      outlineBtn.type = "button";
      outlineBtn.className = "studio-tab-action-btn";
      outlineBtn.textContent = t("outline");
      outlineBtn.title = `${t("outline")} (Ctrl+Shift+O)`;
      outlineBtn.addEventListener("click", () => this.openOutlinePopup());
      tabRight.appendChild(outlineBtn);

      const timelineBtn = document.createElement("button");
      timelineBtn.type = "button";
      timelineBtn.className = "studio-tab-action-btn";
      timelineBtn.textContent = t("timeline");
      timelineBtn.title = t("timelineTitle");
      timelineBtn.addEventListener("click", () => this.onOpenTimelineRequest?.(active));
      tabRight.appendChild(timelineBtn);

      const fmtBtn = document.createElement("button");
      fmtBtn.type = "button";
      fmtBtn.className = "studio-tab-action-btn";
      fmtBtn.textContent = t("formatCode");
      fmtBtn.title = `${t("formatCode")} (Alt+Shift+F)`;
      fmtBtn.addEventListener("click", () => this.formatActiveFile());
      tabRight.appendChild(fmtBtn);

      const inlineBtn = document.createElement("button");
      inlineBtn.type = "button";
      inlineBtn.className = "studio-tab-action-btn";
      inlineBtn.id = "btn-inline-ai-trigger";
      inlineBtn.title = `${t("inlineEdit")} (Ctrl+K)`;
      inlineBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z"/></svg><span>${t("inlineEdit")}</span>`;
      inlineBtn.addEventListener("click", () => {
        this.openInlineAiEdit();
      });
      tabRight.appendChild(inlineBtn);

      const attachBtn = document.createElement("button");
      attachBtn.type = "button";
      attachBtn.className = "studio-tab-action-btn";
      attachBtn.id = "btn-attach-active-file";
      attachBtn.title = t("attachActive");
      attachBtn.innerHTML = `${ICON_PAPERCLIP}<span>${t("attachActive")}</span>`;
      attachBtn.addEventListener("click", () => {
        this.onAttachActiveRequest?.(active);
      });
      tabRight.appendChild(attachBtn);
    }

    const modeBadge = document.createElement("span");
    modeBadge.className = "readonly-pill";
    modeBadge.textContent = active ? (active.dirty ? t("modified") : t("editMode")) : t("ready");
    modeBadge.title = t("saveCtrlS");
    tabRight.appendChild(modeBadge);

    if (!this.chatPanelVisible) {
      const openChatBtn = document.createElement("button");
      openChatBtn.type = "button";
      openChatBtn.className = "studio-tab-action-btn studio-tab-chat-btn";
      openChatBtn.id = "btn-editor-open-chat";
      openChatBtn.title = `${t("openChat")} (Ctrl+L)`;
      openChatBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z"/></svg><span>${t("openChat")}</span>`;
      openChatBtn.addEventListener("click", () => {
        this.onOpenChatRequest?.();
      });
      tabRight.appendChild(openChatBtn);
    }

    this.tabsContainer.appendChild(tabRight);
  }

  private hideSelectionBar(): void {
    if (this.selectionBarEl) {
      this.selectionBarEl.remove();
      this.selectionBarEl = null;
    }
  }

  private updateSelectionBar(tab: OpenTab, view: EditorView): void {
    if (!studioSettings.get().enableSelectionAiBar) {
      this.hideSelectionBar();
      return;
    }
    const sel = view.state.selection.main;
    if (sel.empty || sel.to - sel.from < 8) {
      this.hideSelectionBar();
      return;
    }
    const selectedCode = view.state.sliceDoc(sel.from, sel.to);
    if (!selectedCode.trim()) {
      this.hideSelectionBar();
      return;
    }
    const startLine = view.state.doc.lineAt(sel.from).number;
    const endLine = view.state.doc.lineAt(sel.to).number;

    this.hideSelectionBar();
    const bar = document.createElement("div");
    bar.className = "selection-ai-bar";
    bar.innerHTML = `
      <span class="sel-ai-lines">L${startLine}${endLine > startLine ? `–${endLine}` : ""}</span>
      <button type="button" class="sel-ai-btn" data-sel-act="explain">${t("selExplain")}</button>
      <button type="button" class="sel-ai-btn" data-sel-act="fix">${t("selFix")}</button>
      <button type="button" class="sel-ai-btn" data-sel-act="refactor">${t("selRefactor")}</button>
      <button type="button" class="sel-ai-btn" data-sel-act="tests">${t("selTests")}</button>
      <button type="button" class="sel-ai-btn" data-sel-act="inline">${t("inlineEdit")}</button>
      <button type="button" class="sel-ai-btn" data-sel-act="chat">${t("selAddToChat")}</button>
    `;

    bar.querySelectorAll<HTMLButtonElement>("[data-sel-act]").forEach((btn) => {
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", () => {
        const act = btn.dataset.selAct;
        this.hideSelectionBar();
        if (act === "inline") {
          this.openInlineAiEdit();
        } else if (act === "explain" || act === "fix" || act === "refactor" || act === "tests" || act === "chat") {
          this.onSelectionAiAction?.(act, tab, selectedCode, startLine, endLine);
        }
      });
    });

    this.editorContainer.appendChild(bar);
    this.selectionBarEl = bar;
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
        <div class="empty-title">${t("emptyEditorTitle")}</div>
        <div class="empty-subtitle">${t("emptyEditorSubtitle")}</div>
      </div>
    `;

    this.onStatusChange?.({
      language: "Plain Text",
      line: 1,
      col: 1,
      hasFile: false,
      path: null,
      dirty: false,
    });
  }

  private renderEditor(tab: OpenTab, jumpToLine?: number): void {
    if (this.editorView) {
      this.editorView.destroy();
      this.editorView = null;
    }

    this.editorContainer.innerHTML = "";
    const editorStack = document.createElement("div");
    editorStack.className = "editor-main-stack";

    const breadcrumbs = document.createElement("div");
    breadcrumbs.className = "editor-breadcrumbs-bar";
    breadcrumbs.style.display = studioSettings.get().showBreadcrumbs ? "flex" : "none";
    this.breadcrumbsEl = breadcrumbs;
    editorStack.appendChild(breadcrumbs);

    const splitWrap = document.createElement("div");
    splitWrap.className = "editor-split-container";

    const hostEl = document.createElement("div");
    hostEl.className = "studio-editor-host editor-enter";
    splitWrap.appendChild(hostEl);

    const secondaryPane = this.renderSecondaryPane(tab);
    if (secondaryPane) {
      splitWrap.appendChild(secondaryPane);
    }
    editorStack.appendChild(splitWrap);
    this.editorContainer.appendChild(editorStack);
    this.updateBreadcrumbs(tab, jumpToLine || 1);

    const langExt = this.getLanguageExtension(tab.name);

    const saveShortcut = keymap.of([
      {
        key: "Tab",
        run: (view) => {
          const ghost = view.state.field(ghostTextState, false);
          if (ghost && ghost.text) {
            view.dispatch({
              changes: { from: ghost.pos, to: ghost.pos, insert: ghost.text },
              selection: { anchor: ghost.pos + ghost.text.length },
              effects: setGhostTextEffect.of(null),
            });
            return true;
          }
          return false;
        },
      },
      {
        key: "Escape",
        run: (view) => {
          const ghost = view.state.field(ghostTextState, false);
          if (ghost) {
            view.dispatch({ effects: setGhostTextEffect.of(null) });
            return true;
          }
          return false;
        },
      },
      {
        key: "Mod-s",
        preventDefault: true,
        run: () => {
          this.saveActiveFile();
          return true;
        },
      },
      {
        key: "Mod-k",
        preventDefault: true,
        run: () => {
          this.openInlineAiEdit();
          return true;
        },
      },
      {
        key: "Alt-Shift-f",
        preventDefault: true,
        run: () => {
          this.formatActiveFile();
          return true;
        },
      },
      {
        key: "Mod-Shift-o",
        preventDefault: true,
        run: () => {
          this.openOutlinePopup();
          return true;
        },
      },
      {
        key: "F12",
        preventDefault: true,
        run: () => {
          void this.triggerGoToDefinition();
          return true;
        },
      },
    ]);

    const ctrlClickHandler = EditorView.domEventHandlers({
      mousedown: (event, view) => {
        if (event.ctrlKey && event.button === 0) {
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos !== null) {
            event.preventDefault();
            void this.triggerGoToDefinition(pos);
            return true;
          }
        }
        return false;
      },
    });

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged && !this.suppressDocChange) {
        tab.content = update.state.doc.toString();
        const nowDirty = tab.content !== tab.savedContent;
        if (nowDirty !== tab.dirty) {
          tab.dirty = nowDirty;
          this.renderTabs();
        }
        if (this.previewEnabled) {
          const htmlFrame = this.editorContainer.querySelector<HTMLIFrameElement>(".editor-html-preview");
          if (htmlFrame) htmlFrame.srcdoc = tab.content;
          const mdWrap = this.editorContainer.querySelector<HTMLElement>(".editor-md-preview");
          if (mdWrap) mdWrap.innerHTML = MarkdownRenderer.render(tab.content);
        }
        this.onContentChange?.(tab);
        this.scheduleGhostText(tab);
        if (nowDirty && studioSettings.get().autoSave) {
          if (this.autoSaveTimer) window.clearTimeout(this.autoSaveTimer);
          const delay = Math.max(400, studioSettings.get().autoSaveDelayMs || 1500);
          this.autoSaveTimer = window.setTimeout(() => {
            if (this.getActiveFile()?.path === tab.path && tab.dirty) {
              this.saveActiveFile();
            }
          }, delay);
        }
      }

      if (update.selectionSet || update.docChanged) {
        const head = update.state.selection.main.head;
        const lineInfo = update.state.doc.lineAt(head);
        this.updateBreadcrumbs(tab, lineInfo.number);
        this.updateSelectionBar(tab, update.view);
        this.onStatusChange?.({
          language: tab.language,
          line: lineInfo.number,
          col: head - lineInfo.from + 1,
          hasFile: true,
          path: tab.path,
          dirty: tab.dirty,
        });
      }
    });

    const prefs = studioSettings.get();
    hostEl.style.setProperty("--editor-font-size", `${prefs.fontSize}px`);

    const extensions: Extension[] = [
      drawSelection(),
      history(),
      indentOnInput(),
      EditorState.tabSize.of(prefs.tabSize),
      EditorView.theme({
        "&": {
          fontSize: `${prefs.fontSize}px`,
          fontFamily: prefs.fontFamily || 'var(--font-mono)',
        },
        ".cm-content, .cm-gutter": {
          lineHeight: String(prefs.lineHeight || 1.55),
          fontFamily: prefs.fontFamily || 'var(--font-mono)',
        },
      }),
      search({ top: true }),
      autocompletion({
        override: [this.buildOfflineCompletionSource(tab.name)],
        activateOnTyping: true,
        maxRenderedOptions: 14,
      }),
      ghostTextState,
      ctrlClickHandler,
      saveShortcut,
      keymap.of([
        ...(prefs.autoCloseBrackets ? closeBracketsKeymap : []),
        ...completionKeymap,
        ...searchKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        indentWithTab,
      ]),
      mintuStudioTheme,
      updateListener,
    ];

    if (prefs.codeFolding) {
      extensions.push(foldGutter());
    }
    if (prefs.autoCloseBrackets) {
      extensions.push(closeBrackets());
    }
    if (prefs.enableCodeDiagnostics) {
      extensions.push(
        ...createStudioLinter(tab.name, (diags) => {
          if (this.activePath === tab.path) {
            this.activeDiagnostics = diags;
            if (studioSettings.get().showMinimap) {
              this.drawMinimap(tab.content);
            }
          }
          this.onDiagnosticsChange?.(tab.path, diags);
        })
      );
    } else {
      this.activeDiagnostics = [];
      this.onDiagnosticsChange?.(tab.path, []);
    }

    if (prefs.showLineNumbers) {
      extensions.push(lineNumbers());
    }
    if (prefs.highlightActiveLine) {
      extensions.push(highlightActiveLine(), highlightActiveLineGutter());
    }
    if (prefs.bracketMatching) {
      extensions.push(bracketMatching());
    }
    if (prefs.wordWrap) {
      extensions.push(EditorView.lineWrapping);
    }

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

    if (jumpToLine && jumpToLine >= 1 && jumpToLine <= this.editorView.state.doc.lines) {
      const targetLine = this.editorView.state.doc.line(jumpToLine);
      this.editorView.dispatch({
        selection: { anchor: targetLine.from },
        scrollIntoView: true,
      });
      this.editorView.focus();
    }

    if (prefs.showMinimap) {
      this.minimapWrap.style.display = "block";
      this.drawMinimap(tab.content);
      this.syncMinimapThumb();
    } else {
      this.minimapWrap.style.display = "none";
    }

    const scroller = this.editorView.scrollDOM;
    scroller.addEventListener("scroll", () => this.syncMinimapThumb(), { passive: true });

    this.onStatusChange?.({
      language: tab.language,
      line: jumpToLine || 1,
      col: 1,
      hasFile: true,
      path: tab.path,
      dirty: tab.dirty,
    });
  }

  public setExternalDiagnostics(byPath: Map<string, CodeDiagnosticItem[]>): void {
    this.externalDiagnosticsByPath = byPath;
    const active = this.getActiveFile();
    if (active && studioSettings.get().showMinimap) {
      this.drawMinimap(active.content);
    }
  }

  private drawMinimap(content: string): void {
    const canvas = this.minimapCanvas;
    const width = 68;
    const lines = content.split("\n");
    const totalLines = Math.max(1, lines.length);
    const maxLines = Math.min(totalLines, 400);
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
    const colorError = styles.getPropertyValue("--danger").trim() || "#EF4444";
    const colorWarn = styles.getPropertyValue("--status-warn").trim() || "#F59E0B";

    // Draw syntax preview lines
    for (let i = 0; i < maxLines; i++) {
      const srcIdx = totalLines > maxLines ? Math.floor((i / maxLines) * totalLines) : i;
      const line = lines[srcIdx];
      if (!line || !line.trim()) continue;
      const indent = line.search(/\S/);
      const trimmed = line.trim();
      const x = Math.min(40, 6 + Math.floor(indent * 0.7));
      const len = Math.min(width - x - 8, Math.max(4, Math.floor(trimmed.length * 0.55)));
      const y = 8 + i * lineHeight;

      if (/^(import|export|function|const|let|return|pub|fn|struct|class|if|else|def)\b/.test(trimmed)) {
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

    // Draw crisp VS Code-style red error & amber warning markers on the minimap!
    const extDiags = this.activePath ? this.externalDiagnosticsByPath.get(this.activePath) || [] : [];
    const allDiags = [...this.activeDiagnostics, ...extDiags];
    const lineSeverity = new Map<number, "error" | "warning">();
    for (const d of allDiags) {
      const ln = Math.max(1, Math.min(totalLines, d.line || 1));
      const prev = lineSeverity.get(ln);
      if (d.severity === "error" || !prev) {
        lineSeverity.set(ln, d.severity);
      }
    }

    for (const [ln, sev] of lineSeverity.entries()) {
      const mappedRow = totalLines > maxLines ? ((ln - 1) / totalLines) * maxLines : ln - 1;
      const y = 8 + mappedRow * lineHeight;
      const markerColor = sev === "error" ? colorError : colorWarn;

      // Translucent highlight band across the minimap row
      ctx.fillStyle = markerColor;
      ctx.globalAlpha = sev === "error" ? 0.28 : 0.2;
      ctx.fillRect(0, Math.max(0, y - 1), width, 4);

      // Bold solid indicator tick on the right edge (unmistakable even in long files)
      ctx.globalAlpha = 0.96;
      ctx.fillRect(width - 6, Math.max(0, y - 1.5), 6, 4.5);
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
      c: "C",
      h: "C/C++ Header",
      cpp: "C++",
      cc: "C++",
      hpp: "C++ Header",
      go: "Go",
      xml: "XML",
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
      case "c":
      case "h":
      case "cpp":
      case "cc":
      case "cxx":
      case "hpp":
        return cpp();
      case "go":
        return go();
      case "sql":
        return sql();
      case "md":
      case "markdown":
        return markdown();
      case "yaml":
      case "yml":
        return yaml();
      case "xml":
      case "csproj":
        return xml();
      default:
        return null;
    }
  }
}
