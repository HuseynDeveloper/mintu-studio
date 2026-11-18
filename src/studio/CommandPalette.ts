/**
 * CommandPalette.ts
 * Quick File Opener (Ctrl+P) & Command Palette (Ctrl+Shift+P or leading '>').
 */

import { getFileIconSvg } from "./icons";
import { t } from "./i18n";

export interface PaletteCommand {
  id: string;
  label: string;
  shortcut?: string;
  category?: string;
  action: () => void;
}

interface PaletteRow {
  kind: "file" | "command";
  id: string;
  primary: string;
  secondary?: string;
  shortcut?: string;
  onSelect: () => void;
}

export class CommandPalette {
  private overlayEl: HTMLElement | null = null;
  private files: string[] = [];
  private commands: PaletteCommand[] = [];
  private selectedIndex = 0;
  private visibleRows: PaletteRow[] = [];

  public onOpenFile?: (relPath: string) => void;

  public setFiles(files: string[]): void {
    this.files = files;
  }

  public setCommands(commands: PaletteCommand[]): void {
    this.commands = commands;
  }

  public open(mode: "files" | "commands" = "files"): void {
    this.close();

    const overlay = document.createElement("div");
    overlay.className = "studio-palette-overlay";
    overlay.innerHTML = `
      <div class="studio-palette-dialog" role="dialog" aria-modal="true" aria-label="Command Palette">
        <div class="palette-input-wrap">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7.5"/>
            <line x1="20" y1="20" x2="16.4" y2="16.4"/>
          </svg>
          <input
            type="text"
            id="studio-palette-input"
            class="palette-input"
            autocomplete="off"
            spellcheck="false"
            placeholder="${mode === "commands" ? t("commandPalettePlaceholder") : t("quickOpenPlaceholder")}"
            value="${mode === "commands" ? ">" : ""}"
          />
          <span class="palette-kbd">ESC</span>
        </div>
        <div id="studio-palette-list" class="palette-list"></div>
      </div>
    `;

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) this.close();
    });

    document.body.appendChild(overlay);
    this.overlayEl = overlay;

    const input = overlay.querySelector("#studio-palette-input") as HTMLInputElement;
    input.focus();
    if (mode === "commands") {
      input.setSelectionRange(1, 1);
    }

    input.addEventListener("input", () => {
      this.selectedIndex = 0;
      this.renderList(input.value);
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (this.visibleRows.length > 0) {
          this.selectedIndex = (this.selectedIndex + 1) % this.visibleRows.length;
          this.updateSelectionHighlight();
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (this.visibleRows.length > 0) {
          this.selectedIndex = (this.selectedIndex - 1 + this.visibleRows.length) % this.visibleRows.length;
          this.updateSelectionHighlight();
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        const chosen = this.visibleRows[this.selectedIndex];
        if (chosen) {
          this.close();
          chosen.onSelect();
        }
      }
    });

    this.selectedIndex = 0;
    this.renderList(input.value);
  }

  public close(): void {
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
  }

  private renderList(rawQuery: string): void {
    const listEl = this.overlayEl?.querySelector("#studio-palette-list") as HTMLElement | null;
    if (!listEl) return;

    const trimmed = rawQuery.trim();
    const isCommandMode = trimmed.startsWith(">");
    const q = (isCommandMode ? trimmed.slice(1) : trimmed).trim().toLowerCase();

    const rows: PaletteRow[] = [];

    if (isCommandMode) {
      for (const c of this.commands) {
        const hay = `${c.category || ""} ${c.label} ${c.shortcut || ""}`.toLowerCase();
        if (!q || this.fuzzyMatch(hay, q)) {
          rows.push({
            kind: "command",
            id: c.id,
            primary: c.label,
            secondary: c.category,
            shortcut: c.shortcut,
            onSelect: c.action,
          });
        }
      }
    } else {
      const scored: Array<{ path: string; score: number }> = [];
      for (const f of this.files) {
        const lower = f.toLowerCase();
        const base = lower.split("/").pop() || lower;
        if (!q) {
          scored.push({ path: f, score: 1 });
        } else if (base.startsWith(q)) {
          scored.push({ path: f, score: 100 - base.length * 0.01 });
        } else if (base.includes(q)) {
          scored.push({ path: f, score: 70 - base.length * 0.01 });
        } else if (lower.includes(q)) {
          scored.push({ path: f, score: 45 - lower.length * 0.01 });
        } else if (this.fuzzyMatch(lower, q)) {
          scored.push({ path: f, score: 20 });
        }
      }
      scored.sort((a, b) => b.score - a.score);

      for (const item of scored.slice(0, 60)) {
        const parts = item.path.split("/");
        const name = parts.pop() || item.path;
        const dir = parts.join("/");
        rows.push({
          kind: "file",
          id: item.path,
          primary: name,
          secondary: dir,
          onSelect: () => this.onOpenFile?.(item.path),
        });
      }
    }

    this.visibleRows = rows;
    if (this.selectedIndex >= rows.length) this.selectedIndex = 0;

    if (rows.length === 0) {
      listEl.innerHTML = `<div class="palette-empty">${isCommandMode ? t("noCommandFound") : t("noFileFoundHint")}</div>`;
      return;
    }

    listEl.innerHTML = rows
      .map((r, idx) => {
        const iconHtml =
          r.kind === "file"
            ? `<span class="palette-item-icon">${getFileIconSvg(r.primary)}</span>`
            : `<span class="palette-item-icon palette-cmd-icon">&gt;</span>`;
        return `
          <button type="button" class="palette-item ${idx === this.selectedIndex ? "is-selected" : ""}" data-idx="${idx}">
            ${iconHtml}
            <span class="palette-item-primary">${this.escapeHtml(r.primary)}</span>
            ${r.secondary ? `<span class="palette-item-secondary">${this.escapeHtml(r.secondary)}</span>` : ""}
            ${r.shortcut ? `<span class="palette-item-shortcut">${this.escapeHtml(r.shortcut)}</span>` : ""}
          </button>
        `;
      })
      .join("");

    listEl.querySelectorAll<HTMLButtonElement>(".palette-item").forEach((btn) => {
      btn.addEventListener("mouseenter", () => {
        this.selectedIndex = Number(btn.dataset.idx || 0);
        this.updateSelectionHighlight();
      });
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.idx || 0);
        const chosen = this.visibleRows[idx];
        if (chosen) {
          this.close();
          chosen.onSelect();
        }
      });
    });
  }

  private updateSelectionHighlight(): void {
    const listEl = this.overlayEl?.querySelector("#studio-palette-list");
    if (!listEl) return;
    listEl.querySelectorAll<HTMLElement>(".palette-item").forEach((el, i) => {
      const sel = i === this.selectedIndex;
      el.classList.toggle("is-selected", sel);
      if (sel) el.scrollIntoView({ block: "nearest" });
    });
  }

  private fuzzyMatch(text: string, pattern: string): boolean {
    let pi = 0;
    for (let i = 0; i < text.length && pi < pattern.length; i++) {
      if (text[i] === pattern[pi]) pi++;
    }
    return pi === pattern.length;
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
}
