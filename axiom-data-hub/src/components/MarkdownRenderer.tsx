import { useMemo } from 'react';

/**
 * MarkdownRenderer — lightweight markdown renderer for AI chat messages.
 * Handles: headers, bold, italic, code blocks, inline code, lists, links, tables.
 * No external dependencies.
 */

interface MarkdownRendererProps {
  content: string;
  style?: React.CSSProperties;
}

export default function MarkdownRenderer({ content, style }: MarkdownRendererProps) {
  const rendered = useMemo(() => parseMarkdown(content), [content]);

  return (
    <div
      className="md-rendered"
      style={{ ...style }}
      dangerouslySetInnerHTML={{ __html: rendered }}
    />
  );
}

function parseMarkdown(md: string): string {
  // Escape HTML first
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks (```lang\n...\n```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre class="md-codeblock" data-lang="${lang}"><code>${code.trim()}</code></pre>`;
  });

  // Inline code (`...`)
  html = html.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');

  // Tables (| header | header | ... |)
  html = html.replace(
    /((?:\|[^\n]+\|\n)+)/g,
    (tableBlock) => {
      const rows = tableBlock.trim().split('\n').filter(r => r.trim());
      if (rows.length < 2) return tableBlock;

      const isSeparator = (r: string) => /^\|\s*[-:]+/.test(r);
      let headerRow = rows[0];
      let dataRows = rows.slice(1);

      // Skip separator row
      if (dataRows.length > 0 && isSeparator(dataRows[0])) {
        dataRows = dataRows.slice(1);
      }

      const parseRow = (r: string) =>
        r.split('|').filter((_, i, arr) => i > 0 && i < arr.length - 1).map(c => c.trim());

      const headers = parseRow(headerRow);
      const thead = `<thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>`;
      const tbody = `<tbody>${dataRows.map(r => `<tr>${parseRow(r).map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>`;

      return `<table class="md-table">${thead}${tbody}</table>`;
    }
  );

  // Headers
  html = html.replace(/^#### (.+)$/gm, '<h4 class="md-h4">$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3 class="md-h3">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="md-h2">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 class="md-h1">$1</h1>');

  // Bold + italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Strikethrough
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="md-link">$1</a>');

  // Horizontal rule
  html = html.replace(/^---$/gm, '<hr class="md-hr" />');

  // Ordered lists
  html = html.replace(
    /((?:^\d+\. .+\n?)+)/gm,
    (block) => {
      const items = block.trim().split('\n').map(l => l.replace(/^\d+\.\s+/, ''));
      return `<ol class="md-ol">${items.map(i => `<li>${i}</li>`).join('')}</ol>`;
    }
  );

  // Unordered lists (- or *)
  html = html.replace(
    /((?:^[\-\*] .+\n?)+)/gm,
    (block) => {
      const items = block.trim().split('\n').map(l => l.replace(/^[\-\*]\s+/, ''));
      return `<ul class="md-ul">${items.map(i => `<li>${i}</li>`).join('')}</ul>`;
    }
  );

  // Blockquotes
  html = html.replace(
    /((?:^&gt; .+\n?)+)/gm,
    (block) => {
      const text = block.replace(/^&gt;\s?/gm, '');
      return `<blockquote class="md-blockquote">${text}</blockquote>`;
    }
  );

  // Paragraphs (double newline)
  html = html.replace(/\n\n/g, '</p><p>');
  html = `<p>${html}</p>`;
  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, '');
  // Don't wrap block elements in <p>
  html = html.replace(/<p>(<(?:h[1-4]|pre|ul|ol|table|blockquote|hr))/g, '$1');
  html = html.replace(/(<\/(?:h[1-4]|pre|ul|ol|table|blockquote|hr)>)<\/p>/g, '$1');

  // Single newlines → <br>
  html = html.replace(/\n/g, '<br />');

  return html;
}

/** CSS for the markdown renderer — inject via <style> tag */
export const MARKDOWN_STYLES = `
.md-rendered {
  font-size: 12.5px;
  line-height: 1.75;
  color: var(--text-primary);
  word-break: break-word;
}
.md-rendered p { margin: 0 0 8px; }
.md-rendered p:last-child { margin-bottom: 0; }
.md-rendered strong { font-weight: 700; color: var(--text-primary); }
.md-rendered em { font-style: italic; }
.md-rendered del { text-decoration: line-through; opacity: 0.6; }
.md-rendered a.md-link { color: var(--accent); text-decoration: underline; }

.md-rendered .md-h1 { font-size: 18px; font-weight: 800; margin: 16px 0 8px; color: var(--text-primary); }
.md-rendered .md-h2 { font-size: 15px; font-weight: 800; margin: 14px 0 6px; color: var(--text-primary); }
.md-rendered .md-h3 { font-size: 13px; font-weight: 700; margin: 12px 0 4px; color: var(--text-primary); }
.md-rendered .md-h4 { font-size: 12px; font-weight: 700; margin: 10px 0 4px; color: var(--text-secondary); }

.md-rendered .md-codeblock {
  background: var(--bg-app);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 14px 16px;
  overflow-x: auto;
  font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
  font-size: 11px;
  line-height: 1.6;
  margin: 8px 0;
  color: var(--text-secondary);
  position: relative;
}
.md-rendered .md-codeblock[data-lang]:not([data-lang=""]):before {
  content: attr(data-lang);
  position: absolute;
  top: 6px;
  right: 10px;
  font-size: 8px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--text-tertiary);
  letter-spacing: 0.05em;
}
.md-rendered code { margin: 0; }

.md-rendered .md-inline-code {
  background: var(--bg-app);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px 5px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 11px;
  color: var(--accent);
}

.md-rendered .md-ul, .md-rendered .md-ol {
  margin: 6px 0;
  padding-left: 20px;
}
.md-rendered .md-ul li, .md-rendered .md-ol li {
  margin-bottom: 3px;
  line-height: 1.6;
}
.md-rendered .md-ul li::marker { color: var(--accent); }

.md-rendered .md-blockquote {
  border-left: 3px solid var(--accent);
  padding: 8px 14px;
  margin: 8px 0;
  background: var(--accent-muted);
  border-radius: 0 8px 8px 0;
  color: var(--text-secondary);
  font-style: italic;
}

.md-rendered .md-table {
  width: 100%;
  border-collapse: collapse;
  margin: 8px 0;
  font-size: 11px;
}
.md-rendered .md-table th {
  background: var(--bg-app);
  border: 1px solid var(--border);
  padding: 6px 10px;
  text-align: left;
  font-weight: 700;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-tertiary);
}
.md-rendered .md-table td {
  border: 1px solid var(--border);
  padding: 6px 10px;
  color: var(--text-secondary);
}
.md-rendered .md-table tr:hover td { background: var(--bg-hover); }

.md-rendered .md-hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 12px 0;
}
`;
