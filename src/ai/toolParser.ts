/**
 * toolParser.ts
 * Model-agnostic parser supporting:
 * 1) ```mintu_tool { ... } ```
 * 2) ```json { "tool": "...", ... } ``` (only known Mintu workspace tools)
 * 3) <mintu_tool>{ ... }</mintu_tool>
 * 4) <mintu_edit path="..." reason="...">raw file content</mintu_edit>
 * 5) <mintu_replace path="..." reason="..."><<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE</mintu_replace>
 * 6) Live streaming detection (extractStreamingEdit) so raw code is hidden from chat and shown as compact progress pill
 */

export interface ParsedToolCall {
  tool: string;
  args: Record<string, any>;
}

export interface StreamingEditProgress {
  path: string;
  lineCount: number;
  preview: string;
}

const KNOWN_TOOLS = new Set([
  "list_dir",
  "read_file",
  "grep_search",
  "propose_edit",
  "propose_replace",
  "propose_command",
  "install_package",
  "fetch_url",
  "web_search",
  "mcp_tool",
]);

function tryParseToolJson(raw: string): ParsedToolCall | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const attempt = (str: string): ParsedToolCall | null => {
    try {
      const parsed = JSON.parse(str);
      if (parsed && typeof parsed.tool === "string" && KNOWN_TOOLS.has(parsed.tool.trim())) {
        return {
          tool: parsed.tool.trim(),
          args: typeof parsed.args === "object" && parsed.args !== null ? parsed.args : parsed,
        };
      }
    } catch {}
    return null;
  };

  const direct = attempt(trimmed);
  if (direct) return direct;

  let inString = false;
  let escaped = false;
  let repaired = "";
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (escaped) {
      repaired += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      repaired += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      repaired += ch;
      continue;
    }
    if (inString && ch === "\n") {
      repaired += "\\n";
      continue;
    }
    if (inString && ch === "\r") {
      continue;
    }
    repaired += ch;
  }

  return attempt(repaired);
}

export function extractStreamingEdit(text: string): StreamingEditProgress | null {
  // Check if there is an unclosed <mintu_edit ...> or <mintu_replace ...> currently streaming
  const withoutClosed = text
    .replace(/<mintu_edit\s+[^>]+>[\s\S]*?<\/mintu_edit>/gi, "")
    .replace(/<mintu_replace\s+[^>]+>[\s\S]*?<\/mintu_replace>/gi, "");

  const openMatch = withoutClosed.match(/<(?:mintu_edit|mintu_replace)\s+([^>]*)>([\s\S]*)$/i);
  if (!openMatch) return null;
  const attrs = openMatch[1];
  const body = openMatch[2] || "";
  const pathMatch = attrs.match(/path\s*=\s*["']([^"']+)["']/i);
  const path = pathMatch ? pathMatch[1].trim() : "file";
  const lines = body.split("\n");
  return {
    path,
    lineCount: Math.max(1, lines.length),
    preview: body.trim().slice(-2000),
  };
}

