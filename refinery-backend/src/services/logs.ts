import { readFile, readdir, stat } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

/* ── Types ── */
export interface LogEntry {
    timestamp: string;
    level: 'info' | 'warn' | 'error' | 'debug';
    message: string;
    source: string;
}

/* ── PM2 log directory ── */
const PM2_LOG_DIR = process.env.PM2_LOG_DIR || join(process.env.HOME || '/root', '.pm2/logs');

/** Parse a raw log line into a structured entry */
function parseLine(line: string, source: string): LogEntry | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    let level: LogEntry['level'] = 'info';
    if (/\berr(or)?\b/i.test(trimmed) || /\bfatal\b/i.test(trimmed)) level = 'error';
    else if (/\bwarn(ing)?\b/i.test(trimmed)) level = 'warn';
    else if (/\bdebug\b/i.test(trimmed)) level = 'debug';

    // Try to extract ISO timestamp from common formats
    const tsMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})/);
    const timestamp = tsMatch ? tsMatch[1] : new Date().toISOString().slice(0, 19);

    return { timestamp, level, message: trimmed, source };
}

/** Read the last N lines from a file (tail) */
async function tailFile(filePath: string, maxLines: number): Promise<string[]> {
    if (!existsSync(filePath)) return [];
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    return lines.slice(-maxLines);
}

/** Get available log files */
export async function getLogFiles(): Promise<{ name: string; path: string; size: number; modified: string }[]> {
    if (!existsSync(PM2_LOG_DIR)) return [];
    const files = await readdir(PM2_LOG_DIR);
    const logFiles = files.filter(f => f.endsWith('.log'));

    const results = [];
    for (const f of logFiles) {
        const fullPath = join(PM2_LOG_DIR, f);
        const s = await stat(fullPath);
        results.push({
            name: f,
            path: fullPath,
            size: s.size,
            modified: s.mtime.toISOString(),
        });
    }
    return results.sort((a, b) => b.modified.localeCompare(a.modified));
}

/** Get parsed log entries */
export async function getLogs(opts: {
    lines?: number;
    level?: string;
    search?: string;
}): Promise<LogEntry[]> {
    const maxLines = opts.lines || 200;
    const files = await getLogFiles();
    if (files.length === 0) return [];

    const entries: LogEntry[] = [];
    for (const file of files) {
        const source = file.name.replace('.log', '');
        const lines = await tailFile(file.path, maxLines);
        for (const line of lines) {
            const entry = parseLine(line, source);
            if (entry) {
                // Level filter
                if (opts.level && opts.level !== 'all' && entry.level !== opts.level) continue;
                // Search filter
                if (opts.search && !entry.message.toLowerCase().includes(opts.search.toLowerCase())) continue;
                entries.push(entry);
            }
        }
    }

    // Sort by timestamp descending, most recent first
    entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return entries.slice(0, maxLines);
}

/** Clear a specific log file */
export async function clearLogFile(fileName: string): Promise<void> {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '');
    const filePath = join(PM2_LOG_DIR, safeName);
    if (!existsSync(filePath)) throw new Error(`Log file not found: ${safeName}`);
    const { writeFile } = await import('fs/promises');
    await writeFile(filePath, '');
}
