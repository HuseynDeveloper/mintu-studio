/**
 * CodeDiagnostics.ts
 * Real-time VS Code-style red squiggly syntax error diagnostics for CodeMirror 6,
 * plus Symbol Outline extractor (Ctrl+Shift+O) and Quick Formatter (Alt+Shift+F).
 */

import { syntaxTree } from "@codemirror/language";
import { linter, lintGutter, type Diagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export interface CodeDiagnosticItem {
  line: number;
  col: number;
  severity: "error" | "warning";
  message: string;
}

export interface OutlineSymbol {
  name: string;
  kind: "fn" | "class" | "type" | "heading" | "selector";
  line: number;
}

function checkBalancedDelimiters(doc: string): Array<{ from: number; to: number; msg: string }> {
  const issues: Array<{ from: number; to: number; msg: string }> = [];
  const stack: Array<{ ch: string; pos: number }> = [];
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const closing: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < doc.length; i++) {
    const c = doc[i];
    const next = doc[i + 1] || "";

    if (inLineComment) {
      if (c === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (c === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inSingle) {
      if (c === "\\") { i++; continue; }
      if (c === "'" || c === "\n") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (c === "\\") { i++; continue; }
      if (c === '"' || c === "\n") inDouble = false;
      continue;
    }
    if (inTemplate) {
      if (c === "\\") { i++; continue; }
      if (c === "`") inTemplate = false;
      continue;
    }

    if (c === "/" && next === "/") { inLineComment = true; i++; continue; }
    if (c === "/" && next === "*") { inBlockComment = true; i++; continue; }
    if (c === "'") { inSingle = true; continue; }
    if (c === '"') { inDouble = true; continue; }
    if (c === "`") { inTemplate = true; continue; }

    if (pairs[c]) {
      stack.push({ ch: c, pos: i });
    } else if (closing[c]) {
      const top = stack[stack.length - 1];
      if (!top) {
        issues.push({ from: i, to: Math.min(doc.length, i + 1), msg: `Unexpected closing '${c}'` });
      } else if (top.ch !== closing[c]) {
        issues.push({ from: i, to: Math.min(doc.length, i + 1), msg: `Mismatched '${c}', expected '${pairs[top.ch]}'` });
      } else {
        stack.pop();
      }
    }
  }

  for (const unclosed of stack.slice(-4)) {
    issues.push({
      from: unclosed.pos,
      to: Math.min(doc.length, unclosed.pos + 1),
      msg: `Unclosed '${unclosed.ch}' (missing '${pairs[unclosed.ch]}')`,
    });
  }
  return issues;
}

export function createStudioLinter(
  filename: string,
  onDiagnostics: (items: CodeDiagnosticItem[]) => void
): Extension[] {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const isCodeWithBraces = ["ts", "tsx", "js", "jsx", "rs", "c", "h", "cpp", "cc", "hpp", "go", "css", "scss", "java", "cs"].includes(ext);

  const diagSource = linter(
    (view: EditorView): Diagnostic[] => {
      const diagnostics: Diagnostic[] = [];
      const docText = view.state.doc.toString();
      const seenRanges = new Set<string>();

      const pushDiag = (from: number, to: number, severity: "error" | "warning", message: string) => {
        const safeFrom = Math.max(0, Math.min(from, view.state.doc.length));
        let safeTo = Math.max(safeFrom, Math.min(to, view.state.doc.length));
        if (safeTo === safeFrom && safeFrom < view.state.doc.length) {
          safeTo = Math.min(view.state.doc.length, safeFrom + 1);
        }
        const key = `${safeFrom}:${safeTo}:${message}`;
        if (seenRanges.has(key) || diagnostics.length >= 60) return;
        seenRanges.add(key);
        diagnostics.push({ from: safeFrom, to: safeTo, severity, message });
      };

      // 1. Strict JSON validator
      if (ext === "json" && docText.trim().length > 0) {
        try {
          JSON.parse(docText);
        } catch (err: any) {
          const msg = String(err?.message || "Invalid JSON syntax");
          const posMatch = msg.match(/position\s+(\d+)/i);
          const pos = posMatch ? Number(posMatch[1]) : 0;
          const line = view.state.doc.lineAt(Math.min(pos, view.state.doc.length));
          pushDiag(
            Math.max(line.from, pos),
            Math.min(line.to, Math.max(line.from + 1, pos + 3)),
            "error",
            `JSON Syntax Error: ${msg}`
          );
        }
      }

      // 2. Universal CodeMirror Lezer AST syntax-error detection across ALL languages
      syntaxTree(view.state).iterate({
        enter(node) {
          if (node.type.isError) {
            const from = node.from;
            const to = node.to > node.from ? node.to : Math.min(view.state.doc.length, node.from + 1);
            const line = view.state.doc.lineAt(Math.min(from, view.state.doc.length));
            const snippet = view.state.sliceDoc(from, Math.min(to, from + 24)).replace(/\s+/g, " ").trim();
            const msg = snippet
              ? `Syntax error near "${snippet}" (line ${line.number})`
              : `Syntax error at line ${line.number}`;
            pushDiag(from, Math.max(to, Math.min(line.to, from + 1)), "error", msg);
          }
        },
      });

      // 3. Python missing colon check on control/def/class statements
      if (ext === "py") {
        for (let ln = 1; ln <= view.state.doc.lines; ln++) {
          const line = view.state.doc.line(ln);
          const stripped = line.text.replace(/#.*$/, "").trim();
          if (
            /^(?:async\s+)?(?:def|class|if|elif|else|for|while|try|except|finally|with)\b/.test(stripped) &&
            !stripped.endsWith(":") &&
            !stripped.endsWith("\\") &&
            !stripped.endsWith("(") &&
            !stripped.endsWith(",")
          ) {
            pushDiag(line.from + line.text.search(/\S/), line.to, "error", `Python Syntax Error: expected ':' at end of statement`);
          }
        }
      }

      // 4. Balanced delimiters fallback for brace languages if AST didn't already flag
      if (isCodeWithBraces && diagnostics.length === 0) {
        const delimIssues = checkBalancedDelimiters(docText);
        for (const d of delimIssues) {
          pushDiag(d.from, d.to, "error", d.msg);
        }
      }

      // Sync to bottom Problems panel
      const mapped: CodeDiagnosticItem[] = diagnostics.map((d) => {
        const line = view.state.doc.lineAt(Math.min(d.from, view.state.doc.length));
        return {
          line: line.number,
          col: d.from - line.from + 1,
          severity: d.severity === "warning" ? "warning" : "error",
          message: d.message,
        };
      });
      onDiagnostics(mapped);

      return diagnostics;
    },
    { delay: 280 }
  );

  return [lintGutter(), diagSource];
}

export function extractSymbols(content: string, filename: string): OutlineSymbol[] {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const lines = content.split(/\r?\n/);
  const out: OutlineSymbol[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    if (ext === "md" || ext === "markdown") {
      const m = line.match(/^(#{1,4})\s+(.+)/);
      if (m) out.push({ name: `${m[1]} ${m[2].trim()}`, kind: "heading", line: lineNum });
      continue;
    }

    if (ext === "py") {
      const fn = line.match(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/);
      if (fn) { out.push({ name: fn[1], kind: "fn", line: lineNum }); continue; }
      const cls = line.match(/^\s*class\s+([A-Za-z_]\w*)/);
      if (cls) { out.push({ name: cls[1], kind: "class", line: lineNum }); continue; }
      continue;
    }

    if (ext === "rs") {
      const fn = line.match(/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/);
      if (fn) { out.push({ name: fn[1], kind: "fn", line: lineNum }); continue; }
      const st = line.match(/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)/);
      if (st) { out.push({ name: st[1], kind: "type", line: lineNum }); continue; }
      const im = line.match(/^\s*impl(?:<[^>]*>)?\s+([A-Za-z_][\w:<>\s]*)/);
      if (im) { out.push({ name: `impl ${im[1].trim().replace(/\{$/, "").trim()}`, kind: "class", line: lineNum }); continue; }
      continue;
    }

    if (ext === "go") {
      const fn = line.match(/^func\s+(?:\([^)]+\)\s*)?([A-Za-z_]\w*)/);
      if (fn) { out.push({ name: fn[1], kind: "fn", line: lineNum }); continue; }
      const tp = line.match(/^type\s+([A-Za-z_]\w*)/);
      if (tp) { out.push({ name: tp[1], kind: "type", line: lineNum }); continue; }
      continue;
    }

    if (ext === "css" || ext === "scss") {
      const sel = line.match(/^([.#@][A-Za-z0-9_\-\s.:]+)\s*\{/);
      if (sel) out.push({ name: sel[1].trim(), kind: "selector", line: lineNum });
      continue;
    }

    // JS / TS / JSX / TSX / C / C++
    const cls = line.match(/^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/);
    if (cls) { out.push({ name: cls[1], kind: "class", line: lineNum }); continue; }

    const iface = line.match(/^\s*(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/);
    if (iface) { out.push({ name: iface[1], kind: "type", line: lineNum }); continue; }

    const fn = line.match(/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
    if (fn) { out.push({ name: fn[1], kind: "fn", line: lineNum }); continue; }

    const arrow = line.match(/^\s*(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/);
    if (arrow) { out.push({ name: arrow[1], kind: "fn", line: lineNum }); continue; }

    const method = line.match(/^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{/);
    if (method && !["if", "for", "while", "switch", "catch", "constructor"].includes(method[1])) {
      out.push({ name: method[1], kind: "fn", line: lineNum });
    }
  }

  return out.slice(0, 200);
}

export function formatCodeDocument(content: string, filename: string, tabSize = 2): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const indentUnit = " ".repeat(Math.max(2, Math.min(8, tabSize)));

  if (ext === "json") {
    try {
      return JSON.stringify(JSON.parse(content), null, tabSize) + "\n";
    } catch {
      return content;
    }
  }

  // Clean trailing spaces and normalize line endings
  const rawLines = content.replace(/\r\n/g, "\n").split("\n").map((l) => l.replace(/[ \t]+$/, ""));

  if (["js", "ts", "jsx", "tsx", "css", "scss", "rs", "c", "cpp", "go"].includes(ext)) {
    let depth = 0;
    const out: string[] = [];
    for (const raw of rawLines) {
      const trimmed = raw.trim();
      if (!trimmed) {
        out.push("");
        continue;
      }
      if (/^[}\])]/.test(trimmed)) {
        depth = Math.max(0, depth - 1);
      }
      out.push(indentUnit.repeat(depth) + trimmed);
      const opens = (trimmed.match(/\{/g) || []).length;
      const closes = (trimmed.match(/\}/g) || []).length;
      const delta = opens - closes;
      if (delta > 0) depth += delta;
      else if (delta < 0 && !/^[}\])]/.test(trimmed)) depth = Math.max(0, depth + delta);
    }
    return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  }

  return rawLines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
