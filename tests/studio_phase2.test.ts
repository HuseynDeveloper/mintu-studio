import test from "node:test";
import assert from "node:assert/strict";
import { computeLineDiff } from "../src/studio/DiffUtils.ts";
import {
  extractLargestCodeFence,
  extractStreamingEdit,
  extractToolCalls,
  stripToolCallBlocks,
} from "../src/ai/toolParser.ts";

test("DiffUtils: computes accurate line additions and removals", () => {
  const oldCode = "const a = 1;\nconst b = 2;\nconst c = 3;";
  const newCode = "const a = 1;\nconst b = 20;\nconst c = 3;\nconst d = 4;";

  const diff = computeLineDiff(oldCode, newCode);
  assert.equal(diff.added, 2);
  assert.equal(diff.removed, 1);
  assert.ok(diff.lines.some((l) => l.type === "del" && l.text === "const b = 2;"));
  assert.ok(diff.lines.some((l) => l.type === "add" && l.text === "const b = 20;"));
  assert.ok(diff.lines.some((l) => l.type === "add" && l.text === "const d = 4;"));
});

test("DiffUtils: brand new file marks all lines as added", () => {
  const diff = computeLineDiff("", "export const ok = true;\nconsole.log(ok);");
  assert.equal(diff.added, 2);
  assert.equal(diff.removed, 0);
  assert.equal(diff.lines.length, 2);
});

test("StudioAIClient: parses mintu_tool blocks and strips them from prose", () => {
  const reply = `Faylı oxuyuram.\n\`\`\`mintu_tool\n{"tool":"read_file","args":{"path":"src/main.ts"}}\n\`\`\`\nİndi yoxlayıram.`;
  const calls = extractToolCalls(reply);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tool, "read_file");
  assert.equal(calls[0].args.path, "src/main.ts");

  const stripped = stripToolCallBlocks(reply);
  assert.ok(!stripped.includes("mintu_tool"));
  assert.ok(stripped.includes("Faylı oxuyuram."));
});

test("toolParser: parses <mintu_edit> XML blocks and ```json tool calls reliably", () => {
  const reply = `Market data API əlavə edirəm.\n<mintu_edit path="src/api/market.ts" reason="Add Market Data API">\nexport async function getPrice(sym: string) {\n  return fetch(\`https://api.example.com/\${sym}\`);\n}\n</mintu_edit>\n\`\`\`json\n{"tool":"list_dir","args":{"path":"src"}}\n\`\`\``;
  const calls = extractToolCalls(reply);
  assert.equal(calls.length, 2);
  const editCall = calls.find((c) => c.tool === "propose_edit");
  const listCall = calls.find((c) => c.tool === "list_dir");
  assert.ok(editCall);
  assert.equal(editCall.args.path, "src/api/market.ts");
  assert.ok(editCall.args.content.includes("export async function getPrice"));
  assert.ok(listCall);
  assert.equal(listCall.args.path, "src");

  const stripped = stripToolCallBlocks(reply);
  assert.ok(!stripped.includes("mintu_edit"));
  assert.ok(!stripped.includes("list_dir"));
  assert.ok(stripped.includes("Market data API"));
});

test("toolParser: parses <mintu_replace> surgical patch blocks", () => {
  const reply = `Xətanı düzəldirəm.\n<mintu_replace path="src/utils.ts" reason="Fix null guard">\n<<<<<<< SEARCH\nreturn x.length;\n=======\nreturn x ? x.length : 0;\n>>>>>>> REPLACE\n</mintu_replace>`;
  const calls = extractToolCalls(reply);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tool, "propose_replace");
  assert.equal(calls[0].args.path, "src/utils.ts");
  assert.equal(calls[0].args.hunks.length, 1);
  assert.equal(calls[0].args.hunks[0].search, "return x.length;");
  assert.equal(calls[0].args.hunks[0].replace, "return x ? x.length : 0;");

  const stripped = stripToolCallBlocks(reply);
  assert.ok(!stripped.includes("mintu_replace"));
  assert.ok(stripped.includes("Xətanı düzəldirəm."));
});

test("toolParser: detects live streaming <mintu_edit> progress and strips raw code from chat", () => {
  const partial = `Faylı yeniləyirəm.\n<mintu_edit path="src/app.ts" reason="Add endpoint">\nexport const a = 1;\nexport const b = 2;\nexport const c = 3;`;
  const prog = extractStreamingEdit(partial);
  assert.ok(prog);
  assert.equal(prog.path, "src/app.ts");
  assert.ok(prog.lineCount >= 3);
  assert.ok(prog.preview.includes("export const c = 3;"));

  const stripped = stripToolCallBlocks(partial);
  assert.ok(stripped.includes("Faylı yeniləyirəm."));
  assert.ok(!stripped.includes("export const a = 1;"));
});

test("toolParser: parses line-range <mintu_replace>, install_package, fetch_url, and largest code fence", () => {
  const reply = `<mintu_replace path="snake.py" start_line="14" end_line="14" reason="Fix colon">\nif score > 0:\n</mintu_replace>\n\`\`\`mintu_tool\n{"tool":"install_package","args":{"manager":"pip","packages":["pygame"],"reason":"Install pygame"}}\n\`\`\`\n\`\`\`mintu_tool\n{"tool":"fetch_url","args":{"url":"https://pypi.org/pypi/pygame/json","reason":"Check version"}}\n\`\`\``;
  const calls = extractToolCalls(reply);
  assert.equal(calls.length, 3);
  const rep = calls.find((c) => c.tool === "propose_replace");
  const pkg = calls.find((c) => c.tool === "install_package");
  const web = calls.find((c) => c.tool === "fetch_url");
  assert.ok(rep && rep.args.startLine === 14 && rep.args.endLine === 14);
  assert.ok(pkg && pkg.args.manager === "pip" && pkg.args.packages[0] === "pygame");
  assert.ok(web && web.args.url === "https://pypi.org/pypi/pygame/json");

  const fence = extractLargestCodeFence("Here is the fix:\n```python\ndef main():\n    return 42\n```");
  assert.ok(fence && fence.lang === "python" && fence.code.includes("return 42"));
});
