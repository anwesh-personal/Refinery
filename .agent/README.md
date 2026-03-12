# 🧠 Refinery Nexus — Agent Knowledge System

This folder carries all project context, plans, audits, and session history so that **any AI agent in any IDE** can pick up exactly where the last one left off.

## Structure

```
.agent/
├── README.md              ← You are here
├── knowledge/             ← Project context, architecture, conventions
│   ├── architecture.md    ← System architecture overview
│   ├── tech-stack.md      ← Technologies, versions, patterns
│   ├── database-schema.md ← All Supabase & ClickHouse schemas
│   └── conventions.md     ← Code conventions, naming, file structure
├── plans/                 ← Implementation plans (features, epics)
│   ├── 001-multi-server.md
│   ├── 002-custom-roles.md
│   ├── 003-team-groups.md
│   ├── 004-verify550-wiring.md
│   └── 005-verification-engine.md
├── audit/                 ← Code audits, security reviews
│   └── 2026-03-12-forensic-audit.md
├── session-logs/          ← Summary of each working session
│   └── 2026-03-12-session.md
└── workflows/             ← Reusable workflows (dev, deploy, etc.)
    └── dev-setup.md
```

## How to Use

1. **Starting a new session?** Read `knowledge/architecture.md` first, then check `plans/` for current priorities
2. **Building a feature?** Follow the plan in `plans/NNN-feature-name.md`
3. **Auditing code?** Write findings to `audit/YYYY-MM-DD-audit-name.md`
4. **Ending a session?** Write a summary to `session-logs/YYYY-MM-DD-session.md`

## Key Principles

- **Nothing hardcoded** — all config flows from UI → Supabase → backend
- **Superadmin controls everything** — roles, permissions, server connections
- **Audit everything** — every admin action gets logged
- **Type safety** — generated DB types, no `as any` casts
- **Modular architecture** — any feature can evolve independently
