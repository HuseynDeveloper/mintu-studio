/**
 * icons.ts
 * All inline SVG icons for Mintu Studio (zero external fonts, images, or CDNs).
 */

export const MINTU_LOGO_SVG = (size = 18): string => `
<svg width="${size}" height="${size}" viewBox="0 0 28 24" fill="none" aria-hidden="true">
  <path d="M2.5 21V5.2C2.5 3.3 4.7 2.2 6.2 3.4L14 9.8L21.8 3.4C23.3 2.2 25.5 3.3 25.5 5.2V21H21.2V10.1L14 15.8L6.8 10.1V21H2.5Z" fill="currentColor"/>
</svg>`;

export const ICON_EXPLORER = `
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
  <polyline points="14 2 14 8 20 8"/>
</svg>`;

export const ICON_SEARCH = `
<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="11" cy="11" r="7.5"/>
  <line x1="20" y1="20" x2="16.4" y2="16.4"/>
</svg>`;

export const ICON_MODELS = `
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <polygon points="12 2 2 7 12 12 22 7 12 2"/>
  <polyline points="2 17 12 22 22 17"/>
  <polyline points="2 12 12 17 22 12"/>
</svg>`;

export const ICON_SETTINGS = `
<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="12" cy="12" r="3"/>
  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
</svg>`;

export const ICON_SPARKLE = `
<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
  <path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z"/>
</svg>`;

export const ICON_HISTORY = `
<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M3 12a9 9 0 1 0 3-6.7L3 8"/>
  <path d="M3 3v5h5"/>
  <polyline points="12 7 12 12 15 14"/>
</svg>`;

export const ICON_EXPAND = `
<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <polyline points="15 3 21 3 21 9"/>
  <polyline points="9 21 3 21 3 15"/>
  <line x1="21" y1="3" x2="14" y2="10"/>
  <line x1="3" y1="21" x2="10" y2="14"/>
</svg>`;

export const ICON_CLOSE = `
<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true">
  <line x1="18" y1="6" x2="6" y2="18"/>
  <line x1="6" y1="6" x2="18" y2="18"/>
</svg>`;

export const ICON_LOCK_RED = `
<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="4" y="11" width="16" height="10" rx="2"/>
  <path d="M8 11V7a4 4 0 0 1 8 0v4"/>
</svg>`;

export const ICON_CHEVRON_RIGHT = `
<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <polyline points="9 18 15 12 9 6"/>
</svg>`;

export const ICON_CHEVRON_DOWN = `
<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <polyline points="6 9 12 15 18 9"/>
</svg>`;

export const ICON_FOLDER = `
<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
</svg>`;

export const ICON_PAPERCLIP = `
<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
</svg>`;

export const ICON_SEND = `
<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <line x1="22" y1="2" x2="11" y2="13"/>
  <polygon points="22 2 15 22 11 13 2 9 22 2"/>
</svg>`;

export const ICON_STOP = `
<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
  <rect x="6" y="6" width="12" height="12" rx="2"/>
</svg>`;

export const ICON_DOTS = `
<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
  <circle cx="5" cy="12" r="1.6"/>
  <circle cx="12" cy="12" r="1.6"/>
  <circle cx="19" cy="12" r="1.6"/>
</svg>`;

export const ICON_CHIP_COMPONENT = `
<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="3" y="3" width="7" height="7" rx="1"/>
  <rect x="14" y="3" width="7" height="7" rx="1"/>
  <rect x="14" y="14" width="7" height="7" rx="1"/>
  <rect x="3" y="14" width="7" height="7" rx="1"/>
</svg>`;

export const ICON_CHIP_EXPLAIN = `
<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  <line x1="8" y1="9" x2="16" y2="9"/>
  <line x1="8" y1="13" x2="13" y2="13"/>
</svg>`;

