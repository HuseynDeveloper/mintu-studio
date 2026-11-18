/**
 * DataExplorerPage.ts
 * Built-in Read-Only SQLite (.db/.sqlite/.sqlite3) & CSV/JSON Table Explorer.
 * - Lists non-sensitive data files in the open project
 * - SQLite: browse tables, run read-only SELECT queries, view timings, export CSV
 * - CSV/JSON: instant searchable interactive table with CSV export
 */

import { invoke } from "@tauri-apps/api/core";
import { isSensitiveFileOrDir } from "./sensitiveFilter";
import { t } from "./i18n";

interface SqliteTableInfo {
  name: string;
  row_count: number;
}

interface SqliteQueryResult {
  columns: string[];
  rows: string[][];
  truncated: boolean;
  duration_ms: number;
}

export function parseCsvToTable(raw: string, maxRows = 500): { columns: string[]; rows: string[][] } {
  const lines = raw.replace(/\r\n/g, "\n").split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { columns: [], rows: [] };
  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        out.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  };
  const columns = parseLine(lines[0]);
  const rows = lines.slice(1, maxRows + 1).map(parseLine);
  return { columns, rows };
}

export function parseJsonToTable(raw: string, maxRows = 500): { columns: string[]; rows: string[][] } | null {
  try {
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object"
        ? [parsed]
        : null;
    if (!arr || arr.length === 0) return { columns: [], rows: [] };
    const colSet = new Set<string>();
    for (const item of arr.slice(0, 50)) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        Object.keys(item).forEach((k) => colSet.add(k));
      } else {
        colSet.add("value");
      }
    }
    const columns = Array.from(colSet);
    const rows = arr.slice(0, maxRows).map((item) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        return columns.map((c) => {
          const v = (item as any)[c];
          if (v === null || v === undefined) return "NULL";
          return typeof v === "object" ? JSON.stringify(v) : String(v);
        });
      }
      return [String(item)];
    });
    return { columns, rows };
  } catch {
    return null;
  }
}

export class DataExplorerPage {
  private container: HTMLElement;
  private dataFiles: string[] = [];
  private selectedFile: string | null = null;
  private sqliteTables: SqliteTableInfo[] = [];
  private sqlQuery = "";
  private columns: string[] = [];
  private rows: string[][] = [];
  private durationMs: number | null = null;
  private filterText = "";
  private errorMsg: string | null = null;

  public onBackToWorkspace?: () => void;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  public setProjectFiles(allFiles: string[]): void {
    this.dataFiles = allFiles.filter((f) => {
      if (isSensitiveFileOrDir(f)) return false;
      const lower = f.toLowerCase();
      return (
        lower.endsWith(".db") ||
        lower.endsWith(".sqlite") ||
        lower.endsWith(".sqlite3") ||
        lower.endsWith(".csv") ||
        lower.endsWith(".json")
      );
    });
  }

  public async show(fileToOpen?: string): Promise<void> {
    this.errorMsg = null;
    if (fileToOpen) {
      await this.selectFile(fileToOpen);
    } else if (!this.selectedFile && this.dataFiles.length > 0) {
      await this.selectFile(this.dataFiles[0]);
    } else {
      this.render();
    }
  }

  private isSqliteFile(path: string): boolean {
    const l = path.toLowerCase();
    return l.endsWith(".db") || l.endsWith(".sqlite") || l.endsWith(".sqlite3");
  }

