/**
 * GitModal.ts
 * Extended Git Panel: Status, Unified Diff, Branch Switcher / Create Branch,
 * Pull & Push, Commit History (git log), and AI Commit Message Generator.
 */

import { invoke } from "@tauri-apps/api/core";
import { StudioAIClient } from "../ai/StudioAIClient";
import { showInputDialog } from "./InputDialog";
import { t } from "./i18n";
import { ICON_CLOSE } from "./icons";

export interface GitFileStatus {
  path: string;
  status: "M" | "A" | "D" | "U" | "R" | string;
}

export interface GitRepoInfo {
  is_git_repo: boolean;
  branch: string | null;
  files: GitFileStatus[];
}

interface GitBranchesInfo {
  current: string;
  branches: string[];
}

interface GitCommitEntry {
  hash: string;
  date: string;
  author: string;
  message: string;
}

export class GitModal {
  private aiClient: StudioAIClient;
  private overlayEl: HTMLElement | null = null;
  private repoInfo: GitRepoInfo = { is_git_repo: false, branch: null, files: [] };
  private branchesInfo: GitBranchesInfo = { current: "", branches: [] };
  private commitLog: GitCommitEntry[] = [];
  private activeSubTab: "diff" | "log" = "diff";
  private selectedPath: string | null = null;
  private currentDiff = "";
  private commitMsg = "";
  private isGenerating = false;
  private statusNotice = "";

  public onGitChanged?: () => void;
  public onReviewDiffWithAi?: (diff: string, files: GitFileStatus[]) => void;

  constructor(aiClient: StudioAIClient) {
    this.aiClient = aiClient;
  }

