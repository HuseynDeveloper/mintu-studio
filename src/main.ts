/**
 * main.ts
 * Entry point for Standalone Mintu Studio.
 */

import { invoke } from "@tauri-apps/api/core";
import { StudioApp } from "./studio/StudioApp";

function showFatalError(title: string, details: string): void {
  console.error(`[Mintu Studio Error] ${title}:`, details);

  const existing = document.getElementById("studio-fatal-error-overlay");
  if (existing) {
    const pre = existing.querySelector("pre");
    if (pre) pre.textContent += `\n\n[${title}]\n${details}`;
    return;
  }

  const overlay = document.createElement("div");
  overlay.id = "studio-fatal-error-overlay";
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    background: #0a0e14;
    color: #fca5a5;
    z-index: 999999;
    padding: 24px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Consolas, monospace;
    display: flex;
    flex-direction: column;
    gap: 16px;
    box-sizing: border-box;
    overflow: auto;
  `;

  overlay.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(239, 68, 68, 0.3); padding-bottom: 12px;">
      <div style="font-size: 16px; font-weight: 700; color: #ef4444;">Mintu Studio Error</div>
      <button id="btn-copy-studio-error" style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #e6edf3; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px;">
        Copy Error
      </button>
    </div>
    <div style="font-size: 13px; color: #e6edf3;">An error occurred while loading Mintu Studio:</div>
    <pre style="background: rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 14px; font-size: 12px; color: #fca5a5; overflow-x: auto; white-space: pre-wrap; word-break: break-all; font-family: Consolas, monospace; flex: 1;">[${title}]\n${details}</pre>
  `;

  (document.body || document.documentElement).appendChild(overlay);

  const copyBtn = overlay.querySelector("#btn-copy-studio-error");
  copyBtn?.addEventListener("click", () => {
    navigator.clipboard.writeText(`[${title}]\n${details}`).then(() => {
      copyBtn.textContent = "Copied!";
      setTimeout(() => {
        copyBtn.textContent = "Copy Error";
      }, 2000);
    });
  });
}

window.addEventListener("error", (event) => {
  const err = event.error;
  const msg = event.message || "Unknown error";
  const source = event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : "";
  const stack = err?.stack || "";
  showFatalError("Uncaught JavaScript Error", `${msg}\n${source ? "Source: " + source + "\n" : ""}${stack}`);
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const msg =
    typeof reason === "object" && reason !== null
      ? reason.stack || reason.message || JSON.stringify(reason)
      : String(reason);
  showFatalError("Unhandled Promise Rejection", msg);
});

window.addEventListener("keydown", (e) => {
  if (e.key === "F12" || (e.ctrlKey && e.shiftKey && (e.key === "I" || e.key === "i"))) {
    invoke("studio_open_devtools").catch(() => {});
  }
});

declare global {
  interface Window {
    __mintuCopyCode?: (button: HTMLButtonElement) => void;
  }
}

window.__mintuCopyCode = (btn: HTMLButtonElement) => {
  const container = btn.closest(".mintu-code-block");
  if (!container) return;
  const codeEl = container.querySelector("pre code");
  if (!codeEl) return;
  const code = codeEl.textContent || "";
  navigator.clipboard.writeText(code).then(() => {
    const span = btn.querySelector("span");
    if (span) {
      const orig = span.textContent;
      span.textContent = "Kopyalandı!";
      setTimeout(() => {
        span.textContent = orig;
      }, 2000);
    }
  });
};

function initStudio(): void {
  try {
    new StudioApp();
  } catch (err: any) {
    showFatalError("Studio Initialization Error", err?.stack || err?.message || String(err));
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initStudio);
} else {
  initStudio();
}