  private async selectFile(relPath: string): Promise<void> {
    this.selectedFile = relPath;
    this.sqliteTables = [];
    this.columns = [];
    this.rows = [];
    this.durationMs = null;
    this.filterText = "";
    this.errorMsg = null;
    this.sqlQuery = "";

    if (this.isSqliteFile(relPath)) {
      try {
        this.sqliteTables = await invoke<SqliteTableInfo[]>("devtools_sqlite_tables", { relPath });
        if (this.sqliteTables.length > 0) {
          const first = this.sqliteTables[0].name.replace(/"/g, '""');
          this.sqlQuery = `SELECT * FROM "${first}" LIMIT 100;`;
          await this.runSql();
          return;
        }
      } catch (e: any) {
        this.errorMsg = String(e);
      }
    } else {
      try {
        const content = await invoke<string>("studio_read_file", { relPath });
        if (relPath.toLowerCase().endsWith(".csv")) {
          const tbl = parseCsvToTable(content);
          this.columns = tbl.columns;
          this.rows = tbl.rows;
        } else {
          const tbl = parseJsonToTable(content);
          if (tbl) {
            this.columns = tbl.columns;
            this.rows = tbl.rows;
          } else {
            this.errorMsg = "JSON file is not a valid object/array table.";
          }
        }
      } catch (e: any) {
        this.errorMsg = String(e);
      }
    }
    this.render();
  }

  private async runSql(): Promise<void> {
    if (!this.selectedFile || !this.sqlQuery.trim()) return;
    this.errorMsg = null;
    try {
      const res = await invoke<SqliteQueryResult>("devtools_sqlite_query", {
        relPath: this.selectedFile,
        query: this.sqlQuery,
        limit: 250,
      });
      this.columns = res.columns;
      this.rows = res.rows;
      this.durationMs = res.duration_ms;
    } catch (e: any) {
      this.errorMsg = String(e);
    }
    this.render();
  }

  private exportCurrentCsv(): void {
    if (this.columns.length === 0) return;
    const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
    const lines = [
      this.columns.map(esc).join(","),
      ...this.rows.map((r) => r.map(esc).join(",")),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(this.selectedFile || "export").split("/").pop()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private render(): void {
    const isSqlite = !!(this.selectedFile && this.isSqliteFile(this.selectedFile));
    const q = this.filterText.trim().toLowerCase();
    const visibleRows = q
      ? this.rows.filter((r) => r.some((cell) => cell.toLowerCase().includes(q)))
      : this.rows;

    const filesHtml =
      this.dataFiles.length === 0
        ? `<div class="bottom-empty">${t("dataNoFiles")}</div>`
        : this.dataFiles
            .map(
              (f) => `
              <button type="button" class="api-side-item ${f === this.selectedFile ? "is-active-file" : ""}" data-data-file="${this.escapeAttr(f)}">
                <span class="api-method-tag">${this.escapeHtml((f.split(".").pop() || "").toUpperCase())}</span>
                <span class="api-side-url" title="${this.escapeAttr(f)}">${this.escapeHtml(f)}</span>
              </button>
            `
            )
            .join("");

    const tablesHtml = isSqlite
      ? `
        <div class="settings-card-block">
          <div class="settings-block-title">${t("dataTablesTitle")} (${this.sqliteTables.length})</div>
          <div class="api-side-list">
            ${this.sqliteTables
              .map(
                (tb) => `
                <button type="button" class="api-side-item" data-sql-table="${this.escapeAttr(tb.name)}">
                  <span class="api-side-url">${this.escapeHtml(tb.name)}</span>
                  <span class="model-meta-pill">${tb.row_count >= 0 ? tb.row_count : "?"}</span>
                </button>
              `
              )
              .join("")}
          </div>
        </div>
      `
      : "";

    const sqlBarHtml = isSqlite
      ? `
        <div class="settings-card-block">
          <textarea id="data-sql-input" class="studio-input studio-textarea api-mono-area" rows="3" placeholder="SELECT * FROM ... LIMIT 100;">${this.escapeHtml(this.sqlQuery)}</textarea>
          <div class="settings-inline-actions">
            <button type="button" class="studio-btn studio-btn-sm studio-btn-primary" id="btn-data-run-sql">${t("dataRunQuery")}</button>
          </div>
        </div>
      `
      : "";

    const tableHtml =
      this.columns.length === 0
        ? `<div class="bottom-empty">—</div>`
        : `
          <div class="data-table-scroll">
            <table class="data-grid-table">
              <thead><tr>${this.columns.map((c) => `<th>${this.escapeHtml(c)}</th>`).join("")}</tr></thead>
              <tbody>
                ${visibleRows
                  .slice(0, 300)
                  .map(
                    (row) =>
                      `<tr>${this.columns.map((_, i) => `<td>${this.escapeHtml(row[i] ?? "")}</td>`).join("")}</tr>`
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        `;

    this.container.innerHTML = `
      <div class="full-page-shell page-enter">
        <div class="full-page-header">
          <div class="full-page-title-block">
            <button type="button" class="studio-btn studio-btn-sm" id="btn-data-back">${t("backToEditor")}</button>
            <div>
              <h1 class="full-page-title">${t("dataPageTitle")}</h1>
              <div class="full-page-subtitle">${t("dataPageSubtitle")}</div>
            </div>
          </div>
        </div>

        <div class="full-page-body">
          <div class="preview-ports-layout">
            <aside class="preview-ports-sidebar">
              <div class="settings-card-block">
                <div class="settings-block-title">${t("filesWord")} (${this.dataFiles.length})</div>
                <div class="api-side-list">${filesHtml}</div>
              </div>
              ${tablesHtml}
            </aside>

            <section class="api-tester-main">
              ${sqlBarHtml}
              ${this.errorMsg ? `<div class="mcp-error-banner">${this.escapeHtml(this.errorMsg)}</div>` : ""}
              <div class="settings-card-block">
                <div class="ext-toolbar-row">
                  <input id="data-filter-input" class="studio-input" type="text" placeholder="${t("dataFilterRows")}" value="${this.escapeAttr(this.filterText)}" autocomplete="off" />
                  <span class="model-meta-pill">${visibleRows.length} rows${this.durationMs !== null ? ` · ${this.durationMs}ms` : ""}</span>
                  <button type="button" class="studio-btn studio-btn-sm" id="btn-data-export-csv" ${this.columns.length === 0 ? "disabled" : ""}>${t("dataExportCsv")}</button>
                </div>
                ${tableHtml}
              </div>
            </section>
          </div>
        </div>
      </div>
    `;

    this.container.querySelector("#btn-data-back")?.addEventListener("click", () => this.onBackToWorkspace?.());

    this.container.querySelectorAll<HTMLButtonElement>("[data-data-file]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const f = btn.dataset.dataFile;
        if (f) void this.selectFile(f);
      });
    });

    this.container.querySelectorAll<HTMLButtonElement>("[data-sql-table]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const name = btn.dataset.sqlTable;
        if (name) {
          this.sqlQuery = `SELECT * FROM "${name.replace(/"/g, '""')}" LIMIT 100;`;
          void this.runSql();
        }
      });
    });

    const sqlIn = this.container.querySelector("#data-sql-input") as HTMLTextAreaElement | null;
    sqlIn?.addEventListener("input", () => (this.sqlQuery = sqlIn.value));
    sqlIn?.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.key === "Enter") {
        e.preventDefault();
        void this.runSql();
      }
    });
    this.container.querySelector("#btn-data-run-sql")?.addEventListener("click", () => void this.runSql());

    const filterIn = this.container.querySelector("#data-filter-input") as HTMLInputElement | null;
    filterIn?.addEventListener("input", () => {
      this.filterText = filterIn.value;
      const pos = filterIn.selectionStart || this.filterText.length;
      this.render();
      const next = this.container.querySelector("#data-filter-input") as HTMLInputElement | null;
      if (next) {
        next.focus();
        next.setSelectionRange(pos, pos);
      }
    });

    this.container.querySelector("#btn-data-export-csv")?.addEventListener("click", () => this.exportCurrentCsv());
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  private escapeAttr(str: string): string {
    return this.escapeHtml(str).replace(/"/g, "&quot;");
  }
}
