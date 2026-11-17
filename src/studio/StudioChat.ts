/**
 * StudioChat.ts
 * Right panel "Mintu AI" matching the design system.
 * - Header: sparkle icon, "Mintu AI", data-flow pill (Lokal / Bulud: <provider>), history, expand, close
 * - Empty state: Mintu "M" logo + tagline + 5 Azerbaijani quick-action chips (prefill only)
 * - Attached file chips with byte/KB size + "N fayl · X KB kontekstdə"
 * - Composer: textarea + ONLY attach (paperclip) and send buttons (no image/# buttons)
 * - Enforces Phase 1 security: tool calling disabled, <untrusted_data> wrapping inside StudioAIClient
 */

import { MarkdownRenderer } from "../ai/MarkdownRenderer";
import { StudioAIClient, StudioChatMessage, StudioMessageRouting } from "../ai/StudioAIClient";
import { ContextFileSummary, formatByteSize } from "./BottomPanel";
import {
  ICON_CHIP_BUG,
  ICON_CHIP_COMPONENT,
  ICON_CHIP_EXPLAIN,
  ICON_CHIP_REFACTOR,
  ICON_CHIP_TEST,
  ICON_CLOSE,
  ICON_EXPAND,
  ICON_HISTORY,
  ICON_PAPERCLIP,
  ICON_SEND,
  ICON_SPARKLE,
  ICON_STOP,
  MINTU_LOGO_SVG,
} from "./icons";

interface QuickChipDef {
  label: string;
  icon: string;
  template: string;
}

const QUICK_CHIPS: QuickChipDef[] = [
  {
    label: "Komponent yarat",
    icon: ICON_CHIP_COMPONENT,
    template: "Qoşulmuş fayl kontekstinə uyğun yeni təkrar istifadə edilə bilən komponent yarat: ",
  },
  {
    label: "Bu kodu izah et",
    icon: ICON_CHIP_EXPLAIN,
    template: "Qoşulmuş koddakı məntiqi, məlumat axınını və əsas hissələri addım-addım izah et.",
  },
  {
    label: "Bug-ı düzəlt",
    icon: ICON_CHIP_BUG,
    template: "Qoşulmuş kodda mümkün səhvləri, kənar halları (edge cases) və bug-ları aşkarlayıb düzəliş təklif et.",
  },
  {
    label: "Refaktor et",
    icon: ICON_CHIP_REFACTOR,
    template: "Qoşulmuş kodu daha oxunaqlı, modul və təmiz etmək üçün refaktorinq təklifi ver.",
  },
  {
    label: "Test əlavə et",
    icon: ICON_CHIP_TEST,
    template: "Qoşulmuş kod üçün əsas ssenariləri və kənar halları əhatə edən unit testlər yaz.",
  },
];

interface SavedChatSession {
  id: string;
  title: string;
  timestamp: number;
  messages: StudioChatMessage[];
}

const HISTORY_STORAGE_KEY = "mintu_studio_chat_sessions_v1";

export class StudioChat {
  private container: HTMLElement;
  private aiClient: StudioAIClient;
  private attachedFiles: Map<string, { content: string; sizeBytes: number }> = new Map();
  private showingHistory = false;

  private messagesListEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private attachedTrayWrapEl!: HTMLElement;
  private providerBadgeEl!: HTMLButtonElement;

  public onFileRemoved?: (path: string) => void;
  public onAttachedChanged?: (files: ContextFileSummary[]) => void;
  public onOpenSettings?: () => void;
  public onAttachButtonClick?: () => void;
  public onExpandToggle?: () => void;
  public onClosePanel?: () => void;
  public onMessageDispatched?: (routing: StudioMessageRouting, files: string[]) => void;
  public onBusyStateChange?: (busy: boolean) => void;

  constructor(container: HTMLElement, aiClient: StudioAIClient) {
    this.container = container;
    this.aiClient = aiClient;
    this.initLayout();
    this.initEvents();
    this.renderMessages(this.aiClient.getMessages());
  }

