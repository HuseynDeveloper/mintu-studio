/**
 * StudioChat.ts
 * Right panel "Mintu AI" (Phase 2: Interactive Diff Approval, Approved Commands, MCP Tool Calls, Agent Steps).
 * - Never writes files or runs commands/MCP tools without explicit user click on "Tətbiq et" / "İcra et".
 * - Preserves Lokal (green) / Bulud (orange) semantic data-flow badges and 5 Azerbaijani quick-action chips.
 */

import { invoke } from "@tauri-apps/api/core";
import { copyTextReliable, MarkdownRenderer } from "../ai/MarkdownRenderer";
import { formatModelDisplayName } from "../ai/LocalModelDetector";
import {
  AgentMode,
  AgentProposal,
  ChatImageAttachment,
  CommandProposal,
  EditProposal,
  McpToolProposal,
  PackageInstallProposal,
  StudioAIClient,
  StudioChatMessage,
  StudioMessageRouting,
  WebFetchProposal,
  stripToolCallBlocks,
} from "../ai/StudioAIClient";
import { ContextFileSummary, formatByteSize } from "./BottomPanel";
import { computeLineDiff } from "./DiffUtils";
import { showInputDialog } from "./InputDialog";
import { studioSettings } from "./StudioSettings";
import { t } from "./i18n";
import { isSensitiveFileOrDir } from "./sensitiveFilter";
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

interface SlashPromptDef {
  command: string;
  label: string;
  template: string;
  custom?: boolean;
}

const CUSTOM_PROMPTS_KEY = "mintu_studio_custom_prompts_v1";

const BUILTIN_SLASH_PROMPTS: SlashPromptDef[] = [
  {
    command: "/review",
    label: "Deep Code Review",
    template: "Review the attached code thoroughly for bugs, edge cases, security risks, and maintainability improvements.",
  },
  {
    command: "/security",
    label: "OWASP Security Audit",
    template: "Perform a strict OWASP security audit on the attached code (injection, XSS, path traversal, auth, secrets) and fix any findings using <mintu_edit>.",
  },
  {
    command: "/optimize",
    label: "Performance Optimization",
    template: "Analyze performance bottlenecks in the attached code and optimize it cleanly using <mintu_edit>.",
  },
  {
    command: "/docs",
    label: "Add Documentation & Comments",
    template: "Add clear JSDoc/docstrings and concise inline documentation to the attached code using <mintu_edit>.",
  },
  {
    command: "/tests",
    label: "Generate Comprehensive Unit Tests",
    template: "Write comprehensive unit tests covering normal and edge cases for the attached code using <mintu_edit>.",
  },
  {
    command: "/explain",
    label: "Step-by-Step Architecture Explanation",
    template: "Explain the architecture, control flow, and every important function in the attached code step by step.",
  },
  {
    command: "/fix-all",
    label: "Find & Fix All Bugs",
    template: "Identify every syntax error, type mismatch, or runtime bug in the attached code and emit <mintu_edit> to fix them all.",
  },
];

interface QuickChipDef {
  labelKey: string;
  icon: string;
  template: string;
}

const QUICK_CHIPS: QuickChipDef[] = [
  {
    labelKey: "chipComponent",
    icon: ICON_CHIP_COMPONENT,
    template: "Create a clean reusable component matching the project style and emit <mintu_edit>: ",
  },
  {
    labelKey: "chipExplain",
    icon: ICON_CHIP_EXPLAIN,
    template: "Explain the logic, data flow, and key parts of the attached code step by step.",
  },
  {
    labelKey: "chipBug",
    icon: ICON_CHIP_BUG,
    template: "Find bugs and edge cases in the attached code and fix them using <mintu_edit>.",
  },
  {
    labelKey: "chipRefactor",
    icon: ICON_CHIP_REFACTOR,
    template: "Refactor the attached code to be cleaner and more modular using <mintu_edit>.",
  },
  {
    labelKey: "chipTest",
    icon: ICON_CHIP_TEST,
    template: "Write comprehensive unit tests for the attached code and add them using <mintu_edit>.",
  },
];

export class StudioChat {
  private container: HTMLElement;
  private aiClient: StudioAIClient;
  private attachedFiles: Map<string, { content: string; sizeBytes: number }> = new Map();
  private pendingImages: ChatImageAttachment[] = [];
  private lastCheckpoint: Array<{ path: string; previousContent: string | null }> = [];
  private showingHistory = false;
  private userScrolledUp = false;
  private expandedProposalIds: Set<string> = new Set();
  private peekStreamingEdit = false;
  private seenMessageIds: Set<string> = new Set();
  private seenProposalIds: Set<string> = new Set();
  private projectFiles: string[] = [];
  private mentionMatches: string[] = [];
  private mentionIdx = 0;
  private mentionRange: { start: number; end: number } | null = null;
  private slashMatches: SlashPromptDef[] = [];
  private slashIdx = 0;
  private customPrompts: SlashPromptDef[] = [];

  private messagesListEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private attachedTrayWrapEl!: HTMLElement;
  private providerBadgeEl!: HTMLButtonElement;
  private mentionPopupEl!: HTMLElement;
  private contextMenuEl!: HTMLElement;
  private contextMenuView: "root" | "files" | "folders" | "mentions" | "actions" = "root";
  private contextFileFilter = "";

  public onFileRemoved?: (path: string) => void;
  public onAttachedChanged?: (files: ContextFileSummary[]) => void;
  public onMentionAttachFile?: (relPath: string) => Promise<void>;
  public onOpenSettings?: () => void;
  public onOpenLocalPermissions?: () => void;
  public onAttachButtonClick?: () => void;
  public onRequestProblemsContext?: () => string;
  public onRequestGitDiffContext?: () => Promise<string>;
  public onRequestTerminalContext?: () => string;
  public onExpandToggle?: () => void;
  public onClosePanel?: () => void;
  public onMessageDispatched?: (routing: StudioMessageRouting, files: string[]) => void;
  public onBusyStateChange?: (busy: boolean) => void;
  public onFileWrittenByAI?: (path: string, content: string, isNewFile: boolean) => void;
  public onAuditEvent?: (category: "read" | "send" | "blocked" | "system", msg: string, detail?: string) => void;

  constructor(container: HTMLElement, aiClient: StudioAIClient) {
    this.container = container;
    this.aiClient = aiClient;
    this.loadCustomPrompts();
    this.initLayout();
    this.initEvents();
    this.renderMessages(this.aiClient.getMessages());
    studioSettings.subscribe(() => {
      this.refreshLocalizedChrome();
      if (this.showingHistory) this.renderHistoryView();
      else this.renderMessages(this.aiClient.getMessages());
    });
  }

  private refreshLocalizedChrome(): void {
    if (this.inputEl) this.inputEl.placeholder = t("composerPlaceholder");
    const newChatBtn = this.container.querySelector("#btn-studio-new-chat") as HTMLElement | null;
    if (newChatBtn) newChatBtn.title = t("newChat");
    const histBtn = this.container.querySelector("#btn-studio-history") as HTMLElement | null;
    if (histBtn) histBtn.title = t("chatHistory");
    const compactBtn = this.container.querySelector("#btn-studio-compact") as HTMLElement | null;
    if (compactBtn) compactBtn.title = t("compactChat");
    const cpBtn = this.container.querySelector("#btn-studio-checkpoint") as HTMLElement | null;
    if (cpBtn) cpBtn.title = t("revertCheckpoint");
    const imgBtn = this.container.querySelector("#btn-composer-image") as HTMLElement | null;
    if (imgBtn) imgBtn.title = t("attachImage");
    const attBtn = this.container.querySelector("#btn-composer-attach") as HTMLElement | null;
    if (attBtn) attBtn.title = t("attachActive");
    const expBtn = this.container.querySelector("#btn-studio-expand") as HTMLElement | null;
    if (expBtn) expBtn.title = t("expand");
    const closeBtn = this.container.querySelector("#btn-studio-close") as HTMLElement | null;
    if (closeBtn) closeBtn.title = t("hide");
    const dropOverlay = this.container.querySelector("#studio-chat-drop-overlay");
    if (dropOverlay) dropOverlay.textContent = t("dropFilesHint");
    this.updateAgentModeUI();
  }

  private updateAgentModeUI(): void {
    const mode = this.aiClient.getAgentMode();
    this.container.querySelectorAll<HTMLButtonElement>("[data-agent-mode]").forEach((btn) => {
      const m = btn.dataset.agentMode as AgentMode;
      btn.classList.toggle("is-active", m === mode);
      if (m === "ask") btn.title = t("modeAskTip");
      else if (m === "plan") btn.title = t("modePlanTip");
      else btn.title = t("modeCodeTip");
    });
  }

