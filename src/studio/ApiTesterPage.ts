/**
 * ApiTesterPage.ts
 * Built-in Postman-Lite HTTP / REST / GraphQL Tester powered by Rust reqwest (ZERO CORS).
 * Supports GET/POST/PUT/PATCH/DELETE, JSON headers/body, response timing & pretty-print,
 * saved history, and Extension-contributed API templates.
 */

import { invoke } from "@tauri-apps/api/core";
import { ExtensionApiTemplate } from "./ExtensionsPage";
import { formatByteSize } from "./BottomPanel";
import { t } from "./i18n";

interface HttpTestResponse {
  status: number;
  status_text: string;
  duration_ms: number;
  size_bytes: number;
  headers: Record<string, string>;
  body: string;
}

interface ApiHistoryEntry {
  method: string;
  url: string;
  headersJson: string;
  body: string;
  status?: number;
  durationMs?: number;
  timestamp: number;
}

const API_HISTORY_KEY = "mintu_studio_api_history_v1";

export class ApiTesterPage {
  private container: HTMLElement;
  private method = "GET";
  private url = "https://jsonplaceholder.typicode.com/posts/1";
  private headersJson = '{\n  "Accept": "application/json"\n}';
  private reqBody = "";
  private sending = false;
  private errorText: string | null = null;
  private response: HttpTestResponse | null = null;
  private history: ApiHistoryEntry[] = [];
  private templates: ExtensionApiTemplate[] = [];

  public onBackToWorkspace?: () => void;

  constructor(container: HTMLElement) {
    this.container = container;
    this.loadHistory();
  }

  public setTemplates(templates: ExtensionApiTemplate[]): void {
    this.templates = templates;
  }

  public show(): void {
    this.render();
  }