  private initLayout(): void {
    this.container.innerHTML = `
      <div class="studio-chat-wrapper">
        <div class="studio-chat-header">
          <div class="chat-header-left">
            <span class="chat-sparkle-icon">${ICON_SPARKLE}</span>
            <span class="chat-title">Mintu AI</span>
            <button type="button" class="dataflow-pill" id="studio-chat-dataflow" title="Model və API tənzimləmələri">
              <span class="dataflow-dot"></span>
              <span class="dataflow-label">Lokal</span>
            </button>
          </div>
          <div class="chat-header-actions">
            <button type="button" id="btn-studio-history" class="studio-btn-icon" title="Tarixçə / Yeni söhbət">${ICON_HISTORY}</button>
            <button type="button" id="btn-studio-expand" class="studio-btn-icon" title="Paneli genişləndir">${ICON_EXPAND}</button>
            <button type="button" id="btn-studio-close" class="studio-btn-icon" title="Paneli gizlət">${ICON_CLOSE}</button>
          </div>
        </div>

        <div class="studio-messages-list" id="studio-messages-list"></div>

        <div class="studio-chat-footer">
          <div class="attached-context-block" id="studio-attached-wrap" style="display: none;"></div>
          <div class="studio-composer">
            <textarea
              id="studio-chat-input"
              placeholder="Mintu-dan istənilən sualı soruşun..."
              rows="2"
            ></textarea>
            <div class="studio-composer-bar">
              <button type="button" id="btn-composer-attach" class="studio-btn-icon" title="Aktiv Faylı Qoş">${ICON_PAPERCLIP}</button>
              <button type="button" id="btn-studio-send" class="studio-send-btn" title="Göndər">${ICON_SEND}</button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.messagesListEl = this.container.querySelector("#studio-messages-list") as HTMLElement;
    this.inputEl = this.container.querySelector("#studio-chat-input") as HTMLTextAreaElement;
    this.sendBtn = this.container.querySelector("#btn-studio-send") as HTMLButtonElement;
    this.attachedTrayWrapEl = this.container.querySelector("#studio-attached-wrap") as HTMLElement;
    this.providerBadgeEl = this.container.querySelector("#studio-chat-dataflow") as HTMLButtonElement;

    this.updateProviderBadge();
  }

  private initEvents(): void {
    this.aiClient.onMessagesChanged = (messages) => {
      if (!this.showingHistory) {
        this.renderMessages(messages);
      }
    };

    this.aiClient.onStateChanged = (generating) => {
      this.updateProviderBadge();
      this.onBusyStateChange?.(generating);
      if (generating) {
        this.sendBtn.title = "Dayandır";
        this.sendBtn.innerHTML = ICON_STOP;
      } else {
        this.sendBtn.title = "Göndər";
        this.sendBtn.innerHTML = ICON_SEND;
      }
    };

    this.providerBadgeEl.addEventListener("click", () => {
      this.onOpenSettings?.();
    });

    this.container.querySelector("#btn-studio-history")?.addEventListener("click", () => {
      this.showingHistory = !this.showingHistory;
      if (this.showingHistory) {
        this.renderHistoryView();
      } else {
        this.renderMessages(this.aiClient.getMessages());
      }
    });

    this.container.querySelector("#btn-studio-expand")?.addEventListener("click", () => {
      this.onExpandToggle?.();
    });

    this.container.querySelector("#btn-studio-close")?.addEventListener("click", () => {
      this.onClosePanel?.();
    });

    this.container.querySelector("#btn-composer-attach")?.addEventListener("click", () => {
      this.onAttachButtonClick?.();
    });

    this.sendBtn.addEventListener("click", () => {
      if (this.aiClient.isBusy()) {
        this.aiClient.stopGeneration();
      } else {
        this.handleSend();
      }
    });

    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (!this.aiClient.isBusy()) {
          this.handleSend();
        }
      }
    });

    this.inputEl.addEventListener("input", () => {
      this.inputEl.style.height = "auto";
      this.inputEl.style.height = `${Math.min(this.inputEl.scrollHeight, 130)}px`;
    });
  }

  public updateProviderBadge(): void {
    const routing = this.aiClient.getActiveRouting();
    const labelEl = this.providerBadgeEl.querySelector(".dataflow-label");
    if (routing.isLocal) {
      this.providerBadgeEl.className = "dataflow-pill is-local";
      if (labelEl) labelEl.textContent = "Lokal";
      this.providerBadgeEl.title = `Lokal model: ${routing.model}`;
    } else {
      this.providerBadgeEl.className = "dataflow-pill is-cloud";
      if (labelEl) labelEl.textContent = `Bulud: ${routing.provider}`;
      this.providerBadgeEl.title = `Bulud modeli: ${routing.provider} (${routing.model})`;
    }
  }

  public attachFile(path: string, content: string): void {
    const sizeBytes = new TextEncoder().encode(content).length;
    this.attachedFiles.set(path, { content, sizeBytes });
    this.renderAttachedTray();
    this.notifyAttachedChanged();
  }

  public detachFile(path: string): void {
    if (!this.attachedFiles.has(path)) return;
    this.attachedFiles.delete(path);
    this.renderAttachedTray();
    this.notifyAttachedChanged();
    this.onFileRemoved?.(path);
  }

  public getAttachedSummaries(): ContextFileSummary[] {
    const list: ContextFileSummary[] = [];
    this.attachedFiles.forEach((data, path) => {
      list.push({ path, sizeBytes: data.sizeBytes });
    });
    return list;
  }

  private notifyAttachedChanged(): void {
    this.onAttachedChanged?.(this.getAttachedSummaries());
  }

  private renderAttachedTray(): void {
    if (this.attachedFiles.size === 0) {
      this.attachedTrayWrapEl.style.display = "none";
      this.attachedTrayWrapEl.innerHTML = "";
      return;
    }

    let totalBytes = 0;
    this.attachedFiles.forEach((v) => {
      totalBytes += v.sizeBytes;
    });

    this.attachedTrayWrapEl.style.display = "flex";
    this.attachedTrayWrapEl.innerHTML = "";

    const summaryEl = document.createElement("div");
    summaryEl.className = "attached-summary-line";
    summaryEl.textContent = `${this.attachedFiles.size} fayl · ${formatByteSize(totalBytes)} kontekstdə`;
    this.attachedTrayWrapEl.appendChild(summaryEl);

    const chipsRow = document.createElement("div");
    chipsRow.className = "attached-files-tray";

    this.attachedFiles.forEach((data, path) => {
      const chip = document.createElement("div");
      chip.className = "attached-chip";
      chip.title = `${path} (${formatByteSize(data.sizeBytes)})`;

      const nameSpan = document.createElement("span");
      nameSpan.className = "chip-name";
      nameSpan.textContent = path.split("/").pop() || path;

      const sizeSpan = document.createElement("span");
      sizeSpan.className = "chip-size";
      sizeSpan.textContent = formatByteSize(data.sizeBytes);

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "chip-remove";
      removeBtn.innerHTML = ICON_CLOSE;
      removeBtn.title = "Kontekstdən çıxar";
      removeBtn.addEventListener("click", () => this.detachFile(path));

      chip.appendChild(nameSpan);
      chip.appendChild(sizeSpan);
      chip.appendChild(removeBtn);
      chipsRow.appendChild(chip);
    });

    this.attachedTrayWrapEl.appendChild(chipsRow);
  }

  private prefillComposer(template: string): void {
    const fileList = Array.from(this.attachedFiles.keys());
    const prefix =
      fileList.length > 0
        ? `[Fayllar: ${fileList.map((f) => f.split("/").pop()).join(", ")}]\n`
        : "";
    this.inputEl.value = `${prefix}${template}`;
    this.inputEl.style.height = "auto";
    this.inputEl.style.height = `${Math.min(this.inputEl.scrollHeight, 130)}px`;
    this.inputEl.focus();
    this.inputEl.setSelectionRange(this.inputEl.value.length, this.inputEl.value.length);
  }

  private async handleSend(): Promise<void> {
    const text = this.inputEl.value.trim();
    if (!text) return;

    this.showingHistory = false;

    const filesToSend: Array<{ filename: string; content: string }> = [];
    this.attachedFiles.forEach((data, filename) => {
      filesToSend.push({ filename, content: data.content });
    });

    const routing = this.aiClient.getActiveRouting();
    this.onMessageDispatched?.(
      routing,
      filesToSend.map((f) => f.filename)
    );

    this.inputEl.value = "";
    this.inputEl.style.height = "auto";

    await this.aiClient.sendMessage(text, filesToSend.length > 0 ? filesToSend : undefined);
  }

  private loadSavedSessions(): SavedChatSession[] {
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  }

  private saveCurrentSessionToHistory(): void {
    const current = this.aiClient.getMessages();
    if (current.length === 0) return;
    const firstUser = current.find((m) => m.role === "user");
    const title = (firstUser?.content || "Söhbət").slice(0, 48);
    const sessions = this.loadSavedSessions();
    sessions.unshift({
      id: `sess_${Date.now()}`,
      title,
      timestamp: Date.now(),
      messages: current,
    });
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(sessions.slice(0, 20)));
    } catch {}
  }

  private renderHistoryView(): void {
    const sessions = this.loadSavedSessions();
    const currentCount = this.aiClient.getMessages().length;

    const listHtml =
      sessions.length === 0
        ? `<div class="history-empty">Yadda saxlanılmış söhbət yoxdur.</div>`
        : sessions
            .map(
              (s) => `
            <div class="history-item">
              <div class="history-item-title">${this.escapeHtml(s.title)}</div>
              <div class="history-item-meta">${s.messages.length} mesaj · ${new Date(s.timestamp).toLocaleTimeString()}</div>
            </div>
          `
            )
            .join("");

    this.messagesListEl.innerHTML = `
      <div class="history-panel">
        <div class="history-header-row">
          <span class="history-heading">Söhbət Tarixçəsi</span>
          <button type="button" class="studio-btn studio-btn-sm" id="btn-history-new-chat">Yeni Söhbət</button>
        </div>
        ${currentCount > 0 ? `<div class="history-current-note">Aktiv söhbətdə ${currentCount} mesaj var. "Yeni Söhbət" onu tarixçəyə saxlayıb təmizləyir.</div>` : ""}
        <div class="history-list">${listHtml}</div>
      </div>
    `;

    this.messagesListEl.querySelector("#btn-history-new-chat")?.addEventListener("click", () => {
      this.saveCurrentSessionToHistory();
      this.aiClient.clearMessages();
      this.showingHistory = false;
      this.renderMessages([]);
    });
  }

  private renderMessages(messages: StudioChatMessage[]): void {
    if (!messages || messages.length === 0) {
      const chipsHtml = QUICK_CHIPS.map(
        (c, i) => `
          <button type="button" class="quick-action-chip" data-chip-idx="${i}">
            <span class="quick-chip-icon">${c.icon}</span>
            <span>${c.label}</span>
          </button>
        `
      ).join("");

      this.messagesListEl.innerHTML = `
        <div class="chat-empty-state">
          <div class="chat-empty-logo">${MINTU_LOGO_SVG(36)}</div>
          <div class="chat-empty-title">Mintu AI</div>
          <div class="chat-empty-tagline">Kodlaşdırma üzrə süni intellekt tərəfdaşınız</div>
          <div class="quick-chips-stack">${chipsHtml}</div>
        </div>
      `;

      this.messagesListEl.querySelectorAll<HTMLButtonElement>(".quick-action-chip").forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = Number(btn.dataset.chipIdx);
          const def = QUICK_CHIPS[idx];
          if (def) this.prefillComposer(def.template);
        });
      });
      return;
    }

    this.messagesListEl.innerHTML = "";

    for (const msg of messages) {
      const msgRow = document.createElement("div");
      msgRow.className = `studio-msg-row ${msg.role === "user" ? "user-row" : "assistant-row"}`;

      const bubble = document.createElement("div");
      bubble.className = `studio-msg-bubble ${msg.role === "user" ? "user-bubble" : "assistant-bubble"}`;

      if (msg.role === "user" && msg.attachedFiles && msg.attachedFiles.length > 0) {
        const badgeContainer = document.createElement("div");
        badgeContainer.className = "msg-badge-container";

        const badge = document.createElement("span");
        if (msg.routing?.isLocal) {
          badge.className = "dataflow-pill is-local";
          badge.innerHTML = `<span class="dataflow-dot"></span><span>Lokal</span>`;
          badge.title = "Fayl məzmunu yalnız yerli kompüterdə emal olunur";
        } else {
          badge.className = "dataflow-pill is-cloud";
          badge.innerHTML = `<span class="dataflow-dot"></span><span>Bulud: ${this.escapeHtml(msg.routing?.provider || "cloud")}</span>`;
          badge.title = `Fayl məzmunu ${msg.routing?.provider} bulud modelinə göndərildi`;
        }
        badgeContainer.appendChild(badge);

        const filesPills = document.createElement("div");
        filesPills.className = "msg-attached-pills";
        for (const f of msg.attachedFiles) {
          const pill = document.createElement("span");
          pill.className = "msg-file-pill";
          pill.textContent = f.split("/").pop() || f;
          pill.title = f;
          filesPills.appendChild(pill);
        }
        badgeContainer.appendChild(filesPills);
        bubble.appendChild(badgeContainer);
      }

      const contentEl = document.createElement("div");
      contentEl.className = "msg-content";

      if (msg.role === "assistant") {
        if (!msg.content && this.aiClient.isBusy()) {
          contentEl.innerHTML = `<span class="thinking-spinner">Mintu düşünür...</span>`;
        } else {
          contentEl.innerHTML = MarkdownRenderer.render(msg.content);
        }
      } else {
        contentEl.textContent = msg.content;
      }

      bubble.appendChild(contentEl);
      msgRow.appendChild(bubble);
      this.messagesListEl.appendChild(msgRow);
    }

    this.messagesListEl.scrollTop = this.messagesListEl.scrollHeight;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
}
