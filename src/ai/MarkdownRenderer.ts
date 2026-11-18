/**
 * Safe, zero-dependency Markdown & Code Renderer for Mintu
 * Strictly sanitizes HTML to prevent XSS.
 * CSP-compliant (ZERO inline onclick handlers — uses data-copy-code delegated events).
 */

export class MarkdownRenderer {
  private static escapeHtml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  public static render(markdown: string): string {
    if (!markdown) return "";

    const codeBlocks: string[] = [];
    let processed = markdown.replace(/```([a-zA-Z0-9_.:\/-]*)[ \t]*\r?\n([\s\S]*?)```/g, (_match, lang, code) => {
      const escapedCode = this.escapeHtml(code.trimEnd());
      const safeLang = lang ? this.escapeHtml(lang.trim()) : "text";
      const index = codeBlocks.length;

      const blockHtml = `
        <div class="mintu-code-block" data-code-index="${index}">
          <div class="code-block-header">
            <span class="code-lang-tag">${safeLang}</span>
            <button type="button" class="code-copy-btn" data-copy-code="1" title="Copy">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              <span>Copy</span>
            </button>
          </div>
          <pre><code class="language-${safeLang}">${escapedCode}</code></pre>
        </div>
      `.trim();

      codeBlocks.push(blockHtml);
      return `%%MINTU_CODE_BLOCK_${index}%%`;
    });

    processed = this.escapeHtml(processed);

    processed = processed.replace(/^### (.*$)/gim, '<h3 class="mintu-md-h3">$1</h3>');
    processed = processed.replace(/^## (.*$)/gim, '<h2 class="mintu-md-h2">$1</h2>');
    processed = processed.replace(/^# (.*$)/gim, '<h1 class="mintu-md-h1">$1</h1>');

    processed = processed.replace(/^\> (.*$)/gim, '<blockquote class="mintu-md-quote">$1</blockquote>');

    processed = processed.replace(/\*\*\*(.*?)\*\*\*/g, "<strong><em>$1</em></strong>");
    processed = processed.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    processed = processed.replace(/\*(.*?)\*/g, "<em>$1</em>");

    processed = processed.replace(/`([^`]+)`/g, '<code class="mintu-inline-code">$1</code>');

    processed = processed.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer" class="mintu-md-link">$1</a>'
    );

    processed = processed.replace(/^\s*[-*]\s+(.*)$/gim, '<li class="mintu-md-li">$1</li>');
    processed = processed.replace(/(<li class="mintu-md-li">[\s\S]*?<\/li>)+/g, '<ul class="mintu-md-ul">$&</ul>');

    processed = processed.replace(/^\s*(\d+)\.\s+(.*)$/gim, '<li class="mintu-md-oli">$2</li>');
    processed = processed.replace(/(<li class="mintu-md-oli">[\s\S]*?<\/li>)+/g, '<ol class="mintu-md-ol">$&</ol>');

    const paragraphs = processed.split(/\n\n+/);
    processed = paragraphs
      .map((p) => {
        p = p.trim();
        if (!p) return "";
        if (
          p.startsWith("<h") ||
          p.startsWith("<ul") ||
          p.startsWith("<ol") ||
          p.startsWith("<blockquote") ||
          p.startsWith("%%MINTU_CODE_BLOCK_")
        ) {
          return p;
        }
        return `<p class="mintu-md-p">${p.replace(/\n/g, "<br/>")}</p>`;
      })
      .filter(Boolean)
      .join("\n");

    processed = processed.replace(/%%MINTU_CODE_BLOCK_(\d+)%%/g, (_m, idx) => {
      return codeBlocks[parseInt(idx, 10)] || "";
    });

    return processed;
  }
}

export async function copyTextReliable(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