export function extractToolCalls(text: string): ParsedToolCall[] {
  const calls: ParsedToolCall[] = [];

  // 1. ```mintu_tool ... ``` and ```tool ... ```
  const mintuFenceRe = /```(?:mintu_tool|tool)\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = mintuFenceRe.exec(text)) !== null) {
    const parsed = tryParseToolJson(match[1]);
    if (parsed) calls.push(parsed);
  }

  // 2. ```json ... ``` ONLY when it explicitly contains a known Mintu tool call
  const jsonFenceRe = /```json\s*([\s\S]*?)```/gi;
  while ((match = jsonFenceRe.exec(text)) !== null) {
    if (match[1].includes('"tool"')) {
      const parsed = tryParseToolJson(match[1]);
      if (parsed) calls.push(parsed);
    }
  }

  // 3. <mintu_tool>...</mintu_tool>
  const xmlToolRe = /<mintu_tool>\s*([\s\S]*?)\s*<\/mintu_tool>/gi;
  while ((match = xmlToolRe.exec(text)) !== null) {
    const parsed = tryParseToolJson(match[1]);
    if (parsed) calls.push(parsed);
  }

  // 4. <mintu_edit path="..." reason="...">raw code</mintu_edit>
  const editTagRe = /<mintu_edit\s+([^>]+)>([\s\S]*?)<\/mintu_edit>/gi;
  while ((match = editTagRe.exec(text)) !== null) {
    const attrs = match[1];
    const body = match[2];
    const pathMatch = attrs.match(/path\s*=\s*["']([^"']+)["']/i);
    const reasonMatch = attrs.match(/reason\s*=\s*["']([^"']*)["']/i);
    if (pathMatch && pathMatch[1].trim()) {
      const cleanedBody = body.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
      calls.push({
        tool: "propose_edit",
        args: {
          path: pathMatch[1].trim(),
          reason: reasonMatch ? reasonMatch[1].trim() : "Code edit proposal",
          content: cleanedBody,
        },
      });
    }
  }

  // 5. <mintu_replace path="..." reason="..."><<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE</mintu_replace>
  // Also supports optional start_line="10" end_line="15" direct line-range replacement!
  const replaceTagRe = /<mintu_replace\s+([^>]+)>([\s\S]*?)<\/mintu_replace>/gi;
  while ((match = replaceTagRe.exec(text)) !== null) {
    const attrs = match[1];
    const body = match[2];
    const pathMatch = attrs.match(/path\s*=\s*["']([^"']+)["']/i);
    const reasonMatch = attrs.match(/reason\s*=\s*["']([^"']*)["']/i);
    const startLineMatch = attrs.match(/start_line\s*=\s*["']?(\d+)["']?/i);
    const endLineMatch = attrs.match(/end_line\s*=\s*["']?(\d+)["']?/i);
    const blockRe = /<<<<<<<\s*SEARCH\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>>\s*REPLACE/g;
    const hunks: Array<{ search: string; replace: string }> = [];
    let hm: RegExpExecArray | null;
    while ((hm = blockRe.exec(body)) !== null) {
      hunks.push({ search: hm[1], replace: hm[2] });
    }
    if (pathMatch && pathMatch[1].trim()) {
      if (hunks.length > 0) {
        calls.push({
          tool: "propose_replace",
          args: {
            path: pathMatch[1].trim(),
            reason: reasonMatch ? reasonMatch[1].trim() : "Targeted code fix",
            hunks,
          },
        });
      } else if (startLineMatch) {
        const cleanedBody = body.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
        const startLine = Number(startLineMatch[1]);
        const endLine = endLineMatch ? Number(endLineMatch[1]) : startLine;
        calls.push({
          tool: "propose_replace",
          args: {
            path: pathMatch[1].trim(),
            reason: reasonMatch ? reasonMatch[1].trim() : `Fix lines ${startLine}-${endLine}`,
            startLine,
            endLine,
            replacement: cleanedBody,
            hunks: [],
          },
        });
      }
    }
  }

  // 6. Fallback: fenced code block with explicit file path like ```ts:src/app.ts or ```python path="app.py"
  if (!calls.some((c) => c.tool === "propose_edit" || c.tool === "propose_replace")) {
    const pathFenceRe = /```[a-zA-Z0-9_-]+(?::|\s+path=["']?)([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)["']?[ \t]*\r?\n([\s\S]*?)```/g;
    while ((match = pathFenceRe.exec(text)) !== null) {
      const p = match[1].trim();
      const content = match[2].replace(/\r?\n$/, "");
      if (p && content.trim().length > 0) {
        calls.push({
          tool: "propose_edit",
          args: { path: p, reason: `Update ${p}`, content },
        });
      }
    }
  }

  return calls;
}

export function stripToolCallBlocks(text: string): string {
  let out = text
    .replace(/```(?:mintu_tool|tool)[\s\S]*?```/gi, "")
    .replace(/<mintu_tool>[\s\S]*?<\/mintu_tool>/gi, "")
    .replace(/<mintu_edit\s+[^>]+>[\s\S]*?<\/mintu_edit>/gi, "")
    .replace(/<mintu_replace\s+[^>]+>[\s\S]*?<\/mintu_replace>/gi, "")
    // Hide in-progress streaming <mintu_edit / <mintu_replace / ```mintu_tool blocks before closing tag arrives
    .replace(/<mintu_edit\s+[^>]*>[\s\S]*$/gi, "")
    .replace(/<mintu_replace\s+[^>]*>[\s\S]*$/gi, "")
    .replace(/```(?:mintu_tool|tool)[\s\S]*$/gi, "");

  out = out.replace(/```json\s*([\s\S]*?)```/gi, (full, inner) => {
    if (inner.includes('"tool"') && tryParseToolJson(inner)) {
      return "";
    }
    return full;
  });

  // Also hide path-tagged fenced blocks that were promoted to EditProposals
  out = out.replace(/```[a-zA-Z0-9_-]+(?::|\s+path=["']?)([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)["']?[ \t]*\r?\n[\s\S]*?```/g, "");

  return out.trim();
}

/**
 * Extracts the largest non-tool fenced code block from an AI reply as a last-resort
 * fallback when a weaker model ignored <mintu_edit>/<mintu_replace> instructions
 * while fixing a known target file.
 */
export function extractLargestCodeFence(text: string): { lang: string; code: string } | null {
  const re = /```([a-zA-Z0-9_-]*)[ \t]*\r?\n([\s\S]*?)```/g;
  let best: { lang: string; code: string } | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const lang = (m[1] || "").toLowerCase();
    if (lang === "mintu_tool" || lang === "tool" || lang === "diff" || lang === "bash" || lang === "sh" || lang === "powershell" || lang === "cmd") {
      continue;
    }
    const code = m[2].replace(/\r?\n$/, "");
    if (!code.trim()) continue;
    if (!best || code.length > best.code.length) {
      best = { lang, code };
    }
  }
  return best;
}
