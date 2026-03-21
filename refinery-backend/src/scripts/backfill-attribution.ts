/**
 * One-time backfill script: attributes all un-attributed operations to the primary superadmin.
 * Run with: npx tsx src/scripts/backfill-attribution.ts
 */
import 'dotenv/config';
import { createClient as createCH } from '@clickhouse/client';
import { createClient as createSB } from '@supabase/supabase-js';

const ch = createCH({
    url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD || '',
    database: process.env.CLICKHOUSE_DATABASE || 'refinery',
});

const sb = createSB(
    process.env.VITE_SUPABASE_URL || '',
    process.env.SUPABASE_SECRET_KEY || '',
);

async function query<T>(sql: string): Promise<T[]> {
    const result = await ch.query({ query: sql, format: 'JSONEachRow' });
    return (await result.json()) as T[];
}

async function command(sql: string): Promise<void> {
    await ch.command({ query: sql });
}

async function main() {
    console.log('[Backfill] Starting user attribution backfill...');
    console.log(`[Backfill] ClickHouse: ${process.env.CLICKHOUSE_HOST}`);

    // Get primary superadmin from Supabase
    const { data: admins, error } = await sb
        .from('profiles')
        .select('id, full_name, email, role')
        .eq('role', 'superadmin')
        .limit(1);

    if (error || !admins?.length) {
        console.error('[Backfill] FAILED: No superadmin found in profiles', error?.message);
        process.exit(1);
    }

    const admin = admins[0];
    const userId = admin.id;
    const userName = admin.full_name || admin.email || 'Admin';
    const safeUserName = userName.replace(/'/g, "''");

    console.log(`[Backfill] Attributing to: ${userName} (${userId})`);

    const TABLES = [
        'ingestion_jobs',
        'verification_batches',
        'target_lists',
        'segments',
        'queue_jobs',
        'pipeline_jobs',
    ];

    let totalUpdated = 0;

    for (const table of TABLES) {
        try {
            const [countRow] = await query<{ cnt: string }>(`
                SELECT count() as cnt FROM ${table}
                WHERE performed_by IS NULL OR performed_by = '' OR performed_by = 'system'
            `);
            const cnt = Number(countRow?.cnt || 0);
            if (cnt === 0) {
                console.log(`[Backfill] ${table}: 0 rows to update, skipping`);
                continue;
            }

            await command(`
                ALTER TABLE ${table} UPDATE
                    performed_by = '${userId}',
                    performed_by_name = '${safeUserName}'
                WHERE performed_by IS NULL OR performed_by = '' OR performed_by = 'system'
            `);
            console.log(`[Backfill] ✓ ${table}: attributed ${cnt} rows to ${userName}`);
            totalUpdated += cnt;
        } catch (e: any) {
            console.log(`[Backfill] ${table}: skipped (${e.message?.substring(0, 60)})`);
        }
    }

    console.log(`\n[Backfill] ✓ Done! Attributed ${totalUpdated} total operations to ${userName}`);
    console.log('[Backfill] Note: ClickHouse mutations are async — data may take a few seconds to reflect.');

    await ch.close();
    process.exit(0);
}

main().catch(e => {
    console.error('[Backfill] FATAL:', e.message);
    process.exit(1);
});
