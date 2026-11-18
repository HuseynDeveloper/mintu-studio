# Contributing to Mintu Studio

Thank you for your interest in contributing to **Mintu Studio**!

## License Structure

- Core IDE (`src/`, `src-tauri/`, `tests/`, `scripts/`): **GNU GPL-3.0-only** (`LICENSE`).
- Community Extensions Marketplace (`marketplace/`): **MIT License** (`marketplace/LICENSE-MIT`).

By submitting a pull request, you agree that your contributions will be licensed under the applicable license above.

## Development Setup

### Prerequisites

- **Node.js** 20+
- **Rust** (stable toolchain) + **Tauri v2** prerequisites
- On Windows (MinGW or MSVC): `cargo`, `rustc`, WebView2 Runtime

### Run Locally

```bash
npm install
npm run dev
```

To run the full desktop app:

```bash
npx tauri dev
```

### Verification Checklist (Required Before PR)

```bash
npx tsc --noEmit
npm test
cd src-tauri && cargo check
```

Every PR must pass:
- TypeScript strict typecheck (`npx tsc --noEmit`)
- Unit tests (`npm test`), including:
  - 100% 4-language i18n key parity (`az`, `en`, `tr`, `ru`)
  - Zero hardcoded hex/rgba colors outside `:root` in `src/styles/studio.css`
  - Sensitive-file security filter tests
- Rust backend check (`cargo check`)

## Submitting a Community Extension to the Marketplace

Mintu Studio extensions are **strictly declarative JSON** (snippets, AI rules, API Tester templates, terminal scripts) — no arbitrary JS execution (`eval` is never used).

1. Create and test your extension inside Mintu Studio (**Extensions -> Create Extension**).
2. Click **Publish to GitHub** (copies the JSON and opens a pre-filled Marketplace submission issue), OR open a Pull Request adding your entry to `marketplace/registry.json`.
3. Once merged into `main`, every Mintu Studio user sees your extension live after clicking **Sync GitHub**.

## Adding or Improving Translations

All UI strings live in `src/studio/i18n.ts`. Keep key parity across all supported locales (`az`, `en`, `tr`, `ru`) and run `npm test` to verify automatically.
