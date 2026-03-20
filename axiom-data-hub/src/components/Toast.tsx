import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';

/* ── Types ── */
type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
    id: string;
    type: ToastType;
    title: string;
    message?: string;
    duration?: number;
}

interface ToastContextType {
    toast: (type: ToastType, title: string, message?: string, duration?: number) => void;
    success: (title: string, message?: string) => void;
    error: (title: string, message?: string) => void;
    info: (title: string, message?: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast(): ToastContextType {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error('useToast must be used within ToastProvider');
    return ctx;
}

const TOAST_STYLES: Record<ToastType, { color: string; bg: string; icon: typeof CheckCircle }> = {
    success: { color: 'var(--green)', bg: 'var(--green-muted)', icon: CheckCircle },
    error: { color: 'var(--red)', bg: 'var(--red-muted)', icon: AlertCircle },
    info: { color: 'var(--blue)', bg: 'var(--blue-muted)', icon: Info },
    warning: { color: 'var(--yellow)', bg: 'var(--yellow-muted)', icon: AlertCircle },
};

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const removeToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    const addToast = useCallback((type: ToastType, title: string, message?: string, duration = 4000) => {
        const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        setToasts(prev => [...prev, { id, type, title, message, duration }]);
        if (duration > 0) {
            setTimeout(() => removeToast(id), duration);
        }
    }, [removeToast]);

    const ctx: ToastContextType = {
        toast: addToast,
        success: (title, message) => addToast('success', title, message),
        error: (title, message) => addToast('error', title, message),
        info: (title, message) => addToast('info', title, message),
    };

    return (
        <ToastContext.Provider value={ctx}>
            {children}

            {/* Toast Container */}
            <div
                style={{
                    position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
                    display: 'flex', flexDirection: 'column-reverse', gap: 10,
                    pointerEvents: 'none',
                }}
            >
                {toasts.map((t) => {
                    const style = TOAST_STYLES[t.type];
                    const Icon = style.icon;
                    return (
                        <div
                            key={t.id}
                            className="animate-slideUp"
                            style={{
                                pointerEvents: 'auto',
                                display: 'flex', alignItems: 'flex-start', gap: 12,
                                padding: '14px 18px', borderRadius: 14, minWidth: 320, maxWidth: 420,
                                background: 'var(--bg-card)', border: `1px solid ${style.color}`,
                                boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
                                backdropFilter: 'blur(12px)',
                                animation: 'slideUp 0.3s ease-out',
                            }}
                        >
                            <Icon size={18} style={{ color: style.color, flexShrink: 0, marginTop: 1 }} />
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{t.title}</div>
                                {t.message && (
                                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{t.message}</div>
                                )}
                            </div>
                            <button
                                onClick={() => removeToast(t.id)}
                                style={{
                                    background: 'none', border: 'none', cursor: 'pointer',
                                    color: 'var(--text-tertiary)', padding: 2, flexShrink: 0,
                                }}
                            >
                                <X size={14} />
                            </button>
                        </div>
                    );
                })}
            </div>
        </ToastContext.Provider>
    );
}
