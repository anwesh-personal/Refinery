import React, { useEffect, useState, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
  Handle,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { supabase } from '../lib/supabase';
import { getAvatarUrl } from '../lib/avatar';
import { Activity, Database, Zap, Send, Clock, User, ShieldCheck, X, Mail, Calendar, Award } from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  avatar_url: string | null;
  created_at: string;
  is_active: boolean;
  last_active_at: string | null;
}

interface UserStats {
  userId: string;
  name: string | null;
  ingestions: number;
  verifications: number;
  targets: number;
  totalOps: number;
  lastActive: string | null;
}

interface TeamRow {
  id: string;
  name: string;
}

interface TeamMembershipRow {
  team_id: string;
  profile_id: string;
  joined_at: string | null;
}

// Data attached to each React Flow node
interface MemberNodeData {
  profile: Profile;
  stats: UserStats | null;
  teamName: string | null;
  teamNames: { name: string; joinedAt: string | null }[];
  [key: string]: unknown;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  superadmin: '#a855f7',
  admin: '#3b82f6',
  member: '#10b981',
};

const TEAM_COLORS = ['#a855f7', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899'];

const getRoleColor = (role: string) => ROLE_COLORS[role] || '#8b5cf6';
const formatNum = (n: number) => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : n.toString();
const timeAgo = (d: string | null) => {
  if (!d) return 'Never';
  const mins = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

// ─── Custom Node ────────────────────────────────────────────────────────────

function MemberCard({ data }: NodeProps<Node<MemberNodeData>>) {
  const p = data.profile;
  const stats = data.stats;
  const color = getRoleColor(p.role);

  return (
    <div style={{
      width: 200, background: 'var(--bg-card)', border: `1px solid ${color}44`,
      borderTop: `3px solid ${color}`, borderRadius: 12, overflow: 'hidden',
      boxShadow: '0 8px 24px rgba(0,0,0,0.12)', cursor: 'pointer',
    }}>
      <Handle type="target" position={Position.Top} style={{ background: color, width: 6, height: 6 }} />
      <Handle type="source" position={Position.Bottom} style={{ background: color, width: 6, height: 6 }} />

      {/* Header */}
      <div style={{ display: 'flex', padding: '10px 12px', gap: 10, alignItems: 'center', background: 'var(--bg-hover)' }}>
        <img src={getAvatarUrl(p.avatar_url, p.email, 40)} alt="" draggable={false}
          style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', border: `2px solid ${color}` }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {p.full_name || p.email.split('@')[0]}
          </div>
          <div style={{ fontSize: 9, color, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 800 }}>
            {p.role}
          </div>
        </div>
        {p.is_active && (
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--green)', boxShadow: '0 0 6px var(--green)', flexShrink: 0 }} />
        )}
      </div>

      {/* Stats */}
      <div style={{ padding: '8px 12px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
        <div title="Ingestions">
          <div style={{ fontSize: 8, color: 'var(--text-tertiary)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}><Database size={8} color="var(--blue)" /> INGS</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{formatNum(stats?.ingestions || 0)}</div>
        </div>
        <div title="Verifications">
          <div style={{ fontSize: 8, color: 'var(--text-tertiary)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}><ShieldCheck size={8} color="var(--green)" /> VRFY</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{formatNum(stats?.verifications || 0)}</div>
        </div>
        <div title="Targets">
          <div style={{ fontSize: 8, color: 'var(--text-tertiary)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}><Send size={8} color="var(--accent)" /> TRG</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{formatNum(stats?.targets || 0)}</div>
        </div>
      </div>

      {/* Team badge */}
      {data.teamName && (
        <div style={{ padding: '0 12px 8px' }}>
          <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: `${color}18`, color, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {data.teamName}
          </span>
        </div>
      )}
    </div>
  );
}

const nodeTypes = { member: MemberCard };

// ─── Main Component ─────────────────────────────────────────────────────────

export const TeamNetworkGraph: React.FC = () => {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<MemberNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMember, setSelectedMember] = useState<{ profile: Profile; stats: UserStats | null; teamNames: { name: string; joinedAt: string | null }[] } | null>(null);
  const [globalTotals, setGlobalTotals] = useState({ teammates: 0, ingestions: 0, verifications: 0, totalOps: 0 });

  const fetchWithTimeout = useCallback(async <T,>(url: string, timeoutMs = 5000): Promise<T | null> => {
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
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      // 1. Profiles
      const { data: profilesData } = await supabase.from('profiles').select('*');
      if (cancelled || !profilesData) { setLoading(false); return; }
      const profiles: Profile[] = profilesData;

      // 2. Teams + memberships (parallel)
      const [teamsRes, membershipsRes] = await Promise.all([
        supabase.from('teams').select('id, name'),
        supabase.from('team_memberships').select('team_id, profile_id, joined_at'),
      ]);
      const teams: TeamRow[] = teamsRes.data || [];
      const memberships: TeamMembershipRow[] = membershipsRes.data || [];

      // Build lookup: profileId -> teamName
      const teamNameMap: Record<string, string> = {};
      teams.forEach(t => { teamNameMap[t.id] = t.name; });
      const profileTeamMap: Record<string, string> = {};
      const profileTeamsMap: Record<string, { name: string; joinedAt: string | null }[]> = {};
      memberships.forEach(m => {
        const tName = teamNameMap[m.team_id] || '';
        if (tName) {
          profileTeamMap[m.profile_id] = profileTeamMap[m.profile_id] || tName; // first team for graph grouping
          if (!profileTeamsMap[m.profile_id]) profileTeamsMap[m.profile_id] = [];
          profileTeamsMap[m.profile_id].push({ name: tName, joinedAt: m.joined_at || null });
        }
      });

      // 3. Stats (async, don't block)
      const statsMap: Record<string, UserStats> = {};
      const statsRaw = await fetchWithTimeout<any>('/api/dashboard/user-stats', 5000);
      if (!cancelled && statsRaw) {
        const perUser: UserStats[] = Array.isArray(statsRaw) ? statsRaw : statsRaw?.perUser || [];
        perUser.forEach(s => { statsMap[s.userId] = s; if (s.name) statsMap[s.name] = s; });
        if (statsRaw?.totals) {
          setGlobalTotals({ teammates: profiles.length, ...statsRaw.totals });
        } else {
          const unique = [...new Map(perUser.map(s => [s.userId, s])).values()];
          setGlobalTotals({
            teammates: profiles.length,
            ingestions: unique.reduce((a, s) => a + s.ingestions, 0),
            verifications: unique.reduce((a, s) => a + s.verifications, 0),
            totalOps: unique.reduce((a, s) => a + s.totalOps, 0),
          });
        }
      } else {
        setGlobalTotals(g => ({ ...g, teammates: profiles.length }));
      }

      if (cancelled) return;

      // 4. Build nodes — cluster by team
      const teamGroups: Record<string, Profile[]> = { __unassigned: [] };
      teams.forEach(t => { teamGroups[t.id] = []; });
      profiles.forEach(p => {
        const tm = memberships.find(m => m.profile_id === p.id);
        if (tm && teamGroups[tm.team_id]) {
          teamGroups[tm.team_id].push(p);
        } else {
          teamGroups.__unassigned.push(p);
        }
      });

      const builtNodes: Node<MemberNodeData>[] = [];
      const builtEdges: Edge[] = [];
      let clusterX = 0;

      Object.entries(teamGroups).forEach(([teamId, members]) => {
        if (members.length === 0) return;
        const teamName = teamId === '__unassigned' ? null : teamNameMap[teamId] || null;
        const teamColorIdx = teams.findIndex(t => t.id === teamId);
        const teamColor = TEAM_COLORS[teamColorIdx % TEAM_COLORS.length] || '#888';

        // Sort: superadmin first
        members.sort((a, b) => {
          const r = (role: string) => role === 'superadmin' ? 3 : role === 'admin' ? 2 : 1;
          return r(b.role) - r(a.role);
        });

        const cols = Math.min(members.length, 3);
        members.forEach((p, i) => {
          const col = i % cols;
          const row = Math.floor(i / cols);
          const stats = statsMap[p.id] || statsMap[p.full_name || ''] || statsMap[(p.email || '').split('@')[0]] || null;

          builtNodes.push({
            id: p.id,
            type: 'member',
            position: { x: clusterX + col * 240, y: row * 160 + 60 },
            data: { profile: p, stats, teamName, teamNames: profileTeamsMap[p.id] || [] },
          });

          // Connect to first member in same team (hub pattern)
          if (i > 0) {
            builtEdges.push({
              id: `e-${members[0].id}-${p.id}`,
              source: members[0].id,
              target: p.id,
              style: { stroke: teamColor, strokeWidth: 2, opacity: 0.5 },
              animated: false,
            });
          }
        });

        clusterX += (cols * 240) + 120;
      });

      setNodes(builtNodes);
      setEdges(builtEdges);
      setLoading(false);
    };

    load();
    return () => { cancelled = true; };
  }, [fetchWithTimeout, setNodes, setEdges]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node<MemberNodeData>) => {
    setSelectedMember({
      profile: node.data.profile,
      stats: node.data.stats,
      teamNames: node.data.teamNames || [],
    });
  }, []);

  if (loading) {
    return (
      <div style={{ height: 650, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-card)', borderRadius: 20, border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: 'var(--text-tertiary)' }}>
          <Activity size={24} className="animate-spin" />
          <span style={{ fontSize: 13, fontWeight: 600 }}>Loading Intelligence Web...</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <div style={{ position: 'relative', height: 650, borderRadius: 24, border: '1px solid var(--border)', overflow: 'hidden' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.3}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={30} size={1} color="var(--border)" />
          <Controls position="bottom-right" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10 }} />
          <MiniMap
            nodeColor={(n: Node) => getRoleColor((n.data as MemberNodeData)?.profile?.role || 'member')}
            maskColor="rgba(0,0,0,0.6)"
            style={{ background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: 10 }}
          />
        </ReactFlow>

        {/* Header Overlay */}
        <div style={{ position: 'absolute', top: 20, left: 24, pointerEvents: 'none', zIndex: 5 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <Activity size={18} color="var(--accent)" /> Intelligence Web
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>Team graph. Click cards for details. Scroll to zoom. Drag to pan.</p>
        </div>

        {/* Aggregate Stats */}
        <div style={{ position: 'absolute', bottom: 20, left: 24, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 16px', display: 'flex', gap: 20, boxShadow: 'var(--shadow-md)', zIndex: 5 }}>
          <div>
            <div style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: 600 }}>Teammates</div>
            <div style={{ fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5 }}><User size={13} color="var(--purple)" /> {globalTotals.teammates}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: 600 }}>Ingestions</div>
            <div style={{ fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5 }}><Database size={13} color="var(--blue)" /> {formatNum(globalTotals.ingestions)}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: 600 }}>Verifications</div>
            <div style={{ fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5 }}><ShieldCheck size={13} color="var(--green)" /> {formatNum(globalTotals.verifications)}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: 600 }}>Total Ops</div>
            <div style={{ fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5 }}><Zap size={13} color="var(--yellow)" /> {formatNum(globalTotals.totalOps)}</div>
          </div>
        </div>
      </div>

      {/* Member Detail Modal */}
      {selectedMember && (() => {
        const p = selectedMember.profile;
        const stats = selectedMember.stats;
        const teamNames = selectedMember.teamNames;
        const color = getRoleColor(p.role);
        const isOnline = p.is_active && p.last_active_at && (Date.now() - new Date(p.last_active_at).getTime()) < 15 * 60 * 1000;
        return (
          <div onClick={() => setSelectedMember(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div onClick={e => e.stopPropagation()} style={{
              background: 'var(--bg-card)', border: `1px solid ${color}44`, borderTop: `3px solid ${color}`,
              borderRadius: 20, width: 420, overflow: 'hidden', boxShadow: `0 40px 80px rgba(0,0,0,0.4), 0 0 40px ${color}22`,
            }}>
              {/* Header */}
              <div style={{ background: 'var(--bg-elevated)', padding: '24px 24px 20px', display: 'flex', alignItems: 'center', gap: 16, position: 'relative' }}>
                <div style={{ position: 'relative' }}>
                  <img src={getAvatarUrl(p.avatar_url, p.email, 80)} alt=""
                    style={{ width: 64, height: 64, borderRadius: '50%', border: `3px solid ${color}`, objectFit: 'cover' }} />
                  {/* Online status dot */}
                  <div style={{
                    position: 'absolute', bottom: 2, right: 2, width: 14, height: 14, borderRadius: '50%',
                    background: isOnline ? 'var(--green)' : 'var(--text-tertiary)',
                    border: '2px solid var(--bg-elevated)',
                    boxShadow: isOnline ? '0 0 8px var(--green)' : 'none',
                  }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>{p.full_name || p.email.split('@')[0]}</div>
                  <div style={{ fontSize: 11, color, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginTop: 3 }}>{p.role}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}><Mail size={11} /> {p.email}</div>
                </div>
                <button onClick={() => setSelectedMember(null)}
                  style={{ position: 'absolute', top: 16, right: 16, background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 8, padding: 6, cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex' }}>
                  <X size={14} />
                </button>
              </div>

              {/* Team Badges */}
              {teamNames.length > 0 && (
                <div style={{ padding: '12px 24px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Teams:</span>
                  {teamNames.map((t, i) => {
                    const teamColor = TEAM_COLORS[i % TEAM_COLORS.length];
                    return (
                      <span key={t.name} style={{
                        fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 6,
                        background: `${teamColor}18`, color: teamColor,
                        border: `1px solid ${teamColor}30`,
                        textTransform: 'uppercase', letterSpacing: '0.04em',
                      }}>
                        {t.name}
                      </span>
                    );
                  })}
                </div>
              )}
              {teamNames.length === 0 && (
                <div style={{ padding: '10px 24px', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 11, fontStyle: 'italic', color: 'var(--text-tertiary)' }}>No team assigned</span>
                </div>
              )}

              {/* Stats Grid */}
              <div style={{ padding: '20px 24px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                {[
                  { label: 'Ingestions', value: stats?.ingestions || 0, icon: <Database size={14} color="var(--blue)" />, c: 'var(--blue)' },
                  { label: 'Verifications', value: stats?.verifications || 0, icon: <ShieldCheck size={14} color="var(--green)" />, c: 'var(--green)' },
                  { label: 'Targets', value: stats?.targets || 0, icon: <Send size={14} color="var(--accent)" />, c: 'var(--accent)' },
                ].map(s => (
                  <div key={s.label} style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: '12px 14px', border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>{s.icon}<span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>{s.label}</span></div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: s.c }}>{formatNum(s.value)}</div>
                  </div>
                ))}
              </div>

              {/* Footer - Meta Info */}
              <div style={{ padding: '0 24px 20px', display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-tertiary)', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Calendar size={12} /> Joined {new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Clock size={12} />
                  {isOnline
                    ? <span style={{ color: 'var(--green)', fontWeight: 600 }}>Online now</span>
                    : <>Active {timeAgo(stats?.lastActive || p.last_active_at || null)}</>
                  }
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Award size={12} color={color} />
                  <span style={{ color, fontWeight: 700 }}>{formatNum(stats?.totalOps || 0)} total actions</span>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
};