  private loadHistory(): void {
    try {
      const raw = localStorage.getItem(API_HISTORY_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) this.history = parsed.slice(0, 20);
      }
    } catch {}
  }

  private saveHistory(): void {
    try {
      localStorage.setItem(API_HISTORY_KEY, JSON.stringify(this.history.slice(0, 20)));
    } catch {}
  }

  private async sendRequest(): Promise<void> {
    const cleanUrl = this.url.trim();
    if (!cleanUrl || this.sending) return;

    let headersObj: Record<string, string> = {};
    if (this.headersJson.trim()) {
      try {
        const parsed = JSON.parse(this.headersJson);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          headersObj = parsed;
        } else {
          this.errorText = "Headers must be a valid JSON object.";
          this.render();
          return;
        }
      } catch (e: any) {
        this.errorText = `Headers JSON error: ${e?.message || e}`;
        this.render();
        return;
      }
    }

    this.sending = true;
    this.errorText = null;
    this.render();

    try {
      const res = await invoke<HttpTestResponse>("studio_http_request", {
        request: {
          method: this.method,
          url: cleanUrl,
          headers: headersObj,
          body: this.method === "GET" || this.method === "HEAD" ? null : this.reqBody || null,
        },
      });
      this.response = res;
      this.history = this.history.filter((h) => !(h.method === this.method && h.url === cleanUrl));
      this.history.unshift({
        method: this.method,
        url: cleanUrl,
        headersJson: this.headersJson,
        body: this.reqBody,
        status: res.status,
        durationMs: res.duration_ms,
        timestamp: Date.now(),
      });
      this.saveHistory();
    } catch (e: any) {
      this.errorText = String(e);
      this.response = null;
    } finally {
      this.sending = false;
      this.render();
    }
  }

  private formatResponseBody(raw: string): string {
    try {
      const parsed = JSON.parse(raw);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return raw;
    }
  }

  private render(): void {
    const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];
    const methodOpts = methods
      .map((m) => `<option value="${m}" ${this.method === m ? "selected" : ""}>${m}</option>`)
      .join("");

    const templatesHtml =
      this.templates.length > 0
        ? `
          <div class="settings-card-block">
            <div class="settings-block-title">${t("apiTemplatesTitle")} (${this.templates.length})</div>
            <div class="api-side-list">
              ${this.templates
                .map(
                  (tpl, idx) => `
                  <button type="button" class="api-side-item" data-api-tpl="${idx}">
                    <span class="api-method-tag method-${tpl.method.toLowerCase()}">${this.escapeHtml(tpl.method)}</span>
                    <span class="api-side-url">${this.escapeHtml(tpl.name)}</span>
                  </button>
                `
                )
                .join("")}
            </div>
          </div>
        `
        : "";

    const historyHtml =
      this.history.length > 0
        ? this.history
            .map(
              (h, idx) => `
              <button type="button" class="api-side-item" data-api-hist="${idx}">
                <span class="api-method-tag method-${h.method.toLowerCase()}">${this.escapeHtml(h.method)}</span>
                <span class="api-side-url" title="${this.escapeAttr(h.url)}">${this.escapeHtml(h.url)}</span>
                ${h.status ? `<span class="model-meta-pill">${h.status}</span>` : ""}
              </button>
            `
            )
            .join("")
        : `<div class="bottom-empty">—</div>`;

    let responseHtml = `<div class="bottom-empty">${t("apiNoResponse")}</div>`;
    if (this.errorText) {
      responseHtml = `<div class="mcp-error-banner">${this.escapeHtml(this.errorText)}</div>`;
    } else if (this.response) {
      const ok = this.response.status >= 200 && this.response.status < 300;
      const formatted = this.formatResponseBody(this.response.body);
      responseHtml = `
        <div class="api-resp-meta">
          <span class="model-meta-pill ${ok ? "pill-installed" : "pill-warn"}">${this.response.status} ${this.escapeHtml(this.response.status_text)}</span>
          <span class="model-meta-pill">${this.response.duration_ms} ms</span>
          <span class="model-meta-pill">${formatByteSize(this.response.size_bytes)}</span>
          <button type="button" class="studio-btn studio-btn-sm" id="btn-api-copy-resp">${t("apiCopyResponse")}</button>
        </div>
        <pre class="api-resp-pre">${this.escapeHtml(formatted.slice(0, 60000))}</pre>
      `;
    }

    this.container.innerHTML = `
      <div class="full-page-shell page-enter">
        <div class="full-page-header">
          <div class="full-page-title-block">
            <button type="button" class="studio-btn studio-btn-sm" id="btn-api-back">${t("backToEditor")}</button>
            <div>
              <h1 class="full-page-title">${t("apiPageTitle")}</h1>
              <div class="full-page-subtitle">${t("apiPageSubtitle")}</div>
            </div>
          </div>
        </div>

        <div class="full-page-body">
          <div class="api-tester-layout">
            <div class="api-tester-main">
              <div class="settings-card-block">
                <div class="api-url-row">
                  <select id="api-method-select" class="studio-input api-method-select">${methodOpts}</select>
                  <input id="api-url-input" class="studio-input" type="text" placeholder="https://api.example.com/v1/..." value="${this.escapeAttr(this.url)}" autocomplete="off" />
                  <button type="button" class="studio-btn studio-btn-primary" id="btn-api-send" ${this.sending ? "disabled" : ""}>${this.sending ? t("apiSending") : t("apiSendBtn")}</button>
                </div>

                <div class="mcp-form-grid">
                  <div class="form-group">
                    <label for="api-headers-input">${t("apiHeadersLabel")}</label>
                    <textarea id="api-headers-input" class="studio-input studio-textarea api-mono-area" rows="4">${this.escapeHtml(this.headersJson)}</textarea>
                  </div>
                  <div class="form-group">
                    <label for="api-body-input">${t("apiBodyLabel")}</label>
                    <textarea id="api-body-input" class="studio-input studio-textarea api-mono-area" rows="4" placeholder='{"key": "value"}'>${this.escapeHtml(this.reqBody)}</textarea>
                  </div>
                </div>
              </div>

              <div class="settings-card-block">
                <div class="settings-block-title">${t("apiResponseTitle")}</div>
                ${responseHtml}
              </div>
            </div>

            <aside class="api-tester-side">
              ${templatesHtml}
              <div class="settings-card-block">
                <div class="key-status-row">
                  <div class="settings-block-title">${t("apiHistoryTitle")}</div>
                  ${this.history.length ? `<button type="button" class="studio-btn studio-btn-sm" id="btn-api-clear-hist">${t("apiClearHistory")}</button>` : ""}
                </div>
                <div class="api-side-list">${historyHtml}</div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    `;

    this.container.querySelector("#btn-api-back")?.addEventListener("click", () => this.onBackToWorkspace?.());

    const methodSel = this.container.querySelector("#api-method-select") as HTMLSelectElement | null;
    const urlIn = this.container.querySelector("#api-url-input") as HTMLInputElement | null;
    const hdrIn = this.container.querySelector("#api-headers-input") as HTMLTextAreaElement | null;
    const bodyIn = this.container.querySelector("#api-body-input") as HTMLTextAreaElement | null;

    methodSel?.addEventListener("change", () => (this.method = methodSel.value));
    urlIn?.addEventListener("input", () => (this.url = urlIn.value));
    hdrIn?.addEventListener("input", () => (this.headersJson = hdrIn.value));
    bodyIn?.addEventListener("input", () => (this.reqBody = bodyIn.value));

    urlIn?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void this.sendRequest();
      }
    });

    this.container.querySelector("#btn-api-send")?.addEventListener("click", () => void this.sendRequest());

    this.container.querySelector("#btn-api-copy-resp")?.addEventListener("click", () => {
      if (this.response) {
        navigator.clipboard?.writeText(this.formatResponseBody(this.response.body)).catch(() => {});
      }
    });

    this.container.querySelector("#btn-api-clear-hist")?.addEventListener("click", () => {
      this.history = [];
      this.saveHistory();
      this.render();
    });

    this.container.querySelectorAll<HTMLButtonElement>("[data-api-tpl]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tpl = this.templates[Number(btn.dataset.apiTpl)];
        if (!tpl) return;
        this.method = tpl.method || "GET";
        this.url = tpl.url;
        this.headersJson = JSON.stringify(tpl.headers || {}, null, 2);
        this.reqBody = tpl.body || "";
        this.render();
      });
    });

    this.container.querySelectorAll<HTMLButtonElement>("[data-api-hist]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const h = this.history[Number(btn.dataset.apiHist)];
        if (!h) return;
        this.method = h.method;
        this.url = h.url;
        this.headersJson = h.headersJson;
        this.reqBody = h.body;
        this.render();
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
