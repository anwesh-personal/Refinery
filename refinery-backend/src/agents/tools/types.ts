// ═══════════════════════════════════════════════════════════
// Agent Tool Types — Shared interfaces for the entire tool system
// ═══════════════════════════════════════════════════════════

/** Definition of a tool that an agent can use */
export interface ToolDefinition {
  /** Unique tool name (snake_case) */
  name: string;
  /** Description shown to the LLM — must be clear enough for it to know when to use this tool */
  description: string;
  /** JSON Schema for tool inputs */
  parameters: Record<string, any>;
  /** read = safe, write = needs confirmation, destructive = double confirmation */
  riskLevel: 'read' | 'write' | 'destructive';
  /** Agent slugs allowed to use this tool */
  agents: string[];
  /** The handler function that executes this tool */
  handler: (args: any, context: ToolContext) => Promise<ToolResult>;
}

/** Context passed to every tool handler */
export interface ToolContext {
  /** Authenticated user's ID */
  userId: string;
  /** Which agent is calling the tool */
  agentSlug: string;
  /** Current conversation ID */
  conversationId: string;
  /** User's access token for internal API calls */
  accessToken: string;
}

/** Standardized tool response */
export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
}

/** What the LLM sends when it wants to use a tool */
export interface ToolCall {
  /** Tool call ID from the LLM (for response correlation) */
  id: string;
  /** Tool name to execute */
  name: string;
  /** Parsed arguments object */
  arguments: Record<string, any>;
}

/** Logged for every tool execution */
export interface ToolExecutionLog {
  agentSlug: string;
  userId: string;
  conversationId: string;
  toolName: string;
  arguments: Record<string, any>;
  result: ToolResult;
  durationMs: number;
  timestamp: string;
}

/** Tool definition formatted for OpenAI-compatible providers */
export interface OpenAIToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

/** Tool definition formatted for Anthropic */
export interface AnthropicToolSchema {
  name: string;
  description: string;
  input_schema: Record<string, any>;
}

/** Convert our ToolDefinition to OpenAI format */
export function toOpenAITools(tools: ToolDefinition[]): OpenAIToolSchema[] {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/** Convert our ToolDefinition to Anthropic format */
export function toAnthropicTools(tools: ToolDefinition[]): AnthropicToolSchema[] {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}