  public async open(): Promise<void> {
    this.close();
    this.statusNotice = "";
    this.commitMsg = "";
    this.selectedPath = null;
    this.activeSubTab = "diff";

    const overlay = document.createElement("div");
    overlay.className = "studio-modal-overlay";
    overlay.innerHTML = `
      <div class="studio-modal-dialog studio-git-dialog" role="dialog" aria-modal="true" aria-label="Git">
        <div class="studio-modal-header">
          <div class="modal-title-group">
            <h2 class="modal-title">${t("gitStatus")}</h2>
            <span class="modal-subtitle" id="git-modal-branch">...</span>
          </div>
          <button type="button" class="studio-btn-icon" id="btn-close-git" title="Close">${ICON_CLOSE}</button>
        </div>
        <div class="studio-modal-body git-modal-body" id="git-modal-content">
          <div class="bottom-empty">Git status...</div>
        </div>
      </div>
    `;

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) this.close();
    });
    overlay.querySelector("#btn-close-git")?.addEventListener("click", () => this.close());

    document.body.appendChild(overlay);
    this.overlayEl = overlay;

    await this.refreshAndRender();
  }

  public close(): void {
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
  }

  private async refreshAndRender(): Promise<void> {
    try {
      this.repoInfo = await invoke<GitRepoInfo>("studio_git_info");
      if (this.repoInfo.is_git_repo) {
        const [diff, branches, log] = await Promise.all([
          invoke<string>("studio_git_diff", { relPath: this.selectedPath }).catch(() => ""),
          invoke<GitBranchesInfo>("studio_git_branches").catch(() => ({ current: "", branches: [] })),
          invoke<GitCommitEntry[]>("studio_git_log", { limit: 25 }).catch(() => []),
        ]);
        this.currentDiff = diff;
        this.branchesInfo = branches;
        this.commitLog = log;
      }
    } catch (e: any) {
      this.statusNotice = `Git error: ${e}`;
    }
    this.render();
  }

  private render(): void {
    if (!this.overlayEl) return;

    const branchEl = this.overlayEl.querySelector("#git-modal-branch");
    if (branchEl) {
      branchEl.textContent = this.repoInfo.is_git_repo
        ? `Branch: ${this.repoInfo.branch || "HEAD"} · ${this.repoInfo.files.length} changed`
        : "No Git repository detected";
    }

    const body = this.overlayEl.querySelector("#git-modal-content") as HTMLElement | null;
    if (!body) return;

    if (!this.repoInfo.is_git_repo) {
      body.innerHTML = `<div class="bottom-empty">${this.escapeHtml(t("gitNotRepo"))}</div>`;
      return;
    }

    const branchOptions = this.branchesInfo.branches
      .map(
        (b) =>
          `<option value="${this.escapeAttr(b)}" ${b === this.branchesInfo.current ? "selected" : ""}>${this.escapeHtml(b)}</option>`
      )
      .join("");

    const toolbarHtml = `
      <div class="git-toolbar-bar">
        <div class="git-toolbar-left">
          <select id="git-branch-select" class="studio-input git-branch-select">${branchOptions}</select>
          <button type="button" class="studio-btn studio-btn-sm" id="btn-git-new-branch">+ Branch</button>
          <button type="button" class="studio-btn studio-btn-sm" id="btn-git-pull">Pull</button>
          <button type="button" class="studio-btn studio-btn-sm" id="btn-git-push">Push</button>
        </div>
        <div class="git-toolbar-right">
          <button type="button" class="studio-btn studio-btn-sm" id="btn-git-ai-review" ${this.repoInfo.files.length === 0 ? "disabled" : ""}>${t("gitReviewAi")}</button>
          <button type="button" class="studio-btn studio-btn-sm ${this.activeSubTab === "diff" ? "studio-btn-primary" : ""}" id="btn-git-tab-diff">Diff (${this.repoInfo.files.length})</button>
          <button type="button" class="studio-btn studio-btn-sm ${this.activeSubTab === "log" ? "studio-btn-primary" : ""}" id="btn-git-tab-log">Log (${this.commitLog.length})</button>
          <button type="button" class="studio-btn studio-btn-sm" id="btn-git-refresh">${t("refresh")}</button>
        </div>
      </div>
    `;

    let mainSectionHtml = "";
    if (this.activeSubTab === "log") {
      const logRows =
        this.commitLog.length === 0
          ? `<div class="bottom-empty">${t("gitNoCommits")}</div>`
          : this.commitLog
              .map(
                (c) => `
                <div class="git-log-row">
                  <span class="git-log-hash">${this.escapeHtml(c.hash)}</span>
                  <span class="git-log-msg">${this.escapeHtml(c.message)}</span>
                  <span class="git-log-meta">${this.escapeHtml(c.author)} · ${this.escapeHtml(c.date)}</span>
                </div>
              `
              )
              .join("");
      mainSectionHtml = `<div class="git-log-list">${logRows}</div>`;
    } else {
      const fileRows =
        this.repoInfo.files.length === 0
          ? `<div class="bottom-empty">${t("gitWorkingClean")}</div>`
          : `
            <button type="button" class="git-file-row ${this.selectedPath === null ? "is-active" : ""}" data-git-path="">
              <span class="git-badge git-badge-all">*</span>
              <span class="git-file-path">${t("gitAllChanges")} (${this.repoInfo.files.length})</span>
            </button>
            ${this.repoInfo.files
              .map(
                (f) => `
                <button type="button" class="git-file-row ${this.selectedPath === f.path ? "is-active" : ""}" data-git-path="${this.escapeAttr(f.path)}">
                  <span class="git-badge git-badge-${this.escapeAttr(f.status.toLowerCase())}">${this.escapeHtml(f.status)}</span>
                  <span class="git-file-path" title="${this.escapeAttr(f.path)}">${this.escapeHtml(f.path)}</span>
                </button>
              `
              )
              .join("")}
          `;

      const diffHtml = this.currentDiff.trim()
        ? this.currentDiff
            .split("\n")
            .slice(0, 800)
            .map((line) => {
              let cls = "diff-line";
              if (line.startsWith("+") && !line.startsWith("+++")) cls += " diff-add";
              else if (line.startsWith("-") && !line.startsWith("---")) cls += " diff-del";
              else if (line.startsWith("@@") || line.startsWith("diff --git")) cls += " diff-hunk";
              return `<div class="${cls}">${this.escapeHtml(line || " ")}</div>`;
            })
            .join("")
        : `<div class="bottom-empty">${t("gitNoDiff")}</div>`;

      mainSectionHtml = `
        <div class="git-layout">
          <div class="git-files-col">
            <div class="git-col-header">${t("gitChangedFiles")}</div>
            <div class="git-files-list">${fileRows}</div>
          </div>
          <div class="git-diff-col">
            <div class="git-col-header">
              <span>Diff ${this.selectedPath ? `— ${this.escapeHtml(this.selectedPath)}` : `(${t("filterAll")})`}</span>
            </div>
            <div class="git-diff-view">${diffHtml}</div>
          </div>
        </div>
      `;
    }

    body.innerHTML = `
      ${toolbarHtml}
      ${mainSectionHtml}
      <div class="git-commit-box">
        <div class="git-commit-head">
          <span class="settings-section-title">AI Commit Message</span>
          <div class="git-commit-actions">
            <button type="button" class="studio-btn studio-btn-sm studio-btn-primary" id="btn-git-gen-commit" ${this.isGenerating || this.repoInfo.files.length === 0 ? "disabled" : ""}>
              ${this.isGenerating ? "..." : "AI Commit"}
            </button>
            <button type="button" class="studio-btn studio-btn-sm" id="btn-git-copy-commit" ${!this.commitMsg ? "disabled" : ""}>${t("gitCopy")}</button>
            <button type="button" class="studio-btn studio-btn-sm" id="btn-git-run-commit" ${!this.commitMsg || this.repoInfo.files.length === 0 ? "disabled" : ""}>Commit</button>
          </div>
        </div>
        <input
          type="text"
          id="git-commit-input"
          class="studio-input"
          placeholder="feat: commit message..."
          value="${this.escapeAttr(this.commitMsg)}"
        />
        ${this.statusNotice ? `<div class="form-hint">${this.escapeHtml(this.statusNotice)}</div>` : ""}
      </div>
    `;

    body.querySelector("#btn-git-ai-review")?.addEventListener("click", () => {
      this.onReviewDiffWithAi?.(this.currentDiff, this.repoInfo.files);
      this.close();
    });

    body.querySelector("#btn-git-tab-diff")?.addEventListener("click", () => {
      this.activeSubTab = "diff";
      this.render();
    });
    body.querySelector("#btn-git-tab-log")?.addEventListener("click", () => {
      this.activeSubTab = "log";
      this.render();
    });
    body.querySelector("#btn-git-refresh")?.addEventListener("click", () => void this.refreshAndRender());

    const branchSelect = body.querySelector("#git-branch-select") as HTMLSelectElement | null;
    branchSelect?.addEventListener("change", async () => {
      const target = branchSelect.value;
      if (!target || target === this.branchesInfo.current) return;
      try {
        const res = await invoke<string>("studio_git_checkout", { branch: target });
        this.statusNotice = res || `Switched to ${target}`;
        this.onGitChanged?.();
        await this.refreshAndRender();
      } catch (e: any) {
        this.statusNotice = `Checkout error: ${e}`;
        this.render();
      }
    });

    body.querySelector("#btn-git-new-branch")?.addEventListener("click", async () => {
      const name = await showInputDialog({
        title: "New Git Branch",
        label: "Branch name (e.g. feat/new-feature)",
        placeholder: "feat/my-feature",
        confirmText: "Create",
      });
      if (!name) return;
      try {
        const res = await invoke<string>("studio_git_create_branch", { branch: name });
        this.statusNotice = res || `Created branch ${name}`;
        this.onGitChanged?.();
        await this.refreshAndRender();
      } catch (e: any) {
        this.statusNotice = `Branch error: ${e}`;
        this.render();
      }
    });

    const runSync = async (action: "pull" | "push") => {
      this.statusNotice = `git ${action}...`;
      this.render();
      try {
        const out = await invoke<string>("studio_git_sync", { action });
        this.statusNotice = out || `git ${action} completed.`;
        this.onGitChanged?.();
        await this.refreshAndRender();
      } catch (e: any) {
        this.statusNotice = `git ${action} error: ${e}`;
        this.render();
      }
    };
    body.querySelector("#btn-git-pull")?.addEventListener("click", () => void runSync("pull"));
    body.querySelector("#btn-git-push")?.addEventListener("click", () => void runSync("push"));

    body.querySelectorAll<HTMLButtonElement>("[data-git-path]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const p = btn.dataset.gitPath || "";
        this.selectedPath = p ? p : null;
        await this.refreshAndRender();
      });
    });

    const commitInput = body.querySelector("#git-commit-input") as HTMLInputElement | null;
    commitInput?.addEventListener("input", () => {
      this.commitMsg = commitInput.value;
    });

    body.querySelector("#btn-git-copy-commit")?.addEventListener("click", async () => {
      if (!this.commitMsg) return;
      try {
        await navigator.clipboard.writeText(this.commitMsg);
        this.statusNotice = "Copied to clipboard.";
        this.render();
      } catch {}
    });

    body.querySelector("#btn-git-gen-commit")?.addEventListener("click", async () => {
      this.isGenerating = true;
      this.statusNotice = "Generating commit message...";
      this.render();
      try {
        const summaryFiles = this.repoInfo.files.map((f) => `${f.status} ${f.path}`).join("\n");
        const diffExcerpt = this.currentDiff.slice(0, 6000);
        const prompt = `Generate a single-line Conventional Commit message (e.g. "feat: add ...", "fix: resolve ...") for these Git changes. Output ONLY the commit message text without quotes, markdown, or extra explanation.\n\nChanged files:\n<untrusted_data>\n${summaryFiles}\n</untrusted_data>\n\nDiff excerpt:\n<untrusted_data>\n${diffExcerpt}\n</untrusted_data>`;
        const generated = await this.aiClient.generateOneShotText(prompt);
        this.commitMsg = generated.split("\n")[0].replace(/^["'`]+|["'`]+$/g, "").trim();
        this.statusNotice = "Commit message ready.";
      } catch (e: any) {
        this.statusNotice = `AI error: ${e?.message || e}`;
      } finally {
        this.isGenerating = false;
        this.render();
      }
    });

    body.querySelector("#btn-git-run-commit")?.addEventListener("click", async () => {
      const msg = this.commitMsg.trim().replace(/"/g, '\\"');
      if (!msg) return;
      this.statusNotice = "git add -A && git commit...";
      this.render();
      try {
        const res = await invoke<{ exit_code: number; stdout: string; stderr: string }>(
          "studio_run_approved_command",
          { command: `git add -A && git commit -m "${msg}"` }
        );
        if (res.exit_code === 0) {
          this.statusNotice = `Committed: ${res.stdout.trim() || msg}`;
          this.commitMsg = "";
          this.onGitChanged?.();
          await this.refreshAndRender();
        } else {
          this.statusNotice = `Commit error: ${res.stderr.trim() || res.stdout.trim()}`;
          this.render();
        }
      } catch (e: any) {
        this.statusNotice = `Commit error: ${e}`;
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
