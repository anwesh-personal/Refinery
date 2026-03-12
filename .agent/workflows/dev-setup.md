---
description: How to set up and run the development environment
---

## Prerequisites
- Node.js 20+
- npm 10+
- Supabase CLI (`brew install supabase/tap/supabase`)

## Steps

// turbo-all

1. Install frontend dependencies
```bash
cd axiom-data-hub && npm install
```

2. Install backend dependencies
```bash
cd refinery-backend && npm install
```

3. Copy environment files
```bash
cp axiom-data-hub/.env.example axiom-data-hub/.env
cp refinery-backend/.env.example refinery-backend/.env
```

4. Fill in the .env files with your Supabase keys:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY` (backend only)

5. Start the frontend dev server
```bash
cd axiom-data-hub && npm run dev
```

6. Start the backend dev server (separate terminal)
```bash
cd refinery-backend && npm run dev
```

7. Frontend is at `http://localhost:5173`, Backend at `http://localhost:4000`

## Regenerate DB Types
When Supabase schema changes (new migrations):
```bash
cd axiom-data-hub && supabase gen types typescript --project-id zucvybnaopjkfhvkrsqz > src/lib/database.types.ts
```

## TypeScript Check
```bash
cd axiom-data-hub && npx tsc --noEmit
```