export const ICON_CHIP_BUG = `
<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M8 2l1.88 1.88"/>
  <path d="M14.12 3.88L16 2"/>
  <path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/>
  <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/>
  <path d="M12 20v-9"/>
  <path d="M6.53 9C4.6 8.8 3 7.1 3 5"/>
  <path d="M6 13H2"/>
  <path d="M3 21c0-2.1 1.7-3.9 3.8-4"/>
  <path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/>
  <path d="M22 13h-4"/>
  <path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>
</svg>`;

export const ICON_CHIP_REFACTOR = `
<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <polyline points="23 4 23 10 17 10"/>
  <polyline points="1 20 1 14 7 14"/>
  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
</svg>`;

export const ICON_CHIP_TEST = `
<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M9 3h6"/>
  <path d="M10 3v6.5L5.2 18a2 2 0 0 0 1.7 3h10.2a2 2 0 0 0 1.7-3L14 9.5V3"/>
</svg>`;

export function getFileIconSvg(filename: string): string {
  const lower = filename.toLowerCase();
  const ext = lower.split(".").pop() || "";

  if (ext === "tsx" || ext === "jsx") {
    return `<svg class="file-icon file-icon-react" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
      <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/>
      <ellipse cx="12" cy="12" rx="9" ry="3.8"/>
      <ellipse cx="12" cy="12" rx="9" ry="3.8" transform="rotate(60 12 12)"/>
      <ellipse cx="12" cy="12" rx="9" ry="3.8" transform="rotate(120 12 12)"/>
    </svg>`;
  }
  if (ext === "ts" || ext === "mts" || ext === "cts") {
    return `<svg class="file-icon file-icon-ts" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="3"/>
      <path d="M8 10h5M10.5 10v7M14.5 16.5c.7.4 1.6.5 2.2 0 .6-.5.5-1.5-.3-1.8l-1-.4c-.8-.3-.9-1.3-.2-1.8.6-.5 1.5-.4 2.1 0"/>
    </svg>`;
  }
  if (ext === "js" || ext === "mjs" || ext === "cjs") {
    return `<svg class="file-icon file-icon-js" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="3"/>
      <path d="M10.5 10v5.2c0 1.2-.8 1.8-2 1.6M14 16.3c.7.5 1.8.5 2.4-.1.6-.6.4-1.5-.4-1.8l-1-.4c-.8-.3-.9-1.2-.2-1.8.6-.5 1.6-.4 2.2.1"/>
    </svg>`;
  }
  if (ext === "json" || ext === "toml" || ext === "yaml" || ext === "yml") {
    return `<svg class="file-icon file-icon-json" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
      <path d="M8 4c-1.5 0-2 1-2 2.5v3C6 11 5 12 4 12c1 0 2 1 2 2.5v3C6 19 6.5 20 8 20"/>
      <path d="M16 4c1.5 0 2 1 2 2.5v3c0 1.5 1 2.5 2 2.5-1 0-2 1-2 2.5v3c0 1.5-.5 2.5-2 2.5"/>
    </svg>`;
  }
  if (ext === "rs") {
    return `<svg class="file-icon file-icon-rs" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="7.5"/>
      <circle cx="12" cy="12" r="2.5"/>
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2"/>
    </svg>`;
  }
  if (ext === "css" || ext === "scss" || ext === "html") {
    return `<svg class="file-icon file-icon-web" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="8 6 2 12 8 18"/>
      <polyline points="16 6 22 12 16 18"/>
    </svg>`;
  }
  if (ext === "md" || ext === "txt") {
    return `<svg class="file-icon file-icon-md" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="8" y1="13" x2="16" y2="13"/>
      <line x1="8" y1="17" x2="13" y2="17"/>
    </svg>`;
  }
  if (ext === "svg" || ext === "png" || ext === "jpg" || ext === "ico") {
    return `<svg class="file-icon file-icon-asset" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/>
    </svg>`;
  }

  return `<svg class="file-icon file-icon-default" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
  </svg>`;
}
