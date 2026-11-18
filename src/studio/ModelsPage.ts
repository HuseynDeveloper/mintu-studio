/**
 * ModelsPage.ts
 * Dedicated full-screen workspace page for Local LLM Models (GGUF download + manual start/stop)
 * and Cloud AI Providers (API keys in Windows Credential Manager, Base URL repair, live Test Connection).
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { StudioAIClient } from "../ai/StudioAIClient";
import {
  CLOUD_PROVIDERS,
  deleteCustomCloudProvider,
  getAllCloudProviders,
  saveCustomCloudProvider,
} from "../ai/cloudCatalog";
import { detectLocalModels, DetectedLocalModel } from "../ai/LocalModelDetector";
import { LOCAL_MODELS_CATALOG, LocalModelCatalogItem, ModelCategory } from "../ai/localModelsCatalog";
import { formatByteSize } from "./BottomPanel";
import { ICON_CLOSE } from "./icons";
import { studioSettings } from "./StudioSettings";
import { t } from "./i18n";

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

interface LocalServerStatus {
  running: boolean;
  model_id: string | null;
  model_path: string | null;
  port: number;
  base_url: string | null;
}

interface CloudTestResult {
  ok: boolean;
  message: string;
  resolved_base_url: string;
  resolved_model: string;
}

export type ModelsSubTab = "local" | "cloud";

export class ModelsPage {
  private container: HTMLElement;
  private aiClient: StudioAIClient;
  private activeSubTab: ModelsSubTab = "local";
  private catalogFilter: "all" | "installed" | ModelCategory = "all";
  private selectedCloudProv = "gemini";
  private showAddCustomCloud = false;

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
  private cloudFeedback: { type: "info" | "error"; text: string } | null = null;
  private cloudKeyMap: Map<string, { has_key: boolean; masked: string | null }> = new Map();
  private unlistenProgress: UnlistenFn | null = null;
  private visible = false;

  public onBackToWorkspace?: () => void;
  public onSettingsSaved?: () => void;
  public onAuditLog?: (category: "read" | "send" | "blocked" | "system", msg: string) => void;

  constructor(container: HTMLElement, aiClient: StudioAIClient) {
    this.container = container;
    this.aiClient = aiClient;
    this.setupDownloadListener();
  }

  private async setupDownloadListener(): Promise<void> {
    try {
      this.unlistenProgress = await listen<ModelDownloadProgress>("studio-model-download-progress", (ev) => {
        const p = ev.payload;
        this.downloads.set(p.model_id, p);

        if (p.status === "completed") {
          this.downloads.delete(p.model_id);
          this.statusMessage = {
            type: "info",
            text: `"${p.model_id}" yükləndi. Avtomatik işə düşmür — istifadə etmək üçün "İşə sal" düyməsini sıxın.`,
          };
          this.onAuditLog?.("system", `Yerli model yükləndi (manual gözləyir): ${p.model_id}`);
          if (this.visible && this.activeSubTab === "local") {
            void this.refreshLocalAndRender();
          }
          return;
        }

        if (p.status === "cancelled" || p.status === "error") {
          this.downloads.delete(p.model_id);
          this.statusMessage = {
            type: p.status === "error" ? "error" : "info",
            text: p.error || `"${p.model_id}" yükləməsi ləğv edildi.`,
          };
          if (this.visible && this.activeSubTab === "local") {
            this.renderLocalView();
          }
          return;
        }

        if (this.visible && this.activeSubTab === "local") {
          this.updateDownloadCardDom(p);
        }
      });
    } catch {
      // ignore outside Tauri
    }
  }

  public async show(subTab: ModelsSubTab = "local"): Promise<void> {
    this.visible = true;
    this.activeSubTab = subTab;
    this.statusMessage = null;
    this.cloudFeedback = null;

    const activeProv = this.aiClient.getActiveProvider();
    const allProviders = getAllCloudProviders();
    if (activeProv !== "local" && allProviders[activeProv]) {
      this.selectedCloudProv = activeProv;
    }

    this.renderShell();
    if (subTab === "local") {
      await this.refreshLocalAndRender();
    } else {
      await this.refreshCloudAndRender();
    }
  }

  public hide(): void {
    this.visible = false;
  }

  private renderShell(): void {
    this.container.innerHTML = `
      <div class="full-page-shell page-enter">
        <div class="full-page-header">
          <div class="full-page-title-block">
            <button type="button" class="studio-btn studio-btn-sm" id="btn-models-back">${t("backToEditor")}</button>
            <div>
              <h1 class="full-page-title">${t("modelsPageTitle")}</h1>
              <div class="full-page-subtitle">${t("modelsPageSubtitle")}</div>
            </div>
          </div>
          <div class="full-page-subtabs">
            <button type="button" class="full-subtab-btn ${this.activeSubTab === "local" ? "active" : ""}" data-models-tab="local">${t("localModelsTab")}</button>
            <button type="button" class="full-subtab-btn ${this.activeSubTab === "cloud" ? "active" : ""}" data-models-tab="cloud">${t("cloudProvidersTab")}</button>
          </div>
        </div>
        <div id="models-page-body" class="full-page-body"></div>
      </div>
    `;

    this.container.querySelector("#btn-models-back")?.addEventListener("click", () => {
      this.onBackToWorkspace?.();
    });

    this.container.querySelectorAll<HTMLButtonElement>("[data-models-tab]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const next = btn.dataset.modelsTab as ModelsSubTab;
        if (!next || next === this.activeSubTab) return;
        this.activeSubTab = next;
        this.container.querySelectorAll("[data-models-tab]").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        if (next === "local") {
          await this.refreshLocalAndRender();
        } else {
          await this.refreshCloudAndRender();
        }
      });
    });
  }

  // ==========================================
  // SUB-VIEW 1: YERLİ LLM MODELLƏRİ
  // ==========================================

  private async refreshLocalAndRender(): Promise<void> {
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
    this.renderLocalView();
  }

  private renderLocalView(): void {
    const body = this.container.querySelector("#models-page-body") as HTMLElement | null;
    if (!body) return;

    const prefs = studioSettings.get();
    const hw = this.hwInfo;
    const installedMap = new Map<string, InstalledModelInfo>();
    for (const m of this.installedModels) {
      installedMap.set(m.id.toLowerCase(), m);
    }

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
            <span class="server-running-pill">${t("serverRunning")}</span>
            <span class="server-banner-model">${this.escapeHtml(this.serverStatus.model_id || "")}</span>
            <span class="server-banner-url">${this.escapeHtml(this.serverStatus.base_url || "")}</span>
          </div>
          <button type="button" class="studio-btn studio-btn-sm studio-btn-danger" id="btn-stop-local-server">${t("stopModel")}</button>
        </div>
      `
      : `
        <div class="local-server-banner is-stopped">
          <div class="server-banner-left">
            <span class="server-stopped-dot"></span>
            <span class="server-banner-text">${this.escapeHtml(t("serverStoppedBanner"))}</span>
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
        const isRunningThis =
          this.serverStatus.running && this.serverStatus.model_id?.toLowerCase() === item.id.toLowerCase();
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
          actionHtml = `<button type="button" class="studio-btn studio-btn-sm studio-btn-danger" data-cancel-dl="${this.escapeAttr(item.id)}">${t("cancel")}</button>`;
        } else if (installed) {
          if (isRunningThis) {
            actionHtml = `
              <span class="server-running-pill">${t("serverActive")}</span>
              <button type="button" class="studio-btn studio-btn-sm studio-btn-danger" data-stop-model="${this.escapeAttr(item.id)}">${t("stopModel")}</button>
            `;
          } else {
            actionHtml = `
              <button type="button" class="studio-btn studio-btn-sm studio-btn-primary" data-start-model="${this.escapeAttr(item.id)}" data-model-path="${this.escapeAttr(installed.path)}" ${isStartingThis ? "disabled" : ""}>
                ${isStartingThis ? t("startingModel") : t("startModel")}
              </button>
              <button type="button" class="studio-btn studio-btn-sm studio-btn-danger" data-delete-model="${this.escapeAttr(item.id)}" ${isStartingThis ? "disabled" : ""}>${t("deleteModel")}</button>
            `;
          }
        } else {
          actionHtml = `<button type="button" class="studio-btn studio-btn-sm" data-download-model="${this.escapeAttr(item.id)}">${t("download")} (${item.sizeHuman})</button>`;
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
                ${installed ? `<span class="model-meta-pill pill-installed">${t("installedWord")} (${formatByteSize(installed.size_bytes)})</span>` : ""}
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
              const isRunningThis =
                this.serverStatus.running && this.serverStatus.model_id?.toLowerCase() === m.id.toLowerCase();
              const isStartingThis = this.startingModelId === m.id;
              return `
                <div class="local-model-card ${isRunningThis ? "is-active-card" : ""}">
                  <div class="local-model-top">
                    <div class="local-model-title-group">
                      <span class="local-model-name">${this.escapeHtml(m.id)}</span>
                      <span class="model-meta-pill">${t("existingGguf")}</span>
                      <span class="model-meta-pill pill-installed">${formatByteSize(m.size_bytes)}</span>
                    </div>
                    <div class="local-model-actions">
                      ${
                        isRunningThis
                          ? `<span class="server-running-pill">${t("serverActive")}</span>
                             <button type="button" class="studio-btn studio-btn-sm studio-btn-danger" data-stop-model="${this.escapeAttr(m.id)}">${t("stopModel")}</button>`
                          : `<button type="button" class="studio-btn studio-btn-sm studio-btn-primary" data-start-model="${this.escapeAttr(m.id)}" data-model-path="${this.escapeAttr(m.path)}" ${isStartingThis ? "disabled" : ""}>${isStartingThis ? t("startingModel") : t("startModel")}</button>
                             <button type="button" class="studio-btn studio-btn-sm studio-btn-danger" data-delete-model="${this.escapeAttr(m.id)}" ${isStartingThis ? "disabled" : ""}>${t("deleteModel")}</button>`
                      }
                    </div>
                  </div>
                  <div class="local-model-desc">${t("localGgufOnDisk")}: ${this.escapeHtml(m.path)}</div>
                </div>
              `;
            })
            .join("")
        : "";

    body.innerHTML = `
      <div class="page-content-narrow tab-switch-enter">
        ${serverBannerHtml}
        ${llamaWarnHtml}
        ${msgBannerHtml}

        <div class="settings-card-block">
          <div class="settings-block-title">${t("engineParamsTitle")}</div>
          <div class="hw-stats-row">
            <span class="hw-stat-chip">RAM: ${hw ? `${hw.total_ram_gb} GB` : "..."}</span>
            <span class="hw-stat-chip">CPU: ${hw ? `${hw.cpu_cores} ${t("cpuCores")}` : "..."}</span>
            <span class="hw-stat-chip">${t("freeDisk")}: ${hw ? `${hw.free_disk_gb} GB` : "..."}</span>
            <span class="hw-stat-chip">${t("engineLabel")}: ${hw?.llama_server_found ? t("engineReady") : t("notFound")}</span>
          </div>

          <div class="dir-picker-row">
            <input id="local-models-dir-input" class="studio-input" type="text" readonly value="${this.escapeAttr(hw?.models_dir || prefs.modelsDir || "")}" />
            <button type="button" class="studio-btn studio-btn-sm" id="btn-pick-models-dir">${t("changeFolder")}</button>
          </div>

          <div class="engine-options-grid">
            <div class="form-group">
              <label for="eng-ctx">${t("ctxSizeLabel")}</label>
              <select id="eng-ctx" class="studio-input">
                <option value="2048" ${prefs.ctxSize === 2048 ? "selected" : ""}>2048 (${t("ctxFast")})</option>
                <option value="4096" ${prefs.ctxSize === 4096 ? "selected" : ""}>4096 (${t("ctxStandard")})</option>
                <option value="8192" ${prefs.ctxSize === 8192 ? "selected" : ""}>8192 (${t("ctxWide")})</option>
                <option value="16384" ${prefs.ctxSize === 16384 ? "selected" : ""}>16384 (${t("ctxLarge")})</option>
              </select>
            </div>
            <div class="form-group">
              <label for="eng-threads">${t("cpuThreadsLabel")}</label>
              <select id="eng-threads" class="studio-input">
                <option value="0" ${prefs.threads === 0 ? "selected" : ""}>${t("autoOption")}</option>
                <option value="2" ${prefs.threads === 2 ? "selected" : ""}>2</option>
                <option value="4" ${prefs.threads === 4 ? "selected" : ""}>4</option>
                <option value="6" ${prefs.threads === 6 ? "selected" : ""}>6</option>
                <option value="8" ${prefs.threads === 8 ? "selected" : ""}>8</option>
                <option value="12" ${prefs.threads === 12 ? "selected" : ""}>12</option>
              </select>
            </div>
            <div class="form-group">
              <label for="eng-gpu">${t("gpuLayersLabel")}</label>
              <select id="eng-gpu" class="studio-input">
                <option value="0" ${prefs.gpuLayers === 0 ? "selected" : ""}>0 (${t("cpuOnly")})</option>
                <option value="16" ${prefs.gpuLayers === 16 ? "selected" : ""}>16 (${t("partialGpu")})</option>
                <option value="32" ${prefs.gpuLayers === 32 ? "selected" : ""}>32 (GPU)</option>
                <option value="99" ${prefs.gpuLayers === 99 ? "selected" : ""}>99 (${t("fullGpu")})</option>
              </select>
            </div>
            <div class="form-group">
              <label for="eng-port">${t("portAutoLabel")}</label>
              <input id="eng-port" class="studio-input" type="number" min="1024" max="65535" value="${prefs.localPort || 8090}" />
            </div>
          </div>
        </div>

        <div class="catalog-header-row">
          <div class="settings-block-title">${t("localModelsCatalogTitle")} (${this.installedModels.length} ${t("installedWord")} / ${LOCAL_MODELS_CATALOG.length} ${t("catalogWord")})</div>
          <div class="catalog-filters">
            <button type="button" class="catalog-filter-btn ${this.catalogFilter === "all" ? "active" : ""}" data-filter="all">${t("filterAll")}</button>
            <button type="button" class="catalog-filter-btn ${this.catalogFilter === "coding" ? "active" : ""}" data-filter="coding">${t("filterCoding")}</button>
            <button type="button" class="catalog-filter-btn ${this.catalogFilter === "reasoning" ? "active" : ""}" data-filter="reasoning">${t("filterReasoning")}</button>
            <button type="button" class="catalog-filter-btn ${this.catalogFilter === "general" ? "active" : ""}" data-filter="general">${t("filterGeneral")}</button>
            <button type="button" class="catalog-filter-btn ${this.catalogFilter === "installed" ? "active" : ""}" data-filter="installed">${t("filterInstalled")}</button>
          </div>
        </div>

        <div class="local-models-list">
          ${catalogCardsHtml}${customCardsHtml || (filteredCatalog.length === 0 ? `<div class="bottom-empty">${t("noModelsInFilter")}</div>` : "")}
        </div>

        <div class="settings-card-block">
          <div class="settings-block-title">${t("customHfTitle")}</div>
          <div class="mcp-form-grid">
            <div class="form-group">
              <label for="custom-gguf-id">${t("customHfIdLabel")}</label>
              <input id="custom-gguf-id" class="studio-input" type="text" placeholder="qwen2.5-coder-3b-custom" autocomplete="off" />
            </div>
            <div class="form-group">
              <label for="custom-gguf-url">${t("customHfUrlLabel")}</label>
              <div class="ext-model-apply-row">
                <input id="custom-gguf-url" class="studio-input" type="text" placeholder="https://huggingface.co/.../model.gguf" autocomplete="off" />
                <button type="button" class="studio-btn studio-btn-sm studio-btn-primary" id="btn-download-custom-gguf">${t("download")}</button>
              </div>
            </div>
          </div>
          <div class="form-hint">${t("customHfHint")}</div>
        </div>

        <div class="settings-card-block">
          <div class="key-status-row">
            <div class="settings-block-title">${t("externalServerTitle")}</div>
            <button type="button" class="studio-btn studio-btn-sm" id="btn-scan-external-local">${t("scanServers")}</button>
          </div>
          <div id="external-local-detected" class="detected-models-wrap"></div>
          <div class="mcp-form-grid">
            <div class="form-group">
              <label for="ext-local-url">${t("externalBaseUrl")}</label>
              <input id="ext-local-url" class="studio-input" type="text" value="${this.escapeAttr(this.aiClient.getLocalBaseUrl())}" />
            </div>
            <div class="form-group">
              <label for="ext-local-model">${t("modelNameLabel")}</label>
              <div class="ext-model-apply-row">
                <input id="ext-local-model" class="studio-input" type="text" value="${this.escapeAttr(this.aiClient.getLocalModel())}" />
                <button type="button" class="studio-btn studio-btn-sm" id="btn-apply-ext-local">${t("connectBtn")}</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    const saveEngine = () => {
      studioSettings.update({
        ctxSize: Number((body.querySelector("#eng-ctx") as HTMLSelectElement)?.value || 4096),
        threads: Number((body.querySelector("#eng-threads") as HTMLSelectElement)?.value || 0),
        gpuLayers: Number((body.querySelector("#eng-gpu") as HTMLSelectElement)?.value || 0),
        localPort: Number((body.querySelector("#eng-port") as HTMLInputElement)?.value || 8090),
      });
    };
    ["#eng-ctx", "#eng-threads", "#eng-gpu", "#eng-port"].forEach((s) => {
      body.querySelector(s)?.addEventListener("change", saveEngine);
    });

    body.querySelector("#btn-pick-models-dir")?.addEventListener("click", async () => {
      const chosen = await invoke<string | null>("llm_pick_models_dir");
      if (chosen) {
        studioSettings.update({ modelsDir: chosen });
        await this.refreshLocalAndRender();
      }
    });

    const stopServer = async () => {
      await invoke("llm_stop_server");
      this.statusMessage = { type: "info", text: t("modelServerStopped") };
      this.onAuditLog?.("system", t("modelServerStopped"));
      await this.refreshLocalAndRender();
      this.onSettingsSaved?.();
    };
    body.querySelector("#btn-stop-local-server")?.addEventListener("click", stopServer);
    body.querySelectorAll<HTMLButtonElement>("[data-stop-model]").forEach((b) => b.addEventListener("click", stopServer));

    body.querySelectorAll<HTMLButtonElement>(".catalog-filter-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.catalogFilter = btn.dataset.filter as any;
        this.renderLocalView();
      });
    });

    body.querySelectorAll<HTMLButtonElement>("[data-download-model]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.downloadModel;
        const item = LOCAL_MODELS_CATALOG.find((m) => m.id === id);
        if (item) this.openDownloadAttentionDialog(item);
      });
    });

    body.querySelectorAll<HTMLButtonElement>("[data-cancel-dl]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.cancelDl;
        if (id) await invoke("llm_cancel_download", { modelId: id });
      });
    });

    body.querySelectorAll<HTMLButtonElement>("[data-start-model]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.startModel;
        const path = btn.dataset.modelPath;
        if (!id || !path) return;

        saveEngine();
        const curPrefs = studioSettings.get();
        this.startingModelId = id;
        this.statusMessage = { type: "info", text: `"${id}" ${t("modelStartingMsg")}` };
        this.renderLocalView();

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
          if (status.port) studioSettings.update({ localPort: status.port });
          this.aiClient.setActiveProvider("local");
          if (status.base_url) this.aiClient.setLocalBaseUrl(status.base_url);
          this.aiClient.setLocalModel(id);
          this.statusMessage = {
            type: "info",
            text: `"${id}" ${t("modelStartedMsg")} (port ${status.port})`,
          };
          this.onAuditLog?.("system", `Yerli model işə salındı: ${id}`);
          this.onSettingsSaved?.();
        } catch (err: any) {
          this.statusMessage = { type: "error", text: String(err) };
        } finally {
          this.startingModelId = null;
          await this.refreshLocalAndRender();
        }
      });
    });

    body.querySelectorAll<HTMLButtonElement>("[data-delete-model]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.deleteModel;
        if (!id) return;
        try {
          await invoke("llm_delete_model", {
            modelId: id,
            modelsDir: this.hwInfo?.models_dir || prefs.modelsDir || null,
          });
          this.statusMessage = { type: "info", text: `"${id}" diskdən silindi.` };
          await this.refreshLocalAndRender();
        } catch (err: any) {
          this.statusMessage = { type: "error", text: String(err) };
          this.renderLocalView();
        }
      });
    });

    body.querySelector("#btn-download-custom-gguf")?.addEventListener("click", () => {
      const idIn = body.querySelector("#custom-gguf-id") as HTMLInputElement | null;
      const urlIn = body.querySelector("#custom-gguf-url") as HTMLInputElement | null;
      const url = (urlIn?.value || "").trim();
      if (!url.startsWith("https://huggingface.co/") || !url.toLowerCase().includes(".gguf")) {
        this.statusMessage = { type: "error", text: "Zəhmət olmasa rəsmi https://huggingface.co/ .gguf linki daxil edin." };
        this.renderLocalView();
        return;
      }
      const rawId = (idIn?.value || "").trim() || url.split("/").pop()?.replace(/\.gguf(\?.*)?$/i, "") || "custom-model";
      const safeId = rawId.replace(/[^a-zA-Z0-9._-]/g, "-");
      this.openDownloadAttentionDialog({
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
      });
    });

    const extWrap = body.querySelector("#external-local-detected") as HTMLElement;
    const extUrl = body.querySelector("#ext-local-url") as HTMLInputElement;
    const extModel = body.querySelector("#ext-local-model") as HTMLInputElement;

    body.querySelector("#btn-scan-external-local")?.addEventListener("click", async () => {
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

    body.querySelector("#btn-apply-ext-local")?.addEventListener("click", () => {
      this.aiClient.setActiveProvider("local");
      this.aiClient.setLocalBaseUrl(extUrl.value);
      this.aiClient.setLocalModel(extModel.value);
      this.statusMessage = { type: "info", text: `Xarici yerli server seçildi: ${extModel.value} (${extUrl.value})` };
      this.onSettingsSaved?.();
      this.renderLocalView();
    });
  }

  private openDownloadAttentionDialog(item: LocalModelCatalogItem): void {
    const hw = this.hwInfo;
    const targetDir = hw?.models_dir || studioSettings.get().modelsDir || "D:\\Mintu-Models";
    const freeDisk = hw ? hw.free_disk_gb : 0;
    const pcRam = hw ? hw.total_ram_gb : 8;
    const diskTight = hw ? freeDisk < item.sizeGb + 1.0 : false;
    const ramTight = hw ? pcRam < item.minRamGb : false;

    const confirmOverlay = document.createElement("div");
    confirmOverlay.className = "studio-modal-overlay attention-overlay";
    confirmOverlay.innerHTML = `
      <div class="studio-modal premium-dl-modal" role="alertdialog" aria-modal="true">
        <div class="premium-dl-header">
          <div class="premium-dl-head-left">
            <span class="premium-dl-badge">${this.escapeHtml(t("attnBadge"))}</span>
            <h3 class="premium-dl-name">${this.escapeHtml(item.name)}</h3>
            <div class="premium-dl-subtitle">${this.escapeHtml(t("attnTitle"))}</div>
          </div>
          <button type="button" class="studio-btn-icon" id="btn-attn-close" title="${this.escapeAttr(t("close"))}">${ICON_CLOSE}</button>
        </div>

        <div class="premium-dl-body">
          <div class="premium-dl-spec-grid">
            <div class="premium-dl-spec-card">
              <div class="premium-dl-spec-label">${this.escapeHtml(t("attnSize"))}</div>
              <div class="premium-dl-spec-val">${this.escapeHtml(item.sizeHuman)}</div>
              <div class="premium-dl-spec-sub">${this.escapeHtml(item.params)} · ${this.escapeHtml(t("attnSource"))}: HuggingFace</div>
            </div>

            <div class="premium-dl-spec-card">
              <div class="premium-dl-spec-label">${this.escapeHtml(t("attnRam"))}</div>
              <div class="premium-dl-spec-val">${item.minRamGb} GB RAM</div>
              <div class="premium-dl-spec-sub ${ramTight ? "spec-warn" : "spec-ok"}">
                PC: ${pcRam} GB RAM · ${this.escapeHtml(ramTight ? t("attnRamWarn") : t("attnRamOk"))}
              </div>
            </div>

            <div class="premium-dl-spec-card spec-wide">
              <div class="premium-dl-spec-label">${this.escapeHtml(t("attnFolder"))}</div>
              <div class="premium-dl-spec-path"><code>${this.escapeHtml(targetDir)}</code></div>
              <div class="premium-dl-spec-sub ${diskTight ? "spec-warn" : "spec-ok"}">
                ${this.escapeHtml(t("freeDisk"))}: <strong>${freeDisk} GB</strong> · ${this.escapeHtml(diskTight ? t("attnDiskWarn") : t("attnDiskOk"))}
              </div>
            </div>
          </div>

          <div class="premium-dl-note">
            <div class="premium-dl-note-title">${this.escapeHtml(t("attnManualTitle"))}</div>
            <div class="premium-dl-note-text">${this.escapeHtml(t("attnManual"))}</div>
          </div>

          ${diskTight ? `<div class="mcp-error-banner">${this.escapeHtml(t("attnDiskWarn"))} (${freeDisk} GB / ${this.escapeHtml(item.sizeHuman)})</div>` : ""}
          ${ramTight ? `<div class="attention-warn-box">${this.escapeHtml(t("attnRamWarn"))} (${item.minRamGb} GB / ${pcRam} GB)</div>` : ""}
        </div>

        <div class="studio-modal-footer premium-dl-footer">
          <button type="button" class="studio-btn" id="btn-attn-cancel">${this.escapeHtml(t("cancel"))}</button>
          <button type="button" class="studio-btn studio-btn-primary" id="btn-attn-confirm">${this.escapeHtml(t("attnConfirm"))} (${this.escapeHtml(item.sizeHuman)})</button>
        </div>
      </div>
    `;

    document.body.appendChild(confirmOverlay);
    const closeAttn = () => {
      confirmOverlay.classList.add("is-closing");
      setTimeout(() => confirmOverlay.remove(), 120);
    };

    confirmOverlay.querySelector("#btn-attn-close")?.addEventListener("click", closeAttn);
    confirmOverlay.querySelector("#btn-attn-cancel")?.addEventListener("click", closeAttn);
    confirmOverlay.addEventListener("click", (e) => {
      if (e.target === confirmOverlay) closeAttn();
    });

    confirmOverlay.querySelector("#btn-attn-confirm")?.addEventListener("click", () => {
      closeAttn();
      this.startModelDownload(item);
    });
  }

  private startModelDownload(item: LocalModelCatalogItem): void {
    const modelsDir = this.hwInfo?.models_dir || studioSettings.get().modelsDir || null;
    this.downloads.set(item.id, {
      model_id: item.id,
      downloaded_bytes: 0,
      total_bytes: Math.round(item.sizeGb * 1024 * 1024 * 1024),
      speed_mbps: 0,
      status: "downloading",
      error: null,
    });
    this.statusMessage = { type: "info", text: `"${item.name}" ${t("modelDownloadingMsg")}` };
    this.onAuditLog?.("system", `Model download started: ${item.name} (${item.sizeHuman})`);
    this.renderLocalView();

    invoke("llm_download_model", {
      modelId: item.id,
      url: item.url,
      modelsDir,
    }).catch((err) => {
      this.downloads.delete(item.id);
      this.statusMessage = { type: "error", text: String(err) };
      if (this.visible && this.activeSubTab === "local") {
        this.renderLocalView();
      }
    });
  }

  private updateDownloadCardDom(p: ModelDownloadProgress): void {
    const box = this.container.querySelector<HTMLElement>(`[data-dl-box="${p.model_id}"]`);
    if (!box) {
      this.renderLocalView();
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
  // SUB-VIEW 2: BULUD API PROVAYDERLƏRİ (2-Column Full Page + Live Test!)
  // ==========================================

  private async refreshCloudAndRender(): Promise<void> {
    this.cloudKeyMap.clear();
    const allProvs = getAllCloudProviders();
    for (const p of Object.values(allProvs)) {
      const st = await this.aiClient.getKeyStatus(p.id);
      this.cloudKeyMap.set(p.id, { has_key: st.has_key, masked: st.masked });
    }
    this.renderCloudView();
  }

  private renderCloudView(): void {
    const body = this.container.querySelector("#models-page-body") as HTMLElement | null;
    if (!body) return;

    const allProvs = getAllCloudProviders();
    const activeProv = this.aiClient.getActiveProvider();
    const cfg = allProvs[this.selectedCloudProv] || CLOUD_PROVIDERS.gemini;
    const keyState = this.cloudKeyMap.get(cfg.id) || { has_key: false, masked: null };
    const savedModel = this.aiClient.getCloudModel(cfg.id);
    const savedUrl = this.aiClient.getCloudBaseUrl(cfg.id);

    const providerCardsHtml = Object.values(allProvs)
      .map((p) => {
        const ks = this.cloudKeyMap.get(p.id);
        const isSelected = p.id === cfg.id;
        const isActive = activeProv === p.id;
        return `
          <button type="button" class="cloud-prov-card ${isSelected ? "is-selected" : ""}" data-select-prov="${this.escapeAttr(p.id)}">
            <div class="cloud-prov-card-top">
              <span class="cloud-prov-card-name">${this.escapeHtml(p.name)}</span>
              ${p.isUserCustom ? `<span class="model-meta-pill">Custom</span>` : ""}
              ${isActive ? `<span class="model-meta-pill pill-installed">${t("serverActive")}</span>` : ""}
            </div>
            <div class="cloud-prov-card-meta">
              <span>${ks?.has_key ? `${t("keyPresentShort")} (${this.escapeHtml(ks.masked || "••••")})` : t("keyMissingShort")}</span>
            </div>
          </button>
        `;
      })
      .join("");

    const modelChipsHtml = (cfg.models || [])
      .map(
        (m) => `
          <button type="button" class="studio-btn studio-btn-sm cloud-model-chip ${savedModel === m ? "studio-btn-primary" : ""}" data-pick-model="${this.escapeAttr(m)}">${this.escapeHtml(m)}</button>
        `
      )
      .join("");

    const feedbackHtml = this.cloudFeedback
      ? `<div class="${this.cloudFeedback.type === "error" ? "mcp-error-banner" : "form-hint"}">${this.escapeHtml(this.cloudFeedback.text)}</div>`
      : "";

    const addCustomFormHtml = this.showAddCustomCloud
      ? `
        <div class="settings-card-block custom-cloud-creator-card">
          <div class="key-status-row">
            <div class="settings-block-title">${t("addCustomCloudTitle")}</div>
            <button type="button" class="studio-btn studio-btn-sm" id="btn-close-custom-cloud">${t("cancel")}</button>
          </div>
          <div class="mcp-form-grid">
            <div class="form-group">
              <label for="new-custom-prov-name">${t("customCloudNameLabel")}</label>
              <input id="new-custom-prov-name" class="studio-input" type="text" placeholder="e.g. Fireworks AI / My Proxy" autocomplete="off" />
            </div>
            <div class="form-group">
              <label for="new-custom-prov-model">${t("modelNameLabel")}</label>
              <input id="new-custom-prov-model" class="studio-input" type="text" placeholder="e.g. accounts/fireworks/models/deepseek-v3" autocomplete="off" />
            </div>
            <div class="form-group">
              <label for="new-custom-prov-url">API Base URL</label>
              <input id="new-custom-prov-url" class="studio-input" type="text" placeholder="https://api.example.com/v1" autocomplete="off" />
            </div>
            <div class="form-group">
              <label for="new-custom-prov-key">API Key</label>
              <input id="new-custom-prov-key" class="studio-input" type="password" placeholder="sk-..." autocomplete="off" />
            </div>
          </div>
          <div class="settings-inline-actions">
            <button type="button" class="studio-btn studio-btn-primary" id="btn-save-new-custom-cloud">${t("saveAndActivate")}</button>
          </div>
        </div>
      `
      : "";

    body.innerHTML = `
      <div class="cloud-page-stack tab-switch-enter">
        <div class="cloud-top-action-bar">
          <span class="settings-block-title" style="margin:0;">${t("providersListTitle")} (${Object.keys(allProvs).length})</span>
          <button type="button" class="studio-btn studio-btn-sm studio-btn-primary" id="btn-toggle-add-custom-cloud">+ ${t("addCustomCloudBtn")}</button>
        </div>

        ${addCustomFormHtml}

        <div class="cloud-split-layout">
          <div class="cloud-prov-sidebar">
            <div class="cloud-prov-list">${providerCardsHtml}</div>
          </div>

          <div class="cloud-prov-detail">
            <div class="settings-card-block">
              <div class="key-status-row">
                <div class="settings-block-title">${this.escapeHtml(cfg.name)}</div>
                <div class="local-model-actions">
                  <span class="key-status-badge ${keyState.has_key ? "status-ok" : "status-missing"}">
                    ${keyState.has_key ? `${t("keySavedBadge")}: ${this.escapeHtml(keyState.masked || "••••")}` : t("noApiKeyBadge")}
                  </span>
                  ${cfg.isUserCustom ? `<button type="button" id="btn-delete-custom-prov" class="studio-btn studio-btn-sm studio-btn-danger">${t("deleteModel")}</button>` : ""}
                </div>
              </div>

              <div class="form-group">
                <label for="cloud-model-input">${t("modelNameLabel")}</label>
                <input id="cloud-model-input" class="studio-input" type="text" value="${this.escapeAttr(savedModel)}" autocomplete="off" />
                <div class="cloud-model-chips">${modelChipsHtml}</div>
              </div>

              <div class="form-group">
                <label for="cloud-url-input">API Base URL</label>
                <div class="ext-model-apply-row">
                  <input id="cloud-url-input" class="studio-input" type="text" value="${this.escapeAttr(savedUrl)}" autocomplete="off" />
                  <button type="button" class="studio-btn studio-btn-sm" id="btn-cloud-reset-url" title="${t("defaultUrl")}">${t("defaultUrl")}</button>
                </div>
                <div class="form-hint">${t("defaultAddressHint")}: <code>${this.escapeHtml(cfg.baseUrl)}</code> (${t("autoRepairHint")})</div>
              </div>

              <div class="form-group">
                <label for="cloud-key-input">${t("apiKeyCredLabel")}</label>
                <div class="ext-model-apply-row">
                  <input id="cloud-key-input" class="studio-input" type="password" placeholder="${keyState.has_key ? this.escapeAttr(t("apiKeyPlaceholderReplace")) : this.escapeAttr(t("apiKeyPlaceholderNew"))}" autocomplete="off" />
                  ${keyState.has_key ? `<button type="button" id="btn-cloud-del-key" class="studio-btn studio-btn-sm studio-btn-danger">${t("deleteKey")}</button>` : ""}
                </div>
              </div>

              ${feedbackHtml}

              <div class="settings-inline-actions">
                <button type="button" id="btn-cloud-test" class="studio-btn">${t("testConnection")}</button>
                <button type="button" id="btn-save-cloud-only" class="studio-btn">${t("save")}</button>
                <button type="button" id="btn-activate-cloud" class="studio-btn studio-btn-primary">${t("saveAndActivate")}</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    body.querySelector("#btn-toggle-add-custom-cloud")?.addEventListener("click", () => {
      this.showAddCustomCloud = !this.showAddCustomCloud;
      this.renderCloudView();
    });
    body.querySelector("#btn-close-custom-cloud")?.addEventListener("click", () => {
      this.showAddCustomCloud = false;
      this.renderCloudView();
    });

    body.querySelector("#btn-save-new-custom-cloud")?.addEventListener("click", async () => {
      const name = (body.querySelector("#new-custom-prov-name") as HTMLInputElement)?.value.trim();
      const model = (body.querySelector("#new-custom-prov-model") as HTMLInputElement)?.value.trim();
      const url = (body.querySelector("#new-custom-prov-url") as HTMLInputElement)?.value.trim();
      const key = (body.querySelector("#new-custom-prov-key") as HTMLInputElement)?.value.trim();
      if (!name || !model || !url) {
        this.cloudFeedback = { type: "error", text: "Name, Base URL, and Model ID are required." };
        this.renderCloudView();
        return;
      }
      const created = saveCustomCloudProvider({ name, baseUrl: url, defaultModel: model, models: [model] });
      this.aiClient.setCloudBaseUrl(created.id, url);
      this.aiClient.setCloudModel(created.id, model);
      if (key) {
        await this.aiClient.storeApiKey(created.id, key);
      }
      this.aiClient.setActiveProvider(created.id);
      this.selectedCloudProv = created.id;
      this.showAddCustomCloud = false;
      this.cloudFeedback = { type: "info", text: `${created.name} (${model}) added and activated.` };
      this.onSettingsSaved?.();
      await this.refreshCloudAndRender();
    });

    body.querySelector("#btn-delete-custom-prov")?.addEventListener("click", async () => {
      if (!cfg.isUserCustom) return;
      deleteCustomCloudProvider(cfg.id);
      await this.aiClient.deleteApiKey(cfg.id).catch(() => {});
      if (this.aiClient.getActiveProvider() === cfg.id) {
        this.aiClient.setActiveProvider("local");
      }
      this.selectedCloudProv = "gemini";
      this.cloudFeedback = { type: "info", text: `${cfg.name} removed.` };
      this.onSettingsSaved?.();
      await this.refreshCloudAndRender();
    });

    const modelIn = body.querySelector("#cloud-model-input") as HTMLInputElement;
    const urlIn = body.querySelector("#cloud-url-input") as HTMLInputElement;
    const keyIn = body.querySelector("#cloud-key-input") as HTMLInputElement;

    body.querySelectorAll<HTMLButtonElement>("[data-select-prov]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const pid = btn.dataset.selectProv;
        if (pid) {
          this.selectedCloudProv = pid;
          this.cloudFeedback = null;
          this.renderCloudView();
        }
      });
    });

    body.querySelectorAll<HTMLButtonElement>("[data-pick-model]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const m = btn.dataset.pickModel;
        if (m) {
          modelIn.value = m;
          body.querySelectorAll("[data-pick-model]").forEach((b) => b.classList.remove("studio-btn-primary"));
          btn.classList.add("studio-btn-primary");
        }
      });
    });

    body.querySelector("#btn-cloud-reset-url")?.addEventListener("click", () => {
      urlIn.value = cfg.baseUrl;
      this.aiClient.setCloudBaseUrl(cfg.id, cfg.baseUrl);
      this.cloudFeedback = { type: "info", text: `${t("defaultUrlRestored")}: ${cfg.baseUrl}` };
      this.renderCloudView();
    });

    body.querySelector("#btn-cloud-del-key")?.addEventListener("click", async () => {
      await this.aiClient.deleteApiKey(cfg.id);
      this.cloudFeedback = { type: "info", text: `${cfg.name} ${t("apiKeyDeleted")}` };
      await this.refreshCloudAndRender();
    });

    const saveCurrent = async (activate: boolean) => {
      this.aiClient.setCloudModel(cfg.id, modelIn.value.trim() || cfg.defaultModel);
      this.aiClient.setCloudBaseUrl(cfg.id, urlIn.value.trim() || cfg.baseUrl);
      if (keyIn.value.trim()) {
        await this.aiClient.storeApiKey(cfg.id, keyIn.value.trim());
      }
      if (activate) {
        this.aiClient.setActiveProvider(cfg.id);
      }
      this.cloudFeedback = {
        type: "info",
        text: `${cfg.name} (${modelIn.value.trim() || cfg.defaultModel}) — ${t("settingsSavedNotice")}`,
      };
      this.onSettingsSaved?.();
      await this.refreshCloudAndRender();
    };

    body.querySelector("#btn-save-cloud-only")?.addEventListener("click", () => void saveCurrent(false));
    body.querySelector("#btn-activate-cloud")?.addEventListener("click", () => void saveCurrent(true));

    body.querySelector("#btn-cloud-test")?.addEventListener("click", async () => {
      // Persist first so Rust reads the latest key/url/model
      this.aiClient.setCloudModel(cfg.id, modelIn.value.trim() || cfg.defaultModel);
      this.aiClient.setCloudBaseUrl(cfg.id, urlIn.value.trim() || cfg.baseUrl);
      if (keyIn.value.trim()) {
        await this.aiClient.storeApiKey(cfg.id, keyIn.value.trim());
      }
      this.cloudFeedback = { type: "info", text: "Bağlantı test edilir..." };
      this.renderCloudView();

      try {
        const res = await invoke<CloudTestResult>("llm_test_cloud_connection", {
          provider: cfg.id,
          baseUrl: this.aiClient.getCloudBaseUrl(cfg.id),
          model: this.aiClient.getCloudModel(cfg.id),
        });
        if (res.resolved_base_url) this.aiClient.setCloudBaseUrl(cfg.id, res.resolved_base_url);
        if (res.resolved_model) this.aiClient.setCloudModel(cfg.id, res.resolved_model);
        this.cloudFeedback = {
          type: res.ok ? "info" : "error",
          text: res.message,
        };
      } catch (e: any) {
        this.cloudFeedback = { type: "error", text: String(e) };
      }
      await this.refreshCloudAndRender();
    });
  }

  public dispose(): void {
    this.unlistenProgress?.();
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  private escapeAttr(str: string): string {
    return this.escapeHtml(str).replace(/"/g, "&quot;");
  }
}
