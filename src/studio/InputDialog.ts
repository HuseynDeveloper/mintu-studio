/**
 * InputDialog.ts
 * Clean dark inline modal input dialog for creating new files/folders without native browser prompts.
 */

import { ICON_CLOSE } from "./icons";
import { t } from "./i18n";

export function showInputDialog(options: {
  title: string;
  label: string;
  placeholder: string;
  defaultValue?: string;
  confirmText: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "studio-modal-overlay";
    overlay.innerHTML = `
      <div class="studio-modal" style="width: 400px;">
        <div class="studio-modal-header">
          <span class="studio-modal-title">${options.title}</span>
          <button type="button" class="studio-btn-icon" id="btn-dialog-close" title="${t("close")}">${ICON_CLOSE}</button>
        </div>
        <div class="studio-modal-body">
          <div class="form-group">
            <label for="input-dialog-field">${options.label}</label>
            <input id="input-dialog-field" class="studio-input" type="text" placeholder="${options.placeholder}" autocomplete="off" spellcheck="false" />
          </div>
        </div>
        <div class="studio-modal-footer">
          <button type="button" class="studio-btn" id="btn-dialog-cancel">${t("cancel")}</button>
          <button type="button" class="studio-btn studio-btn-primary" id="btn-dialog-ok">${options.confirmText}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    const input = overlay.querySelector("#input-dialog-field") as HTMLInputElement;
    if (options.defaultValue) {
      input.value = options.defaultValue;
    }

    const finish = (val: string | null) => {
      overlay.classList.add("is-closing");
      setTimeout(() => overlay.remove(), 125);
      resolve(val);
    };

    overlay.querySelector("#btn-dialog-close")?.addEventListener("click", () => finish(null));
    overlay.querySelector("#btn-dialog-cancel")?.addEventListener("click", () => finish(null));
    overlay.querySelector("#btn-dialog-ok")?.addEventListener("click", () => {
      const v = input.value.trim();
      finish(v || null);
    });
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) finish(null);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const v = input.value.trim();
        finish(v || null);
      } else if (e.key === "Escape") {
        finish(null);
      }
    });

    setTimeout(() => {
      input.focus();
      if (options.defaultValue) input.select();
    }, 10);
  });
}

export function showConfirmDialog(options: {
  title: string;
  message: string;
  confirmText: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "studio-modal-overlay";
    overlay.innerHTML = `
      <div class="studio-modal" style="width: 400px;">
        <div class="studio-modal-header">
          <span class="studio-modal-title">${options.title}</span>
          <button type="button" class="studio-btn-icon" id="btn-confirm-close" title="${t("close")}">${ICON_CLOSE}</button>
        </div>
        <div class="studio-modal-body">
          <div class="form-hint" style="color: var(--text); font-size: 13px;">${options.message}</div>
        </div>
        <div class="studio-modal-footer">
          <button type="button" class="studio-btn" id="btn-confirm-cancel">${t("cancel")}</button>
          <button type="button" class="studio-btn ${options.danger ? "studio-btn-danger" : "studio-btn-primary"}" id="btn-confirm-ok">${options.confirmText}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    const finish = (ok: boolean) => {
      overlay.classList.add("is-closing");
      setTimeout(() => overlay.remove(), 125);
      resolve(ok);
    };

    overlay.querySelector("#btn-confirm-close")?.addEventListener("click", () => finish(false));
    overlay.querySelector("#btn-confirm-cancel")?.addEventListener("click", () => finish(false));
    overlay.querySelector("#btn-confirm-ok")?.addEventListener("click", () => finish(true));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) finish(false);
    });
  });
}
