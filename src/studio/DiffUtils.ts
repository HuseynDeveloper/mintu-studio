/**
 * DiffUtils.ts
 * Lightweight LCS line-by-line unified diff calculator for AI edit proposals.
 */

export interface DiffLine {
  type: "context" | "add" | "del";
  oldLine?: number;
  newLine?: number;
  text: string;
}

export interface DiffResult {
  lines: DiffLine[];
  added: number;
  removed: number;
  truncated: boolean;
}

export function computeLineDiff(oldText: string, newText: string, maxPreviewLines = 180): DiffResult {
  const oldLines = oldText === "" ? [] : oldText.replace(/\r\n/g, "\n").split("\n");
  const newLines = newText === "" ? [] : newText.replace(/\r\n/g, "\n").split("\n");

  // Fast path for brand new file
  if (oldLines.length === 0) {
    const sliced = newLines.slice(0, maxPreviewLines);
    return {
      lines: sliced.map((text, idx) => ({ type: "add", newLine: idx + 1, text })),
      added: newLines.length,
      removed: 0,
      truncated: newLines.length > maxPreviewLines,
    };
  }

  // Fallback for very large files to keep LCS O(N*M) instant
  if (oldLines.length * newLines.length > 250_000) {
    let prefix = 0;
    while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) {
      prefix++;
    }
    let suffix = 0;
    while (
      suffix < oldLines.length - prefix &&
      suffix < newLines.length - prefix &&
      oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
    ) {
      suffix++;
    }
    const delLines = oldLines.slice(prefix, oldLines.length - suffix);
    const addLines = newLines.slice(prefix, newLines.length - suffix);
    const all: DiffLine[] = [
      ...delLines.map((text, i) => ({ type: "del" as const, oldLine: prefix + i + 1, text })),
      ...addLines.map((text, i) => ({ type: "add" as const, newLine: prefix + i + 1, text })),
    ];
    return {
      lines: all.slice(0, maxPreviewLines),
      added: addLines.length,
      removed: delLines.length,
      truncated: all.length > maxPreviewLines,
    };
  }

  // Standard LCS DP
  const n = oldLines.length;
  const m = newLines.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = dp[i + 1][j] >= dp[i][j + 1] ? dp[i + 1][j] : dp[i][j + 1];
      }
    }
  }

  const raw: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let added = 0;
  let removed = 0;

  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      raw.push({ type: "context", oldLine: i + 1, newLine: j + 1, text: oldLines[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      raw.push({ type: "del", oldLine: i + 1, text: oldLines[i] });
      removed++;
      i++;
    } else {
      raw.push({ type: "add", newLine: j + 1, text: newLines[j] });
      added++;
      j++;
    }
  }

  while (i < n) {
    raw.push({ type: "del", oldLine: i + 1, text: oldLines[i] });
    removed++;
    i++;
  }
  while (j < m) {
    raw.push({ type: "add", newLine: j + 1, text: newLines[j] });
    added++;
    j++;
  }

  // Keep only changed lines + 2 context lines around each change
  const keep = new Uint8Array(raw.length);
  for (let k = 0; k < raw.length; k++) {
    if (raw[k].type !== "context") {
      for (let c = Math.max(0, k - 2); c <= Math.min(raw.length - 1, k + 2); c++) {
        keep[c] = 1;
      }
    }
  }

  const compact: DiffLine[] = [];
  for (let k = 0; k < raw.length; k++) {
    if (keep[k]) compact.push(raw[k]);
  }

  return {
    lines: compact.slice(0, maxPreviewLines),
    added,
    removed,
    truncated: compact.length > maxPreviewLines,
  };
}
