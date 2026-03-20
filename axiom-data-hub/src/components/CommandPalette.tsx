import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Search, CloudDownload, Database, Filter, ShieldCheck, Send,
    ListOrdered, Settings, ScrollText, Wrench, BarChart3, Cpu, Users, Command
} from 'lucide-react';

interface CommandItem {
    id: string;
    label: string;
    sub: string;
    icon: typeof Search;
    path: string;
    keywords: string[];
}

const COMMANDS: CommandItem[] = [
    { id: 'dashboard', label: 'Dashboard', sub: 'Intelligence Hub', icon: BarChart3, path: '/', keywords: ['home', 'hub', 'stats', 'overview'] },
    { id: 'ingestion', label: 'S3 Ingestion', sub: 'Download & ingest data', icon: CloudDownload, path: '/ingestion', keywords: ['s3', 'import', 'download', 'upload', 'parquet'] },
    { id: 'database', label: 'ClickHouse Explorer', sub: 'Query & browse tables', icon: Database, path: '/database', keywords: ['sql', 'query', 'schema', 'table', 'clickhouse'] },
    { id: 'segments', label: 'Segments', sub: 'Filter & segment leads', icon: Filter, path: '/segments', keywords: ['filter', 'list', 'niche', 'leads'] },
    { id: 'verification', label: 'Verification Engine', sub: 'Batch email verification', icon: ShieldCheck, path: '/verification', keywords: ['verify', 'email', 'bounce', 'valid', 'check'] },
    { id: 'pipeline', label: 'Pipeline Studio', sub: 'CSV upload & verify', icon: Cpu, path: '/pipeline', keywords: ['csv', 'upload', 'studio'] },
    { id: 'janitor', label: 'Database Janitor', sub: 'Clean duplicate data', icon: Wrench, path: '/janitor', keywords: ['clean', 'duplicate', 'dedupe', 'purge'] },
    { id: 'targets', label: 'Email Targets', sub: 'Generate target lists', icon: Send, path: '/targets', keywords: ['target', 'export', 'list', 'ready'] },
    { id: 'queue', label: 'Mail Queue', sub: 'Dispatch & track jobs', icon: ListOrdered, path: '/queue', keywords: ['send', 'dispatch', 'mail', 'queue', 'job'] },
    { id: 'logs', label: 'Daemon Logs', sub: 'Server log viewer', icon: ScrollText, path: '/logs', keywords: ['log', 'pm2', 'error', 'daemon', 'debug'] },
    { id: 'team', label: 'Team', sub: 'Manage roles & members', icon: Users, path: '/team', keywords: ['user', 'member', 'role', 'permission', 'squad'] },
    { id: 'settings', label: 'Settings', sub: 'Profile, theme, API keys', icon: Settings, path: '/settings', keywords: ['setting', 'theme', 'profile', 'api', 'key'] },
];

export function CommandPalette() {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const navigate = useNavigate();

    // Cmd+K / Ctrl+K to toggle
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                setOpen(prev => !prev);
            }
            if (e.key === 'Escape') setOpen(false);
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);

    // Focus input when opened
    useEffect(() => {
        if (open) {
            setQuery('');
            setSelectedIndex(0);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [open]);

    const filtered = query.trim()
        ? COMMANDS.filter(cmd => {
            const q = query.toLowerCase();
            return cmd.label.toLowerCase().includes(q) ||
                cmd.sub.toLowerCase().includes(q) ||
                cmd.keywords.some(kw => kw.includes(q));
        })
        : COMMANDS;

    const handleSelect = useCallback((cmd: CommandItem) => {
        navigate(cmd.path);
        setOpen(false);
    }, [navigate]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(prev => Math.min(prev + 1, filtered.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(prev => Math.max(prev - 1, 0));
        } else if (e.key === 'Enter' && filtered[selectedIndex]) {
            handleSelect(filtered[selectedIndex]);
        }
    };

    if (!open) return null;

    return (
        <>
            {/* Backdrop */}
            <div
                onClick={() => setOpen(false)}
                style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
                    backdropFilter: 'blur(4px)', zIndex: 9998,
                    animation: 'fadeIn 0.15s ease-out',
                }}
            />

            {/* Palette */}
            <div
                className="animate-slideUp"
                style={{
                    position: 'fixed', top: '18%', left: '50%', transform: 'translateX(-50%)',
                    width: '100%', maxWidth: 540, zIndex: 9999,
                    background: 'var(--bg-card)', border: '1px solid var(--border)',
                    borderRadius: 16, overflow: 'hidden',
                    boxShadow: '0 24px 80px rgba(0,0,0,0.4)',
                }}
            >
                {/* Search input */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                    <Search size={18} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                    <input
                        ref={inputRef}
                        type="text"
                        placeholder="Search pages, actions..."
                        value={query}
                        onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
                        onKeyDown={handleKeyDown}
                        style={{
                            flex: 1, background: 'none', border: 'none', outline: 'none',
                            fontSize: 15, fontWeight: 500, color: 'var(--text-primary)',
                        }}
                    />
                    <kbd style={{
                        fontSize: 10, fontWeight: 700, padding: '3px 6px', borderRadius: 4,
                        background: 'var(--bg-elevated)', color: 'var(--text-tertiary)',
                        border: '1px solid var(--border)',
                    }}>ESC</kbd>
                </div>

                {/* Results */}
                <div style={{ maxHeight: 360, overflowY: 'auto', padding: '8px 8px' }}>
                    {filtered.length > 0 ? (
                        filtered.map((cmd, idx) => {
                            const Icon = cmd.icon;
                            const isSelected = idx === selectedIndex;
                            return (
                                <div
                                    key={cmd.id}
                                    onClick={() => handleSelect(cmd)}
                                    onMouseEnter={() => setSelectedIndex(idx)}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 14,
                                        padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
                                        transition: 'background 0.1s',
                                        background: isSelected ? 'var(--bg-hover)' : 'transparent',
                                    }}
                                >
                                    <div style={{
                                        width: 36, height: 36, borderRadius: 10,
                                        background: isSelected ? 'var(--accent-muted)' : 'var(--bg-elevated)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        color: isSelected ? 'var(--accent)' : 'var(--text-tertiary)',
                                        transition: 'all 0.15s',
                                    }}>
                                        <Icon size={18} />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{cmd.label}</div>
                                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{cmd.sub}</div>
                                    </div>
                                    {isSelected && (
                                        <kbd style={{
                                            fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                                            background: 'var(--bg-elevated)', color: 'var(--text-tertiary)',
                                            border: '1px solid var(--border)',
                                        }}>↵</kbd>
                                    )}
                                </div>
                            );
                        })
                    ) : (
                        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
                            No results for "{query}"
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div style={{
                    padding: '10px 20px', borderTop: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', gap: 16, fontSize: 11, color: 'var(--text-tertiary)',
                }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Command size={11} /> <kbd style={{ fontSize: 10, fontWeight: 600 }}>K</kbd> to toggle
                    </span>
                    <span>↑↓ navigate</span>
                    <span>↵ select</span>
                </div>
            </div>
        </>
    );
}
