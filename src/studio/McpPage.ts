/**
 * McpPage.ts
 * Dedicated full-screen workspace page for Model Context Protocol (MCP) Servers.
 * 100% localized across AZ / EN / TR / RU.
 */

import { invoke } from "@tauri-apps/api/core";
import { McpServerConfig, McpServerStatusView } from "./McpModal";
import { t } from "./i18n";

export class McpPage {
  private container: HTMLElement;
  private formError: string | null = null;
  private servers: McpServerStatusView[] = [];

  public onBackToWorkspace?: () => void;
  public onServersUpdated?: (servers: McpServerStatusView[]) => void;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  public async getServers(): Promise<McpServerStatusView[]> {
    try {
      return await invoke<McpServerStatusView[]>("mcp_list_servers");
    } catch {
      return [];
    }
  }

  public async show(): Promise<void> {
    this.formError = null;
    this.servers = await this.getServers();
    this.onServersUpdated?.(this.servers);
    this.render();
  }

  private render(): void {
    const connectedCount = this.servers.filter((s) => s.status === "connected").length;
    const totalTools = this.servers.reduce((acc, s) => acc + s.tools.length, 0);

    const serversHtml =
      this.servers.length === 0
        ? `<div class="bottom-empty">${t("mcpEmpty")}</div>`
        : this.servers
            .map((s) => {
              const statusClass =
                s.status === "connected" ? "is-local" : s.status === "error" ? "is-error" : "is-idle";
              const statusText =
                s.status === "connected"
                  ? `${t("mcpConnected")} (${s.tools.length} ${t("mcpToolsWord")})`
                  : s.status === "error"
                    ? t("errorStatus")
                    : t("mcpDisconnected");

              const toolsHtml =
                s.tools.length > 0
                  ? `<div class="mcp-tools-pills">${s.tools
                      .map(
                        (tool) =>
                          `<span class="msg-file-pill" title="${this.escapeAttr(tool.description || tool.name)}">${this.escapeHtml(tool.name)}</span>`
                      )
                      .join("")}</div>`
                  : "";

              return `
                <div class="mcp-server-card">
                  <div class="mcp-card-top">
                    <div class="mcp-card-info">
                      <span class="mcp-card-name">${this.escapeHtml(s.config.name)}</span>
                      <span class="mcp-status-pill ${statusClass}">${statusText}</span>
                    </div>
                    <div class="mcp-card-actions">
                      ${
                        s.status === "connected"
                          ? `<button type="button" class="studio-btn studio-btn-sm" data-disconnect="${this.escapeAttr(s.config.id)}">${t("mcpDisconnect")}</button>`
                          : `<button type="button" class="studio-btn studio-btn-sm studio-btn-primary" data-connect="${this.escapeAttr(s.config.id)}">${t("mcpConnect")}</button>`
                      }
                      <button type="button" class="studio-btn studio-btn-sm studio-btn-danger" data-delete="${this.escapeAttr(s.config.id)}">${t("deleteModel")}</button>
                    </div>
                  </div>
                  <div class="mcp-card-cmd">${this.escapeHtml(s.config.command)} ${this.escapeHtml(s.config.args.join(" "))}</div>
                  ${s.error ? `<div class="mcp-card-err">${this.escapeHtml(s.error)}</div>` : ""}
                  ${toolsHtml}
                </div>
              `;
            })
            .join("");

    this.container.innerHTML = `
      <div class="full-page-shell page-enter">
        <div class="full-page-header">
          <div class="full-page-title-block">
            <button type="button" class="studio-btn studio-btn-sm" id="btn-mcp-back">${t("backToEditor")}</button>
            <div>
              <h1 class="full-page-title">${t("mcpPageTitle")}</h1>
              <div class="full-page-subtitle">${connectedCount} ${t("serverActive")} · ${totalTools} ${t("mcpToolsWord")}</div>
            </div>
          </div>
          <button type="button" class="studio-btn studio-btn-sm" id="btn-mcp-refresh">${t("refresh")}</button>
        </div>

        <div class="full-page-body">
          <div class="mcp-page-grid">
            <div class="mcp-page-left">
              <div class="settings-block-title">${t("mcpConfiguredTitle")} (${this.servers.length})</div>
              <div class="mcp-servers-list">${serversHtml}</div>
            </div>

            <div class="mcp-page-right">
              <div class="settings-card-block">
                <div class="settings-block-title">${t("mcpAddTitle")}</div>
                <div class="form-hint">${t("mcpAddHint")}</div>

                <div class="form-presets">
                  <button type="button" class="studio-btn studio-btn-sm" id="btn-mcp-preset-memory">Memory MCP</button>
                  <button type="button" class="studio-btn studio-btn-sm" id="btn-mcp-preset-thinking">Sequential Thinking</button>
                  <button type="button" class="studio-btn studio-btn-sm" id="btn-mcp-preset-fetch">Fetch (uvx)</button>
                  <button type="button" class="studio-btn studio-btn-sm" id="btn-mcp-preset-git">Git MCP</button>
                </div>

                <div class="form-group">
                  <label for="mcp-input-name">${t("mcpServerName")}</label>
                  <input id="mcp-input-name" class="studio-input" type="text" placeholder="memory" />
                </div>

                <div class="form-group">
                  <label for="mcp-input-cmd">${t("mcpCommand")}</label>
                  <input id="mcp-input-cmd" class="studio-input" type="text" placeholder="npx, node, python, uvx..." />
                </div>

                <div class="form-group">
                  <label for="mcp-input-args">${t("mcpArgs")}</label>
                  <input id="mcp-input-args" class="studio-input" type="text" placeholder="-y @modelcontextprotocol/server-memory" />
                </div>

                <div class="form-group">
                  <label for="mcp-input-env">${t("mcpEnv")}</label>
                  <input id="mcp-input-env" class="studio-input" type="text" placeholder="{}" />
                </div>

                ${this.formError ? `<div class="mcp-error-banner">${this.escapeHtml(this.formError)}</div>` : ""}

                <div class="settings-inline-actions">
                  <button type="button" id="btn-mcp-add" class="studio-btn studio-btn-primary">${t("mcpSaveBtn")}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.container.querySelector("#btn-mcp-back")?.addEventListener("click", () => this.onBackToWorkspace?.());
    this.container.querySelector("#btn-mcp-refresh")?.addEventListener("click", () => void this.show());

    const nameIn = this.container.querySelector("#mcp-input-name") as HTMLInputElement;
    const cmdIn = this.container.querySelector("#mcp-input-cmd") as HTMLInputElement;
    const argsIn = this.container.querySelector("#mcp-input-args") as HTMLInputElement;
    const envIn = this.container.querySelector("#mcp-input-env") as HTMLInputElement;

    this.container.querySelector("#btn-mcp-preset-memory")?.addEventListener("click", () => {
      nameIn.value = "memory";
      cmdIn.value = "npx";
      argsIn.value = "-y @modelcontextprotocol/server-memory";
      envIn.value = "{}";
    });
    this.container.querySelector("#btn-mcp-preset-thinking")?.addEventListener("click", () => {
      nameIn.value = "sequential-thinking";
      cmdIn.value = "npx";
      argsIn.value = "-y @modelcontextprotocol/server-sequential-thinking";
      envIn.value = "{}";
    });
    this.container.querySelector("#btn-mcp-preset-fetch")?.addEventListener("click", () => {
      nameIn.value = "fetch";
      cmdIn.value = "uvx";
      argsIn.value = "mcp-server-fetch";
      envIn.value = "{}";
    });
    this.container.querySelector("#btn-mcp-preset-git")?.addEventListener("click", () => {
      nameIn.value = "git";
      cmdIn.value = "uvx";
      argsIn.value = "mcp-server-git";
      envIn.value = "{}";
    });

    this.container.querySelectorAll<HTMLButtonElement>("[data-connect]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.connect;
        if (!id) return;
        btn.disabled = true;
        btn.textContent = t("mcpConnecting");
        this.formError = null;
        try {
          await invoke("mcp_connect_server", { id });
        } catch (err: any) {
          this.formError = String(err);
        }
        await this.show();
      });
    });

    this.container.querySelectorAll<HTMLButtonElement>("[data-disconnect]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.disconnect;
        if (!id) return;
        await invoke("mcp_disconnect_server", { id });
        await this.show();
      });
    });

    this.container.querySelectorAll<HTMLButtonElement>("[data-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.delete;
        if (!id) return;
        await invoke("mcp_delete_server", { id });
        await this.show();
      });
    });

    this.container.querySelector("#btn-mcp-add")?.addEventListener("click", async () => {
      this.formError = null;
      const name = nameIn.value.trim();
      const command = cmdIn.value.trim();
      if (!name || !command) {
        this.formError = `${t("mcpServerName")} & ${t("mcpCommand")} required.`;
        this.render();
        return;
      }
      let envObj: Record<string, string> = {};
      if (envIn.value.trim()) {
        try {
          const parsed = JSON.parse(envIn.value.trim());
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            envObj = parsed;
          } else {
            this.formError = "Env must be a valid JSON object.";
            this.render();
            return;
          }
        } catch {
          this.formError = "Env JSON syntax error.";
          this.render();
          return;
        }
      }

      const id = name.toLowerCase().replace(/[^a-z0-9_-]/g, "-") || `mcp-${Date.now()}`;
      const config: McpServerConfig = {
        id,
        name,
        command,
        args: argsIn.value.trim().split(/\s+/).filter(Boolean),
        env: envObj,
        enabled: true,
      };
      try {
        await invoke("mcp_save_server", { config });
        await this.show();
      } catch (e: any) {
        this.formError = String(e);
        this.render();
      }
    });
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  private escapeAttr(str: string): string {
    return this.escapeHtml(str).replace(/"/g, "&quot;");
  }
}
