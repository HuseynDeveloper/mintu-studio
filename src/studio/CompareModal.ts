/**
 * CompareModal.ts
 * 1. Compare any two workspace files with unified line diff (computeLineDiff)
 * 2. Project Starter Template Scaffolder Modal (React+TS+Vite, Python FastAPI, Node Express, Web Starter)
 */

import { invoke } from "@tauri-apps/api/core";
import { computeLineDiff } from "./DiffUtils";
import { isSensitiveFileOrDir } from "./sensitiveFilter";
import { t } from "./i18n";
import { ICON_CLOSE } from "./icons";

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(str: string): string {
  return escapeHtml(str).replace(/"/g, "&quot;");
}

export function openCompareFilesModal(projectFiles: string[], initialFileA?: string | null): void {
  document.querySelector(".compare-modal-overlay")?.remove();
  const safeFiles = projectFiles.filter((f) => !isSensitiveFileOrDir(f));
  let fileA = initialFileA && safeFiles.includes(initialFileA) ? initialFileA : safeFiles[0] || "";
  let fileB = safeFiles.find((f) => f !== fileA) || fileA;
  let diffHtml = `<div class="bottom-empty">—</div>`;
  let statsText = "";

  const overlay = document.createElement("div");
  overlay.className = "studio-modal-overlay compare-modal-overlay";
  const close = () => {
    overlay.classList.add("is-closing");
    setTimeout(() => overlay.remove(), 120);
  };

  const compute = async () => {
    if (!fileA || !fileB) {
      diffHtml = `<div class="bottom-empty">${t("noChanges")}</div>`;
      render();
      return;
    }
    try {
      const [contentA, contentB] = await Promise.all([
        invoke<string>("studio_read_file", { relPath: fileA }),
        invoke<string>("studio_read_file", { relPath: fileB }),
      ]);
      const diff = computeLineDiff(contentA, contentB, 400);
      statsText = `+${diff.added} / -${diff.removed}`;
      diffHtml = diff.lines.length
        ? diff.lines
            .map((l) => {
              const sign = l.type === "add" ? "+" : l.type === "del" ? "-" : " ";
              return `<div class="diff-line diff-${l.type}"><span class="diff-sign">${sign}</span><span class="diff-text">${escapeHtml(l.text)}</span></div>`;
            })
            .join("")
        : `<div class="bottom-empty">${t("noChanges")}</div>`;
    } catch (e: any) {
      diffHtml = `<div class="mcp-error-banner">${escapeHtml(String(e))}</div>`;
    }
    render();
  };

  const render = () => {
    const optsA = safeFiles
      .map((f) => `<option value="${escapeAttr(f)}" ${f === fileA ? "selected" : ""}>${escapeHtml(f)}</option>`)
      .join("");
    const optsB = safeFiles
      .map((f) => `<option value="${escapeAttr(f)}" ${f === fileB ? "selected" : ""}>${escapeHtml(f)}</option>`)
      .join("");

    overlay.innerHTML = `
      <div class="studio-modal-dialog studio-git-dialog" role="dialog" aria-modal="true">
        <div class="studio-modal-header">
          <div class="modal-title-group">
            <h2 class="modal-title">${t("compareTitle")}</h2>
            ${statsText ? `<span class="modal-subtitle">${escapeHtml(statsText)}</span>` : ""}
          </div>
          <button type="button" class="studio-btn-icon" id="btn-close-compare" title="${t("close")}">${ICON_CLOSE}</button>
        </div>
        <div class="studio-modal-body git-modal-body">
          <div class="mcp-form-grid">
            <div class="form-group">
              <label for="cmp-file-a">${t("compareFileA")}</label>
              <select id="cmp-file-a" class="studio-input">${optsA}</select>
            </div>
            <div class="form-group">
              <label for="cmp-file-b">${t("compareFileB")}</label>
              <select id="cmp-file-b" class="studio-input">${optsB}</select>
            </div>
          </div>
          <div class="git-diff-view" style="flex:1; min-height: 280px;">${diffHtml}</div>
        </div>
      </div>
    `;

    overlay.querySelector("#btn-close-compare")?.addEventListener("click", close);
    const selA = overlay.querySelector("#cmp-file-a") as HTMLSelectElement | null;
    const selB = overlay.querySelector("#cmp-file-b") as HTMLSelectElement | null;
    selA?.addEventListener("change", () => {
      fileA = selA.value;
      void compute();
    });
    selB?.addEventListener("change", () => {
      fileB = selB.value;
      void compute();
    });
  };

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  document.body.appendChild(overlay);
  void compute();
}

const STARTER_TEMPLATES = [
  { id: "react-ts-vite", name: "React + TypeScript + Vite", desc: "Modern SPA setup with package.json, index.html, src/main.tsx, src/App.tsx" },
  { id: "python-fastapi", name: "Python FastAPI Backend", desc: "Typed FastAPI server with Pydantic v2 schema, /health endpoint, and requirements.txt" },
  { id: "node-express", name: "Node.js Express REST API", desc: "Clean ESM Express server with /health route and watch dev script" },
  { id: "web-starter", name: "HTML / CSS / JS Starter", desc: "Zero-build clean dark web starter with index.html, style.css, app.js" },
];

export function openNewProjectTemplateModal(onCreated: (createdFiles: string[]) => void): void {
  document.querySelector(".template-modal-overlay")?.remove();
  let selectedId = STARTER_TEMPLATES[0].id;
  let projectName = "my-mintu-app";
  let errText = "";

  const overlay = document.createElement("div");
  overlay.className = "studio-modal-overlay template-modal-overlay";
  const close = () => {
    overlay.classList.add("is-closing");
    setTimeout(() => overlay.remove(), 120);
  };

  const render = () => {
    const cards = STARTER_TEMPLATES.map(
      (tpl) => `
        <button type="button" class="cloud-prov-card ${tpl.id === selectedId ? "is-selected" : ""}" data-tpl-id="${tpl.id}">
          <div class="cloud-prov-card-top">
            <span class="cloud-prov-card-name">${escapeHtml(tpl.name)}</span>
          </div>
          <div class="cloud-prov-card-meta">${escapeHtml(tpl.desc)}</div>
        </button>
      `
    ).join("");

    overlay.innerHTML = `
      <div class="studio-modal-dialog" style="width: 560px; max-width: 94vw;" role="dialog" aria-modal="true">
        <div class="studio-modal-header">
          <h2 class="modal-title">${t("templateModalTitle")}</h2>
          <button type="button" class="studio-btn-icon" id="btn-close-tpl" title="${t("close")}">${ICON_CLOSE}</button>
        </div>
        <div class="studio-modal-body" style="display:flex; flex-direction:column; gap:12px;">
          <div class="form-group">
            <label for="tpl-proj-name">${t("templateNameLabel")}</label>
            <input id="tpl-proj-name" class="studio-input" type="text" value="${escapeAttr(projectName)}" autocomplete="off" />
          </div>
          <div class="cloud-prov-list">${cards}</div>
          ${errText ? `<div class="mcp-error-banner">${escapeHtml(errText)}</div>` : ""}
        </div>
        <div class="studio-modal-footer">
          <button type="button" class="studio-btn" id="btn-cancel-tpl">${t("cancel")}</button>
          <button type="button" class="studio-btn studio-btn-primary" id="btn-confirm-tpl">${t("templateCreateBtn")}</button>
        </div>
      </div>
    `;

    overlay.querySelector("#btn-close-tpl")?.addEventListener("click", close);
    overlay.querySelector("#btn-cancel-tpl")?.addEventListener("click", close);
    const nameIn = overlay.querySelector("#tpl-proj-name") as HTMLInputElement | null;
    nameIn?.addEventListener("input", () => (projectName = nameIn.value));

    overlay.querySelectorAll<HTMLButtonElement>("[data-tpl-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.tplId) {
          selectedId = btn.dataset.tplId;
          render();
        }
      });
    });

    overlay.querySelector("#btn-confirm-tpl")?.addEventListener("click", async () => {
      errText = "";
      try {
        const created = await invoke<string[]>("devtools_scaffold_project", {
          templateId: selectedId,
          projectName: projectName.trim() || "my-mintu-app",
        });
        close();
        onCreated(created);
      } catch (e: any) {
        errText = String(e);
        render();
      }
    });
  };

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  document.body.appendChild(overlay);
  render();
}
