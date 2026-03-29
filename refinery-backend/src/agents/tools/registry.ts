// ═══════════════════════════════════════════════════════════
// Tool Registry — Master map of all tools available to agents
//
// Each entry: name → { definition + handler reference }
// The executor looks up tools here. The chat route reads
// definitions from here to pass to the LLM.
// ═══════════════════════════════════════════════════════════

import type { ToolDefinition } from './types.js';
import { startVerification, getVerificationStatus, getVerificationResults, listVerificationJobs } from './handlers/verify.js';
import { queryDatabase, getTableSchema } from './handlers/database.js';
import { getServerHealth, getDashboardStats } from './handlers/system.js';
import { listSegments, createSegment, getSegmentCount } from './handlers/segments.js';
import { generateEmailCopy } from './handlers/content.js';
import { listS3Sources, startIngestion } from './handlers/ingestion.js';

// ─── Tool Definitions ───────────────────────────────────

export const TOOL_REGISTRY: Record<string, ToolDefinition> = {

  // ══════ VERIFICATION ══════

  start_verification: {
    name: 'start_verification',
    description: 'Start a new email verification pipeline job. Takes a list of emails and runs them through syntax check, typo fix, deduplication, disposable detection, role-based check, MX lookup, SMTP handshake, catch-all detection, and risk scoring.',
    parameters: {
      type: 'object',
      properties: {
        emails: {
          type: 'array', items: { type: 'string' },
          description: 'List of email addresses to verify. Max 200,000 per job.',
        },
        checks: {
          type: 'object',
          description: 'Optional. Which checks to enable. Defaults to all enabled.',
          properties: {
            syntax: { type: 'boolean' }, typoFix: { type: 'boolean' },
            deduplicate: { type: 'boolean' }, disposable: { type: 'boolean' },
            roleBased: { type: 'boolean' }, freeProvider: { type: 'boolean' },
            mxLookup: { type: 'boolean' }, smtpVerify: { type: 'boolean' },
            catchAll: { type: 'boolean' },
          },
        },
      },
      required: ['emails'],
    },
    riskLevel: 'write',
    agents: ['smtp_specialist'],
    handler: startVerification,
  },

  get_verification_status: {
    name: 'get_verification_status',
    description: 'Check the progress of a verification job. Returns processed count, classification breakdown, and completion percentage.',
    parameters: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'The verification job ID' },
      },
      required: ['job_id'],
    },
    riskLevel: 'read',
    agents: ['smtp_specialist', 'supervisor'],
    handler: getVerificationStatus,
  },

  get_verification_results: {
    name: 'get_verification_results',
    description: 'Get results from a completed verification job. Returns paginated email-level results with classification, risk score, and check details.',
    parameters: {
      type: 'object',
      properties: {
        job_id: { type: 'string' },
        classification: { type: 'string', enum: ['safe', 'uncertain', 'risky', 'reject', 'all'], description: 'Filter by classification. Default: all.' },
        limit: { type: 'number', description: 'Max results to return. Default: 100, max: 500.' },
        offset: { type: 'number', description: 'Offset for pagination. Default: 0.' },
      },
      required: ['job_id'],
    },
    riskLevel: 'read',
    agents: ['smtp_specialist', 'data_scientist', 'verification_engineer'],
    handler: getVerificationResults,
  },

  list_verification_jobs: {
    name: 'list_verification_jobs',
    description: 'List all verification jobs with their status, email counts, and timestamps.',
    parameters: { type: 'object', properties: {} },
    riskLevel: 'read',
    agents: ['smtp_specialist', 'supervisor'],
    handler: listVerificationJobs,
  },

  // ══════ DATABASE ══════

  query_database: {
    name: 'query_database',
    description: 'Run a read-only SQL query against the ClickHouse database. Use this to analyze lead data, count records, find patterns, or answer questions about the data. Only SELECT queries are allowed — no mutations.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'SQL SELECT query. Must start with SELECT. No INSERT/UPDATE/DELETE/DROP allowed.' },
        limit: { type: 'number', description: 'Max rows to return. Default: 100, max: 1000. Auto-appended if not in query.' },
      },
      required: ['query'],
    },
    riskLevel: 'read',
    agents: ['data_scientist'],
    handler: queryDatabase,
  },

  get_table_schema: {
    name: 'get_table_schema',
    description: 'Get column definitions for a ClickHouse table. Use this to understand what data fields are available before writing queries.',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'Table name. Default: universal_person.' },
      },
    },
    riskLevel: 'read',
    agents: ['data_scientist'],
    handler: getTableSchema,
  },

  // ══════ SEGMENTS ══════

  list_segments: {
    name: 'list_segments',
    description: 'List all defined segments with their names, descriptions, and row counts.',
    parameters: { type: 'object', properties: {} },
    riskLevel: 'read',
    agents: ['data_scientist', 'supervisor'],
    handler: listSegments,
  },

  create_segment: {
    name: 'create_segment',
    description: 'Create a new segment by defining filter rules. Segments are saved queries that can be re-executed to get matching leads.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Human-readable segment name' },
        description: { type: 'string', description: 'What this segment represents' },
        filters: {
          type: 'object', description: 'FilterGroup with logic (AND/OR) and conditions array',
          properties: {
            logic: { type: 'string', enum: ['AND', 'OR'] },
            conditions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  field: { type: 'string' },
                  operator: { type: 'string', enum: ['=', '!=', 'LIKE', 'NOT LIKE', 'IN', 'NOT IN', '>', '<', '>=', '<=', 'IS NULL', 'IS NOT NULL'] },
                  value: {},
                },
              },
            },
          },
        },
      },
      required: ['name', 'filters'],
    },
    riskLevel: 'write',
    agents: ['data_scientist'],
    handler: createSegment,
  },

  get_segment_count: {
    name: 'get_segment_count',
    description: 'Get the current row count for a segment without loading the data.',
    parameters: {
      type: 'object',
      properties: {
        segment_id: { type: 'string', description: 'The segment ID' },
      },
      required: ['segment_id'],
    },
    riskLevel: 'read',
    agents: ['data_scientist'],
    handler: getSegmentCount,
  },

  // ══════ CONTENT ══════

  generate_email_copy: {
    name: 'generate_email_copy',
    description: 'Generate email copy (subject line, body, CTA) for a campaign. Returns multiple variants for A/B testing.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['cold_outreach', 'follow_up', 're_engagement', 'announcement', 'newsletter'], description: 'Type of email' },
        product: { type: 'string', description: 'What you are selling or promoting' },
        audience: { type: 'string', description: 'Who the email is for' },
        tone: { type: 'string', enum: ['professional', 'casual', 'urgent', 'friendly', 'authoritative'], description: 'Tone of the email. Default: professional.' },
        variants: { type: 'number', description: 'Number of variants to generate. Default: 3, max: 5.' },
      },
      required: ['type', 'product', 'audience'],
    },
    riskLevel: 'read',
    agents: ['email_marketer'],
    handler: generateEmailCopy,
  },

  // ══════ SYSTEM ══════

  get_server_health: {
    name: 'get_server_health',
    description: 'Check the health status of all connected services — ClickHouse, Supabase, S3, SMTP servers.',
    parameters: { type: 'object', properties: {} },
    riskLevel: 'read',
    agents: ['supervisor'],
    handler: getServerHealth,
  },

  get_dashboard_stats: {
    name: 'get_dashboard_stats',
    description: 'Get platform-wide statistics — total leads, verified/unverified counts, recent verification jobs.',
    parameters: { type: 'object', properties: {} },
    riskLevel: 'read',
    agents: ['supervisor', 'data_scientist'],
    handler: getDashboardStats,
  },

  // ══════ INGESTION ══════

  list_s3_sources: {
    name: 'list_s3_sources',
    description: 'List configured S3/MinIO data sources for data ingestion.',
    parameters: { type: 'object', properties: {} },
    riskLevel: 'read',
    agents: ['supervisor'],
    handler: listS3Sources,
  },

  start_ingestion: {
    name: 'start_ingestion',
    description: 'Start an S3 ingestion job to load data from CSV/TSV/Parquet files into ClickHouse universal_person table.',
    parameters: {
      type: 'object',
      properties: {
        source_id: { type: 'string', description: 'S3 source configuration ID' },
        files: { type: 'array', items: { type: 'string' }, description: 'File paths within the S3 bucket to ingest' },
        column_mapping: { type: 'object', description: 'Optional. Map source columns to universal_person columns.' },
      },
      required: ['source_id', 'files'],
    },
    riskLevel: 'write',
    agents: ['supervisor'],
    handler: startIngestion,
  },
};

// ─── Helper: Get tools available to a specific agent ───

export function getToolsForAgent(agentSlug: string): ToolDefinition[] {
  return Object.values(TOOL_REGISTRY).filter(t => t.agents.includes(agentSlug));
}

// ─── Helper: Get all tool names ───

export function getAllToolNames(): string[] {
  return Object.keys(TOOL_REGISTRY);
}
