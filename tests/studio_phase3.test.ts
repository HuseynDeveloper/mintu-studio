import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { extractSymbols, formatCodeDocument } from "../src/studio/CodeDiagnostics.ts";

function parseI18nLangBlocks(src: string): Record<string, Map<string, string>> {
  const langs = ["az", "en", "tr", "ru"];
  const result: Record<string, Map<string, string>> = {};
  for (let i = 0; i < langs.length; i++) {
    const lang = langs[i];
    const startRe = new RegExp(`\\b${lang}:\\s*\\{`);
    const m = startRe.exec(src);
    assert.ok(m, `Missing language block: ${lang}`);
    const startIdx = m.index + m[0].length;
    const endIdx =
      i + 1 < langs.length
        ? src.search(new RegExp(`\\b${langs[i + 1]}:\\s*\\{`))
        : src.indexOf("};\n\nexport function getLang");
    assert.ok(endIdx > startIdx, `Could not bound language block: ${lang}`);
    const slice = src.slice(startIdx, endIdx);
    const map = new Map<string, string>();
    const entryRe = /^\s*([a-zA-Z0-9_]+):\s*"((?:[^"\\]|\\.)*)"\s*,?\s*$/gm;
    let em: RegExpExecArray | null;
    while ((em = entryRe.exec(slice)) !== null) {
      map.set(em[1], em[2]);
    }
    result[lang] = map;
  }
  return result;
}

test("i18n: 100% key parity across az, en, tr, ru with non-empty values", () => {
  const i18nPath = path.resolve(process.cwd(), "src/studio/i18n.ts");
  const raw = fs.readFileSync(i18nPath, "utf8");
  const blocks = parseI18nLangBlocks(raw);
  const baseKeys = Array.from(blocks.az.keys()).sort();
  assert.ok(baseKeys.length >= 200, `Expected 200+ i18n keys, got ${baseKeys.length}`);

  for (const lang of ["az", "en", "tr", "ru"]) {
    const keys = Array.from(blocks[lang].keys()).sort();
    const missing = baseKeys.filter((k) => !blocks[lang].has(k));
    const extra = keys.filter((k) => !blocks.az.has(k));
    assert.deepEqual(missing, [], `Missing keys in ${lang}: ${missing.join(", ")}`);
    assert.deepEqual(extra, [], `Extra keys in ${lang}: ${extra.join(", ")}`);
    for (const [k, v] of blocks[lang].entries()) {
      assert.ok(v.trim().length > 0, `Empty value for ${lang}.${k}`);
    }
  }
});

test("studio.css: zero hardcoded hex or rgba colors outside :root block", () => {
  const cssPath = path.resolve(process.cwd(), "src/styles/studio.css");
  const raw = fs.readFileSync(cssPath, "utf8");
  const rootEnd = raw.indexOf("}");
  assert.ok(rootEnd > 0, ":root block must exist");
  const afterRoot = raw.slice(rootEnd + 1);
  const noComments = afterRoot.replace(/\/\*[\s\S]*?\*\//g, "");
  const hexMatches = noComments.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  const rgbaMatches = noComments.match(/rgba?\s*\(/gi) || [];
  assert.deepEqual(hexMatches, [], `Found hardcoded hex colors outside :root: ${hexMatches.join(", ")}`);
  assert.deepEqual(rgbaMatches, [], `Found hardcoded rgb/rgba colors outside :root: ${rgbaMatches.join(", ")}`);
});

test("CodeDiagnostics: extracts functions/classes and formats JSON cleanly", () => {
  const tsCode = `export class MarketFeed {\n  fetch() {}\n}\nexport async function syncQuotes() {}\n`;
  const syms = extractSymbols(tsCode, "feed.ts");
  assert.ok(syms.some((s) => s.name === "MarketFeed" && s.kind === "class"));
  assert.ok(syms.some((s) => s.name === "syncQuotes" && s.kind === "fn"));

  const formatted = formatCodeDocument('{"a":1,"b":[2,3]}', "data.json", 2);
  assert.equal(formatted, '{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}\n');
});
