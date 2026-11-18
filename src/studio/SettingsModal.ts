/**
 * SettingsModal.ts
 * Comprehensive Real Settings Section for Mintu Studio.
 * Tabs:
 * 1. Yerli Modellər (12-model GGUF catalog, ATTENTION confirmation before download, live progress, MANUAL Start/Stop + engine options + Ollama/LM Studio)
 * 2. Bulud API-lər (Gemini, Claude, OpenAI, DeepSeek, Groq, Qwen, Kimi, Custom + Windows Credential Manager)
 * 3. Redaktor və Görünüş (Live Font size, Tab size, Word wrap, Minimap, Auto-save, Smooth animations)
 * 4. Agent və Təhlükəsizlik (Max steps, Custom system prompt, Security summary, MCP shortcut)
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { CLOUD_PROVIDERS } from "../ai/cloudCatalog";
import { StudioAIClient } from "../ai/StudioAIClient";
import { detectLocalModels, DetectedLocalModel } from "../ai/LocalModelDetector";
import { LOCAL_MODELS_CATALOG, LocalModelCatalogItem } from "../ai/localModelsCatalog";
import { DEFAULT_PREFERENCES, studioSettings } from "./StudioSettings";
import { formatByteSize } from "./BottomPanel";
import { ICON_CLOSE } from "./icons";

export type SettingsTabId = "local" | "cloud" | "editor" | "agent";

interface HardwareInfo {
  total_ram_gb: number;
  cpu_cores: number;
  models_dir: string;
  free_disk_gb: number;
  llama_server_found: boolean;
  llama_server_path: string | null;
}

interface InstalledModelInfo {
  id: string;
  filename: string;
  path: string;
  size_bytes: number;
}

interface ModelDownloadProgress {
  model_id: string;
  downloaded_bytes: number;
  total_bytes: number;
  speed_mbps: number;
  status: "downloading" | "completed" | "cancelled" | "error";
  error: string | null;
}

export interface LocalServerStatus {
  running: boolean;
  model_id: string | null;
  model_path: string | null;
  port: number;
  base_url: string | null;
}

export class SettingsModal {
  private aiClient: StudioAIClient;
  private overlayEl: HTMLElement | null = null;
  private activeTab: SettingsTabId = "local";
  private catalogFilter: "all" | "coding" | "reasoning" | "general" | "installed" = "all";

  private hwInfo: HardwareInfo | null = null;
  private installedModels: InstalledModelInfo[] = [];
  private serverStatus: LocalServerStatus = {
    running: false,
    model_id: null,
    model_path: null,
    port: 8090,
    base_url: null,
  };
  private downloads: Map<string, ModelDownloadProgress> = new Map();
  private startingModelId: string | null = null;
  private statusMessage: { type: "info" | "error"; text: string } | null = null;
  private unlistenProgress: UnlistenFn | null = null;

  public onSettingsSaved?: () => void;
  public onOpenMcpRequested?: () => void;
  public onAuditLog?: (cat: "read" | "send" | "blocked" | "system", msg: string) => void;

  constructor(aiClient: StudioAIClient) {
    this.aiClient = aiClient;
    this.initDownloadListener();
  }

  private async initDownloadListener(): Promise<void> {
    try {
      this.unlistenProgress = await listen<ModelDownloadProgress>("studio-model-download-progress", (event) => {
        const p = event.payload;
        if (p.status === "downloading") {
          this.downloads.set(p.model_id, p);
          this.updateDownloadCardDom(p);
        } else {
          this.downloads.delete(p.model_id);
          if (p.status === "completed") {
            this.statusMessage = {
              type: "info",
              text: `"${p.model_id}" yükləndi. Model avtomatik işə düşməyib — başlatmaq üçün "İşə sal" düyməsinə basın.`,
            };
            this.onAuditLog?.("system", `Yerli model yükləndi (manual start gözləyir): ${p.model_id}`);
          } else if (p.status === "cancelled") {
            this.statusMessage = { type: "info", text: `"${p.model_id}" yüklənməsi ləğv edildi.` };
          } else if (p.status === "error") {
            this.statusMessage = { type: "error", text: `Yükləmə xətası (${p.model_id}): ${p.error || "Naməlum xəta"}` };
          }
          if (this.overlayEl && this.activeTab === "local") {
            this.refreshLocalDataAndRender();
          }
        }
      });
    } catch {}
  }

  public dispose(): void {
    if (this.unlistenProgress) {
      this.unlistenProgress();
      this.unlistenProgress = null;
    }
  }

  public async open(initialTab?: SettingsTabId): Promise<void> {
    if (initialTab) this.activeTab = initialTab;
    if (this.overlayEl) this.overlayEl.remove();

    const overlay = document.createElement("div");
    overlay.className = "studio-modal-overlay";
    overlay.id = "studio-settings-modal";

    overlay.innerHTML = `
      <div class="studio-modal studio-modal-settings">
        <div class="studio-modal-header">
          <span class="studio-modal-title">Mintu Studio Tənzimləmələri</span>
          <button type="button" id="btn-close-settings-modal" class="studio-btn-icon" title="Bağla">${ICON_CLOSE}</button>
        </div>

        <div class="settings-shell">
          <nav class="settings-nav" aria-label="Tənzimləmə bölmələri">
            <button type="button" class="settings-nav-item ${this.activeTab === "local" ? "active" : ""}" data-stab="local">Yerli Modellər</button>
            <button type="button" class="settings-nav-item ${this.activeTab === "cloud" ? "active" : ""}" data-stab="cloud">Bulud API-lər</button>
            <button type="button" class="settings-nav-item ${this.activeTab === "editor" ? "active" : ""}" data-stab="editor">Redaktor və Görünüş</button>
            <button type="button" class="settings-nav-item ${this.activeTab === "agent" ? "active" : ""}" data-stab="agent">Agent və Təhlükəsizlik</button>
          </nav>

          <div class="settings-content" id="settings-tab-content">
            <div class="bottom-empty">Yüklənir...</div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    this.overlayEl = overlay;

    const closeModal = () => {
      overlay.classList.add("is-closing");
      this.overlayEl = null;
      setTimeout(() => overlay.remove(), 125);
    };

    overlay.querySelector("#btn-close-settings-modal")?.addEventListener("click", closeModal);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal();
    });

    overlay.querySelectorAll<HTMLButtonElement>(".settings-nav-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.stab as SettingsTabId;
        if (!tab || tab === this.activeTab) return;
        this.activeTab = tab;
        overlay.querySelectorAll(".settings-nav-item").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        this.renderActiveTab();
      });
    });

    await this.renderActiveTab();
  }

  private async renderActiveTab(): Promise<void> {
    if (!this.overlayEl) return;
    if (this.activeTab === "local") {
      await this.refreshLocalDataAndRender();
    } else if (this.activeTab === "cloud") {
      await this.renderCloudTab();
    } else if (this.activeTab === "editor") {
      this.renderEditorTab();
    } else {
      this.renderAgentTab();
    }
  }

  // ==========================================
  // TAB 1: YERLİ MODELLƏR (Catalog + ATTENTION + Manual Start/Stop)
  // ==========================================

  private async refreshLocalDataAndRender(): Promise<void> {
    const prefs = studioSettings.get();
    try {
      this.hwInfo = await invoke<HardwareInfo>("llm_get_hardware_info", {
        modelsDir: prefs.modelsDir || null,
      });
      if (!prefs.modelsDir && this.hwInfo.models_dir) {
        studioSettings.update({ modelsDir: this.hwInfo.models_dir });
      }
      this.installedModels = await invoke<InstalledModelInfo[]>("llm_list_installed_models", {
        modelsDir: this.hwInfo.models_dir,
      });
      this.serverStatus = await invoke<LocalServerStatus>("llm_get_server_status");
    } catch (e: any) {
      this.statusMessage = { type: "error", text: `Məlumat oxunmadı: ${e}` };
    }
    this.renderLocalTab();
  }

  private renderLocalTab(): void {
    const container = this.overlayEl?.querySelector("#settings-tab-content") as HTMLElement | null;
    if (!container) return;

    const prefs = studioSettings.get();
    const hw = this.hwInfo;
    const installedMap = new Map<string, InstalledModelInfo>();
    for (const m of this.installedModels) {
      installedMap.set(m.id.toLowerCase(), m);
    }

    // Also include any custom .gguf files in modelsDir that are not in the built-in catalog
    const catalogIds = new Set(LOCAL_MODELS_CATALOG.map((c) => c.id.toLowerCase()));
    const customInstalled = this.installedModels.filter((m) => !catalogIds.has(m.id.toLowerCase()));

    const filteredCatalog = LOCAL_MODELS_CATALOG.filter((item) => {
      if (this.catalogFilter === "all") return true;
      if (this.catalogFilter === "installed") return installedMap.has(item.id.toLowerCase());
      return item.category === this.catalogFilter;
    });

    const serverBannerHtml = this.serverStatus.running
      ? `
        <div class="local-server-banner is-running">
          <div class="server-banner-left">
            <span class="dataflow-pill is-local"><span class="dataflow-dot"></span><span>İşləyir</span></span>
            <span class="server-banner-model">${this.escapeHtml(this.serverStatus.model_id || "")}</span>
            <span class="server-banner-url">${this.escapeHtml(this.serverStatus.base_url || "")}</span>
          </div>
          <button type="button" class="studio-btn studio-btn-sm studio-btn-danger" id="btn-stop-local-server">Dayandır</button>
        </div>
      `
      : `
        <div class="local-server-banner is-stopped">
          <div class="server-banner-left">
            <span class="server-stopped-dot"></span>
            <span class="server-banner-text">Daxili yerli server dayandırılıb. Model yükləndikdən sonra onu aşağıdan manual olaraq <strong>İşə sal</strong> düyməsi ilə başladın.</span>
          </div>
        </div>
      `;

    const llamaWarnHtml =
      hw && !hw.llama_server_found
        ? `<div class="mcp-error-banner">llama-server.exe tapılmadı. D:\\llama-cpu\\llama-server.exe mövcud olmalı və ya xarici Ollama/LM Studio istifadə edilməlidir.</div>`
        : "";

    const msgBannerHtml = this.statusMessage
      ? `<div class="${this.statusMessage.type === "error" ? "mcp-error-banner" : "form-hint"}">${this.escapeHtml(this.statusMessage.text)}</div>`
      : "";

    const catalogCardsHtml = filteredCatalog
      .map((item) => {
        const installed = installedMap.get(item.id.toLowerCase());
        const dl = this.downloads.get(item.id);
        const isRunningThis = this.serverStatus.running && this.serverStatus.model_id?.toLowerCase() === item.id.toLowerCase();
        const isStartingThis = this.startingModelId === item.id;

        let actionHtml = "";
        let progressHtml = "";

        if (dl && dl.status === "downloading") {
          const pct = dl.total_bytes > 0 ? Math.min(100, Math.round((dl.downloaded_bytes / dl.total_bytes) * 100)) : 0;
          progressHtml = `
            <div class="model-dl-progress" data-dl-box="${this.escapeAttr(item.id)}">
              <div class="model-dl-bar-track"><div class="model-dl-bar-fill" style="width: ${pct}%;"></div></div>
              <div class="model-dl-meta">${pct}% · ${formatByteSize(dl.downloaded_bytes)} / ${dl.total_bytes ? formatByteSize(dl.total_bytes) : item.sizeHuman} · ${dl.speed_mbps.toFixed(1)} MB/s</div>
            </div>
          `;
          actionHtml = `<button type="button" class="studio-btn studio-btn-sm studio-btn-danger" data-cancel-dl="${this.escapeAttr(item.id)}">Ləğv et</button>`;
        } else if (installed) {
          if (isRunningThis) {
            actionHtml = `
              <span class="dataflow-pill is-local"><span class="dataflow-dot"></span><span>Aktiv</span></span>
              <button type="button" class="studio-btn studio-btn-sm studio-btn-danger" data-stop-model="${this.escapeAttr(item.id)}">Dayandır</button>
            `;
          } else {
            actionHtml = `
              <button type="button" class="studio-btn studio-btn-sm studio-btn-primary" data-start-model="${this.escapeAttr(item.id)}" data-model-path="${this.escapeAttr(installed.path)}" ${isStartingThis ? "disabled" : ""}>
                ${isStartingThis ? "Başladılır..." : "İşə sal"}
              </button>
              <button type="button" class="studio-btn studio-btn-sm studio-btn-danger" data-delete-model="${this.escapeAttr(item.id)}" ${isStartingThis ? "disabled" : ""}>Sil</button>
            `;
          }
        } else {
          actionHtml = `<button type="button" class="studio-btn studio-btn-sm" data-download-model="${this.escapeAttr(item.id)}">Yüklə (${item.sizeHuman})</button>`;
        }

        const ramOk = !hw || hw.total_ram_gb >= item.minRamGb;

        return `
          <div class="local-model-card ${isRunningThis ? "is-active-card" : ""}">
            <div class="local-model-top">
              <div class="local-model-title-group">
                <span class="local-model-name">${this.escapeHtml(item.name)}</span>
                <span class="model-meta-pill">${this.escapeHtml(item.categoryLabel)}</span>
                <span class="model-meta-pill">${this.escapeHtml(item.params)}</span>
                <span class="model-meta-pill ${ramOk ? "" : "pill-warn"}">${item.minRamGb} GB RAM</span>
              </div>
              <div class="local-model-actions">${actionHtml}</div>
            </div>
            <div class="local-model-desc">${this.escapeHtml(item.description)}</div>
            ${progressHtml}
          </div>
        `;
      })
      .join("");

    const customCardsHtml =
      (this.catalogFilter === "all" || this.catalogFilter === "installed") && customInstalled.length > 0
        ? customInstalled
            .map((m) => {
              const isRunningThis = this.serverStatus.running && this.serverStatus.model_id?.toLowerCase() === m.id.toLowerCase();
              const isStartingThis = this.startingModelId === m.id;
              return `
                <div class="local-model-card ${isRunningThis ? "is-active-card" : ""}">
                  <div class="local-model-top">
                    <div class="local-model-title-group">
                      <span class="local-model-name">${this.escapeHtml(m.filename)}</span>
                      <span class="model-meta-pill">Xüsusi GGUF</span>
                      <span class="model-meta-pill">${formatByteSize(m.size_bytes)}</span>
                    </div>
                    <div class="local-model-actions">
                      ${
                        isRunningThis
                          ? `<span class="dataflow-pill is-local"><span class="dataflow-dot"></span><span>Aktiv</span></span>
                             <button type="button" class="studio-btn studio-btn-sm studio-btn-danger" data-stop-model="${this.escapeAttr(m.id)}">Dayandır</button>`
                          : `<button type="button" class="studio-btn studio-btn-sm studio-btn-primary" data-start-model="${this.escapeAttr(m.id)}" data-model-path="${this.escapeAttr(m.path)}" ${isStartingThis ? "disabled" : ""}>${isStartingThis ? "Başladılır..." : "İşə sal"}</button>
                             <button type="button" class="studio-btn studio-btn-sm studio-btn-danger" data-delete-model="${this.escapeAttr(m.id)}">Sil</button>`
                      }
                    </div>
                  </div>
                </div>
              `;
            })
            .join("")
        : "";

    container.innerHTML = `
      <div class="settings-pane tab-switch-enter">
        <div class="settings-hw-strip">
          <div class="hw-stat">Sistem: <strong>${hw ? `${hw.total_ram_gb} GB RAM · ${hw.cpu_cores} nüvə` : "..."}</strong></div>
          <div class="hw-stat">Disk: <strong>${hw ? `${hw.free_disk_gb} GB boş` : "..."}</strong></div>
          <div class="hw-dir-row">
            <span class="hw-dir-path" title="${this.escapeAttr(hw?.models_dir || prefs.modelsDir)}">${this.escapeHtml(hw?.models_dir || prefs.modelsDir || "D:\\Mintu-Models")}</span>
            <button type="button" class="studio-btn studio-btn-sm" id="btn-pick-models-dir">Qovluğu Dəyiş</button>
          </div>
        </div>

        ${serverBannerHtml}
        ${llamaWarnHtml}
        ${msgBannerHtml}

        <!-- Manual Engine Settings -->
        <div class="settings-card-block">
          <div class="settings-block-title">Yerli Mühərrik Seçimləri (llama-server · Manual İşə Salma Parametrləri)</div>
          <div class="settings-engine-grid">
            <div class="form-group">
              <label for="eng-ctx">Kontekst (Context Size)</label>
              <select id="eng-ctx" class="studio-input">
                <option value="2048" ${prefs.ctxSize === 2048 ? "selected" : ""}>2048 (Az RAM)</option>
                <option value="4096" ${prefs.ctxSize === 4096 ? "selected" : ""}>4096 (Standart)</option>
                <option value="8192" ${prefs.ctxSize === 8192 ? "selected" : ""}>8192 (Kodlaşdırma)</option>
                <option value="16384" ${prefs.ctxSize === 16384 ? "selected" : ""}>16384 (Geniş)</option>
              </select>
            </div>
            <div class="form-group">
              <label for="eng-threads">CPU Axınları (Threads)</label>
              <select id="eng-threads" class="studio-input">
                <option value="0" ${prefs.threads === 0 ? "selected" : ""}>Avtomatik</option>
                <option value="2" ${prefs.threads === 2 ? "selected" : ""}>2 axın</option>
                <option value="4" ${prefs.threads === 4 ? "selected" : ""}>4 axın</option>
                <option value="6" ${prefs.threads === 6 ? "selected" : ""}>6 axın</option>
                <option value="8" ${prefs.threads === 8 ? "selected" : ""}>8 axın</option>
                <option value="12" ${prefs.threads === 12 ? "selected" : ""}>12 axın</option>
              </select>
            </div>
            <div class="form-group">
              <label for="eng-gpu">GPU Qatları (-ngl)</label>
              <select id="eng-gpu" class="studio-input">
                <option value="0" ${prefs.gpuLayers === 0 ? "selected" : ""}>0 (Yalnız CPU)</option>
                <option value="16" ${prefs.gpuLayers === 16 ? "selected" : ""}>16 qat</option>
                <option value="32" ${prefs.gpuLayers === 32 ? "selected" : ""}>32 qat</option>
                <option value="99" ${prefs.gpuLayers === 99 ? "selected" : ""}>99 (Tam GPU)</option>
              </select>
            </div>
            <div class="form-group">
              <label for="eng-port">Port</label>
              <input id="eng-port" class="studio-input" type="number" min="1024" max="65535" value="${prefs.localPort}" />
            </div>
            <div class="form-group">
              <label for="eng-temp">Temperatur</label>
              <select id="eng-temp" class="studio-input">
                <option value="0.1" ${prefs.temperature === 0.1 ? "selected" : ""}>0.1 (Çox dəqiq)</option>
                <option value="0.2" ${prefs.temperature === 0.2 ? "selected" : ""}>0.2 (Kod üçün ideal)</option>
                <option value="0.5" ${prefs.temperature === 0.5 ? "selected" : ""}>0.5 (Balanslı)</option>
                <option value="0.8" ${prefs.temperature === 0.8 ? "selected" : ""}>0.8 (Yaradıcı)</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Model Catalog Filter + List -->
        <div class="catalog-header-row">
          <div class="settings-block-title">Yerli LLM Modelləri (${this.installedModels.length} yüklənib / ${LOCAL_MODELS_CATALOG.length} kataloq)</div>
          <div class="catalog-filters">
            <button type="button" class="catalog-filter-btn ${this.catalogFilter === "all" ? "active" : ""}" data-filter="all">Hamısı</button>
            <button type="button" class="catalog-filter-btn ${this.catalogFilter === "coding" ? "active" : ""}" data-filter="coding">Kodlaşdırma</button>
            <button type="button" class="catalog-filter-btn ${this.catalogFilter === "reasoning" ? "active" : ""}" data-filter="reasoning">Məntiq</button>
            <button type="button" class="catalog-filter-btn ${this.catalogFilter === "general" ? "active" : ""}" data-filter="general">Ümumi</button>
            <button type="button" class="catalog-filter-btn ${this.catalogFilter === "installed" ? "active" : ""}" data-filter="installed">Yüklənmişlər</button>
          </div>
        </div>

        <div class="local-models-list">
          ${catalogCardsHtml}${customCardsHtml || (filteredCatalog.length === 0 ? `<div class="bottom-empty">Bu filtr üzrə model tapılmadı.</div>` : "")}
        </div>

        <!-- Custom HuggingFace GGUF URL Download -->
        <div class="settings-card-block">
          <div class="settings-block-title">Xüsusi HuggingFace GGUF Linki ilə Yüklə</div>
          <div class="mcp-form-grid">
            <div class="form-group">
              <label for="custom-gguf-id">Model ID (fayl adı)</label>
              <input id="custom-gguf-id" class="studio-input" type="text" placeholder="məs: qwen2.5-coder-3b-custom" autocomplete="off" />
            </div>
            <div class="form-group">
              <label for="custom-gguf-url">Rəsmi HuggingFace .gguf URL</label>
              <div class="ext-model-apply-row">
                <input id="custom-gguf-url" class="studio-input" type="text" placeholder="https://huggingface.co/.../model.gguf" autocomplete="off" />
                <button type="button" class="studio-btn studio-btn-sm studio-btn-primary" id="btn-download-custom-gguf">Yüklə</button>
              </div>
            </div>
          </div>
          <div class="form-hint">Yalnız rəsmi https://huggingface.co/ linkləri qəbul olunur. Yükləmədən əvvəl DİQQƏT xəbərdarlığı göstərilir və model avtomatik işə düşmür.</div>
        </div>

        <!-- External Ollama / LM Studio Connect -->
        <div class="settings-card-block">
          <div class="key-status-row">
            <div class="settings-block-title">Xarici Yerli Server (Ollama / LM Studio)</div>
            <button type="button" class="studio-btn studio-btn-sm" id="btn-scan-external-local">Serverləri Axtar</button>
          </div>
          <div id="external-local-detected" class="detected-models-wrap"></div>
          <div class="mcp-form-grid">
            <div class="form-group">
              <label for="ext-local-url">Xarici Base URL</label>
              <input id="ext-local-url" class="studio-input" type="text" value="${this.escapeAttr(this.aiClient.getLocalBaseUrl())}" />
            </div>
            <div class="form-group">
              <label for="ext-local-model">Model Adı</label>
              <div class="ext-model-apply-row">
                <input id="ext-local-model" class="studio-input" type="text" value="${this.escapeAttr(this.aiClient.getLocalModel())}" />
                <button type="button" class="studio-btn studio-btn-sm" id="btn-apply-ext-local">Qoş</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Engine parameter listeners (instant save)
    const bindEngineSave = () => {
      const ctx = Number((container.querySelector("#eng-ctx") as HTMLSelectElement)?.value || 4096);
      const threads = Number((container.querySelector("#eng-threads") as HTMLSelectElement)?.value || 0);
      const gpuLayers = Number((container.querySelector("#eng-gpu") as HTMLSelectElement)?.value || 0);
      const localPort = Number((container.querySelector("#eng-port") as HTMLInputElement)?.value || 8090);
      const temperature = Number((container.querySelector("#eng-temp") as HTMLSelectElement)?.value || 0.2);
      studioSettings.update({ ctxSize: ctx, threads, gpuLayers, localPort, temperature });
    };
    ["#eng-ctx", "#eng-threads", "#eng-gpu", "#eng-port", "#eng-temp"].forEach((sel) => {
      container.querySelector(sel)?.addEventListener("change", bindEngineSave);
    });

    // Pick models folder
    container.querySelector("#btn-pick-models-dir")?.addEventListener("click", async () => {
      const chosen = await invoke<string | null>("llm_pick_models_dir");
      if (chosen) {
        studioSettings.update({ modelsDir: chosen });
        await this.refreshLocalDataAndRender();
      }
    });

    // Stop running server
    const stopServer = async () => {
      await invoke("llm_stop_server");
      this.statusMessage = { type: "info", text: "Yerli model serveri dayandırıldı." };
      this.onAuditLog?.("system", "Yerli model serveri dayandırıldı");
      await this.refreshLocalDataAndRender();
      this.onSettingsSaved?.();
    };
    container.querySelector("#btn-stop-local-server")?.addEventListener("click", stopServer);
    container.querySelectorAll<HTMLButtonElement>("[data-stop-model]").forEach((btn) => {
      btn.addEventListener("click", stopServer);
    });

    // Filter buttons
    container.querySelectorAll<HTMLButtonElement>(".catalog-filter-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.catalogFilter = btn.dataset.filter as any;
        this.renderLocalTab();
      });
    });

    // Download button -> MUST show ATTENTION confirmation modal first!
    container.querySelectorAll<HTMLButtonElement>("[data-download-model]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.downloadModel;
        const item = LOCAL_MODELS_CATALOG.find((m) => m.id === id);
        if (item) this.openDownloadAttentionDialog(item);
      });
    });

    // Cancel download button
    container.querySelectorAll<HTMLButtonElement>("[data-cancel-dl]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.cancelDl;
        if (id) await invoke("llm_cancel_download", { modelId: id });
      });
    });

    // Manual Start Model button
    container.querySelectorAll<HTMLButtonElement>("[data-start-model]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.startModel;
        const path = btn.dataset.modelPath;
        if (!id || !path) return;

        bindEngineSave();
        const curPrefs = studioSettings.get();
        this.startingModelId = id;
        this.statusMessage = { type: "info", text: `"${id}" manual olaraq işə salınır (bu 5–15 saniyə çəkə bilər)...` };
        this.renderLocalTab();

        try {
          const status = await invoke<LocalServerStatus>("llm_start_server", {
            options: {
              model_id: id,
              model_path: path,
              port: curPrefs.localPort || 8090,
              ctx_size: curPrefs.ctxSize || 4096,
              threads: curPrefs.threads || 0,
              gpu_layers: curPrefs.gpuLayers || 0,
            },
          });

          this.serverStatus = status;
          if (status.port) {
            studioSettings.update({ localPort: status.port });
          }
          this.aiClient.setActiveProvider("local");
          if (status.base_url) this.aiClient.setLocalBaseUrl(status.base_url);
          this.aiClient.setLocalModel(id);
          this.statusMessage = {
            type: "info",
            text: `"${id}" uğurla işə düşdü (port ${status.port}) və Mintu AI üçün avtomatik aktiv edildi.`,
          };
          this.onAuditLog?.("system", `Yerli model manual işə salındı: ${id}`);
          this.onSettingsSaved?.();
        } catch (err: any) {
          this.statusMessage = { type: "error", text: String(err) };
        } finally {
          this.startingModelId = null;
          await this.refreshLocalDataAndRender();
        }
      });
    });

    // Delete installed model
    container.querySelectorAll<HTMLButtonElement>("[data-delete-model]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.deleteModel;
        if (!id) return;
        try {
          await invoke("llm_delete_model", {
            modelId: id,
            modelsDir: this.hwInfo?.models_dir || prefs.modelsDir || null,
          });
          this.statusMessage = { type: "info", text: `"${id}" diskdən silindi.` };
          await this.refreshLocalDataAndRender();
        } catch (err: any) {
          this.statusMessage = { type: "error", text: String(err) };
          this.renderLocalTab();
        }
      });
    });

    // Custom HuggingFace GGUF URL download -> still shows ATTENTION dialog!
    container.querySelector("#btn-download-custom-gguf")?.addEventListener("click", () => {
      const idIn = container.querySelector("#custom-gguf-id") as HTMLInputElement | null;
      const urlIn = container.querySelector("#custom-gguf-url") as HTMLInputElement | null;
      const url = (urlIn?.value || "").trim();
      if (!url.startsWith("https://huggingface.co/") || !url.toLowerCase().includes(".gguf")) {
        this.statusMessage = {
          type: "error",
          text: "Zəhmət olmasa rəsmi https://huggingface.co/ .gguf linki daxil edin.",
        };
        this.renderLocalTab();
        return;
      }
      const rawId = (idIn?.value || "").trim() || url.split("/").pop()?.replace(/\.gguf(\?.*)?$/i, "") || "custom-model";
      const safeId = rawId.replace(/[^a-zA-Z0-9._-]/g, "-");
      const customItem: LocalModelCatalogItem = {
        id: safeId,
        name: safeId,
        category: "general",
        categoryLabel: "Xüsusi GGUF",
        params: "Custom GGUF",
        sizeHuman: "Dəyişkən",
        sizeGb: 2.5,
        minRamGb: 6,
        recommendedCtx: 4096,
        description: "İstifadəçi tərəfindən HuggingFace linki ilə əlavə edilən yerli GGUF model.",
        url,
      };
      this.openDownloadAttentionDialog(customItem);
    });

    // External Ollama/LM Studio scan & connect
    const extWrap = container.querySelector("#external-local-detected") as HTMLElement;
    const extUrl = container.querySelector("#ext-local-url") as HTMLInputElement;
    const extModel = container.querySelector("#ext-local-model") as HTMLInputElement;

    container.querySelector("#btn-scan-external-local")?.addEventListener("click", async () => {
      extWrap.innerHTML = `<span class="bottom-empty">Ollama / LM Studio yoxlanılır...</span>`;
      const found: DetectedLocalModel[] = await detectLocalModels(extUrl.value);
      if (found.length === 0) {
        extWrap.innerHTML = `<span class="bottom-empty">İşləyən xarici server tapılmadı.</span>`;
        return;
      }
      extWrap.innerHTML = "";
      for (const m of found) {
        const pill = document.createElement("button");
        pill.type = "button";
        pill.className = "studio-btn studio-btn-sm detected-model-pill";
        pill.textContent = m.label;
        pill.addEventListener("click", () => {
          extUrl.value = m.baseUrl;
          extModel.value = m.id;
        });
        extWrap.appendChild(pill);
      }
    });

    container.querySelector("#btn-apply-ext-local")?.addEventListener("click", () => {
      this.aiClient.setActiveProvider("local");
      this.aiClient.setLocalBaseUrl(extUrl.value);
      this.aiClient.setLocalModel(extModel.value);
      this.statusMessage = { type: "info", text: `Xarici yerli server seçildi: ${extModel.value} (${extUrl.value})` };
      this.onSettingsSaved?.();
      this.renderLocalTab();
    });
  }

  /**
   * Prominent ATTENTION Warning Modal shown BEFORE downloading any local LLM.
   */
  private openDownloadAttentionDialog(item: LocalModelCatalogItem): void {
    const hw = this.hwInfo;
    const lowRam = hw ? hw.total_ram_gb < item.minRamGb : false;
    const lowDisk = hw ? hw.free_disk_gb < item.sizeGb + 1.0 : false;
    const targetDir = hw?.models_dir || studioSettings.get().modelsDir || "D:\\Mintu-Models";

    const dialogOverlay = document.createElement("div");
    dialogOverlay.className = "studio-modal-overlay";
    dialogOverlay.style.zIndex = "2200";

    dialogOverlay.innerHTML = `
      <div class="studio-modal attention-modal">
        <div class="studio-modal-header attention-header">
          <div class="attention-title-wrap">
            <span class="attention-badge">DİQQƏT / ATTENTION</span>
            <span class="studio-modal-title">Model Yükləmə Xəbərdarlığı</span>
          </div>
          <button type="button" class="studio-btn-icon" id="btn-att-close" title="Bağla">${ICON_CLOSE}</button>
        </div>

        <div class="studio-modal-body">
          <div class="attention-lead">
            <strong>${this.escapeHtml(item.name)}</strong> (${this.escapeHtml(item.params)}) modelini kompüterinizə yükləmək üzrəsiniz. Davam etməzdən əvvəl aşağıdakı detalları yoxlayın:
          </div>

          <div class="attention-facts">
            <div class="attention-fact-row">
              <span class="fact-key">Fayl ölçüsü (İnternet trafiki):</span>
              <span class="fact-val">${this.escapeHtml(item.sizeHuman)}</span>
            </div>
            <div class="attention-fact-row">
              <span class="fact-key">Yadda saxlanılacaq qovluq:</span>
              <span class="fact-val">${this.escapeHtml(targetDir)}</span>
            </div>
            <div class="attention-fact-row">
              <span class="fact-key">Diskdəki boş yer:</span>
              <span class="fact-val ${lowDisk ? "fact-danger" : ""}">${hw ? `${hw.free_disk_gb} GB boş` : "Yoxlanılır"}</span>
            </div>
            <div class="attention-fact-row">
              <span class="fact-key">Tələb olunan RAM:</span>
              <span class="fact-val ${lowRam ? "fact-danger" : ""}">${item.minRamGb} GB RAM (Sizin PC: ${hw ? `${hw.total_ram_gb} GB` : "?"})</span>
            </div>
          </div>

          ${
            lowRam
              ? `<div class="mcp-error-banner">DİQQƏT: Kompüterinizin RAM-ı (${hw?.total_ram_gb} GB) bu modelin minimum tələbindən (${item.minRamGb} GB) azdır. Model yavaş işləyə və ya yaddaş xətası verə bilər.</div>`
              : ""
          }
          ${
            lowDisk
              ? `<div class="mcp-error-banner">DİQQƏT: Seçilmiş diskdə kifayət qədər boş yer (${hw?.free_disk_gb} GB) olmaya bilər.</div>`
              : ""
          }

          <div class="form-hint form-hint-warning">
            <strong>Manual İşə Salma Qaydası:</strong> Model yükləndikdən sonra <strong>avtomatik işə düşməyəcək</strong>. RAM və CPU resurslarına tam nəzarət etməyiniz üçün yükləmə bitdikdən sonra modeli <strong>"İşə sal"</strong> düyməsi ilə özünüz manual başlatmalısınız.
          </div>
        </div>

        <div class="studio-modal-footer">
          <button type="button" class="studio-btn" id="btn-att-cancel">Ləğv et</button>
          <button type="button" class="studio-btn studio-btn-primary" id="btn-att-confirm">Başa düşdüm, Yüklə (${this.escapeHtml(item.sizeHuman)})</button>
        </div>
      </div>
    `;

    document.body.appendChild(dialogOverlay);

    const closeAttention = () => {
      dialogOverlay.classList.add("is-closing");
      setTimeout(() => dialogOverlay.remove(), 125);
    };

    dialogOverlay.querySelector("#btn-att-close")?.addEventListener("click", closeAttention);
    dialogOverlay.querySelector("#btn-att-cancel")?.addEventListener("click", closeAttention);
    dialogOverlay.addEventListener("click", (e) => {
      if (e.target === dialogOverlay) closeAttention();
    });

    dialogOverlay.querySelector("#btn-att-confirm")?.addEventListener("click", () => {
      closeAttention();
      this.startModelDownload(item, targetDir);
    });
  }

  private startModelDownload(item: LocalModelCatalogItem, modelsDir: string): void {
    this.downloads.set(item.id, {
      model_id: item.id,
      downloaded_bytes: 0,
      total_bytes: 0,
      speed_mbps: 0,
      status: "downloading",
      error: null,
    });
    this.statusMessage = { type: "info", text: `"${item.name}" yüklənir...` };
    this.onAuditLog?.("system", `Model yüklənməsi başladı: ${item.name} (${item.sizeHuman})`);
    this.renderLocalTab();

    invoke("llm_download_model", {
      modelId: item.id,
      url: item.url,
      modelsDir,
    }).catch((err) => {
      this.downloads.delete(item.id);
      this.statusMessage = { type: "error", text: String(err) };
      if (this.overlayEl && this.activeTab === "local") {
        this.renderLocalTab();
      }
    });
  }

  private updateDownloadCardDom(p: ModelDownloadProgress): void {
    if (!this.overlayEl || this.activeTab !== "local") return;
    const box = this.overlayEl.querySelector<HTMLElement>(`[data-dl-box="${p.model_id}"]`);
    if (!box) {
      this.renderLocalTab();
      return;
    }
    const pct = p.total_bytes > 0 ? Math.min(100, Math.round((p.downloaded_bytes / p.total_bytes) * 100)) : 0;
    const fill = box.querySelector<HTMLElement>(".model-dl-bar-fill");
    const meta = box.querySelector<HTMLElement>(".model-dl-meta");
    if (fill) fill.style.width = `${pct}%`;
    if (meta) {
      meta.textContent = `${pct}% · ${formatByteSize(p.downloaded_bytes)} / ${p.total_bytes ? formatByteSize(p.total_bytes) : "..."} · ${p.speed_mbps.toFixed(1)} MB/s`;
    }
  }

  // ==========================================
  // TAB 2: BULUD API-LƏR
  // ==========================================

  private async renderCloudTab(): Promise<void> {
    const container = this.overlayEl?.querySelector("#settings-tab-content") as HTMLElement | null;
    if (!container) return;

    const activeProv = this.aiClient.getActiveProvider();
    const initialCloud = activeProv !== "local" && CLOUD_PROVIDERS[activeProv] ? activeProv : "gemini";

    const optionsHtml = Object.values(CLOUD_PROVIDERS)
      .map((p) => `<option value="${p.id}" ${p.id === initialCloud ? "selected" : ""}>${p.name}</option>`)
      .join("");

    container.innerHTML = `
      <div class="settings-pane tab-switch-enter">
        <div class="settings-card-block">
          <div class="settings-block-title">Bulud AI Provayderi və Şifrəli API Açarı</div>

          <div class="form-group">
            <label for="cloud-prov-select">Provayder</label>
            <select id="cloud-prov-select" class="studio-input">${optionsHtml}</select>
          </div>

          <div class="form-group">
            <label for="cloud-model-input">Model Adı</label>
            <input id="cloud-model-input" class="studio-input" list="cloud-models-datalist" type="text" />
            <datalist id="cloud-models-datalist"></datalist>
          </div>

          <div class="form-group">
            <label for="cloud-url-input">Base URL</label>
            <input id="cloud-url-input" class="studio-input" type="text" />
          </div>

          <div class="form-group">
            <label for="cloud-key-input">API Açarı (Windows Credential Manager-də saxlanılır)</label>
            <div class="key-status-row">
              <span id="cloud-key-badge" class="key-status-badge">Yoxlanılır...</span>
              <button type="button" id="btn-cloud-del-key" class="studio-btn studio-btn-sm studio-btn-danger" style="display: none;">Açarı Sil</button>
            </div>
            <input id="cloud-key-input" class="studio-input" type="password" placeholder="Yeni API açarı daxil edin..." autocomplete="off" />
          </div>

          <div class="form-hint form-hint-warning">
            Bulud provayderi aktiv olduqda qoşulan fayllar həmin serverə göndərilir və interfeysdə narıncı "Bulud: &lt;provider&gt;" nişanı yanır. Həssas fayllar (.env, .key) Rust tərəfindən heç vaxt göndərilmir.
          </div>

          <div class="settings-inline-actions">
            <button type="button" id="btn-save-cloud-only" class="studio-btn">Yalnız Açar/Modeli Saxla</button>
            <button type="button" id="btn-activate-cloud" class="studio-btn studio-btn-primary">Saxla və Bu Provayderi Aktiv Et</button>
          </div>
          <div id="cloud-save-feedback" class="form-hint" style="display: none;"></div>
        </div>
      </div>
    `;

    const sel = container.querySelector("#cloud-prov-select") as HTMLSelectElement;
    const modelIn = container.querySelector("#cloud-model-input") as HTMLInputElement;
    const datalist = container.querySelector("#cloud-models-datalist") as HTMLDataListElement;
    const urlIn = container.querySelector("#cloud-url-input") as HTMLInputElement;
    const keyIn = container.querySelector("#cloud-key-input") as HTMLInputElement;
    const badge = container.querySelector("#cloud-key-badge") as HTMLElement;
    const delBtn = container.querySelector("#btn-cloud-del-key") as HTMLButtonElement;
    const feedback = container.querySelector("#cloud-save-feedback") as HTMLElement;

    const loadProv = async () => {
      const prov = sel.value;
      const cfg = CLOUD_PROVIDERS[prov];
      modelIn.value = this.aiClient.getCloudModel(prov);
      urlIn.value = this.aiClient.getCloudBaseUrl(prov);
      keyIn.value = "";
      datalist.innerHTML = (cfg?.models || []).map((m) => `<option value="${m}"></option>`).join("");

      const status = await this.aiClient.getKeyStatus(prov);
      if (status.has_key) {
        badge.textContent = `Saxlanılıb: ${status.masked || "••••"}`;
        badge.className = "key-status-badge status-ok";
        delBtn.style.display = "inline-flex";
      } else {
        badge.textContent = "Açar əlavə edilməyib";
        badge.className = "key-status-badge status-missing";
        delBtn.style.display = "none";
      }
    };

    const persistCloud = async (activate: boolean) => {
      const prov = sel.value;
      this.aiClient.setCloudModel(prov, modelIn.value);
      this.aiClient.setCloudBaseUrl(prov, urlIn.value);
      if (keyIn.value.trim()) {
        await this.aiClient.storeApiKey(prov, keyIn.value.trim());
      }
      if (activate) {
        this.aiClient.setActiveProvider(prov);
      }
      await loadProv();
      feedback.style.display = "block";
      feedback.textContent = activate
        ? `${CLOUD_PROVIDERS[prov]?.name || prov} yadda saxlanıldı və aktiv edildi.`
        : `${CLOUD_PROVIDERS[prov]?.name || prov} parametrləri yadda saxlanıldı.`;
      this.onSettingsSaved?.();
    };

    sel.addEventListener("change", () => loadProv());
    delBtn.addEventListener("click", async () => {
      await this.aiClient.deleteApiKey(sel.value);
      await loadProv();
    });
    container.querySelector("#btn-save-cloud-only")?.addEventListener("click", () => persistCloud(false));
    container.querySelector("#btn-activate-cloud")?.addEventListener("click", () => persistCloud(true));

    await loadProv();
  }

  // ==========================================
  // TAB 3: REDAKTOR VƏ GÖRÜNÜŞ (Live Settings)
  // ==========================================

  private renderEditorTab(): void {
    const container = this.overlayEl?.querySelector("#settings-tab-content") as HTMLElement | null;
    if (!container) return;

    const prefs = studioSettings.get();

    container.innerHTML = `
      <div class="settings-pane tab-switch-enter">
        <div class="settings-card-block">
          <div class="settings-block-title">Kod Redaktoru və İnterfeys (Dəyişikliklər dərhal tətbiq olunur)</div>

          <div class="settings-toggle-row">
            <div class="toggle-meta">
              <div class="toggle-title">İnterfeys Dili (Language)</div>
              <div class="toggle-desc">Mintu Studio menyuları və başlıqlarının dili.</div>
            </div>
            <select id="pref-language" class="studio-input settings-compact-control">
              <option value="az" ${prefs.language === "az" ? "selected" : ""}>Azərbaycan</option>
              <option value="en" ${prefs.language === "en" ? "selected" : ""}>English</option>
              <option value="tr" ${prefs.language === "tr" ? "selected" : ""}>Türkçe</option>
              <option value="ru" ${prefs.language === "ru" ? "selected" : ""}>Русский</option>
            </select>
          </div>

          <div class="settings-toggle-row">
            <div class="toggle-meta">
              <div class="toggle-title">Şrift Ölçüsü (Font Size)</div>
              <div class="toggle-desc">CodeMirror kod redaktorunun yazı ölçüsü (11px – 18px).</div>
            </div>
            <select id="pref-font-size" class="studio-input settings-compact-control">
              ${[11, 12, 13, 14, 15, 16, 18]
                .map((n) => `<option value="${n}" ${prefs.fontSize === n ? "selected" : ""}>${n}px</option>`)
                .join("")}
            </select>
          </div>

          <div class="settings-toggle-row">
            <div class="toggle-meta">
              <div class="toggle-title">Tab Ölçüsü (Indent)</div>
              <div class="toggle-desc">Boşluq sayı (2 və ya 4).</div>
            </div>
            <select id="pref-tab-size" class="studio-input settings-compact-control">
              <option value="2" ${prefs.tabSize === 2 ? "selected" : ""}>2 boşluq</option>
              <option value="4" ${prefs.tabSize === 4 ? "selected" : ""}>4 boşluq</option>
            </select>
          </div>

          <div class="settings-toggle-row">
            <div class="toggle-meta">
              <div class="toggle-title">Sətir Bükmə (Word Wrap)</div>
              <div class="toggle-desc">Uzun kod sətirlərini ekrana sığdırır.</div>
            </div>
            <label class="studio-switch">
              <input type="checkbox" id="pref-word-wrap" ${prefs.wordWrap ? "checked" : ""} />
              <span class="studio-switch-track"></span>
            </label>
          </div>

          <div class="settings-toggle-row">
            <div class="toggle-meta">
              <div class="toggle-title">Kod Minimap-ı Göstər</div>
              <div class="toggle-desc">Redaktorun sağ kənarında sürətli baxış xəritəsi.</div>
            </div>
            <label class="studio-switch">
              <input type="checkbox" id="pref-show-minimap" ${prefs.showMinimap ? "checked" : ""} />
              <span class="studio-switch-track"></span>
            </label>
          </div>

          <div class="settings-toggle-row">
            <div class="toggle-meta">
              <div class="toggle-title">Avtomatik Yadda Saxlama (Auto-Save)</div>
              <div class="toggle-desc">Redaktədən 1.5 saniyə sonra faylı avtomatik diskə yazır.</div>
            </div>
            <label class="studio-switch">
              <input type="checkbox" id="pref-auto-save" ${prefs.autoSave ? "checked" : ""} />
              <span class="studio-switch-track"></span>
            </label>
          </div>

          <div class="settings-toggle-row">
            <div class="toggle-meta">
              <div class="toggle-title">Hamar İnterfeys Animasiyaları</div>
              <div class="toggle-desc">Səhifə, tab, panel və modal keçid animasiyaları.</div>
            </div>
            <label class="studio-switch">
              <input type="checkbox" id="pref-smooth-anim" ${prefs.smoothAnimations ? "checked" : ""} />
              <span class="studio-switch-track"></span>
            </label>
          </div>
        </div>
      </div>
    `;

    container.querySelector("#pref-language")?.addEventListener("change", (e) => {
      studioSettings.update({ language: (e.target as HTMLSelectElement).value as any });
    });
    container.querySelector("#pref-font-size")?.addEventListener("change", (e) => {
      studioSettings.update({ fontSize: Number((e.target as HTMLSelectElement).value) });
    });
    container.querySelector("#pref-tab-size")?.addEventListener("change", (e) => {
      studioSettings.update({ tabSize: Number((e.target as HTMLSelectElement).value) });
    });
    container.querySelector("#pref-word-wrap")?.addEventListener("change", (e) => {
      studioSettings.update({ wordWrap: (e.target as HTMLInputElement).checked });
    });
    container.querySelector("#pref-show-minimap")?.addEventListener("change", (e) => {
      studioSettings.update({ showMinimap: (e.target as HTMLInputElement).checked });
    });
    container.querySelector("#pref-auto-save")?.addEventListener("change", (e) => {
      studioSettings.update({ autoSave: (e.target as HTMLInputElement).checked });
    });
    container.querySelector("#pref-smooth-anim")?.addEventListener("change", (e) => {
      studioSettings.update({ smoothAnimations: (e.target as HTMLInputElement).checked });
    });
  }

  // ==========================================
  // TAB 4: AGENT VƏ TƏHLÜKƏSİZLİK
  // ==========================================

  private renderAgentTab(): void {
    const container = this.overlayEl?.querySelector("#settings-tab-content") as HTMLElement | null;
    if (!container) return;

    const prefs = studioSettings.get();

    container.innerHTML = `
      <div class="settings-pane tab-switch-enter">
        <div class="settings-card-block">
          <div class="settings-block-title">Mintu AI Agent Davranışı</div>

          <div class="settings-toggle-row">
            <div class="toggle-meta">
              <div class="toggle-title">Maksimum Agent Addımları</div>
              <div class="toggle-desc">Bir sorğu ərzində agentin icra edə biləcəyi avtomatik oxuma/axtarış dövrü sayı.</div>
            </div>
            <select id="pref-max-steps" class="studio-input settings-compact-control">
              <option value="3" ${prefs.maxAgentSteps === 3 ? "selected" : ""}>3 addım</option>
              <option value="5" ${prefs.maxAgentSteps === 5 ? "selected" : ""}>5 addım</option>
              <option value="8" ${prefs.maxAgentSteps === 8 ? "selected" : ""}>8 addım</option>
            </select>
          </div>

          <div class="form-group">
            <label for="pref-sys-prompt">Əlavə Sistem Təlimatı (İsteğe bağlı)</label>
            <textarea id="pref-sys-prompt" class="studio-input" rows="4" placeholder="Məs: Həmişə TypeScript strict tipləri ilə yaz, qısa izah ver...">${this.escapeHtml(prefs.customSystemPrompt)}</textarea>
            <div class="settings-inline-actions">
              <button type="button" class="studio-btn studio-btn-sm" id="btn-reset-sys-prompt">Təmizlə</button>
              <button type="button" class="studio-btn studio-btn-sm studio-btn-primary" id="btn-save-sys-prompt">Yadda saxla</button>
            </div>
          </div>
        </div>

        <div class="settings-card-block">
          <div class="settings-block-title">Rust Səviyyəsində Aktiv Təhlükəsizlik Zəmanətləri</div>
          <div class="security-checklist">
            <div class="security-item">Həssas fayllar (.env*, *.pem, *.key, id_rsa*, .ssh, secret/password/credential) Rust tərəfindən oxuma, yazma və axtarışdan tam bloklanır.</div>
            <div class="security-item">Bütün kod dəyişiklikləri əvvəlcə Diff önizləməsi ilə göstərilir — yalnız "Tətbiq et" sıxıldıqda fayla yazılır.</div>
            <div class="security-item">Komandalar və MCP alətləri heç vaxt özbaşına işləmir — hər biri "İcra et" təsdiqi tələb edir.</div>
            <div class="security-item">Bütün fayl məzmunları prompt injection qoruması üçün &lt;untrusted_data&gt; zərfinə bükülür.</div>
          </div>
          <div class="settings-inline-actions">
            <button type="button" class="studio-btn studio-btn-sm" id="btn-open-mcp-from-settings">MCP Serverləri İdarə Et</button>
          </div>
        </div>
      </div>
    `;

    container.querySelector("#pref-max-steps")?.addEventListener("change", (e) => {
      studioSettings.update({ maxAgentSteps: Number((e.target as HTMLSelectElement).value) });
    });

    const promptArea = container.querySelector("#pref-sys-prompt") as HTMLTextAreaElement;
    container.querySelector("#btn-reset-sys-prompt")?.addEventListener("click", () => {
      promptArea.value = "";
      studioSettings.update({ customSystemPrompt: DEFAULT_PREFERENCES.customSystemPrompt });
    });
    container.querySelector("#btn-save-sys-prompt")?.addEventListener("click", () => {
      studioSettings.update({ customSystemPrompt: promptArea.value.trim() });
      this.onSettingsSaved?.();
    });

    container.querySelector("#btn-open-mcp-from-settings")?.addEventListener("click", () => {
      if (this.overlayEl) {
        this.overlayEl.remove();
        this.overlayEl = null;
      }
      this.onOpenMcpRequested?.();
    });
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  private escapeAttr(str: string): string {
    return this.escapeHtml(str).replace(/"/g, "&quot;");
  }
}
