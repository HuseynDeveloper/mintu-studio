/**
 * SettingsModal.ts
 * Model & API Provider Configuration Modal for Standalone Mintu Studio.
 * Allows switching between Local models (Ollama / llama.cpp) and Cloud providers
 * with secure Windows Credential Manager storage.
 */

import { CLOUD_PROVIDERS } from "../ai/cloudCatalog";
import { StudioAIClient } from "../ai/StudioAIClient";

export class SettingsModal {
  private aiClient: StudioAIClient;
  private overlayEl: HTMLElement | null = null;
  public onSettingsSaved?: () => void;

  constructor(aiClient: StudioAIClient) {
    this.aiClient = aiClient;
  }

  public open(): void {
    if (this.overlayEl) {
      this.overlayEl.remove();
    }

    const overlay = document.createElement("div");
    overlay.className = "studio-modal-overlay";
    overlay.id = "studio-settings-modal";

    const activeProv = this.aiClient.getActiveProvider();

    const providerOptions = [
      `<option value="local" ${activeProv === "local" ? "selected" : ""}>Local Model (Ollama / llama.cpp)</option>`,
      ...Object.values(CLOUD_PROVIDERS).map(
        (p) =>
          `<option value="${p.id}" ${activeProv === p.id ? "selected" : ""}>Cloud: ${p.name}</option>`
      ),
    ].join("");

    overlay.innerHTML = `
      <div class="studio-modal">
        <div class="studio-modal-header">
          <span class="studio-modal-title">Model və API Tənzimləmələri</span>
          <button id="btn-close-settings-modal" class="studio-btn-icon" title="Bağla">&times;</button>
        </div>

        <div class="studio-modal-body">
          <div class="form-group">
            <label for="select-studio-provider">Aktiv AI Provayderi</label>
            <select id="select-studio-provider" class="studio-input">${providerOptions}</select>
          </div>

          <div id="section-local-settings">
            <div class="form-group">
              <label for="input-local-url">Yerli Server Ünvanı (OpenAI-compatible)</label>
              <input id="input-local-url" class="studio-input" type="text" placeholder="http://127.0.0.1:11434/v1" />
              <div class="form-presets">
                <button type="button" class="studio-btn studio-btn-sm" id="btn-preset-ollama">Ollama (:11434)</button>
                <button type="button" class="studio-btn studio-btn-sm" id="btn-preset-llamacpp">llama.cpp (:8080)</button>
                <button type="button" class="studio-btn studio-btn-sm" id="btn-preset-lmstudio">LM Studio (:1234)</button>
              </div>
            </div>
            <div class="form-group">
              <label for="input-local-model">Yerli Model Adı</label>
              <input id="input-local-model" class="studio-input" type="text" placeholder="qwen2.5-coder:7b" />
            </div>
            <div class="form-hint">
              Yerli rejimdə layihə fayllarınız heç bir xarici serverə göndərilmir (100% offline).
            </div>
          </div>

          <div id="section-cloud-settings" style="display: none;">
            <div class="form-group">
              <label for="input-cloud-model">Bulud Modeli</label>
              <input id="input-cloud-model" class="studio-input" list="datalist-cloud-models" type="text" />
              <datalist id="datalist-cloud-models"></datalist>
            </div>

            <div class="form-group">
              <label for="input-cloud-url">Base URL</label>
              <input id="input-cloud-url" class="studio-input" type="text" />
            </div>

            <div class="form-group">
              <label for="input-cloud-apikey">API Açarı (Windows Credential Manager-də şifrələnir)</label>
              <div class="key-status-row">
                <span id="cloud-key-status" class="key-status-badge">Yoxlanılır...</span>
                <button type="button" id="btn-delete-cloud-key" class="studio-btn studio-btn-sm" style="display: none; color: #f87171;">Açarı Sil</button>
              </div>
              <input id="input-cloud-apikey" class="studio-input" type="password" placeholder="Yeni API açarı daxil edin..." autocomplete="off" />
            </div>

            <div class="form-hint form-hint-warning">
              Bulud modeli aktiv olduqda çata qoşulan fayllar seçilmiş provayderə göndəriləcək və hər mesajda narıncı nişanla göstəriləcək.
            </div>
          </div>
        </div>

        <div class="studio-modal-footer">
          <button id="btn-cancel-settings-modal" class="studio-btn">Ləğv et</button>
          <button id="btn-save-settings-modal" class="studio-btn studio-btn-primary">Yadda saxla</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    this.overlayEl = overlay;

    const selectProvider = overlay.querySelector("#select-studio-provider") as HTMLSelectElement;
    const localSection = overlay.querySelector("#section-local-settings") as HTMLElement;
    const cloudSection = overlay.querySelector("#section-cloud-settings") as HTMLElement;
    const inputLocalUrl = overlay.querySelector("#input-local-url") as HTMLInputElement;
    const inputLocalModel = overlay.querySelector("#input-local-model") as HTMLInputElement;
    const inputCloudModel = overlay.querySelector("#input-cloud-model") as HTMLInputElement;
    const datalistCloudModels = overlay.querySelector("#datalist-cloud-models") as HTMLDataListElement;
    const inputCloudUrl = overlay.querySelector("#input-cloud-url") as HTMLInputElement;
    const inputCloudKey = overlay.querySelector("#input-cloud-apikey") as HTMLInputElement;
    const keyStatusEl = overlay.querySelector("#cloud-key-status") as HTMLElement;
    const btnDeleteKey = overlay.querySelector("#btn-delete-cloud-key") as HTMLButtonElement;

    const refreshFields = async () => {
      const prov = selectProvider.value;
      if (prov === "local") {
        localSection.style.display = "block";
        cloudSection.style.display = "none";
        inputLocalUrl.value = this.aiClient.getLocalBaseUrl();
        inputLocalModel.value = this.aiClient.getLocalModel();
      } else {
        localSection.style.display = "none";
        cloudSection.style.display = "block";

        const cfg = CLOUD_PROVIDERS[prov];
        inputCloudModel.value = this.aiClient.getCloudModel(prov);
        inputCloudUrl.value = this.aiClient.getCloudBaseUrl(prov);
        inputCloudKey.value = "";

        datalistCloudModels.innerHTML = (cfg?.models || [])
          .map((m) => `<option value="${m}"></option>`)
          .join("");

        keyStatusEl.textContent = "Yoxlanılır...";
        btnDeleteKey.style.display = "none";

        const status = await this.aiClient.getKeyStatus(prov);
        if (status.has_key) {
          keyStatusEl.textContent = `Saxlanılıb: ${status.masked || "••••"}`;
          keyStatusEl.className = "key-status-badge status-ok";
          btnDeleteKey.style.display = "inline-flex";
        } else {
          keyStatusEl.textContent = "Açar əlavə edilməyib";
          keyStatusEl.className = "key-status-badge status-missing";
          btnDeleteKey.style.display = "none";
        }
      }
    };

    selectProvider.addEventListener("change", () => {
      refreshFields();
    });

    overlay.querySelector("#btn-preset-ollama")?.addEventListener("click", () => {
      inputLocalUrl.value = "http://127.0.0.1:11434/v1";
    });
    overlay.querySelector("#btn-preset-llamacpp")?.addEventListener("click", () => {
      inputLocalUrl.value = "http://127.0.0.1:8080/v1";
    });
    overlay.querySelector("#btn-preset-lmstudio")?.addEventListener("click", () => {
      inputLocalUrl.value = "http://127.0.0.1:1234/v1";
    });

    btnDeleteKey.addEventListener("click", async () => {
      const prov = selectProvider.value;
      await this.aiClient.deleteApiKey(prov);
      refreshFields();
    });

    const closeModal = () => {
      overlay.remove();
      this.overlayEl = null;
    };

    overlay.querySelector("#btn-close-settings-modal")?.addEventListener("click", closeModal);
    overlay.querySelector("#btn-cancel-settings-modal")?.addEventListener("click", closeModal);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal();
    });

    overlay.querySelector("#btn-save-settings-modal")?.addEventListener("click", async () => {
      const prov = selectProvider.value;
      this.aiClient.setActiveProvider(prov);

      if (prov === "local") {
        this.aiClient.setLocalBaseUrl(inputLocalUrl.value);
        this.aiClient.setLocalModel(inputLocalModel.value);
      } else {
        this.aiClient.setCloudModel(prov, inputCloudModel.value);
        this.aiClient.setCloudBaseUrl(prov, inputCloudUrl.value);
        const newKey = inputCloudKey.value.trim();
        if (newKey) {
          await this.aiClient.storeApiKey(prov, newKey);
        }
      }

      this.onSettingsSaved?.();
      closeModal();
    });

    refreshFields();
  }
}
