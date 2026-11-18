/**
 * McpModal.ts
 * Model Context Protocol (MCP) Server Manager Modal for Mintu Studio.
 * Connects external stdio MCP servers, inspects discovered tools, and exposes them to Mintu AI.
 */

import { invoke } from "@tauri-apps/api/core";
import { ICON_CLOSE } from "./icons";

export interface McpServerConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
}

export interface McpToolDef {
  name: string;
  description: string;
  input_schema: any;
}

export interface McpServerStatusView {
  config: McpServerConfig;
  status: "connected" | "disconnected" | "error";
  error: string | null;
  tools: McpToolDef[];
}

export class McpModal {
  private overlayEl: HTMLElement | null = null;
  public onServersUpdated?: (servers: McpServerStatusView[]) => void;

  public async getServers(): Promise<McpServerStatusView[]> {
    try {
      return await invoke<McpServerStatusView[]>("mcp_list_servers");
    } catch {
      return [];
    }
  }

  public async open(): Promise<void> {
    if (this.overlayEl) this.overlayEl.remove();

    const overlay = document.createElement("div");
    overlay.className = "studio-modal-overlay";
    overlay.id = "studio-mcp-modal";

    overlay.innerHTML = `
      <div class="studio-modal studio-modal-wide">
        <div class="studio-modal-header">
          <span class="studio-modal-title">MCP Serverlər (Model Context Protocol)</span>
          <button type="button" id="btn-close-mcp-modal" class="studio-btn-icon" title="Bağla">${ICON_CLOSE}</button>
        </div>

        <div class="studio-modal-body">
          <div class="form-hint">
            Stdio əsaslı xarici MCP serverləri əlavə edib qoşun. Qoşulmuş MCP alətləri Mintu AI agentinə avtomatik təqdim olunur və hər çağırış yalnız sizin təsdiqinizlə icra edilir.
          </div>

          <div class="mcp-section-title">Konfiqurasiya Edilmiş Serverlər</div>
          <div id="mcp-servers-list" class="mcp-servers-list">
            <div class="bottom-empty">Yüklənir...</div>
          </div>

          <div class="mcp-divider"></div>

          <div class="mcp-section-title">Yeni MCP Server Əlavə Et</div>
          <div class="form-presets">
            <button type="button" class="studio-btn studio-btn-sm" id="btn-mcp-preset-memory">Preset: Memory MCP</button>
            <button type="button" class="studio-btn studio-btn-sm" id="btn-mcp-preset-thinking">Preset: Sequential Thinking</button>
            <button type="button" class="studio-btn studio-btn-sm" id="btn-mcp-preset-fetch">Preset: Fetch MCP (uvx)</button>
          </div>

          <div class="mcp-form-grid">
            <div class="form-group">
              <label for="mcp-input-name">Server Adı</label>
              <input id="mcp-input-name" class="studio-input" type="text" placeholder="məs: memory" />
            </div>
            <div class="form-group">
              <label for="mcp-input-cmd">Komanda (Executable)</label>
              <input id="mcp-input-cmd" class="studio-input" type="text" placeholder="npx, node, python, uvx..." />
            </div>
          </div>

          <div class="form-group">
            <label for="mcp-input-args">Arqumentlər (boşluqla ayrılmış)</label>
            <input id="mcp-input-args" class="studio-input" type="text" placeholder="-y @modelcontextprotocol/server-memory" />
          </div>

          <div class="form-group">
            <label for="mcp-input-env">Mühit Dəyişənləri — Env (isteğe bağlı JSON, məs: {"API_KEY":"..."})</label>
            <input id="mcp-input-env" class="studio-input" type="text" placeholder="{}" />
          </div>

          <div id="mcp-form-error" class="mcp-error-banner" style="display: none;"></div>
        </div>

        <div class="studio-modal-footer">
          <button type="button" id="btn-mcp-add" class="studio-btn studio-btn-primary">Serveri Yadda Saxla</button>
          <button type="button" id="btn-mcp-done" class="studio-btn">Bağla</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    this.overlayEl = overlay;

    const listEl = overlay.querySelector("#mcp-servers-list") as HTMLElement;
    const nameInput = overlay.querySelector("#mcp-input-name") as HTMLInputElement;
    const cmdInput = overlay.querySelector("#mcp-input-cmd") as HTMLInputElement;
    const argsInput = overlay.querySelector("#mcp-input-args") as HTMLInputElement;
    const envInput = overlay.querySelector("#mcp-input-env") as HTMLInputElement;
    const errEl = overlay.querySelector("#mcp-form-error") as HTMLElement;

    const showErr = (msg: string | null) => {
      if (!msg) {
        errEl.style.display = "none";
        errEl.textContent = "";
      } else {
        errEl.style.display = "block";
        errEl.textContent = msg;
      }
    };

    const renderList = async () => {
      const servers = await this.getServers();
      this.onServersUpdated?.(servers);

      if (servers.length === 0) {
        listEl.innerHTML = `<div class="bottom-empty">Heç bir MCP server əlavə edilməyib. Aşağıdan preset seçin və ya öz serverinizi daxil edin.</div>`;
        return;
      }

      listEl.innerHTML = "";
      for (const s of servers) {
        const card = document.createElement("div");
        card.className = "mcp-server-card";

        const statusClass =
          s.status === "connected"
            ? "is-local"
            : s.status === "error"
              ? "is-error"
              : "is-idle";
        const statusText =
          s.status === "connected"
            ? `Qoşulub (${s.tools.length} alət)`
            : s.status === "error"
              ? "Xəta"
              : "Bağlı";

        const toolsHtml =
          s.tools.length > 0
            ? `<div class="mcp-tools-pills">${s.tools
                .map((t) => `<span class="msg-file-pill" title="${this.escapeAttr(t.description)}">${this.escapeHtml(t.name)}</span>`)
                .join("")}</div>`
            : "";

        card.innerHTML = `
          <div class="mcp-card-top">
            <div class="mcp-card-info">
              <span class="mcp-card-name">${this.escapeHtml(s.config.name)}</span>
              <span class="mcp-status-pill ${statusClass}">${statusText}</span>
            </div>
            <div class="mcp-card-actions">
              ${
                s.status === "connected"
                  ? `<button type="button" class="studio-btn studio-btn-sm" data-disconnect="${this.escapeAttr(s.config.id)}">Ayır</button>`
                  : `<button type="button" class="studio-btn studio-btn-sm studio-btn-primary" data-connect="${this.escapeAttr(s.config.id)}">Qoşul</button>`
              }
              <button type="button" class="studio-btn studio-btn-sm studio-btn-danger" data-delete="${this.escapeAttr(s.config.id)}">Sil</button>
            </div>
          </div>
          <div class="mcp-card-cmd">${this.escapeHtml(s.config.command)} ${this.escapeHtml(s.config.args.join(" "))}</div>
          ${s.error ? `<div class="mcp-card-err">${this.escapeHtml(s.error)}</div>` : ""}
          ${toolsHtml}
        `;

        card.querySelector<HTMLButtonElement>("[data-connect]")?.addEventListener("click", async (e) => {
          const btn = e.currentTarget as HTMLButtonElement;
          btn.disabled = true;
          btn.textContent = "Qoşulur...";
          showErr(null);
          try {
            await invoke("mcp_connect_server", { id: s.config.id });
          } catch (err: any) {
            showErr(String(err));
          }
          await renderList();
        });

        card.querySelector<HTMLButtonElement>("[data-disconnect]")?.addEventListener("click", async () => {
          showErr(null);
          await invoke("mcp_disconnect_server", { id: s.config.id });
          await renderList();
        });

        card.querySelector<HTMLButtonElement>("[data-delete]")?.addEventListener("click", async () => {
          showErr(null);
          await invoke("mcp_delete_server", { id: s.config.id });
          await renderList();
        });

        listEl.appendChild(card);
      }
    };

    // Presets
    overlay.querySelector("#btn-mcp-preset-memory")?.addEventListener("click", () => {
      nameInput.value = "memory";
      cmdInput.value = "npx";
      argsInput.value = "-y @modelcontextprotocol/server-memory";
      envInput.value = "{}";
    });
    overlay.querySelector("#btn-mcp-preset-thinking")?.addEventListener("click", () => {
      nameInput.value = "sequential-thinking";
      cmdInput.value = "npx";
      argsInput.value = "-y @modelcontextprotocol/server-sequential-thinking";
      envInput.value = "{}";
    });
    overlay.querySelector("#btn-mcp-preset-fetch")?.addEventListener("click", () => {
      nameInput.value = "fetch";
      cmdInput.value = "uvx";
      argsInput.value = "mcp-server-fetch";
      envInput.value = "{}";
    });

    overlay.querySelector("#btn-mcp-add")?.addEventListener("click", async () => {
      showErr(null);
      const name = nameInput.value.trim();
      const command = cmdInput.value.trim();
      if (!name || !command) {
        showErr("Server adı və komanda mütləq doldurulmalıdır.");
        return;
      }

      let envObj: Record<string, string> = {};
      const envRaw = envInput.value.trim();
      if (envRaw) {
        try {
          const parsed = JSON.parse(envRaw);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            envObj = parsed;
          } else {
            showErr("Env sahəsi etibarlı JSON obyekti olmalıdır.");
            return;
          }
        } catch {
          showErr("Env sahəsində JSON sintaksis xətası var.");
          return;
        }
      }

      const args = argsInput.value
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      const id = name.toLowerCase().replace(/[^a-z0-9_-]/g, "-") || `mcp-${Date.now()}`;

      try {
        await invoke("mcp_save_server", {
          config: { id, name, command, args, env: envObj, enabled: true },
        });
        nameInput.value = "";
        cmdInput.value = "";
        argsInput.value = "";
        envInput.value = "";
        await renderList();
      } catch (err: any) {
        showErr(String(err));
      }
    });

    const closeModal = () => {
      overlay.classList.add("is-closing");
      this.overlayEl = null;
      setTimeout(() => overlay.remove(), 125);
    };

    overlay.querySelector("#btn-close-mcp-modal")?.addEventListener("click", closeModal);
    overlay.querySelector("#btn-mcp-done")?.addEventListener("click", closeModal);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal();
    });

    await renderList();
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  private escapeAttr(str: string): string {
    return this.escapeHtml(str).replace(/"/g, "&quot;");
  }
}