  private initLayout(): void {
    const curMode = this.aiClient.getAgentMode();
    this.container.innerHTML = `
      <div class="studio-chat-wrapper" id="studio-chat-wrapper">
        <div class="chat-drop-overlay" id="studio-chat-drop-overlay" style="display: none;">${t("dropFilesHint")}</div>
        <div class="studio-chat-header">
          <div class="chat-header-left">
            <span class="chat-sparkle-icon">${ICON_SPARKLE}</span>
            <span class="chat-title">Mintu AI</span>
            <button type="button" class="dataflow-pill" id="studio-chat-dataflow" title="${t("models")}">
              <span class="dataflow-label">${t("local")}</span>
            </button>
          </div>
          <div class="chat-header-actions">
            <button type="button" id="btn-studio-new-chat" class="studio-btn-icon" title="${t("newChat")}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </button>
            <button type="button" id="btn-studio-checkpoint" class="studio-btn-icon" style="display: none;" title="${t("revertCheckpoint")}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
              </svg>
            </button>
            <button type="button" id="btn-studio-compact" class="studio-btn-icon" title="${t("compactChat")}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                <polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/>
                <line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/>
              </svg>
            </button>
            <button type="button" id="btn-studio-export-md" class="studio-btn-icon" title="${t("exportChatMd")}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </button>
            <button type="button" id="btn-studio-history" class="studio-btn-icon" title="${t("chatHistory")}">${ICON_HISTORY}</button>
            <button type="button" id="btn-studio-expand" class="studio-btn-icon" title="${t("expand")}">${ICON_EXPAND}</button>
            <button type="button" id="btn-studio-close" class="studio-btn-icon" title="${t("hide")}">${ICON_CLOSE}</button>
          </div>
        </div>

        <div class="studio-messages-list" id="studio-messages-list"></div>
        <button type="button" id="btn-chat-scroll-bottom" class="chat-scroll-bottom-btn" style="display: none;" title="Scroll to bottom">↓</button>

        <div class="studio-chat-footer">
          <div class="mention-popup" id="studio-mention-popup" style="display: none;"></div>
          <div class="context-menu-popover" id="studio-context-menu" style="display: none;"></div>
          <div class="pending-images-tray" id="studio-pending-images" style="display: none;"></div>
          <div class="attached-context-block" id="studio-attached-wrap" style="display: none;"></div>
          <div class="studio-composer">
            <textarea
              id="studio-chat-input"
              placeholder="${t("composerPlaceholder")}"
              rows="2"
            ></textarea>
            <div class="studio-composer-bar">
              <div class="composer-bar-left">
                <button type="button" id="btn-composer-attach" class="studio-btn-icon" title="${t("attachActive")}">${ICON_PAPERCLIP}</button>
                <button type="button" id="btn-composer-image" class="studio-btn-icon" title="${t("attachImage")}">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                    <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
                  </svg>
                </button>
                <div class="agent-mode-group" role="group" aria-label="Agent Mode">
                  <button type="button" class="agent-mode-pill ${curMode === "ask" ? "is-active" : ""}" data-agent-mode="ask" title="${t("modeAskTip")}">${t("modeAsk")}</button>
                  <button type="button" class="agent-mode-pill ${curMode === "plan" ? "is-active" : ""}" data-agent-mode="plan" title="${t("modePlanTip")}">${t("modePlan")}</button>
                  <button type="button" class="agent-mode-pill ${curMode === "code" ? "is-active" : ""}" data-agent-mode="code" title="${t("modeCodeTip")}">${t("modeCode")}</button>
                </div>
                <input type="file" id="studio-image-file-input" accept="image/png,image/jpeg,image/webp" multiple style="display: none;" />
              </div>
              <button type="button" id="btn-studio-send" class="studio-send-btn" title="${t("send")}">${ICON_SEND}</button>
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
    this.mentionPopupEl = this.container.querySelector("#studio-mention-popup") as HTMLElement;
    this.contextMenuEl = this.container.querySelector("#studio-context-menu") as HTMLElement;

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
        this.sendBtn.title = t("stop");
        this.sendBtn.innerHTML = ICON_STOP;
      } else {
        this.sendBtn.title = t("send");
        this.sendBtn.innerHTML = ICON_SEND;
      }
    };

    this.providerBadgeEl.addEventListener("click", () => this.onOpenSettings?.());

    // Delegated CSP-safe Copy button handler for all rendered Markdown code/CMD blocks
    this.messagesListEl.addEventListener("click", async (e) => {
      const target = e.target as HTMLElement | null;
      const copyBtn = target?.closest<HTMLButtonElement>("[data-copy-code]");
      if (!copyBtn) return;
      const codeBlock = copyBtn.closest(".mintu-code-block");
      const codeEl = codeBlock?.querySelector("code");
      const text = codeEl?.textContent || "";
      if (!text) return;
      const ok = await copyTextReliable(text);
      const span = copyBtn.querySelector("span");
      if (ok && span) {
        const prev = span.textContent;
        span.textContent = t("copiedLabel");
        copyBtn.classList.add("copied");
        setTimeout(() => {
          span.textContent = prev || "Copy";
          copyBtn.classList.remove("copied");
        }, 1600);
      }
    });

    // Smart auto-scroll: never yank user down if they scrolled up while AI is streaming!
    const scrollBottomBtn = this.container.querySelector("#btn-chat-scroll-bottom") as HTMLButtonElement | null;
    this.messagesListEl.addEventListener(
      "scroll",
      () => {
        const distFromBottom =
          this.messagesListEl.scrollHeight - this.messagesListEl.scrollTop - this.messagesListEl.clientHeight;
        this.userScrolledUp = distFromBottom > 56;
        if (scrollBottomBtn) {
          scrollBottomBtn.style.display = this.userScrolledUp ? "inline-flex" : "none";
        }
      },
      { passive: true }
    );

    scrollBottomBtn?.addEventListener("click", () => {
      this.userScrolledUp = false;
      this.messagesListEl.scrollTop = this.messagesListEl.scrollHeight;
      scrollBottomBtn.style.display = "none";
    });

    this.container.querySelector("#btn-studio-new-chat")?.addEventListener("click", () => {
      this.aiClient.createNewSession(t("newChat"));
      this.showingHistory = false;
    this.userScrolledUp = false;
    this.peekStreamingEdit = false;
      this.renderMessages([]);
      this.inputEl.focus();
    });

    this.container.querySelectorAll<HTMLButtonElement>("[data-agent-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.dataset.agentMode as AgentMode;
        if (mode) {
          this.aiClient.setAgentMode(mode);
          this.updateAgentModeUI();
        }
      });
    });

    // Drag & Drop images or non-sensitive text files directly into Mintu AI chat
    const wrapper = this.container.querySelector("#studio-chat-wrapper") as HTMLElement | null;
    const dropOverlay = this.container.querySelector("#studio-chat-drop-overlay") as HTMLElement | null;
    if (wrapper && dropOverlay) {
      let dragDepth = 0;
      wrapper.addEventListener("dragenter", (e) => {
        if (!e.dataTransfer?.types.includes("Files")) return;
        e.preventDefault();
        dragDepth++;
        dropOverlay.style.display = "flex";
      });
      wrapper.addEventListener("dragover", (e) => {
        if (!e.dataTransfer?.types.includes("Files")) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      });
      wrapper.addEventListener("dragleave", () => {
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) dropOverlay.style.display = "none";
      });
      wrapper.addEventListener("drop", (e) => {
        e.preventDefault();
        dragDepth = 0;
        dropOverlay.style.display = "none";
        const files = e.dataTransfer?.files;
        if (!files || files.length === 0) return;
        for (const f of Array.from(files)) {
          if (f.type.startsWith("image/")) {
            this.ingestImageFile(f);
          } else {
            this.ingestDroppedTextFile(f);
          }
        }
      });
    }

    this.container.querySelector("#btn-studio-history")?.addEventListener("click", () => {
      this.showingHistory = !this.showingHistory;
      if (this.showingHistory) {
        this.renderHistoryView();
      } else {
        this.renderMessages(this.aiClient.getMessages());
      }
    });

    this.container.querySelector("#btn-studio-expand")?.addEventListener("click", () => this.onExpandToggle?.());
    this.container.querySelector("#btn-studio-close")?.addEventListener("click", () => this.onClosePanel?.());
    this.container.querySelector("#btn-composer-attach")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleContextMenu();
    });
    document.addEventListener("click", (e) => {
      if (this.contextMenuEl.style.display === "none") return;
      const target = e.target as Node | null;
      if (target && !this.contextMenuEl.contains(target) && !(target as HTMLElement).closest?.("#btn-composer-attach")) {
        this.hideContextMenu();
      }
    });

    this.container.querySelector("#btn-studio-compact")?.addEventListener("click", async () => {
      if (this.aiClient.isBusy()) return;
      const ok = await this.aiClient.compactConversation();
      if (ok) this.onAuditEvent?.("system", "Chat compacted.");
    });

    this.container.querySelector("#btn-studio-export-md")?.addEventListener("click", () => {
      this.exportActiveChatMarkdown();
    });

    this.container.querySelector("#btn-studio-checkpoint")?.addEventListener("click", async () => {
      await this.revertLastCheckpoint();
    });

    const imgFileInput = this.container.querySelector("#studio-image-file-input") as HTMLInputElement | null;
    this.container.querySelector("#btn-composer-image")?.addEventListener("click", () => {
      imgFileInput?.click();
    });
    imgFileInput?.addEventListener("change", () => {
      if (imgFileInput.files) {
        for (const f of Array.from(imgFileInput.files)) {
          this.ingestImageFile(f);
        }
        imgFileInput.value = "";
      }
    });

    this.inputEl.addEventListener("paste", (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const blob = item.getAsFile();
          if (blob) {
            e.preventDefault();
            this.ingestImageFile(blob);
          }
        }
      }
    });

    this.sendBtn.addEventListener("click", () => {
      if (this.aiClient.isBusy()) {
        this.aiClient.stopGeneration();
      } else {
        this.handleSend();
      }
    });

    this.inputEl.addEventListener("keydown", (e) => {
      if (this.slashMatches.length > 0 && this.mentionPopupEl.style.display !== "none") {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          this.slashIdx = (this.slashIdx + 1) % this.slashMatches.length;
          this.renderSlashPopup();
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          this.slashIdx = (this.slashIdx - 1 + this.slashMatches.length) % this.slashMatches.length;
          this.renderSlashPopup();
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          const chosen = this.slashMatches[this.slashIdx];
          if (chosen) this.pickSlashPrompt(chosen);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          this.hideMentionPopup();
          return;
        }
      }

      if (this.mentionMatches.length > 0 && this.mentionPopupEl.style.display !== "none") {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          this.mentionIdx = (this.mentionIdx + 1) % this.mentionMatches.length;
          this.renderMentionPopup();
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          this.mentionIdx = (this.mentionIdx - 1 + this.mentionMatches.length) % this.mentionMatches.length;
          this.renderMentionPopup();
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          const chosen = this.mentionMatches[this.mentionIdx];
          if (chosen) void this.pickMentionFile(chosen);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          this.hideMentionPopup();
          return;
        }
      }

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
      if (!this.updateSlashSuggestions()) {
        this.updateMentionSuggestions();
      }
    });
  }

  private loadCustomPrompts(): void {
    try {
      const raw = localStorage.getItem(CUSTOM_PROMPTS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) this.customPrompts = parsed;
      }
    } catch {}
  }

  private saveCustomPrompts(): void {
    try {
      localStorage.setItem(CUSTOM_PROMPTS_KEY, JSON.stringify(this.customPrompts.slice(0, 30)));
    } catch {}
  }

  private exportActiveChatMarkdown(): void {
    const msgs = this.aiClient.getMessages();
    if (msgs.length === 0) return;
    const lines: string[] = [`# Mintu AI Chat Export`, `Exported: ${new Date().toLocaleString()}`, ""];
    for (const m of msgs) {
      const heading = m.role === "user" ? "## User" : "## Mintu AI";
      const body = m.role === "assistant" ? stripToolCallBlocks(m.content) || m.content : m.content;
      lines.push(heading, "", body, "");
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mintu-chat-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
    this.onAuditEvent?.("system", "Chat exported as Markdown (.md)");
  }

  private updateSlashSuggestions(): boolean {
    const val = this.inputEl.value;
    if (!val.startsWith("/") || val.includes("\n")) {
      this.slashMatches = [];
      return false;
    }
    const q = val.trim().toLowerCase();
    const all = [...BUILTIN_SLASH_PROMPTS, ...this.customPrompts];
    const filtered = all.filter(
      (p) => p.command.toLowerCase().includes(q) || p.label.toLowerCase().includes(q)
    );
    this.slashMatches = filtered;
    this.slashIdx = 0;
    this.mentionMatches = [];
    this.renderSlashPopup();
    return true;
  }

  private renderSlashPopup(): void {
    this.mentionPopupEl.style.display = "flex";
    const itemsHtml = this.slashMatches
      .map(
        (p, idx) => `
          <button type="button" class="mention-item ${idx === this.slashIdx ? "is-selected" : ""}" data-slash-idx="${idx}">
            <span class="mention-name">${this.escapeHtml(p.command)}</span>
            <span class="mention-path">${this.escapeHtml(p.label)}</span>
          </button>
        `
      )
      .join("");

    this.mentionPopupEl.innerHTML = `
      <div class="slash-popup-head">
        <span>${t("slashTitle")}</span>
        <button type="button" class="studio-btn studio-btn-sm" id="btn-slash-add-prompt">${t("slashSavePrompt")}</button>
      </div>
      ${itemsHtml}
    `;

    this.mentionPopupEl.querySelectorAll<HTMLButtonElement>("[data-slash-idx]").forEach((btn) => {
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const chosen = this.slashMatches[Number(btn.dataset.slashIdx || 0)];
        if (chosen) this.pickSlashPrompt(chosen);
      });
    });

