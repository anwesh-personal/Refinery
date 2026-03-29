import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

interface Props {
  content: string;
}

const components: Components = {
  h1: ({ children }) => (
    <h1 style={{ fontSize: 18, fontWeight: 800, margin: '16px 0 8px', color: 'var(--text-primary)', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 style={{ fontSize: 15, fontWeight: 700, margin: '14px 0 6px', color: 'var(--text-primary)' }}>{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 style={{ fontSize: 13, fontWeight: 700, margin: '12px 0 4px', color: 'var(--text-primary)' }}>{children}</h3>
  ),
  p: ({ children }) => (
    <p style={{ fontSize: 13, lineHeight: 1.7, margin: '6px 0', color: 'var(--text-primary)' }}>{children}</p>
  ),
  strong: ({ children }) => (
    <strong style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{children}</strong>
  ),
  em: ({ children }) => (
    <em style={{ color: 'var(--text-secondary)' }}>{children}</em>
  ),
  ul: ({ children }) => (
    <ul style={{ margin: '6px 0', paddingLeft: 20, listStyleType: 'disc' }}>{children}</ul>
  ),
  ol: ({ children }) => (
    <ol style={{ margin: '6px 0', paddingLeft: 20 }}>{children}</ol>
  ),
  li: ({ children }) => (
    <li style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-primary)', marginBottom: 3 }}>{children}</li>
  ),
  blockquote: ({ children }) => (
    <blockquote style={{
      margin: '8px 0', padding: '8px 14px',
      borderLeft: '3px solid var(--accent)', background: 'var(--bg-hover)',
      borderRadius: '0 8px 8px 0', color: 'var(--text-secondary)', fontSize: 13,
    }}>{children}</blockquote>
  ),
  code: ({ className, children }) => {
    const isBlock = className?.startsWith('language-');
    if (isBlock) {
      const lang = className?.replace('language-', '') || '';
      return (
        <div style={{
          margin: '10px 0', borderRadius: 12, overflow: 'hidden',
          border: '1px solid var(--border)', background: 'var(--bg-sidebar)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '6px 14px', background: 'var(--bg-hover)',
            borderBottom: '1px solid var(--border)',
          }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--red)', opacity: 0.6 }} />
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--yellow)', opacity: 0.6 }} />
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--green)', opacity: 0.6 }} />
            </div>
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)' }}>
              {lang || 'code'}
            </span>
          </div>
          <pre style={{
            margin: 0, padding: '14px 16px', overflowX: 'auto',
            fontSize: 12, lineHeight: 1.6, fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
            color: 'var(--text-primary)', background: 'transparent',
          }}>
            <code>{children}</code>
          </pre>
        </div>
      );
    }
    return (
      <code style={{
        padding: '2px 6px', borderRadius: 5,
        background: 'var(--bg-hover)', border: '1px solid var(--border)',
        fontSize: 12, fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        color: 'var(--accent)',
      }}>{children}</code>
    );
  },
  table: ({ children }) => (
    <div style={{ margin: '10px 0', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead style={{ background: 'var(--bg-hover)' }}>{children}</thead>
  ),
  th: ({ children }) => (
    <th style={{
      padding: '8px 12px', textAlign: 'left', fontWeight: 700,
      fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em',
      color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border)',
    }}>{children}</th>
  ),
  td: ({ children }) => (
    <td style={{
      padding: '8px 12px', borderBottom: '1px solid var(--border)',
      color: 'var(--text-primary)',
    }}>{children}</td>
  ),
  hr: () => (
    <hr style={{ border: 'none', height: 1, background: 'var(--border)', margin: '12px 0' }} />
  ),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>{children}</a>
  ),
};

export default function MarkdownRenderer({ content }: Props) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  );
}
