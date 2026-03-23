import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getAvatarUrl } from '../lib/avatar';
import { Activity, Database, Zap, Send, Clock, User, ShieldCheck, X, Mail, Calendar, Award } from 'lucide-react';

interface Profile {
    id: string;
    email: string;
    full_name: string | null;
    role: string;
    avatar_url: string | null;
    created_at: string;
    is_active: boolean;
}

interface UserOperationStats {
    userId: string;
    name: string | null;
    ingestions: number;
    verifications: number;
    targets: number;
    totalOps: number;
    lastActive: string | null;
}

interface NodeData {
    id: string;
    profile: Profile;
    x: number;
    y: number;
    vx: number;
    vy: number;
    width: number;
    height: number;
}

interface EdgeData {
    source: string;
    target: string;
    strength: number;
}

const ROLE_COLORS: Record<string, string> = {
    superadmin: '#a855f7', // purple
    admin: '#3b82f6',      // blue
    member: '#10b981',     // green
};

const getRoleColor = (role: string) => ROLE_COLORS[role] || '#8b5cf6';
const formatNum = (n: number) => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : n.toString();

// A simple time-ago formatter
const timeAgo = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
};

export const TeamNetworkGraph: React.FC = () => {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [statsMap, setStatsMap] = useState<Record<string, UserOperationStats>>({});
    const [globalTotals, setGlobalTotals] = useState({ ingestions: 0, verifications: 0, targets: 0, totalOps: 0 });
    const [loading, setLoading] = useState(true);
    const [selectedMember, setSelectedMember] = useState<Profile | null>(null);
    const [isDragged, setIsDragged] = useState(false);

    /** Fetch with a hard timeout so we never hang forever */
    const fetchWithTimeout = async <T,>(url: string, timeoutMs = 5000): Promise<T | null> => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) return null;
            const res = await fetch(
                `${(import.meta as any).env?.VITE_API_URL || 'http://localhost:4000'}${url}`,
                { headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, signal: controller.signal },
            );
            clearTimeout(timer);
            if (!res.ok) return null;
            return await res.json() as T;
        } catch {
            clearTimeout(timer);
            return null;
        }
    };

    // Layout & Physics State
    const nodesRef = useRef<NodeData[]>([]);
    const edgesRef = useRef<EdgeData[]>([]);
    const animationRef = useRef<number>(0);
    const isDragging = useRef<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        // Step 1: Load profiles FIRST (fast — Supabase, not ClickHouse)
        const loadProfiles = async () => {
            const { data, error } = await supabase.from('profiles').select('*');
            if (!cancelled && !error && data) {
                setProfiles(data);
                setLoading(false); // Cards render immediately
            } else if (!cancelled) {
                setLoading(false);
            }
        };

        // Step 2: Load stats async (slow — ClickHouse queries, but won't block cards)
        const loadStats = async () => {
            const statsRaw = await fetchWithTimeout<any>('/api/dashboard/user-stats', 5000);
            if (cancelled) return;

            const smap: Record<string, UserOperationStats> = {};
            const perUserList: UserOperationStats[] = Array.isArray(statsRaw)
                ? statsRaw
                : statsRaw?.perUser || [];

            perUserList.forEach(s => {
                smap[s.userId] = s;
                if (s.name) smap[s.name] = s;
            });
            setStatsMap(smap);

            if (statsRaw?.totals) {
                setGlobalTotals(statsRaw.totals);
            } else {
                const uniqueStats = [...new Map(perUserList.map(s => [s.userId, s])).values()];
                if (uniqueStats.length > 0) {
                    setGlobalTotals({
                        ingestions: uniqueStats.reduce((a, s) => a + s.ingestions, 0),
                        verifications: uniqueStats.reduce((a, s) => a + s.verifications, 0),
                        targets: uniqueStats.reduce((a, s) => a + s.targets, 0),
                        totalOps: uniqueStats.reduce((a, s) => a + s.totalOps, 0),
                    });
                }
                // No more fallback to /activity?limit=1000 — that was causing the hang
            }
        };

        loadProfiles();
        loadStats();

        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (profiles.length === 0) return;

        const width = containerRef.current?.clientWidth || 1000;
        const height = containerRef.current?.clientHeight || 600;

        // Determine hierarchy
        const sorted = [...profiles].sort((a, b) => {
            const r = (role: string) => role === 'superadmin' ? 3 : role === 'admin' ? 2 : 1;
            return r(b.role) - r(a.role);
        });

        // Create Nodes (Rich Cards)
        const cardWidth = 200;
        const cardHeight = 110;

        const nodes: NodeData[] = sorted.map((p, i) => {
            // Start them reasonably spaced out so physics doesn't explode
            const row = Math.floor(i / 4);
            const col = i % 4;

            return {
                id: p.id,
                profile: p,
                x: (width / 2) + (col * 240) - 360 + (Math.random() * 20 - 10),
                y: (height / 2) + (row * 160) - 100 + (Math.random() * 20 - 10),
                vx: 0,
                vy: 0,
                width: cardWidth,
                height: cardHeight
            };
        });

        // Create Edges
        const edges: EdgeData[] = [];
        const superadmins = nodes.filter(n => n.profile.role === 'superadmin');
        const admins = nodes.filter(n => n.profile.role === 'admin');
        const leaders = [...superadmins, ...admins];

        nodes.forEach(n => {
            if (n.profile.role === 'member' && leaders.length > 0) {
                // Members connect to an admin or superadmin
                const target = leaders[Math.floor(Math.random() * leaders.length)];
                edges.push({ source: n.id, target: target.id, strength: 0.8 });
            } else if (n.profile.role === 'admin' && superadmins.length > 0) {
                // Admins connect to a superadmin
                const target = superadmins[Math.floor(Math.random() * superadmins.length)];
                edges.push({ source: n.id, target: target.id, strength: 0.8 });
            }
        });

        // Connect peers randomly to form a web instead of strict tree
        for (let i = 0; i < nodes.length; i++) {
            if (Math.random() > 0.7) continue;
            const potentialPeers = nodes.filter(p => p.id !== nodes[i].id && p.profile.role === nodes[i].profile.role);
            if (potentialPeers.length > 0) {
                const peer = potentialPeers[Math.floor(Math.random() * potentialPeers.length)];
                // Don't add duplicate edges
                if (!edges.find(e => (e.source === nodes[i].id && e.target === peer.id) || (e.target === nodes[i].id && e.source === peer.id))) {
                    edges.push({ source: nodes[i].id, target: peer.id, strength: 0.3 });
                }
            }
        }

        nodesRef.current = nodes;
        edgesRef.current = edges;

        // Physics Engine
        let lastTime = performance.now();
        let isActive = true;

        const tick = (time: number) => {
            if (!isActive) return;

            const dt = Math.min((time - lastTime) / 1000, 0.05); // Cap dt to prevent explosions
            lastTime = time;

            const cw = containerRef.current?.clientWidth || 1000;
            const ch = containerRef.current?.clientHeight || 600;

            if (canvasRef.current) {
                if (canvasRef.current.width !== cw || canvasRef.current.height !== ch) {
                    canvasRef.current.width = cw;
                    canvasRef.current.height = ch;
                }
            }

            const center = { x: cw / 2, y: ch / 2 };

            // Tuned physics constants for heavy rectangular cards
            const K = 0.03; // Spring strength
            const REPULSION = 400000; // Strong repulsion to prevent overlapping cards
            const DAMPING = 0.75; // High friction so it settles quickly
            let settled = false;

            // 1. Repulsion
            for (let i = 0; i < nodes.length; i++) {
                for (let j = i + 1; j < nodes.length; j++) {
                    const n1 = nodes[i];
                    const n2 = nodes[j];
                    const dx = n1.x - n2.x;
                    const dy = n1.y - n2.y;
                    const distSq = dx * dx + dy * dy;

                    if (distSq > 0 && distSq < 90000) { // Only repel if within 300px
                        const dist = Math.sqrt(distSq);
                        const force = REPULSION / distSq;
                        n1.vx += (dx / dist) * force;
                        n1.vy += (dy / dist) * force;
                        n2.vx -= (dx / dist) * force;
                        n2.vy -= (dy / dist) * force;
                    }
                }
            }

            // 2. Spring Edges
            edges.forEach(edge => {
                const n1 = nodes.find(n => n.id === edge.source);
                const n2 = nodes.find(n => n.id === edge.target);
                if (!n1 || !n2) return;

                const targetDist = 220; // Preferred resting distance between connected cards
                const dx = n2.x - n1.x;
                const dy = n2.y - n1.y;
                const distSq = dx * dx + dy * dy;
                const dist = Math.sqrt(distSq) || 1;

                const force = (dist - targetDist) * K * edge.strength;
                n1.vx += (dx / dist) * force;
                n1.vy += (dy / dist) * force;
                n2.vx -= (dx / dist) * force;
                n2.vy -= (dy / dist) * force;
            });

            // 3. Center Gravity — very gentle, only relevant at start
            nodes.forEach(n => {
                const dx = center.x - (n.x + n.width / 2);
                const dy = center.y - (n.y + n.height / 2);
                const pull = n.profile.role === 'superadmin' ? 0.008 : 0.003;
                n.vx += dx * pull * dt;
                n.vy += dy * pull * dt;
            });

            // 4. Update Positions
            let totalKE = 0;
            nodes.forEach(n => {
                n.vx *= DAMPING;
                n.vy *= DAMPING;

                // Speed limit
                const limit = 20;
                if (n.vx > limit) n.vx = limit;
                if (n.vx < -limit) n.vx = -limit;
                if (n.vy > limit) n.vy = limit;
                if (n.vy < -limit) n.vy = -limit;

                if (isDragging.current === n.id) {
                    n.vx = 0;
                    n.vy = 0;
                } else {
                    n.x += n.vx * (dt * 60);
                    n.y += n.vy * (dt * 60);
                }

                totalKE += n.vx * n.vx + n.vy * n.vy;

                // Keep inside bounds
                const pad = 20;
                if (n.x < pad) { n.x = pad; n.vx *= -0.5; }
                if (n.x + n.width > cw - pad) { n.x = cw - n.width - pad; n.vx *= -0.5; }
                if (n.y < pad) { n.y = pad; n.vy *= -0.5; }
                if (n.y + n.height > ch - pad) { n.y = ch - n.height - pad; n.vy *= -0.5; }
            });

            settled = totalKE < 0.05 && !isDragging.current;

            // 5. Draw Edges on Canvas
            const ctx = canvasRef.current?.getContext('2d');
            if (ctx && canvasRef.current) {
                ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);

                edges.forEach(edge => {
                    const n1 = nodes.find(n => n.id === edge.source);
                    const n2 = nodes.find(n => n.id === edge.target);
                    if (!n1 || !n2) return;

                    // Connect to centers of the cards
                    const cx1 = n1.x + n1.width / 2;
                    const cy1 = n1.y + n1.height / 2;
                    const cx2 = n2.x + n2.width / 2;
                    const cy2 = n2.y + n2.height / 2;

                    ctx.beginPath();
                    ctx.moveTo(cx1, cy1);
                    ctx.lineTo(cx2, cy2);

                    const grad = ctx.createLinearGradient(cx1, cy1, cx2, cy2);
                    grad.addColorStop(0, getRoleColor(n1.profile.role) + '66');
                    grad.addColorStop(1, getRoleColor(n2.profile.role) + '66');

                    ctx.strokeStyle = grad;
                    ctx.lineWidth = 2;
                    ctx.stroke();

                    // Flowing data particles along the path
                    const t = (time / 2000 + edge.strength) % 1;
                    const px = cx1 + (cx2 - cx1) * t;
                    const py = cy1 + (cy2 - cy1) * t;

                    ctx.beginPath();
                    ctx.arc(px, py, 3, 0, Math.PI * 2);
                    ctx.fillStyle = getRoleColor(n1.profile.role);
                    ctx.shadowBlur = 8;
                    ctx.shadowColor = getRoleColor(n1.profile.role);
                    ctx.fill();
                    ctx.shadowBlur = 0;
                });
            }

            // 7. Update DOM via transforms
            nodes.forEach(n => {
                const el = document.getElementById(`team-card-${n.id}`);
                if (el) el.style.transform = `translate(${n.x}px, ${n.y}px)`;
            });

            // Keep looping — particles on edges always animate; physics only when not settled
            animationRef.current = requestAnimationFrame(tick);
        };

        animationRef.current = requestAnimationFrame(tick);

        return () => {
            isActive = false;
            if (animationRef.current) cancelAnimationFrame(animationRef.current);
        };
    }, [profiles]);

    // Drag logic
    const dragState = useRef({ startX: 0, startY: 0, nodeStartX: 0, nodeStartY: 0, profileId: '' });

    const handlePointerDown = (id: string, e: React.PointerEvent) => {
        isDragging.current = id;
        setIsDragged(false);
        const node = nodesRef.current.find(n => n.id === id);
        if (node) {
            dragState.current = { startX: e.clientX, startY: e.clientY, nodeStartX: node.x, nodeStartY: node.y, profileId: id };
        }
        e.preventDefault();
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!isDragging.current) return;
        const node = nodesRef.current.find(n => n.id === isDragging.current);
        if (!node) return;
        const dx = e.clientX - dragState.current.startX;
        const dy = e.clientY - dragState.current.startY;
        if (Math.abs(dx) > 6 || Math.abs(dy) > 6) setIsDragged(true);
        node.x = dragState.current.nodeStartX + dx;
        node.y = dragState.current.nodeStartY + dy;
        node.vx = 0;
        node.vy = 0;
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        const dist = Math.hypot(e.clientX - dragState.current.startX, e.clientY - dragState.current.startY);
        if (dist < 6 && dragState.current.profileId) {
            const p = profiles.find(p => p.id === dragState.current.profileId);
            if (p) setSelectedMember(p);
        }
        isDragging.current = null;
    };

    if (loading) {
        return (
            <div style={{ height: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-card)', borderRadius: 20, border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: 'var(--text-tertiary)' }}>
                    <Activity size={24} className="animate-spin" />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>Loading Intelligence Web...</span>
                </div>
            </div>
        );
    }

    return (
        <>
        <div
            ref={containerRef}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            style={{
                position: 'relative',
                height: 650,
                background: 'var(--bg-app)',
                backgroundImage: 'radial-gradient(circle at center, var(--bg-card) 0%, transparent 100%)',
                borderRadius: 24,
                border: '1px solid var(--border)',
                overflow: 'hidden',
                boxShadow: 'inset 0 0 100px rgba(0,0,0,0.1)',
                touchAction: 'none'
            }}
        >
            {/* Background Dots */}
            <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 1px 1px, var(--border) 1px, transparent 0)', backgroundSize: '40px 40px', opacity: 0.5, pointerEvents: 'none' }} />

            {/* Connection Edge Canvas */}
            <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />

            {/* Nodes / Rich Cards */}
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                {nodesRef.current.map(n => {
                    const { profile: p } = n;
                    // Look up stats from React state — always fresh, survives async load
                    const stats = statsMap[p.id] || statsMap[p.full_name || ''] || statsMap[(p.email || '').split('@')[0]];
                    const color = getRoleColor(p.role);

                    return (
                        <div
                            key={p.id}
                            id={`team-card-${n.id}`}
                            onPointerDown={(e) => handlePointerDown(p.id, e)}
                            style={{
                                position: 'absolute',
                                top: 0, left: 0,
                                width: n.width,
                                height: n.height,
                                pointerEvents: 'auto',
                                cursor: isDragging.current === p.id ? 'grabbing' : 'grab',
                                willChange: 'transform',
                                background: 'var(--bg-card)',
                                border: `1px solid ${color}44`,
                                borderTop: `3px solid ${color}`,
                                borderRadius: 12,
                                boxShadow: isDragging.current === p.id
                                    ? `0 20px 40px rgba(0,0,0,0.3), 0 0 20px ${color}44`
                                    : '0 8px 24px rgba(0,0,0,0.12)',
                                display: 'flex',
                                flexDirection: 'column',
                                overflow: 'hidden',
                                transition: 'box-shadow 0.2s',
                                zIndex: isDragging.current === p.id ? 100 : (p.role === 'superadmin' ? 10 : 1)
                            }}
                        >
                            {/* Card Header (Avatar + Name) */}
                            <div style={{ display: 'flex', padding: '12px 14px', gap: 12, alignItems: 'center', background: 'var(--bg-hover)' }}>
                                <img
                                    src={getAvatarUrl(p.avatar_url, p.email, 40)}
                                    alt={p.full_name || p.email}
                                    style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', background: 'var(--bg-app)', border: `2px solid ${color}` }}
                                    draggable={false}
                                />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {p.full_name || p.email.split('@')[0]}
                                    </div>
                                    <div style={{ fontSize: 10, color, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 800 }}>
                                        {p.role}
                                    </div>
                                </div>
                            </div>

                            {/* Card Body (Stats) */}
                            <div style={{ flex: 1, padding: '10px 14px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                                    {/* Stat: Ingestion */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }} title="Ingestion Jobs">
                                        <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}><Database size={10} color="var(--blue)" /> INGS</div>
                                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{formatNum(stats?.ingestions || 0)}</div>
                                    </div>
                                    {/* Stat: Verification */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }} title="Verification Batches">
                                        <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}><ShieldCheck size={10} color="var(--green)" /> VRFY</div>
                                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{formatNum(stats?.verifications || 0)}</div>
                                    </div>
                                    {/* Stat: Targets */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }} title="Target Lists Created">
                                        <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}><Send size={10} color="var(--accent)" /> TRG</div>
                                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{formatNum(stats?.targets || 0)}</div>
                                    </div>
                                </div>

                                {/* Last Active Footer */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 8 }}>
                                    <Clock size={10} color="var(--text-tertiary)" />
                                    <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 500 }}>
                                        Active {timeAgo(stats?.lastActive || null)}
                                    </span>
                                </div>
                            </div>

                            {/* Tiny active indicator pulse */}
                            {p.is_active && (
                                <div style={{ position: 'absolute', top: 8, right: 8, width: 8, height: 8, borderRadius: '50%', background: 'var(--green)', boxShadow: '0 0 6px var(--green)' }} />
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Header Overlay */}
            <div style={{ position: 'absolute', top: 24, left: 28, pointerEvents: 'none' }}>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Activity size={18} color="var(--accent)" />
                    Intelligence Web
                </h3>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>Live operational graph. Drag cards to reorganize.</p>
            </div>

            {/* Aggregate Network Stats Panel */}
            <div style={{ position: 'absolute', bottom: 24, left: 28, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px', display: 'flex', gap: 24, boxShadow: 'var(--shadow-md)' }}>
                <div>
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>Teammates</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <User size={14} color="var(--purple)" /> {profiles.length}
                    </div>
                </div>
                <div>
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>Ingestions</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Database size={14} color="var(--blue)" /> {formatNum(globalTotals.ingestions)}
                    </div>
                </div>
                <div>
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>Verifications</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <ShieldCheck size={14} color="var(--green)" /> {formatNum(globalTotals.verifications)}
                    </div>
                </div>
                <div>
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>Total Ops</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Zap size={14} color="var(--yellow)" /> {formatNum(globalTotals.totalOps)}
                    </div>
                </div>
            </div>

        </div>

        {/* Member Detail Modal */}
        {selectedMember && (() => {
            const p = selectedMember;
            const color = getRoleColor(p.role);
            const stats = statsMap[p.id] || statsMap[p.full_name || ''] || statsMap[(p.email || '').split('@')[0]];
            return (
                <div
                    onClick={() => setSelectedMember(null)}
                    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                    <div onClick={e => e.stopPropagation()} style={{
                        background: 'var(--bg-card)', border: `1px solid ${color}44`, borderTop: `3px solid ${color}`,
                        borderRadius: 20, width: 380, overflow: 'hidden', boxShadow: `0 40px 80px rgba(0,0,0,0.4), 0 0 40px ${color}22`,
                        animation: 'fadeInScale 0.18s ease-out',
                    }}>
                        {/* Header */}
                        <div style={{ background: 'var(--bg-elevated)', padding: '24px 24px 20px', display: 'flex', alignItems: 'center', gap: 16, position: 'relative' }}>
                            <img src={getAvatarUrl(p.avatar_url, p.email, 80)} alt={p.full_name || p.email}
                                style={{ width: 64, height: 64, borderRadius: '50%', border: `3px solid ${color}`, objectFit: 'cover' }} />
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>{p.full_name || p.email.split('@')[0]}</div>
                                <div style={{ fontSize: 11, color, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginTop: 3 }}>{p.role}</div>
                                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <Mail size={11} /> {p.email}
                                </div>
                            </div>
                            <button onClick={() => setSelectedMember(null)}
                                style={{ position: 'absolute', top: 16, right: 16, background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 8, padding: 6, cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex' }}>
                                <X size={14} />
                            </button>
                        </div>

                        {/* Stats */}
                        <div style={{ padding: '20px 24px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                            {[
                                { label: 'Ingestions', value: stats?.ingestions || 0, icon: <Database size={14} color="var(--blue)" />, color: 'var(--blue)' },
                                { label: 'Verifications', value: stats?.verifications || 0, icon: <ShieldCheck size={14} color="var(--green)" />, color: 'var(--green)' },
                                { label: 'Targets', value: stats?.targets || 0, icon: <Send size={14} color="var(--accent)" />, color: 'var(--accent)' },
                            ].map(s => (
                                <div key={s.label} style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: '12px 14px', border: '1px solid var(--border)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>{s.icon}<span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-tertiary)', letterSpacing: '0.06em' }}>{s.label}</span></div>
                                    <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{formatNum(s.value)}</div>
                                </div>
                            ))}
                        </div>

                        {/* Footer */}
                        <div style={{ padding: '0 24px 20px', display: 'flex', gap: 12, fontSize: 12, color: 'var(--text-tertiary)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Calendar size={12} />
                                Joined {new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Clock size={12} />
                                Active {timeAgo(stats?.lastActive || null)}
                            </div>
                            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Award size={12} color={color} />
                                <span style={{ color, fontWeight: 700 }}>{formatNum(stats?.totalOps || 0)} ops</span>
                            </div>
                        </div>
                    </div>
                </div>
            );
        })()}
        </>
    );
};
