/**
 * Purpose: Safe, lightweight Markdown renderer for in-canvas note previews.
 *
 * This intentionally supports a small subset of Markdown and does NOT allow raw HTML.
 * Keep it dependency-free so the manager UI works offline and without additional packages.
 */

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const escapeAttr = (value: string): string => escapeHtml(value).replace(/\n/g, ' ').replace(/\r/g, ' ');

const sanitizeUrl = (raw: string): string | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  if (lower.startsWith('javascript:')) return null;
  if (lower.startsWith('vbscript:')) return null;
  if (lower.startsWith('data:')) return null;

  // Block other explicit schemes (allow common safe schemes only).
  if (/^[a-z][a-z0-9+.-]*:/.test(lower)) {
    if (lower.startsWith('http:')) return trimmed;
    if (lower.startsWith('https:')) return trimmed;
    if (lower.startsWith('mailto:')) return trimmed;
    if (lower.startsWith('tel:')) return trimmed;
    return null;
  }

  // Allow relative URLs and fragments.
  return trimmed;
};

const applyEmphasis = (escaped: string): string => {
  let out = escaped;
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  out = out.replace(/_([^_]+)_/g, '<em>$1</em>');
  return out;
};

const renderTextWithLinksAndEmphasis = (raw: string): string => {
  const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;
  const parts: string[] = [];

  let lastIndex = 0;
  for (const match of raw.matchAll(LINK_RE)) {
    const idx = match.index ?? -1;
    if (idx < 0) continue;

    const before = raw.slice(lastIndex, idx);
    parts.push(applyEmphasis(escapeHtml(before)));

    const labelRaw = match[1] ?? '';
    const urlRaw = match[2] ?? '';
    const safeUrl = sanitizeUrl(urlRaw);
    const labelHtml = applyEmphasis(escapeHtml(labelRaw));
    if (safeUrl) {
      parts.push(
        `<a href="${escapeAttr(safeUrl)}" target="_blank" rel="noreferrer noopener">${labelHtml}</a>`
      );
    } else {
      parts.push(applyEmphasis(escapeHtml(match[0] ?? '')));
    }

    lastIndex = idx + String(match[0] ?? '').length;
  }

  const rest = raw.slice(lastIndex);
  parts.push(applyEmphasis(escapeHtml(rest)));
  return parts.join('');
};

const renderInlineMarkdown = (raw: string): string => {
  const chunks = raw.split(/(`[^`]*`)/g);
  return chunks
    .map((chunk) => {
      if (chunk.startsWith('`') && chunk.endsWith('`')) {
        return `<code>${escapeHtml(chunk.slice(1, -1))}</code>`;
      }
      return renderTextWithLinksAndEmphasis(chunk);
    })
    .join('');
};

const isHorizontalRuleLine = (line: string): boolean => {
  const t = line.trim();
  if (!t) return false;
  if (/^(-\s*){3,}$/.test(t)) return true;
  if (/^(\*\s*){3,}$/.test(t)) return true;
  if (/^(_\s*){3,}$/.test(t)) return true;
  return false;
};

const isBlockStartLine = (line: string): boolean => {
  const t = line.trim();
  if (!t) return false;
  if (/^```/.test(t)) return true;
  if (/^#{1,6}\s+/.test(t)) return true;
  if (/^\s*>/.test(line)) return true;
  if (/^\s*[-*+]\s+/.test(line)) return true;
  if (/^\s*\d+\.\s+/.test(line)) return true;
  if (isHorizontalRuleLine(line)) return true;
  return false;
};

export const renderMarkdownToHtml = (markdown: string): string => {
  const raw = typeof markdown === 'string' ? markdown : '';
  const normalized = raw.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');

  const blocks: string[] = [];
  let i = 0;

  const nextLine = () => (i < lines.length ? lines[i] : null);

  while (i < lines.length) {
    const line = nextLine() ?? '';

    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Fenced code blocks: ```lang
    const fenceMatch = /^```([\w-]+)?\s*$/.exec(line.trim());
    if (fenceMatch) {
      const lang = (fenceMatch[1] ?? '').trim();
      i += 1;
      const codeLines: string[] = [];
      while (i < lines.length) {
        const l = nextLine() ?? '';
        if (/^```/.test(l.trim())) break;
        codeLines.push(l);
        i += 1;
      }
      // Consume closing fence if present.
      if (i < lines.length && /^```/.test((nextLine() ?? '').trim())) i += 1;

      const code = codeLines.join('\n');
      const classAttr = lang ? ` class="language-${escapeAttr(lang)}"` : '';
      blocks.push(`<pre><code${classAttr}>${escapeHtml(code)}</code></pre>`);
      continue;
    }

    // Horizontal rule
    if (isHorizontalRuleLine(line)) {
      blocks.push('<hr />');
      i += 1;
      continue;
    }

    // Headings
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line.trim());
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = headingMatch[2] ?? '';
      blocks.push(`<h${level}>${renderInlineMarkdown(content)}</h${level}>`);
      i += 1;
      continue;
    }

    // Blockquotes (single-level)
    if (/^\s*>/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^\s*>/.test((nextLine() ?? ''))) {
        const rawLine = nextLine() ?? '';
        quoteLines.push(rawLine.replace(/^\s*>\s?/, ''));
        i += 1;
      }
      const inner = renderMarkdownToHtml(quoteLines.join('\n'));
      blocks.push(`<blockquote>${inner}</blockquote>`);
      continue;
    }

    // Unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test((nextLine() ?? ''))) {
        const rawItem = (nextLine() ?? '').replace(/^\s*[-*+]\s+/, '');
        items.push(`<li>${renderInlineMarkdown(rawItem)}</li>`);
        i += 1;
      }
      blocks.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test((nextLine() ?? ''))) {
        const rawItem = (nextLine() ?? '').replace(/^\s*\d+\.\s+/, '');
        items.push(`<li>${renderInlineMarkdown(rawItem)}</li>`);
        i += 1;
      }
      blocks.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    // Paragraph
    const paragraphLines: string[] = [];
    while (i < lines.length) {
      const l = nextLine() ?? '';
      if (!l.trim()) break;
      if (isBlockStartLine(l) && paragraphLines.length > 0) break;
      paragraphLines.push(l);
      i += 1;
    }

    const html = paragraphLines.map((l) => renderInlineMarkdown(l)).join('<br />');
    blocks.push(`<p>${html}</p>`);
  }

  return blocks.join('');
};