    this.mentionPopupEl.querySelector("#btn-slash-add-prompt")?.addEventListener("mousedown", (e) => {
      e.preventDefault();
      void this.promptSaveCustomSlash();
    });
  }

  private async promptSaveCustomSlash(): Promise<void> {
    this.hideMentionPopup();
    const cmdRaw = await showInputDialog({
      title: t("slashSavePrompt"),
      label: "Slash command (e.g. /mycheck)",
      placeholder: "/mycheck",
      confirmText: t("save"),
    });
    if (!cmdRaw) return;
    const body = await showInputDialog({
      title: t("slashSavePrompt"),
      label: "Prompt text",
      placeholder: "Check all error handling and add logging...",
      confirmText: t("save"),
    });
    if (!body) return;
    const command = cmdRaw.startsWith("/") ? cmdRaw.trim() : `/${cmdRaw.trim()}`;
    this.customPrompts.push({
      command,
      label: body.slice(0, 48),
      template: body,
      custom: true,
    });
    this.saveCustomPrompts();
  }

  private pickSlashPrompt(item: SlashPromptDef): void {
    this.hideMentionPopup();
    this.prefillComposer(item.template);
  }

  public setProjectFiles(files: string[]): void {
    this.projectFiles = files;
  }

  public sendPrefilledPrompt(text: string, autoSend = false): void {
    this.showingHistory = false;
    this.userScrolledUp = false;
    this.peekStreamingEdit = false;
    this.inputEl.value = text;
    this.inputEl.style.height = "auto";
    this.inputEl.style.height = `${Math.min(this.inputEl.scrollHeight, 130)}px`;
    this.inputEl.focus();
    if (autoSend && !this.aiClient.isBusy()) {
      void this.handleSend();
    }
  }

  private hideMentionPopup(): void {
    this.mentionMatches = [];
    this.slashMatches = [];
    this.mentionRange = null;
    this.mentionPopupEl.style.display = "none";
    this.mentionPopupEl.innerHTML = "";
  }

  private updateMentionSuggestions(): void {
    const pos = this.inputEl.selectionStart || 0;
    const before = this.inputEl.value.slice(0, pos);
    const match = before.match(/(?:^|\s)@([^\s@]*)$/);
    if (!match || this.projectFiles.length === 0) {
      this.hideMentionPopup();
      return;
    }

    const query = match[1].toLowerCase();
    const start = pos - match[1].length - 1;
    this.mentionRange = { start, end: pos };

    const filtered = this.projectFiles
      .filter((f) => !isSensitiveFileOrDir(f) && (!query || f.toLowerCase().includes(query)))
      .slice(0, 8);

    if (filtered.length === 0) {
      this.hideMentionPopup();
      return;
    }

    this.mentionMatches = filtered;
    this.mentionIdx = 0;
    this.renderMentionPopup();
  }

  private renderMentionPopup(): void {
    this.mentionPopupEl.style.display = "flex";
    this.mentionPopupEl.innerHTML = this.mentionMatches
      .map(
        (path, idx) => `
          <button type="button" class="mention-item ${idx === this.mentionIdx ? "is-selected" : ""}" data-mention-idx="${idx}">
            <span class="mention-name">${this.escapeHtml(path.split("/").pop() || path)}</span>
            <span class="mention-path">${this.escapeHtml(path)}</span>
          </button>
        `
      )
      .join("");

    this.mentionPopupEl.querySelectorAll<HTMLButtonElement>(".mention-item").forEach((btn) => {
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const idx = Number(btn.dataset.mentionIdx || 0);
        const chosen = this.mentionMatches[idx];
        if (chosen) void this.pickMentionFile(chosen);
      });
    });
  }

  private async pickMentionFile(relPath: string): Promise<void> {
    if (this.mentionRange) {
      const val = this.inputEl.value;
      const inserted = `@${relPath} `;
      this.inputEl.value = val.slice(0, this.mentionRange.start) + inserted + val.slice(this.mentionRange.end);
      const nextPos = this.mentionRange.start + inserted.length;
      this.inputEl.setSelectionRange(nextPos, nextPos);
    }
    this.hideMentionPopup();
    await this.onMentionAttachFile?.(relPath);
    this.inputEl.focus();
  }

  public updateProviderBadge(): void {
    const routing = this.aiClient.getActiveRouting();
    const labelEl = this.providerBadgeEl.querySelector(".dataflow-label");
    this.providerBadgeEl.className = "dataflow-pill";
    if (routing.isLocal) {
      const cleanModel = formatModelDisplayName(routing.model);
      if (labelEl) labelEl.textContent = cleanModel;
      this.providerBadgeEl.title = `Lokal model: ${cleanModel}`;
    } else {
      if (labelEl) labelEl.textContent = routing.provider;
      this.providerBadgeEl.title = `${routing.provider} (${routing.model})`;
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

    const prefs = studioSettings.get();
    const ctxTokens = prefs.ctxSize || 4096;
    const estUsedTokens = Math.round(totalBytes / 4);
    const pct = Math.min(100, Math.round((estUsedTokens / ctxTokens) * 100));

    const summaryEl = document.createElement("div");
    summaryEl.className = "attached-summary-line";
    summaryEl.innerHTML = prefs.showContextMeter
      ? `<span>${this.attachedFiles.size} ${t("filesWord")} · ${formatByteSize(totalBytes)} ${t("inContext")}</span><span class="ctx-meter-label" title="~${estUsedTokens} / ${ctxTokens} tokens">${pct}% ${t("context").toLowerCase()}</span>`
      : `<span>${this.attachedFiles.size} ${t("filesWord")} · ${formatByteSize(totalBytes)} ${t("inContext")}</span>`;
    this.attachedTrayWrapEl.appendChild(summaryEl);

    if (prefs.showContextMeter) {
      const meterBar = document.createElement("div");
      meterBar.className = "ctx-meter-track";
      meterBar.innerHTML = `<div class="ctx-meter-fill ${pct > 85 ? "is-high" : ""}" style="width: ${pct}%;"></div>`;
      this.attachedTrayWrapEl.appendChild(meterBar);
    }

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
      removeBtn.title = t("removeFromContext");
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

  private ingestDroppedTextFile(file: File): void {
    const name = file.name || "file.txt";
    if (isSensitiveFileOrDir(name)) {
      this.onAuditEvent?.("blocked", `Sensitive dropped file blocked: ${name}`);
      return;
    }
    if (file.size > 512_000) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      if (text.includes("\0")) return; // skip binary files
      this.attachFile(name, text);
      this.onAuditEvent?.("read", `Dropped file attached: ${name}`);
    };
    reader.readAsText(file);
  }

  private ingestImageFile(file: File): void {
    if (this.pendingImages.length >= 4) return;
    if (file.size > 4_000_000) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const idx = dataUrl.indexOf(",");
      if (idx === -1) return;
      const base64 = dataUrl.slice(idx + 1);
      this.pendingImages.push({
        mime_type: file.type || "image/png",
        base64,
        name: file.name || "screenshot.png",
      });
      this.renderPendingImages();
    };
    reader.readAsDataURL(file);
  }

  private renderPendingImages(): void {
    const wrap = this.container.querySelector("#studio-pending-images") as HTMLElement | null;
    if (!wrap) return;
    if (this.pendingImages.length === 0) {
      wrap.style.display = "none";
      wrap.innerHTML = "";
      return;
    }
    wrap.style.display = "flex";
    wrap.innerHTML = this.pendingImages
      .map(
        (img, i) => `
        <div class="pending-img-chip">
          <img src="data:${this.escapeAttr(img.mime_type)};base64,${img.base64}" alt="img" class="pending-img-thumb" />
          <button type="button" class="pending-img-remove" data-rm-img="${i}" title="Remove">${ICON_CLOSE}</button>
        </div>
      `
      )
      .join("");
    wrap.querySelectorAll<HTMLButtonElement>("[data-rm-img]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.rmImg);
        this.pendingImages.splice(idx, 1);
        this.renderPendingImages();
      });
    });
  }

  private updateCheckpointButton(): void {
    const btn = this.container.querySelector("#btn-studio-checkpoint") as HTMLButtonElement | null;
    if (btn) {
      btn.style.display = this.lastCheckpoint.length > 0 ? "inline-flex" : "none";
      btn.title = `${t("revertCheckpoint")} (${this.lastCheckpoint.length})`;
    }
  }

  private async revertLastCheckpoint(): Promise<void> {
    if (this.lastCheckpoint.length === 0) return;
    const snapshot = [...this.lastCheckpoint];
    this.lastCheckpoint = [];
    this.updateCheckpointButton();
    for (const item of snapshot) {
      try {
        if (item.previousContent === null) {
          await invoke("studio_delete_entry", { relPath: item.path });
        } else {
          await invoke("studio_write_file", { relPath: item.path, content: item.previousContent });
          this.onFileWrittenByAI?.(item.path, item.previousContent, false);
        }
        this.onAuditEvent?.("system", `Checkpoint geri qaytarıldı: ${item.path}`);
      } catch (e: any) {
        this.onAuditEvent?.("blocked", `Checkpoint bərpa xətası (${item.path}): ${e}`);
      }
    }
  }

  private async handleSend(customText?: string): Promise<void> {
    const text = (customText ?? this.inputEl.value).trim();
    const imagesToSend = customText === undefined ? [...this.pendingImages] : [];
    if (!text && imagesToSend.length === 0) return;

    this.showingHistory = false;
    this.userScrolledUp = false;
    this.peekStreamingEdit = false;

    const filesToSend: Array<{ filename: string; content: string }> = [];
    this.attachedFiles.forEach((data, filename) => {
      filesToSend.push({ filename, content: data.content });
    });

    const routing = this.aiClient.getActiveRouting();
    this.onMessageDispatched?.(
      routing,
      filesToSend.map((f) => f.filename)
    );

    if (customText === undefined) {
      this.inputEl.value = "";
      this.inputEl.style.height = "auto";
      this.pendingImages = [];
      this.renderPendingImages();
    }

    await this.aiClient.sendMessage(
      text,
      filesToSend.length > 0 ? filesToSend : undefined,
      imagesToSend.length > 0 ? imagesToSend : undefined
    );
  }

  // --- Interactive Approval Actions ---

  private async applyEditProposal(prop: EditProposal, recordCheckpoint = true): Promise<void> {
    if (isSensitiveFileOrDir(prop.path)) {
      this.onAuditEvent?.("blocked", `Həssas fayl yazılması bloklandı: ${prop.path}`);
      return;
    }
    try {
      await invoke("studio_write_file", { relPath: prop.path, content: prop.content });
      prop.status = "applied";
      if (recordCheckpoint) {
        this.lastCheckpoint = [{ path: prop.path, previousContent: prop.previousContent }];
        this.updateCheckpointButton();
      }
      this.onFileWrittenByAI?.(prop.path, prop.content, prop.isNewFile);
      this.onAuditEvent?.("system", `AI dəyişikliyi tətbiq edildi: ${prop.path}`);
      this.aiClient.persistUpdates();
    } catch (err: any) {
      this.onAuditEvent?.("blocked", `Fayl yazılmadı (${prop.path}): ${err}`);
    }
  }

  private async revertEditProposal(prop: EditProposal): Promise<void> {
    if (prop.previousContent === null) return;
    try {
      await invoke("studio_write_file", { relPath: prop.path, content: prop.previousContent });
      prop.status = "reverted";
      this.onFileWrittenByAI?.(prop.path, prop.previousContent, false);
      this.onAuditEvent?.("system", `Dəyişiklik geri qaytarıldı: ${prop.path}`);
      this.aiClient.persistUpdates();
    } catch (err: any) {
      this.onAuditEvent?.("blocked", `Geri qaytarma xətası (${prop.path}): ${err}`);
    }
  }

  private async runCommandProposal(prop: CommandProposal): Promise<void> {
    prop.status = "running";
    this.aiClient.persistUpdates();
    this.onAuditEvent?.("system", `Təsdiqlənmiş komanda icra olunur: ${prop.command}`);
    try {
      const res = await invoke<{ exit_code: number; stdout: string; stderr: string; timed_out: boolean }>(
        "studio_run_approved_command",
        { command: prop.command }
      );
      prop.result = res;
      prop.status = "executed";
      this.onAuditEvent?.("system", `Komanda bitdi (exit ${res.exit_code}): ${prop.command}`);
    } catch (err: any) {
      prop.result = { exit_code: -1, stdout: "", stderr: String(err), timed_out: false };
      prop.status = "executed";
    }
    this.aiClient.persistUpdates();
  }

  // --- Antigravity-Style Attach / Context Picker Menu (Files, Folders, Mentions, Actions, Browser) ---

  private toggleContextMenu(): void {
    if (this.contextMenuEl.style.display !== "none") {
      this.hideContextMenu();
      return;
    }
    this.hideMentionPopup();
    this.contextMenuView = "root";
    this.contextFileFilter = "";
    this.contextMenuEl.style.display = "block";
    this.renderContextMenu();
  }

  private hideContextMenu(): void {
    this.contextMenuEl.style.display = "none";
    this.contextMenuEl.innerHTML = "";
  }

  private async openBrowserFetchDialog(): Promise<void> {
    this.hideContextMenu();
    const perm = studioSettings.get().permWebFetch || "ask";
    if (perm === "deny") {
      this.onAuditEvent?.("blocked", t("permBlockedMsg"));
      this.onOpenLocalPermissions?.();
      return;
    }
    const url = await showInputDialog({
      title: t("ctxFetchUrlTitle"),
      label: t("ctxFetchUrlLabel"),
      placeholder: t("ctxFetchUrlPlaceholder"),
      confirmText: t("ctxFetchUrlBtn"),
    });
    if (!url) return;
    try {
      const text = await invoke<string>("studio_fetch_url_text", { url });
      const label = `browser:${url.replace(/^https?:\/\//i, "").slice(0, 44)}`;
      this.attachFile(label, text);
      this.onAuditEvent?.("read", `Browser source attached: ${url}`);
    } catch (e: any) {
      this.onAuditEvent?.("blocked", `Browser fetch failed (${url}): ${e}`);
    }
  }

  private renderContextMenu(): void {
    if (this.contextMenuView === "root") {
      this.contextMenuEl.innerHTML = `
        <div class="ctx-menu-head">
          <span class="ctx-menu-title">${this.escapeHtml(t("ctxMenuTitle"))}</span>
        </div>
        <div class="ctx-menu-list">
          <button type="button" class="ctx-menu-item" data-ctx-nav="files">
            <span class="ctx-menu-ico">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </span>
            <span class="ctx-menu-meta">
              <span class="ctx-menu-label">${this.escapeHtml(t("ctxFiles"))}</span>
              <span class="ctx-menu-desc">${this.escapeHtml(t("ctxFilesDesc"))}</span>
            </span>
            <span class="ctx-menu-chev">›</span>
          </button>

          <button type="button" class="ctx-menu-item" data-ctx-nav="folders">
            <span class="ctx-menu-ico">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            </span>
            <span class="ctx-menu-meta">
              <span class="ctx-menu-label">${this.escapeHtml(t("ctxFolders"))}</span>
              <span class="ctx-menu-desc">${this.escapeHtml(t("ctxFoldersDesc"))}</span>
            </span>
            <span class="ctx-menu-chev">›</span>
          </button>

          <button type="button" class="ctx-menu-item" data-ctx-nav="mentions">
            <span class="ctx-menu-ico">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/></svg>
            </span>
            <span class="ctx-menu-meta">
              <span class="ctx-menu-label">${this.escapeHtml(t("ctxMentions"))}</span>
              <span class="ctx-menu-desc">${this.escapeHtml(t("ctxMentionsDesc"))}</span>
            </span>
            <span class="ctx-menu-chev">›</span>
          </button>

          <button type="button" class="ctx-menu-item" data-ctx-nav="actions">
            <span class="ctx-menu-ico">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            </span>
            <span class="ctx-menu-meta">
              <span class="ctx-menu-label">${this.escapeHtml(t("ctxActions"))}</span>
              <span class="ctx-menu-desc">${this.escapeHtml(t("ctxActionsDesc"))}</span>
            </span>
            <span class="ctx-menu-chev">›</span>
          </button>

          <button type="button" class="ctx-menu-item" data-ctx-browser="1">
            <span class="ctx-menu-ico">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            </span>
            <span class="ctx-menu-meta">
              <span class="ctx-menu-label">${this.escapeHtml(t("ctxBrowser"))}</span>
              <span class="ctx-menu-desc">${this.escapeHtml(t("ctxBrowserDesc"))}</span>
            </span>
            <span class="ctx-menu-chev">›</span>
          </button>
        </div>
      `;

      this.contextMenuEl.querySelectorAll<HTMLButtonElement>("[data-ctx-nav]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.contextMenuView = btn.dataset.ctxNav as any;
          this.contextFileFilter = "";
          this.renderContextMenu();
        });
      });
      this.contextMenuEl.querySelector("[data-ctx-browser]")?.addEventListener("click", (e) => {
        e.stopPropagation();
        void this.openBrowserFetchDialog();
      });
      return;
    }

    if (this.contextMenuView === "files") {
      const q = this.contextFileFilter.trim().toLowerCase();
      const filtered = this.projectFiles
        .filter((f) => !isSensitiveFileOrDir(f) && (!q || f.toLowerCase().includes(q)))
        .slice(0, 14);

      this.contextMenuEl.innerHTML = `
        <div class="ctx-menu-head">
          <button type="button" class="ctx-menu-back" data-ctx-back="1">‹ ${this.escapeHtml(t("ctxBack"))}</button>
          <span class="ctx-menu-title">${this.escapeHtml(t("ctxFiles"))}</span>
        </div>
        <div class="ctx-menu-search-wrap">
          <input type="text" id="ctx-file-filter" class="studio-input" placeholder="${this.escapeAttr(t("searchPlaceholder"))}" value="${this.escapeAttr(this.contextFileFilter)}" autocomplete="off" />
        </div>
        <div class="ctx-menu-list">
          <button type="button" class="ctx-menu-item" data-ctx-active="1">
            <span class="ctx-menu-meta"><span class="ctx-menu-label">${this.escapeHtml(t("ctxAttachActive"))}</span></span>
          </button>
          <button type="button" class="ctx-menu-item" data-ctx-image="1">
            <span class="ctx-menu-meta"><span class="ctx-menu-label">${this.escapeHtml(t("ctxUploadImage"))}</span></span>
          </button>
          ${filtered
            .map(
              (f) => `
            <button type="button" class="ctx-menu-item" data-ctx-pick-file="${this.escapeAttr(f)}">
              <span class="ctx-menu-meta">
                <span class="ctx-menu-label">${this.escapeHtml(f.split("/").pop() || f)}</span>
                <span class="ctx-menu-desc">${this.escapeHtml(f)}</span>
              </span>
            </button>
          `
            )
            .join("")}
        </div>
      `;

      this.bindContextMenuBack();
      const filterEl = this.contextMenuEl.querySelector("#ctx-file-filter") as HTMLInputElement | null;
      filterEl?.addEventListener("input", () => {
        this.contextFileFilter = filterEl.value;
        const pos = filterEl.selectionStart || this.contextFileFilter.length;
        this.renderContextMenu();
        const next = this.contextMenuEl.querySelector("#ctx-file-filter") as HTMLInputElement | null;
        if (next) {
          next.focus();
          next.setSelectionRange(pos, pos);
        }
      });
      filterEl?.focus();

      this.contextMenuEl.querySelector("[data-ctx-active]")?.addEventListener("click", () => {
        this.hideContextMenu();
        this.onAttachButtonClick?.();
      });
      this.contextMenuEl.querySelector("[data-ctx-image]")?.addEventListener("click", () => {
        this.hideContextMenu();
        (this.container.querySelector("#studio-image-file-input") as HTMLInputElement | null)?.click();
      });
      this.contextMenuEl.querySelectorAll<HTMLButtonElement>("[data-ctx-pick-file]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const p = btn.dataset.ctxPickFile;
          this.hideContextMenu();
          if (p) await this.onMentionAttachFile?.(p);
        });
      });
      return;
    }

    if (this.contextMenuView === "folders") {
      const folderSet = new Set<string>([""]);
      for (const f of this.projectFiles) {
        const parts = f.split("/");
        if (parts.length > 1) {
          let acc = "";
          for (let i = 0; i < parts.length - 1; i++) {
            acc = acc ? `${acc}/${parts[i]}` : parts[i];
            folderSet.add(acc);
          }
        }
      }
      const folders = Array.from(folderSet).sort().slice(0, 18);

      this.contextMenuEl.innerHTML = `
        <div class="ctx-menu-head">
          <button type="button" class="ctx-menu-back" data-ctx-back="1">‹ ${this.escapeHtml(t("ctxBack"))}</button>
          <span class="ctx-menu-title">${this.escapeHtml(t("ctxFolders"))}</span>
        </div>
        <div class="ctx-menu-list">
          ${folders
            .map(
              (dir) => `
            <button type="button" class="ctx-menu-item" data-ctx-pick-dir="${this.escapeAttr(dir)}">
              <span class="ctx-menu-meta">
                <span class="ctx-menu-label">${this.escapeHtml(dir || "/ (Project Root)")}</span>
              </span>
            </button>
          `
            )
            .join("")}
        </div>
      `;

      this.bindContextMenuBack();
      this.contextMenuEl.querySelectorAll<HTMLButtonElement>("[data-ctx-pick-dir]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const dir = btn.dataset.ctxPickDir || "";
          this.hideContextMenu();
          try {
            const entries = await invoke<Array<{ name: string; path: string; is_dir: boolean; is_sensitive: boolean }>>(
              "studio_list_dir",
              { relPath: dir || null }
            );
            const listing = entries
              .map((e) => (e.is_sensitive ? `[SENSITIVE] ${e.path}` : `${e.is_dir ? "[DIR]" : "[FILE]"} ${e.path}`))
              .join("\n");
            this.attachFile(`folder:${dir || "root"}`, listing || "(empty folder)");
            this.onAuditEvent?.("read", `Folder context attached: ${dir || "/"}`);
          } catch (err: any) {
            this.onAuditEvent?.("blocked", `Folder attach error: ${err}`);
          }
        });
      });
      return;
    }

    if (this.contextMenuView === "mentions") {
      this.contextMenuEl.innerHTML = `
        <div class="ctx-menu-head">
          <button type="button" class="ctx-menu-back" data-ctx-back="1">‹ ${this.escapeHtml(t("ctxBack"))}</button>
          <span class="ctx-menu-title">${this.escapeHtml(t("ctxMentions"))}</span>
        </div>
        <div class="ctx-menu-list">
          <button type="button" class="ctx-menu-item" data-ctx-mention="problems">
            <span class="ctx-menu-meta">
              <span class="ctx-menu-label">@problems</span>
              <span class="ctx-menu-desc">Attach active code & compiler errors</span>
            </span>
          </button>
          <button type="button" class="ctx-menu-item" data-ctx-mention="git">
            <span class="ctx-menu-meta">
              <span class="ctx-menu-label">@git</span>
              <span class="ctx-menu-desc">Attach current Git diff</span>
            </span>
          </button>
          <button type="button" class="ctx-menu-item" data-ctx-mention="terminal">
            <span class="ctx-menu-meta">
              <span class="ctx-menu-label">@terminal</span>
              <span class="ctx-menu-desc">Attach recent terminal output</span>
            </span>
          </button>
          <button type="button" class="ctx-menu-item" data-ctx-mention="file">
            <span class="ctx-menu-meta">
              <span class="ctx-menu-label">@file</span>
              <span class="ctx-menu-desc">Insert @ file mention in prompt</span>
            </span>
          </button>
        </div>
      `;

      this.bindContextMenuBack();
      this.contextMenuEl.querySelectorAll<HTMLButtonElement>("[data-ctx-mention]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const kind = btn.dataset.ctxMention;
          this.hideContextMenu();
          if (kind === "problems") {
            const summary = this.onRequestProblemsContext?.() || "";
            this.attachFile("@problems", summary || "No active errors or warnings detected.");
          } else if (kind === "git") {
            const diff = (await this.onRequestGitDiffContext?.()) || "";
            this.attachFile("@git-diff", diff || "Working tree clean (no Git diff).");
          } else if (kind === "terminal") {
            const out = this.onRequestTerminalContext?.() || "";
            this.attachFile("@terminal", out || "(No terminal output yet)");
          } else if (kind === "file") {
            this.inputEl.value = `${this.inputEl.value}${this.inputEl.value && !this.inputEl.value.endsWith(" ") ? " " : ""}@`;
            this.inputEl.focus();
            this.updateMentionSuggestions();
          }
        });
      });
      return;
    }

    if (this.contextMenuView === "actions") {
      const actions: Array<{ label: string; prompt: string; autoSend: boolean }> = [
        {
          label: t("ctxActFixAll"),
          prompt: "Inspect all live errors and bugs in the active file and emit <mintu_replace> or <mintu_edit> to fix every issue right now.",
          autoSend: true,
        },
        {
          label: t("ctxActInstallPkg"),
          prompt: "Check imports and missing dependencies in the active file, and emit install_package to install any missing package.",
          autoSend: true,
        },
        {
          label: t("ctxActReviewGit"),
          prompt: "Review my current project changes for bugs, edge cases, and security issues.",
          autoSend: false,
        },
        {
          label: t("ctxActGenTests"),
          prompt: "Generate comprehensive unit tests for the active file using <mintu_edit>.",
          autoSend: true,
        },
        {
          label: t("ctxActOptimize"),
          prompt: "Optimize the active file for readability and performance using <mintu_replace> or <mintu_edit>.",
          autoSend: true,
        },
      ];

      this.contextMenuEl.innerHTML = `
        <div class="ctx-menu-head">
          <button type="button" class="ctx-menu-back" data-ctx-back="1">‹ ${this.escapeHtml(t("ctxBack"))}</button>
          <span class="ctx-menu-title">${this.escapeHtml(t("ctxActions"))}</span>
        </div>
        <div class="ctx-menu-list">
          ${actions
            .map(
              (a, i) => `
            <button type="button" class="ctx-menu-item" data-ctx-act="${i}">
              <span class="ctx-menu-meta"><span class="ctx-menu-label">${this.escapeHtml(a.label)}</span></span>
            </button>
          `
            )
            .join("")}
        </div>
      `;

      this.bindContextMenuBack();
      this.contextMenuEl.querySelectorAll<HTMLButtonElement>("[data-ctx-act]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const act = actions[Number(btn.dataset.ctxAct)];
          this.hideContextMenu();
          if (act) this.sendPrefilledPrompt(act.prompt, act.autoSend);
        });
      });
    }
  }

  private bindContextMenuBack(): void {
    this.contextMenuEl.querySelector("[data-ctx-back]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.contextMenuView = "root";
      this.renderContextMenu();
    });
  }

  private async runPackageInstallProposal(prop: PackageInstallProposal): Promise<void> {
    if (prop.status !== "pending") return;
    prop.status = "running";
    this.aiClient.persistUpdates();
    this.onAuditEvent?.("system", `Installing package: ${prop.command}`);
    try {
      const res = await invoke<{ exit_code: number; stdout: string; stderr: string; timed_out: boolean }>(
        "studio_run_approved_command",
        { command: prop.command }
      );
      prop.result = res;
      prop.status = "executed";
      this.onAuditEvent?.("system", `Package install finished (exit ${res.exit_code}): ${prop.command}`);
    } catch (err: any) {
      prop.result = { exit_code: -1, stdout: "", stderr: String(err), timed_out: false };
      prop.status = "executed";
    }
    this.aiClient.persistUpdates();
  }

  private async runWebFetchProposal(prop: WebFetchProposal): Promise<void> {
    if (prop.status !== "pending") return;
    prop.status = "running";
    this.aiClient.persistUpdates();
    const target = prop.query || prop.url;
    this.onAuditEvent?.("read", `Fetching web source: ${target}`);
    try {
      const text = prop.query
        ? await invoke<string>("studio_search_web", { query: prop.query })
        : await invoke<string>("studio_fetch_url_text", { url: prop.url });
      prop.result = text;
      prop.status = "executed";
      this.onAuditEvent?.("read", `Web source fetched (${text.length} chars): ${target}`);
    } catch (err: any) {
      prop.result = String(err);
      prop.status = "error";
    }
    this.aiClient.persistUpdates();
  }

  private async runMcpProposal(prop: McpToolProposal): Promise<void> {
    prop.status = "running";
    this.aiClient.persistUpdates();
    this.onAuditEvent?.("system", `MCP aləti icra olunur: ${prop.server}/${prop.tool}`);
    try {
      const result = await invoke<string>("mcp_call_tool", {
        serverId: prop.server,
        toolName: prop.tool,
        arguments: prop.arguments,
      });
      prop.result = result;
      prop.status = "executed";
      this.onAuditEvent?.("system", `MCP aləti tamamlandı: ${prop.server}/${prop.tool}`);
    } catch (err: any) {
      prop.result = String(err);
      prop.status = "error";
    }
    this.aiClient.persistUpdates();
  }

  private renderProposalCard(prop: AgentProposal): HTMLElement {
    const isNewCard = !this.seenProposalIds.has(prop.id);
    this.seenProposalIds.add(prop.id);
    const card = document.createElement("div");
    card.className = `proposal-card${isNewCard ? " card-enter" : ""}`;

    if (prop.kind === "edit") {
      const diff = computeLineDiff(prop.previousContent || "", prop.content);
      const isExpanded =
        this.expandedProposalIds.has(prop.id) || studioSettings.get().expandDiffsByDefault;
      const statusBadge =
        prop.status === "applied"
          ? `<span class="proposal-status status-applied">${t("appliedStatus")}</span>`
          : prop.status === "rejected"
            ? `<span class="proposal-status status-rejected">${t("rejectedStatus")}</span>`
            : prop.status === "reverted"
              ? `<span class="proposal-status status-rejected">${t("revertedStatus")}</span>`
              : `<span class="proposal-status status-pending">${prop.isNewFile ? t("newFileBadge") : t("editBadge")}</span>`;

      const diffLinesHtml = isExpanded
        ? diff.lines
            .map((l) => {
              const sign = l.type === "add" ? "+" : l.type === "del" ? "-" : " ";
              return `<div class="diff-line diff-${l.type}"><span class="diff-sign">${sign}</span><span class="diff-text">${this.escapeHtml(l.text)}</span></div>`;
            })
            .join("")
        : "";

      card.innerHTML = `
        <div class="proposal-header proposal-header-clickable" data-toggle-diff="1" title="${t("viewDiffBtn")}">
          <div class="proposal-title-row">
            <span class="proposal-chevron">${isExpanded ? "▾" : "▸"}</span>
            <span class="proposal-path" title="${this.escapeAttr(prop.path)}">${this.escapeHtml(prop.path)}</span>
            <span class="diff-stats"><span class="diff-stat-add">+${diff.added}</span> <span class="diff-stat-del">-${diff.removed}</span></span>
          </div>
          ${statusBadge}
        </div>
        ${prop.reason ? `<div class="proposal-reason">${this.escapeHtml(prop.reason)}</div>` : ""}
        ${
          isExpanded
            ? `<div class="diff-viewer">${diffLinesHtml || `<div class="diff-empty">${t("noChanges")}</div>`}${diff.truncated ? `<div class="diff-truncated">${t("moreLines")}</div>` : ""}</div>`
            : ""
        }
        <div class="proposal-actions"></div>
      `;

      const toggleDiff = () => {
        if (this.expandedProposalIds.has(prop.id)) {
          this.expandedProposalIds.delete(prop.id);
        } else {
          this.expandedProposalIds.add(prop.id);
        }
        this.renderMessages(this.aiClient.getMessages());
      };

      card.querySelector("[data-toggle-diff]")?.addEventListener("click", toggleDiff);

      const actionsEl = card.querySelector(".proposal-actions") as HTMLElement;
      const viewBtn = document.createElement("button");
      viewBtn.type = "button";
      viewBtn.className = "studio-btn studio-btn-sm";
      viewBtn.textContent = isExpanded ? t("hideDiffBtn") : t("viewDiffBtn");
      viewBtn.addEventListener("click", toggleDiff);
      actionsEl.appendChild(viewBtn);

      if (prop.status === "pending") {
        const applyBtn = document.createElement("button");
        applyBtn.type = "button";
        applyBtn.className = "studio-btn studio-btn-sm studio-btn-primary";
        applyBtn.textContent = t("apply");
        applyBtn.addEventListener("click", () => this.applyEditProposal(prop));

        const rejectBtn = document.createElement("button");
        rejectBtn.type = "button";
        rejectBtn.className = "studio-btn studio-btn-sm";
        rejectBtn.textContent = t("cancel");
        rejectBtn.addEventListener("click", () => {
          prop.status = "rejected";
          this.aiClient.persistUpdates();
        });

        actionsEl.appendChild(applyBtn);
        actionsEl.appendChild(rejectBtn);
      } else if (prop.status === "applied" && prop.previousContent !== null) {
        const undoBtn = document.createElement("button");
        undoBtn.type = "button";
        undoBtn.className = "studio-btn studio-btn-sm";
        undoBtn.textContent = t("revert");
        undoBtn.addEventListener("click", () => this.revertEditProposal(prop));
        actionsEl.appendChild(undoBtn);
      }
      return card;
    }

    if (prop.kind === "command") {
      const statusBadge =
        prop.status === "executed"
          ? `<span class="proposal-status status-applied">Exit: ${prop.result?.exit_code ?? 0}</span>`
          : prop.status === "running"
            ? `<span class="proposal-status status-pending">${t("runningStatus")}</span>`
            : prop.status === "rejected"
              ? `<span class="proposal-status status-rejected">${t("rejectedStatus")}</span>`
              : `<span class="proposal-status status-pending">${t("awaitingApproval")}</span>`;

      const outCombined = prop.result
        ? [prop.result.stdout, prop.result.stderr].filter(Boolean).join("\n").trim()
        : "";

      card.innerHTML = `
        <div class="proposal-header">
          <span class="proposal-path">${t("commandExecTitle")}</span>
          ${statusBadge}
        </div>
        ${prop.reason ? `<div class="proposal-reason">${this.escapeHtml(prop.reason)}</div>` : ""}
        <pre class="proposal-cmd-box">${this.escapeHtml(prop.command)}</pre>
        ${outCombined ? `<pre class="proposal-output-box">${this.escapeHtml(outCombined.slice(0, 4000))}</pre>` : ""}
        <div class="proposal-actions"></div>
      `;

      const actionsEl = card.querySelector(".proposal-actions") as HTMLElement;
      if (prop.status === "pending") {
        const runBtn = document.createElement("button");
        runBtn.type = "button";
        runBtn.className = "studio-btn studio-btn-sm studio-btn-primary";
        runBtn.textContent = t("run");
        runBtn.addEventListener("click", () => this.runCommandProposal(prop));

        const rejectBtn = document.createElement("button");
        rejectBtn.type = "button";
        rejectBtn.className = "studio-btn studio-btn-sm";
        rejectBtn.textContent = t("cancel");
        rejectBtn.addEventListener("click", () => {
          prop.status = "rejected";
          this.aiClient.persistUpdates();
        });

        actionsEl.appendChild(runBtn);
        actionsEl.appendChild(rejectBtn);
      } else if (prop.status === "executed" && !this.aiClient.isBusy()) {
        const sendResultBtn = document.createElement("button");
        sendResultBtn.type = "button";
        sendResultBtn.className = "studio-btn studio-btn-sm";
        sendResultBtn.textContent = t("sendResultToAi");
        sendResultBtn.addEventListener("click", () => {
          const summary = `Command output (${prop.command}, exit=${prop.result?.exit_code}):\n\`\`\`\n${outCombined.slice(0, 3000) || "(empty)"}\n\`\`\``;
          this.handleSend(summary);
        });
        actionsEl.appendChild(sendResultBtn);
      }
      return card;
    }

    if (prop.kind === "package") {
      const statusBadge =
        prop.status === "executed"
          ? `<span class="proposal-status status-applied">Exit: ${prop.result?.exit_code ?? 0}</span>`
          : prop.status === "running"
            ? `<span class="proposal-status status-pending">${t("runningStatus")}</span>`
            : prop.status === "rejected"
              ? `<span class="proposal-status status-rejected">${t("rejectedStatus")}</span>`
              : `<span class="proposal-status status-pending">${t("awaitingApproval")}</span>`;

      const outCombined = prop.result
        ? [prop.result.stdout, prop.result.stderr].filter(Boolean).join("\n").trim()
        : "";

      card.innerHTML = `
        <div class="proposal-header">
          <div class="proposal-title-row">
            <span class="model-meta-pill">${this.escapeHtml(prop.manager.toUpperCase())}</span>
            <span class="proposal-path">${this.escapeHtml(prop.packages.join(", "))}</span>
          </div>
          ${statusBadge}
        </div>
        ${prop.reason ? `<div class="proposal-reason">${this.escapeHtml(prop.reason)}</div>` : ""}
        <pre class="proposal-cmd-box">${this.escapeHtml(prop.command)}</pre>
        ${outCombined ? `<pre class="proposal-output-box">${this.escapeHtml(outCombined.slice(0, 4000))}</pre>` : ""}
        <div class="proposal-actions"></div>
      `;

      const actionsEl = card.querySelector(".proposal-actions") as HTMLElement;
      if (prop.status === "pending") {
        const allowBtn = document.createElement("button");
        allowBtn.type = "button";
        allowBtn.className = "studio-btn studio-btn-sm studio-btn-primary";
        allowBtn.textContent = t("pkgInstallAllowBtn");
        allowBtn.addEventListener("click", () => void this.runPackageInstallProposal(prop));

        const rejectBtn = document.createElement("button");
        rejectBtn.type = "button";
        rejectBtn.className = "studio-btn studio-btn-sm";
        rejectBtn.textContent = t("cancel");
        rejectBtn.addEventListener("click", () => {
          prop.status = "rejected";
          this.aiClient.persistUpdates();
        });

        const permBtn = document.createElement("button");
        permBtn.type = "button";
        permBtn.className = "studio-btn studio-btn-sm";
        permBtn.textContent = t("openLocalPermsBtn");
        permBtn.addEventListener("click", () => this.onOpenLocalPermissions?.());

        actionsEl.appendChild(allowBtn);
        actionsEl.appendChild(rejectBtn);
        actionsEl.appendChild(permBtn);
      } else if (prop.status === "executed" && !this.aiClient.isBusy()) {
        const sendResultBtn = document.createElement("button");
        sendResultBtn.type = "button";
        sendResultBtn.className = "studio-btn studio-btn-sm";
        sendResultBtn.textContent = t("sendResultToAi");
        sendResultBtn.addEventListener("click", () => {
          this.handleSend(`Package install (${prop.command}, exit=${prop.result?.exit_code}):\n\`\`\`\n${outCombined.slice(0, 3000) || "(ok)"}\n\`\`\``);
        });
        actionsEl.appendChild(sendResultBtn);
      }
      return card;
    }

    if (prop.kind === "web_fetch") {
      const statusBadge =
        prop.status === "executed"
          ? `<span class="proposal-status status-applied">${t("completedStatus")}</span>`
          : prop.status === "running"
            ? `<span class="proposal-status status-pending">${t("runningStatus")}</span>`
            : prop.status === "error" || prop.status === "rejected"
              ? `<span class="proposal-status status-rejected">${prop.status === "error" ? t("errorStatus") : t("rejectedStatus")}</span>`
              : `<span class="proposal-status status-pending">${t("awaitingApproval")}</span>`;

      const target = prop.query ? `Search: ${prop.query}` : prop.url;

      card.innerHTML = `
        <div class="proposal-header">
          <div class="proposal-title-row">
            <span class="model-meta-pill">WEB</span>
            <span class="proposal-path" title="${this.escapeAttr(target)}">${this.escapeHtml(target)}</span>
          </div>
          ${statusBadge}
        </div>
        ${prop.reason ? `<div class="proposal-reason">${this.escapeHtml(prop.reason)}</div>` : ""}
        ${prop.result ? `<pre class="proposal-output-box">${this.escapeHtml(prop.result.slice(0, 3000))}</pre>` : ""}
        <div class="proposal-actions"></div>
      `;

      const actionsEl = card.querySelector(".proposal-actions") as HTMLElement;
      if (prop.status === "pending") {
        const allowBtn = document.createElement("button");
        allowBtn.type = "button";
        allowBtn.className = "studio-btn studio-btn-sm studio-btn-primary";
        allowBtn.textContent = t("webFetchAllowBtn");
        allowBtn.addEventListener("click", () => void this.runWebFetchProposal(prop));

        const rejectBtn = document.createElement("button");
        rejectBtn.type = "button";
        rejectBtn.className = "studio-btn studio-btn-sm";
        rejectBtn.textContent = t("cancel");
        rejectBtn.addEventListener("click", () => {
          prop.status = "rejected";
          this.aiClient.persistUpdates();
        });

        const permBtn = document.createElement("button");
        permBtn.type = "button";
        permBtn.className = "studio-btn studio-btn-sm";
        permBtn.textContent = t("openLocalPermsBtn");
        permBtn.addEventListener("click", () => this.onOpenLocalPermissions?.());

        actionsEl.appendChild(allowBtn);
        actionsEl.appendChild(rejectBtn);
        actionsEl.appendChild(permBtn);
      } else if (prop.status === "executed" && prop.result && !this.aiClient.isBusy()) {
        const sendResBtn = document.createElement("button");
        sendResBtn.type = "button";
        sendResBtn.className = "studio-btn studio-btn-sm";
        sendResBtn.textContent = t("sendResultToAi");
        sendResBtn.addEventListener("click", () => {
          this.handleSend(`Fetched web source (${target}):\n\`\`\`\n${prop.result!.slice(0, 4000)}\n\`\`\`\nNow use this information to complete the task.`);
        });
        actionsEl.appendChild(sendResBtn);
      }
      return card;
    }

    // MCP Tool Proposal
    const statusBadge =
      prop.status === "executed"
        ? `<span class="proposal-status status-applied">${t("completedStatus")}</span>`
        : prop.status === "running"
          ? `<span class="proposal-status status-pending">${t("runningStatus")}</span>`
          : prop.status === "error"
            ? `<span class="proposal-status status-rejected">${t("errorStatus")}</span>`
            : prop.status === "rejected"
              ? `<span class="proposal-status status-rejected">${t("rejectedStatus")}</span>`
              : `<span class="proposal-status status-pending">${t("mcpApproval")}</span>`;

    card.innerHTML = `
      <div class="proposal-header">
        <span class="proposal-path">MCP: ${this.escapeHtml(prop.server)} / ${this.escapeHtml(prop.tool)}</span>
        ${statusBadge}
      </div>
      ${prop.reason ? `<div class="proposal-reason">${this.escapeHtml(prop.reason)}</div>` : ""}
      <pre class="proposal-cmd-box">${this.escapeHtml(JSON.stringify(prop.arguments, null, 2))}</pre>
      ${prop.result ? `<pre class="proposal-output-box">${this.escapeHtml(prop.result.slice(0, 4000))}</pre>` : ""}
      <div class="proposal-actions"></div>
    `;

    const actionsEl = card.querySelector(".proposal-actions") as HTMLElement;
    if (prop.status === "pending") {
      const runBtn = document.createElement("button");
      runBtn.type = "button";
      runBtn.className = "studio-btn studio-btn-sm studio-btn-primary";
      runBtn.textContent = t("run");
      runBtn.addEventListener("click", () => this.runMcpProposal(prop));

      const rejectBtn = document.createElement("button");
      rejectBtn.type = "button";
      rejectBtn.className = "studio-btn studio-btn-sm";
      rejectBtn.textContent = t("cancel");
      rejectBtn.addEventListener("click", () => {
        prop.status = "rejected";
        this.aiClient.persistUpdates();
      });

      actionsEl.appendChild(runBtn);
      actionsEl.appendChild(rejectBtn);
    } else if (prop.status === "executed" && prop.result && !this.aiClient.isBusy()) {
      const sendResBtn = document.createElement("button");
      sendResBtn.type = "button";
      sendResBtn.className = "studio-btn studio-btn-sm";
      sendResBtn.textContent = t("sendResultToAi");
      sendResBtn.addEventListener("click", () => {
        this.handleSend(`MCP (${prop.server}/${prop.tool}) output:\n\`\`\`\n${prop.result!.slice(0, 3000)}\n\`\`\``);
      });
      actionsEl.appendChild(sendResBtn);
    }

    return card;
  }

  // --- Multi-Session History & Message Rendering ---

  private renderHistoryView(): void {
    const sessions = this.aiClient.listSessions();
    const activeId = this.aiClient.getActiveSessionId();

    const listHtml =
      sessions.length === 0
        ? `<div class="history-empty">${t("noSavedChats")}</div>`
        : sessions
            .map(
              (s) => `
            <div class="history-item ${s.id === activeId ? "is-active" : ""}" data-sess-id="${this.escapeAttr(s.id)}">
              <button type="button" class="history-item-main" data-switch-sess="${this.escapeAttr(s.id)}">
                <div class="history-item-title">${this.escapeHtml(s.title)}</div>
                <div class="history-item-meta">${s.messages.length} ${t("messagesCount")} · ${new Date(s.updatedAt).toLocaleString()}</div>
              </button>
              <div class="history-item-actions">
                <button type="button" class="studio-btn-icon" data-rename-sess="${this.escapeAttr(s.id)}" title="${t("rename")}">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                    <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                  </svg>
                </button>
                <button type="button" class="studio-btn-icon" data-delete-sess="${this.escapeAttr(s.id)}" title="${t("deleteChat")}">${ICON_CLOSE}</button>
              </div>
            </div>
          `
            )
            .join("");

    this.messagesListEl.innerHTML = `
      <div class="history-panel">
        <div class="history-header-row">
          <span class="history-heading">${t("chatHistory")} (${sessions.length})</span>
          <button type="button" class="studio-btn studio-btn-sm studio-btn-primary" id="btn-history-new-chat">+ ${t("newChat")}</button>
        </div>
        <div class="history-list">${listHtml}</div>
      </div>
    `;

    this.messagesListEl.querySelector("#btn-history-new-chat")?.addEventListener("click", () => {
      this.aiClient.createNewSession(t("newChat"));
      this.showingHistory = false;
    this.userScrolledUp = false;
    this.peekStreamingEdit = false;
      this.renderMessages([]);
    });

    this.messagesListEl.querySelectorAll<HTMLButtonElement>("[data-switch-sess]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.switchSess;
        if (id) {
          this.aiClient.switchSession(id);
          this.showingHistory = false;
    this.userScrolledUp = false;
    this.peekStreamingEdit = false;
          this.renderMessages(this.aiClient.getMessages());
        }
      });
    });

    this.messagesListEl.querySelectorAll<HTMLButtonElement>("[data-rename-sess]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const id = btn.dataset.renameSess;
        const cur = sessions.find((s) => s.id === id);
        if (!id || !cur) return;
        const nextName = await showInputDialog({
          title: t("renameChatTitle"),
          label: t("renameChatLabel"),
          placeholder: cur.title,
          defaultValue: cur.title,
          confirmText: t("save"),
        });
        if (nextName) {
          this.aiClient.renameSession(id, nextName);
          this.renderHistoryView();
        }
      });
    });

    this.messagesListEl.querySelectorAll<HTMLButtonElement>("[data-delete-sess]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.dataset.deleteSess;
        if (id) {
          this.aiClient.deleteSession(id);
          this.renderHistoryView();
        }
      });
    });
  }

  private renderMessages(messages: StudioChatMessage[]): void {
    if (!messages || messages.length === 0) {
      const chipsHtml = QUICK_CHIPS.map(
        (c, i) => `
          <button type="button" class="quick-action-chip" data-chip-idx="${i}">
            <span class="quick-chip-icon">${c.icon}</span>
            <span>${t(c.labelKey)}</span>
          </button>
        `
      ).join("");

      this.messagesListEl.innerHTML = `
        <div class="chat-empty-state">
          <div class="chat-empty-logo">${MINTU_LOGO_SVG(36)}</div>
          <div class="chat-empty-title">Mintu AI</div>
          <div class="chat-empty-tagline">${t("chatTagline")}</div>
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

    const prevScrollTop = this.messagesListEl.scrollTop;
    const shouldFollowBottom = !this.userScrolledUp && studioSettings.get().autoScrollChat;

    this.messagesListEl.innerHTML = "";

    for (const msg of messages) {
      const isNewMsg = !this.seenMessageIds.has(msg.id);
      this.seenMessageIds.add(msg.id);
      const msgRow = document.createElement("div");
      msgRow.className = `studio-msg-row ${msg.role === "user" ? "user-row" : "assistant-row"}${isNewMsg ? " msg-enter" : ""}`;

      const bubble = document.createElement("div");
      bubble.className = `studio-msg-bubble ${msg.role === "user" ? "user-bubble" : "assistant-bubble"}`;

      if (msg.role === "user" && msg.attachedFiles && msg.attachedFiles.length > 0) {
        const badgeContainer = document.createElement("div");
        badgeContainer.className = "msg-badge-container";

        const badge = document.createElement("span");
        badge.className = "dataflow-pill";
        if (msg.routing?.isLocal) {
          badge.textContent = formatModelDisplayName(msg.routing?.model || "Lokal");
        } else {
          badge.textContent = msg.routing?.provider || "AI";
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

      // Agent read-only steps pills
      if (msg.role === "assistant" && msg.steps && msg.steps.length > 0) {
        const stepsWrap = document.createElement("div");
        stepsWrap.className = "agent-steps-list";
        for (const st of msg.steps) {
          const pill = document.createElement("div");
          pill.className = `agent-step-pill step-${st.status}`;
          pill.textContent = `${st.tool}: ${st.target}${st.summary ? ` (${st.summary})` : ""}`;
          stepsWrap.appendChild(pill);
        }
        bubble.appendChild(stepsWrap);
      }

      if (msg.role === "user" && msg.images && msg.images.length > 0) {
        const imgsRow = document.createElement("div");
        imgsRow.className = "msg-images-row";
        for (const img of msg.images) {
          const im = document.createElement("img");
          im.className = "msg-img-preview";
          im.src = `data:${img.mime_type};base64,${img.base64}`;
          im.alt = img.name || "image";
          imgsRow.appendChild(im);
        }
        bubble.appendChild(imgsRow);
      }

      const contentEl = document.createElement("div");
      contentEl.className = "msg-content";

      if (msg.role === "assistant") {
        const cleaned = stripToolCallBlocks(msg.content);
        if (!cleaned && this.aiClient.isBusy()) {
          contentEl.innerHTML = `<span class="thinking-spinner">${t("thinking")}</span>`;
        } else if (cleaned) {
          contentEl.innerHTML = MarkdownRenderer.render(cleaned);
        }
      } else {
        contentEl.textContent = msg.content;
      }

      if (contentEl.innerHTML || contentEl.textContent) {
        bubble.appendChild(contentEl);
      }

      if (msg.role === "assistant" && msg.streamingEdit) {
        const liveCard = document.createElement("div");
        liveCard.className = "live-edit-pill-card";
        liveCard.innerHTML = `
          <button type="button" class="live-edit-pill-head" data-peek-live="1">
            <span class="live-edit-dot"></span>
            <span class="live-edit-path">${t("writingFileLabel")} <code>${this.escapeHtml(msg.streamingEdit.path)}</code></span>
            <span class="model-meta-pill">${msg.streamingEdit.lineCount} L</span>
            <span class="live-edit-toggle">${this.peekStreamingEdit ? t("hideDiffBtn") : t("viewDiffBtn")}</span>
          </button>
          ${
            this.peekStreamingEdit
              ? `<pre class="live-edit-peek">${this.escapeHtml(msg.streamingEdit.preview)}</pre>`
              : ""
          }
        `;
        liveCard.querySelector("[data-peek-live]")?.addEventListener("click", () => {
          this.peekStreamingEdit = !this.peekStreamingEdit;
          this.renderMessages(this.aiClient.getMessages());
        });
        bubble.appendChild(liveCard);
      }

      // Interactive Diff / Command / MCP Approval Cards
      if (msg.role === "assistant" && msg.proposals && msg.proposals.length > 0) {
        const pendingEdits = msg.proposals.filter(
          (p): p is EditProposal => p.kind === "edit" && p.status === "pending"
        );
        if (pendingEdits.length >= 2) {
          const bulkBar = document.createElement("div");
          bulkBar.className = "bulk-proposals-bar";
          bulkBar.innerHTML = `
            <span class="bulk-proposals-label">${pendingEdits.length} ${t("pendingFileEdits")}</span>
            <div class="bulk-proposals-actions">
              <button type="button" class="studio-btn studio-btn-sm studio-btn-primary" data-bulk-apply>${t("applyAll")}</button>
              <button type="button" class="studio-btn studio-btn-sm" data-bulk-reject>${t("rejectAll")}</button>
            </div>
          `;
          bulkBar.querySelector("[data-bulk-apply]")?.addEventListener("click", async () => {
            const batchSnapshot: Array<{ path: string; previousContent: string | null }> = [];
            for (const ep of pendingEdits) {
              if (ep.status === "pending") {
                batchSnapshot.push({ path: ep.path, previousContent: ep.previousContent });
                await this.applyEditProposal(ep, false);
              }
            }
            if (batchSnapshot.length > 0) {
              this.lastCheckpoint = batchSnapshot;
              this.updateCheckpointButton();
            }
          });
          bulkBar.querySelector("[data-bulk-reject]")?.addEventListener("click", () => {
            for (const ep of pendingEdits) {
              if (ep.status === "pending") ep.status = "rejected";
            }
            this.aiClient.persistUpdates();
          });
          bubble.appendChild(bulkBar);
        }

        const propWrap = document.createElement("div");
        propWrap.className = "proposals-stack";
        for (const prop of msg.proposals) {
          propWrap.appendChild(this.renderProposalCard(prop));
        }
        bubble.appendChild(propWrap);
      }

      if (msg.role === "assistant" && msg.stats && studioSettings.get().showPerfStats) {
        const statsEl = document.createElement("div");
        statsEl.className = "msg-perf-stats";
        const secs = (msg.stats.durationMs / 1000).toFixed(1);
        statsEl.textContent = `~${msg.stats.tokPerSec} tok/s · ${msg.stats.tokens} token · ${secs}s`;
        bubble.appendChild(statsEl);
      }

      msgRow.appendChild(bubble);
      this.messagesListEl.appendChild(msgRow);
    }

    if (shouldFollowBottom) {
      this.messagesListEl.scrollTop = this.messagesListEl.scrollHeight;
    } else {
      this.messagesListEl.scrollTop = prevScrollTop;
    }
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  private escapeAttr(str: string): string {
    return this.escapeHtml(str).replace(/"/g, "&quot;");
  }
}
