/**
 * StudioChat.ts
 * Standalone Agent chat panel for Mintu Studio.
 * Enforces:
 * - Tool calling DISABLED for Phase 1.
 * - Project file attachments wrapped in <untrusted_data> envelope (inside StudioAIClient).
 * - Clear green "local model" vs orange "sent to cloud: <provider>" badge on every message with files.
 */

import { MarkdownRenderer } from "../ai/MarkdownRenderer";
import { StudioAIClient, StudioChatMessage } from "../ai/StudioAIClient";

export class StudioChat {
  private container: HTMLElement;
  private aiClient: StudioAIClient;
  private attachedFiles: Map<string, string> = new Map();

  private messagesListEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private attachedTrayEl!: HTMLElement;
  private providerBadgeEl!: HTMLElement;

  public onFileRemoved?: (path: string) => void;
  public onOpenSettings?: () => void;

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
            <span class="chat-title">Mintu Agent</span>
            <button type="button" class="provider-badge provider-badge-btn" id="studio-provider-badge" title="Model və API tənzimləmələrini aç">Yüklənir...</button>
          </div>
          <div class="chat-header-actions">
            <button id="btn-studio-clear-chat" class="studio-btn-icon" title="Söhbəti Təmizlə">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </div>

        <div class="studio-messages-list" id="studio-messages-list"></div>

        <div class="studio-chat-footer">
          <div class="attached-files-tray" id="studio-attached-tray"></div>
          <div class="studio-input-box">
            <textarea
              id="studio-chat-input"
              placeholder="Fayllar və kod haqqında sual verin... (Shift+Enter yeni sətir)"
              rows="1"
            ></textarea>
            <button id="btn-studio-send" class="studio-send-btn" title="Göndər">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            </button>
          </div>
        </div>
      </div>
    `;

    this.messagesListEl = this.container.querySelector("#studio-messages-list") as HTMLElement;
    this.inputEl = this.container.querySelector("#studio-chat-input") as HTMLTextAreaElement;
    this.sendBtn = this.container.querySelector("#btn-studio-send") as HTMLButtonElement;
    this.attachedTrayEl = this.container.querySelector("#studio-attached-tray") as HTMLElement;
    this.providerBadgeEl = this.container.querySelector("#studio-provider-badge") as HTMLElement;

    this.updateProviderBadge();
  }

  private initEvents(): void {
    this.aiClient.onMessagesChanged = (messages) => {
      this.renderMessages(messages);
    };

    this.aiClient.onStateChanged = (generating) => {
      this.updateProviderBadge();
      if (generating) {
        this.sendBtn.title = "Dayandır";
        this.sendBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>`;
      } else {
        this.sendBtn.title = "Göndər";
        this.sendBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`;
      }
    };

    this.providerBadgeEl.addEventListener("click", () => {
      this.onOpenSettings?.();
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
      this.inputEl.style.height = `${Math.min(this.inputEl.scrollHeight, 120)}px`;
    });

    const clearChatBtn = this.container.querySelector("#btn-studio-clear-chat");
    clearChatBtn?.addEventListener("click", () => {
      this.aiClient.clearMessages();
    });
  }

  public updateProviderBadge(): void {
    const routing = this.aiClient.getActiveRouting();
    if (routing.isLocal) {
      this.providerBadgeEl.className = "provider-badge provider-badge-btn badge-local";
      this.providerBadgeEl.textContent = `local model (${routing.model})`;
    } else {
      this.providerBadgeEl.className = "provider-badge provider-badge-btn badge-cloud";
      this.providerBadgeEl.textContent = `cloud: ${routing.provider}`;
    }
  }

  public attachFile(path: string, content: string): void {
    this.attachedFiles.set(path, content);
    this.renderAttachedTray();
  }

  public detachFile(path: string): void {
    this.attachedFiles.delete(path);
    this.renderAttachedTray();
    this.onFileRemoved?.(path);
  }

  public isFileAttached(path: string): boolean {
    return this.attachedFiles.has(path);
  }

  private renderAttachedTray(): void {
    this.attachedTrayEl.innerHTML = "";
    if (this.attachedFiles.size === 0) {
      this.attachedTrayEl.style.display = "none";
      return;
    }

    this.attachedTrayEl.style.display = "flex";
    this.attachedFiles.forEach((_, path) => {
      const chip = document.createElement("div");
      chip.className = "attached-chip";

      const nameSpan = document.createElement("span");
      nameSpan.className = "chip-name";
      nameSpan.textContent = path.split("/").pop() || path;
      nameSpan.title = path;

      const removeBtn = document.createElement("button");
      removeBtn.className = "chip-remove";
      removeBtn.innerHTML = "&times;";
      removeBtn.title = "Çıxar";
      removeBtn.onclick = () => this.detachFile(path);

      chip.appendChild(nameSpan);
      chip.appendChild(removeBtn);
      this.attachedTrayEl.appendChild(chip);
    });
  }

  private async handleSend(): Promise<void> {
    const text = this.inputEl.value.trim();
    if (!text) return;

    const filesToSend: Array<{ filename: string; content: string }> = [];
    this.attachedFiles.forEach((content, filename) => {
      filesToSend.push({ filename, content });
    });

    this.inputEl.value = "";
    this.inputEl.style.height = "auto";

    await this.aiClient.sendMessage(text, filesToSend.length > 0 ? filesToSend : undefined);
  }

  private renderMessages(messages: StudioChatMessage[]): void {
    if (!messages || messages.length === 0) {
      this.messagesListEl.innerHTML = `
        <div class="chat-welcome">
          <div class="welcome-title">Mintu Studio Agent</div>
          <div class="welcome-text">Layihə fayllarını qoşaraq kod haqqında suallar verə, arxitekturanı müzakirə edə və refaktorinq təklifləri ala bilərsiniz.</div>
        </div>
      `;
      return;
    }

    this.messagesListEl.innerHTML = "";

    for (const msg of messages) {
      const msgRow = document.createElement("div");
      msgRow.className = `studio-msg-row ${msg.role === "user" ? "user-row" : "assistant-row"}`;

      const bubble = document.createElement("div");
      bubble.className = `studio-msg-bubble ${msg.role === "user" ? "user-bubble" : "assistant-bubble"}`;

      // Show routing badge + attached file chips whenever a user message includes project files
      if (msg.role === "user" && msg.attachedFiles && msg.attachedFiles.length > 0) {
        const badgeContainer = document.createElement("div");
        badgeContainer.className = "msg-badge-container";

        const badge = document.createElement("span");
        if (msg.routing?.isLocal) {
          badge.className = "studio-badge badge-local";
          badge.textContent = "local model";
          badge.title = "Fayl məzmunu yalnız yerli kompüterdə emal olunur";
        } else {
          badge.className = "studio-badge badge-cloud";
          badge.textContent = `sent to cloud: ${msg.routing?.provider || "cloud"}`;
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
}
