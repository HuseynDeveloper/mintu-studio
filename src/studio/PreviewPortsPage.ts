/**
 * PreviewPortsPage.ts
 * Dedicated workspace page combining:
 * - Active Localhost Port & Process Monitor (list listening ports, 1-click Preview or Kill PID)
 * - Built-in Responsive Localhost Web Preview (Desktop / Tablet 768px / Mobile 390px)
 */

import { invoke } from "@tauri-apps/api/core";
import { t } from "./i18n";

interface ActivePortItem {
  port: number;
  pid: number;
  process_name: string;
  address: string;
}

type ViewportSize = "desktop" | "tablet" | "mobile";

export class PreviewPortsPage {
  private container: HTMLElement;
  private ports: ActivePortItem[] = [];
  private previewUrl = "http://127.0.0.1:5173";
  private viewport: ViewportSize = "desktop";
  private frameKey = 1;
  private notice: string | null = null;
  private loadingPorts = false;

  public onBackToWorkspace?: () => void;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  public async show(initialUrl?: string): Promise<void> {
    if (initialUrl) this.previewUrl = initialUrl;
    this.notice = null;
    this.render();
    await this.refreshPorts();
  }

  private async refreshPorts(): Promise<void> {
    this.loadingPorts = true;
    this.render();
    try {
      this.ports = await invoke<ActivePortItem[]>("devtools_list_ports");
    } catch (e: any) {
      this.notice = String(e);
      this.ports = [];
    } finally {
      this.loadingPorts = false;
      this.render();
    }
  }

  private sanitizePreviewUrl(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return "http://127.0.0.1:5173";
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^\d{2,5}$/.test(trimmed)) return `http://127.0.0.1:${trimmed}`;
    return `http://${trimmed}`;
  }

  private render(): void {
    const portsHtml =
      this.ports.length === 0
        ? `<div class="bottom-empty">${this.loadingPorts ? "..." : t("portsEmpty")}</div>`
        : this.ports
            .map(
              (p) => `
              <div class="port-item-row">
                <div class="port-item-meta">
                  <span class="api-method-tag method-get">:${p.port}</span>
                  <span class="port-proc-name" title="${this.escapeAttr(p.address)}">${this.escapeHtml(p.process_name)}</span>
                  <span class="model-meta-pill">PID ${p.pid}</span>
                </div>
                <div class="port-item-actions">
                  <button type="button" class="studio-btn studio-btn-sm studio-btn-primary" data-preview-port="${p.port}">${t("portPreviewBtn")}</button>
                  <button type="button" class="studio-btn studio-btn-sm studio-btn-danger" data-kill-pid="${p.pid}">${t("portKillBtn")}</button>
                </div>
              </div>
            `
            )
            .join("");

    const frameWidth =
      this.viewport === "mobile" ? "390px" : this.viewport === "tablet" ? "768px" : "100%";

    this.container.innerHTML = `
      <div class="full-page-shell page-enter">
        <div class="full-page-header">
          <div class="full-page-title-block">
            <button type="button" class="studio-btn studio-btn-sm" id="btn-prev-back">${t("backToEditor")}</button>
            <div>
              <h1 class="full-page-title">${t("previewPortsNav")}</h1>
              <div class="full-page-subtitle">${this.ports.length} ${t("portsTitle").toLowerCase()}</div>
            </div>
          </div>
          <div class="full-page-subtabs">
            <button type="button" class="full-subtab-btn ${this.viewport === "desktop" ? "active" : ""}" data-vp="desktop">${t("previewDesktop")}</button>
            <button type="button" class="full-subtab-btn ${this.viewport === "tablet" ? "active" : ""}" data-vp="tablet">${t("previewTablet")}</button>
            <button type="button" class="full-subtab-btn ${this.viewport === "mobile" ? "active" : ""}" data-vp="mobile">${t("previewMobile")}</button>
          </div>
        </div>

        <div class="full-page-body">
          <div class="preview-ports-layout">
            <aside class="preview-ports-sidebar">
              <div class="settings-card-block">
                <div class="key-status-row">
                  <div class="settings-block-title">${t("portsTitle")} (${this.ports.length})</div>
                  <button type="button" class="studio-btn studio-btn-sm" id="btn-ports-refresh">${t("refresh")}</button>
                </div>
                ${this.notice ? `<div class="form-hint">${this.escapeHtml(this.notice)}</div>` : ""}
                <div class="ports-list">${portsHtml}</div>
              </div>
            </aside>

            <section class="preview-stage-col">
              <div class="preview-url-bar">
                <input id="preview-url-input" class="studio-input" type="text" value="${this.escapeAttr(this.previewUrl)}" placeholder="http://127.0.0.1:5173" autocomplete="off" />
                <button type="button" class="studio-btn studio-btn-sm studio-btn-primary" id="btn-preview-go">${t("previewOpenBtn")}</button>
                <button type="button" class="studio-btn studio-btn-sm" id="btn-preview-reload">${t("refresh")}</button>
              </div>
              <div class="preview-frame-stage">
                <iframe
                  key="${this.frameKey}"
                  id="studio-localhost-iframe"
                  class="preview-localhost-iframe"
                  style="width: ${frameWidth};"
                  src="${this.escapeAttr(this.previewUrl)}"
                ></iframe>
              </div>
            </section>
          </div>
        </div>
      </div>
    `;

    this.container.querySelector("#btn-prev-back")?.addEventListener("click", () => this.onBackToWorkspace?.());
    this.container.querySelector("#btn-ports-refresh")?.addEventListener("click", () => void this.refreshPorts());

    this.container.querySelectorAll<HTMLButtonElement>("[data-vp]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const vp = btn.dataset.vp as ViewportSize;
        if (vp) {
          this.viewport = vp;
          this.render();
        }
      });
    });

    const urlInput = this.container.querySelector("#preview-url-input") as HTMLInputElement | null;
    const go = () => {
      if (urlInput) {
        this.previewUrl = this.sanitizePreviewUrl(urlInput.value);
        this.frameKey++;
        this.render();
      }
    };
    this.container.querySelector("#btn-preview-go")?.addEventListener("click", go);
    this.container.querySelector("#btn-preview-reload")?.addEventListener("click", () => {
      const iframe = this.container.querySelector("#studio-localhost-iframe") as HTMLIFrameElement | null;
      if (iframe) iframe.src = this.previewUrl;
    });
    urlInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        go();
      }
    });

    this.container.querySelectorAll<HTMLButtonElement>("[data-preview-port]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const port = btn.dataset.previewPort;
        if (port) {
          this.previewUrl = `http://127.0.0.1:${port}`;
          this.frameKey++;
          this.render();
        }
      });
    });

    this.container.querySelectorAll<HTMLButtonElement>("[data-kill-pid]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const pid = Number(btn.dataset.killPid || 0);
        if (!pid) return;
        try {
          const msg = await invoke<string>("devtools_kill_pid", { pid });
          this.notice = msg || `PID ${pid} terminated.`;
        } catch (e: any) {
          this.notice = String(e);
        }
        await this.refreshPorts();
      });
    });
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  private escapeAttr(str: string): string {
    return this.escapeHtml(str).replace(/"/g, "&quot;");
  }
}
