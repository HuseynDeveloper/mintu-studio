/**
 * scripts/prepare-release.mjs
 * Generates a signed-checksum `release/latest.json` manifest for GitHub Releases Auto-Updater.
 *
 * Usage:
 *   node scripts/prepare-release.mjs --repo <owner/repo> --notes "Release highlights..."
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const args = process.argv.slice(2);
function getArg(name, fallback = "") {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

const pkg = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8"));
const version = getArg("version", pkg.version);
const repo = getArg("repo", "HuseynDeveloper/mintu-studio").replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "");
const notes = getArg("notes", `Mintu Studio v${version} update with improvements and fixes.`);

const targetDir = process.env.CARGO_TARGET_DIR || "D:\\mintu-studio-target";
const installerName = `Mintu Studio_${version}_x64-setup.exe`;
const installerPath = path.join(targetDir, "release", "bundle", "nsis", installerName);

if (!fs.existsSync(installerPath)) {
  console.error(`Installer not found at: ${installerPath}`);
  console.error("Run 'npx tauri build --bundles nsis' first.");
  process.exit(1);
}

const bytes = fs.readFileSync(installerPath);
const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");

// GitHub Releases converts spaces in asset filenames to dots when uploaded
const githubAssetFilename = installerName.replace(/\s+/g, ".");
const downloadUrl = `https://github.com/${repo}/releases/download/v${version}/${githubAssetFilename}`;

const manifest = {
  version,
  pub_date: new Date().toISOString(),
  notes,
  url: downloadUrl,
  sha256,
};

const outDir = path.resolve("release");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "latest.json");
fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

console.log("Generated GitHub Release manifest:");
console.log("  Manifest:", outPath);
console.log("  Installer:", installerPath);
console.log("  SHA-256:", sha256);
console.log("  Upload both files to GitHub Release tag:", `v${version}`);
