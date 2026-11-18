/**
 * LocalTimeline.ts
 * Local file snapshot history (saved automatically on every Ctrl+S).
 * Allows comparing diffs against any previous snapshot and restoring in 1 click.
 */

import { computeLineDiff } from "./DiffUtils";
import { t } from "./i18n";
import { ICON_CLOSE } from "./icons";

export interface TimelineSnapshot {
  id: string;
  timestamp: number;
  content: string;
  sizeBytes: number;
}

const TIMELINE_KEY = "mintu_studio_local_timeline_v1";
const MAX_SNAPSHOTS_PER_FILE = 10;
const MAX_TRACKED_FILES = 40;

type TimelineStore = Record<string, TimelineSnapshot[]>;

function loadStore(): TimelineStore {
  try {
    const raw = localStorage.getItem(TIMELINE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed as TimelineStore;
    }
  } catch {}
  return {};
}

function saveStore(store: TimelineStore): void {
  try {
    const keys = Object.keys(store);
    if (keys.length > MAX_TRACKED_FILES) {
      // Evict oldest tracked files
      keys
        .sort((a, b) => {
          const ta = store[a]?.[0]?.timestamp || 0;
          const tb = store[b]?.[0]?.timestamp || 0;
          return ta - tb;
        })
        .slice(0, keys.length - MAX_TRACKED_FILES)
        .forEach((k) => delete store[k]);
    }
    localStorage.setItem(TIMELINE_KEY, JSON.stringify(store));
  } catch {
    // Ignore localStorage quota errors
  }
}

export function saveTimelineSnapshot(projectKey: string, relPath: string, content: string): void {
  if (!relPath || content.length > 250_000) return;
  const key = `${projectKey}::${relPath}`;
  const store = loadStore();
  const list = store[key] || [];
  if (list.length > 0 && list[0].content === content) {
    return; // Skip duplicate snapshot
  }
  const snap: TimelineSnapshot = {
    id: `snap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    content,
    sizeBytes: new TextEncoder().encode(content).length,
  };
  list.unshift(snap);
  store[key] = list.slice(0, MAX_SNAPSHOTS_PER_FILE);
  saveStore(store);
}

export function getTimelineSnapshots(projectKey: string, relPath: string): TimelineSnapshot[] {
  const key = `${projectKey}::${relPath}`;
  const store = loadStore();
  return store[key] || [];
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function openTimelineModal(
  projectKey: string,
  relPath: string,
  currentContent: string,
  onRestore: (content: string) => void
): void {
  const existing = document.querySelector(".timeline-modal-overlay");
  if (existing) existing.remove();

  const snapshots = getTimelineSnapshots(projectKey, relPath);
  let selectedIdx = 0;

  const overlay = document.createElement("div");
  overlay.className = "studio-modal-overlay timeline-modal-overlay";

  const close = () => {
    overlay.classList.add("is-closing");
    setTimeout(() => overlay.remove(), 120);
  };

  const render = () => {
    const selected = snapshots[selectedIdx] || null;
    const listHtml =
      snapshots.length === 0
        ? `<div class="bottom-empty">${t("timelineEmpty")}</div>`
        : snapshots
            .map(
              (s, i) => `
              <button type="button" class="git-file-row ${i === selectedIdx ? "is-active" : ""}" data-snap-idx="${i}">
                <span class="git-file-path">${new Date(s.timestamp).toLocaleString()}</span>
                <span class="bottom-row-size">${Math.max(1, Math.round(s.sizeBytes / 1024))} KB</span>
              </button>
            `
            )
            .join("");

    let diffHtml = `<div class="bottom-empty">${t("timelineEmpty")}</div>`;
    if (selected) {
      const diff = computeLineDiff(selected.content, currentContent, 240);
      diffHtml = diff.lines.length
        ? diff.lines
            .map((l) => {
              const sign = l.type === "add" ? "+" : l.type === "del" ? "-" : " ";
              return `<div class="diff-line diff-${l.type}"><span class="diff-sign">${sign}</span><span class="diff-text">${escapeHtml(l.text)}</span></div>`;
            })
            .join("")
        : `<div class="bottom-empty">${t("noChanges")}</div>`;
    }

    overlay.innerHTML = `
      <div class="studio-modal-dialog studio-git-dialog" role="dialog" aria-modal="true">
        <div class="studio-modal-header">
          <div class="modal-title-group">
            <h2 class="modal-title">${t("timelineTitle")}</h2>
            <span class="modal-subtitle">${escapeHtml(relPath)} (${snapshots.length})</span>
          </div>
          <button type="button" class="studio-btn-icon" id="btn-close-timeline" title="${t("close")}">${ICON_CLOSE}</button>
        </div>
        <div class="studio-modal-body git-modal-body">
          <div class="git-layout">
            <div class="git-files-col">
              <div class="git-col-header">${t("timeline")}</div>
              <div class="git-files-list">${listHtml}</div>
            </div>
            <div class="git-diff-col">
              <div class="git-col-header">
                <span>${t("timelineCurrentVsSnap")}</span>
                ${
                  selected
                    ? `<button type="button" class="studio-btn studio-btn-sm studio-btn-primary" id="btn-restore-snap">${t("timelineRestore")}</button>`
                    : ""
                }
              </div>
              <div class="git-diff-view">${diffHtml}</div>
            </div>
          </div>
        </div>
      </div>
    `;

    overlay.querySelector("#btn-close-timeline")?.addEventListener("click", close);
    overlay.querySelectorAll<HTMLButtonElement>("[data-snap-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedIdx = Number(btn.dataset.snapIdx || 0);
        render();
      });
    });
    overlay.querySelector("#btn-restore-snap")?.addEventListener("click", () => {
      if (selected) {
        onRestore(selected.content);
        close();
      }
    });
  };

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  document.body.appendChild(overlay);
  render();
}
