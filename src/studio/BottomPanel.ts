/**
 * BottomPanel.ts
 * Bottom workspace panel with 3 tabs:
 * - Kontekst (attached files with sizes and remove buttons)
 * - Fəaliyyət jurnalı (timestamped audit log of file reads, sends, blocked sensitive files)
 * - Problemlər (errors and warnings)
 * Strictly NO terminal anywhere.
 */

import { ICON_CLOSE, ICON_LOCK_RED, getFileIconSvg } from "./icons";

export type BottomTabId = "context" | "activity" | "problems";

export interface ContextFileSummary {
  path: string;
  sizeBytes: number;
}

export interface ActivityLogEntry {
  time: string;
  category: "read" | "send" | "blocked" | "system";
  message: string;
  detail?: string;
}

export interface ProblemEntry {
  time: string;
  severity: "error" | "warning";
  source: string;
  message: string;
}

export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

function nowTime(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export class BottomPanel {
  private container: HTMLElement;
  private activeTab: BottomTabId = "context";
  private contextFiles: ContextFileSummary[] = [];
  private activityLog: ActivityLogEntry[] = [];
  private problems: ProblemEntry[] = [];
  private isCollapsed = false;

  public onRemoveContextFile?: (path: string) => void;
  public onOpenContextFile?: (path: string) => void;
  public onToggleCollapse?: (collapsed: boolean) => void;

  constructor(container: HTMLElement) {
    this.container = container;
    this.logActivity("system", "Mintu Studio hazırdır (Yalnız oxu rejimi aktivdir)");
    this.render();
  }

  public setActiveTab(tab: BottomTabId): void {
    this.activeTab = tab;
    if (this.isCollapsed) {
      this.setCollapsed(false);
    }
    this.render();
  }

  public setCollapsed(collapsed: boolean): void {
    this.isCollapsed = collapsed;
    this.onToggleCollapse?.(collapsed);
    this.render();
  }

  public getCollapsed(): boolean {
    return this.isCollapsed;
  }

  public updateContextFiles(files: ContextFileSummary[]): void {
    this.contextFiles = files;
    this.render();
  }

  public logActivity(category: ActivityLogEntry["category"], message: string, detail?: string): void {
    this.activityLog.unshift({
      time: nowTime(),
      category,
      message,
      detail,
    });
    if (this.activityLog.length > 200) {
      this.activityLog.pop();
    }
    this.render();
  }

  public addProblem(severity: ProblemEntry["severity"], source: string, message: string): void {
    this.problems.unshift({
      time: nowTime(),
      severity,
      source,
      message,
    });
    if (this.problems.length > 100) {
      this.problems.pop();
    }
    this.render();
  }

  public clearActiveTab(): void {
    if (this.activeTab === "activity") {
      this.activityLog = [];
    } else if (this.activeTab === "problems") {
      this.problems = [];
    } else if (this.activeTab === "context") {
      const paths = this.contextFiles.map((f) => f.path);
      for (const p of paths) {
        this.onRemoveContextFile?.(p);
      }
    }
    this.render();
  }

  private render(): void {
    const totalBytes = this.contextFiles.reduce((acc, f) => acc + f.sizeBytes, 0);
    const contextBadge = this.contextFiles.length > 0 ? `<span class="bottom-tab-badge">${this.contextFiles.length}</span>` : "";
    const problemsBadge = this.problems.length > 0 ? `<span class="bottom-tab-badge badge-problem">${this.problems.length}</span>` : "";

    let bodyHtml = "";
    if (!this.isCollapsed) {
      if (this.activeTab === "context") {
        if (this.contextFiles.length === 0) {
          bodyHtml = `
            <div class="bottom-empty">
              Kontekstə heç bir fayl qoşulmayıb. Explorer ağacından və ya redaktor başlığındakı "Aktiv Faylı Qoş" düyməsi ilə fayl əlavə edin.
            </div>
          `;
        } else {
          const rows = this.contextFiles
            .map((f) => {
              const name = f.path.split("/").pop() || f.path;
              return `
                <div class="bottom-context-row" data-path="${this.escapeAttr(f.path)}">
                  <span class="bottom-row-icon">${getFileIconSvg(name)}</span>
                  <button type="button" class="bottom-row-path" data-open="${this.escapeAttr(f.path)}" title="${this.escapeAttr(f.path)}">${this.escapeHtml(f.path)}</button>
                  <span class="bottom-row-size">${formatByteSize(f.sizeBytes)}</span>
                  <button type="button" class="studio-btn-icon bottom-row-remove" data-remove="${this.escapeAttr(f.path)}" title="Kontekstdən çıxar">${ICON_CLOSE}</button>
                </div>
              `;
            })
            .join("");

          bodyHtml = `
            <div class="bottom-context-summary">${this.contextFiles.length} fayl · ${formatByteSize(totalBytes)} kontekstdə</div>
            <div class="bottom-list">${rows}</div>
          `;
        }
      } else if (this.activeTab === "activity") {
        if (this.activityLog.length === 0) {
          bodyHtml = `<div class="bottom-empty">Fəaliyyət jurnalı boşdur.</div>`;
        } else {
          const rows = this.activityLog
            .map((entry) => {
              const tagLabel =
                entry.category === "read"
                  ? "OXUMA"
                  : entry.category === "send"
                    ? "GÖNDƏRMƏ"
                    : entry.category === "blocked"
                      ? "BLOKLANDI"
                      : "SİSTEM";
              const tagClass = `audit-tag audit-tag-${entry.category}`;
              const lockPrefix = entry.category === "blocked" ? `<span class="audit-lock">${ICON_LOCK_RED}</span>` : "";
              return `
                <div class="bottom-audit-row">
                  <span class="audit-time">${entry.time}</span>
                  <span class="${tagClass}">${lockPrefix}${tagLabel}</span>
                  <span class="audit-msg">${this.escapeHtml(entry.message)}</span>
                  ${entry.detail ? `<span class="audit-detail">${this.escapeHtml(entry.detail)}</span>` : ""}
                </div>
              `;
            })
            .join("");
          bodyHtml = `<div class="bottom-list bottom-mono-list">${rows}</div>`;
        }
      } else {
        if (this.problems.length === 0) {
          bodyHtml = `<div class="bottom-empty">Problem aşkarlanmadı.</div>`;
        } else {
          const rows = this.problems
            .map(
              (p) => `
              <div class="bottom-problem-row problem-${p.severity}">
                <span class="audit-time">${p.time}</span>
                <span class="problem-source">${this.escapeHtml(p.source)}</span>
                <span class="problem-msg">${this.escapeHtml(p.message)}</span>
              </div>
            `
            )
            .join("");
          bodyHtml = `<div class="bottom-list bottom-mono-list">${rows}</div>`;
        }
      }
    }

    const clearTitle =
      this.activeTab === "context"
        ? "Bütün kontekst fayllarını təmizlə"
        : this.activeTab === "activity"
          ? "Jurnalı təmizlə"
          : "Problemləri təmizlə";

    this.container.innerHTML = `
      <div class="bottom-panel-header">
        <div class="bottom-tabs" role="tablist">
          <button type="button" class="bottom-tab ${this.activeTab === "context" ? "active" : ""}" data-tab="context" role="tab">
            Kontekst ${contextBadge}
          </button>
          <button type="button" class="bottom-tab ${this.activeTab === "activity" ? "active" : ""}" data-tab="activity" role="tab">
            Fəaliyyət jurnalı
          </button>
          <button type="button" class="bottom-tab ${this.activeTab === "problems" ? "active" : ""}" data-tab="problems" role="tab">
            Problemlər ${problemsBadge}
          </button>
        </div>
        <div class="bottom-panel-actions">
          <button type="button" class="studio-btn-icon" id="btn-bottom-clear" title="${clearTitle}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
            </svg>
          </button>
          <button type="button" class="studio-btn-icon" id="btn-bottom-toggle" title="${this.isCollapsed ? "Paneli aç" : "Paneli yığ"}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true">
              ${this.isCollapsed ? `<polyline points="18 15 12 9 6 15"/>` : `<polyline points="6 9 12 15 18 9"/>`}
            </svg>
          </button>
        </div>
      </div>
      ${this.isCollapsed ? "" : `<div class="bottom-panel-body">${bodyHtml}</div>`}
    `;

    this.container.querySelectorAll<HTMLButtonElement>(".bottom-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.tab as BottomTabId;
        if (tab) this.setActiveTab(tab);
      });
    });

    this.container.querySelector("#btn-bottom-clear")?.addEventListener("click", () => {
      this.clearActiveTab();
    });

    this.container.querySelector("#btn-bottom-toggle")?.addEventListener("click", () => {
      this.setCollapsed(!this.isCollapsed);
    });

    this.container.querySelectorAll<HTMLButtonElement>("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = btn.dataset.remove;
        if (p) this.onRemoveContextFile?.(p);
      });
    });

    this.container.querySelectorAll<HTMLButtonElement>("[data-open]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = btn.dataset.open;
        if (p) this.onOpenContextFile?.(p);
      });
    });
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  private escapeAttr(str: string): string {
    return this.escapeHtml(str).replace(/"/g, "&quot;");
  }
}
