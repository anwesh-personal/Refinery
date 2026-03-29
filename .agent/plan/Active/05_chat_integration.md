# 05 — Chat Integration

## Purpose
This document specifies exactly how the existing `POST /api/ai/agents/:slug/chat` route changes to support tool calling. The current route sends a message to the LLM and streams back a text response. The modified route will additionally:

1. Inject the system manifest into the system prompt
2. Pass tool definitions to the LLM
3. Handle `tool_use` / `function_call` responses from the LLM
4. Execute the tool via the executor
5. Send the tool result back to the LLM for final response

---

## Current Chat Flow (before changes)

```
User message → POST /api/ai/agents/:slug/chat
  → Load agent config from DB
  → Load conversation history
  → Build messages array: [system_prompt, ...history, user_message]
  → Call LLM (OpenAI/Anthropic/Gemini/Ollama)
  → Stream response back to client
  → Save assistant message to DB
```

## New Chat Flow (after changes)

```
User message → POST /api/ai/agents/:slug/chat
  → Load agent config from DB
  → Load conversation history
  → Build system prompt = agent.system_prompt + buildSystemManifest(slug) + KB entries
  → Get tools for this agent from registry (filtered by agent slug)
  → Build messages array: [system_prompt, ...history, user_message]
  → Call LLM WITH tools parameter
  → IF response is tool_use:
      → Execute tool via executor
      → Log execution
      → Send tool result back to LLM as tool_result message
      → Get final text response from LLM
      → Stream to client
  → ELSE (normal text response):
      → Stream to client as before
  → Save all messages (user, tool_call, tool_result, assistant) to DB
```

---

## LLM Provider Tool Formats

Each provider has a different tool calling format. The chat route must translate our `ToolDefinition[]` into the provider-specific format.

### OpenAI / OpenAI-compatible
```json
{
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "start_verification",
        "description": "Start a new email verification pipeline job...",
        "parameters": { ... JSON Schema ... }
      }
    }
  ],
  "tool_choice": "auto"
}
```
Response when tool is used:
```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "tool_calls": [{
        "id": "call_abc123",
        "type": "function",
        "function": { "name": "start_verification", "arguments": "{\"emails\": [...]}" }
      }]
    }
  }]
}
```

### Anthropic
```json
{
  "tools": [
    {
      "name": "start_verification",
      "description": "Start a new email verification pipeline job...",
      "input_schema": { ... JSON Schema ... }
    }
  ]
}
```
Response when tool is used:
```json
{
  "content": [
    { "type": "tool_use", "id": "toolu_abc", "name": "start_verification", "input": { "emails": [...] } }
  ]
}
```

### Google Gemini
```json
{
  "tools": [{
    "functionDeclarations": [{
      "name": "start_verification",
      "description": "...",
      "parameters": { ... JSON Schema ... }
    }]
  }]
}
```

### Ollama (local models)
OpenAI-compatible format (same as OpenAI above). Most local models don't support tool calling yet — for Ollama, tools should be described in the system prompt as text, and the agent parses JSON from the response.

---

## Executor Integration

### File: `agents/tools/executor.ts`

```typescript
import { ToolDefinition, ToolCall, ToolResult, ToolContext } from './types';
import { TOOL_REGISTRY } from './registry';

export async function executeTool(
  call: ToolCall,
  context: ToolContext
): Promise<ToolResult> {
  const tool = TOOL_REGISTRY[call.name];

  if (!tool) {
    return { success: false, error: `Unknown tool: ${call.name}` };
  }

  // Check agent is allowed to use this tool
  if (!tool.agents.includes(context.agentSlug)) {
    return { success: false, error: `Agent ${context.agentSlug} cannot use tool ${call.name}` };
  }

  // Execute with timing
  const start = Date.now();
  try {
    const result = await tool.handler(call.arguments, context);
    const duration = Date.now() - start;

    // Log execution (fire-and-forget — don't block response)
    logToolExecution({
      agentSlug: context.agentSlug,
      userId: context.userId,
      conversationId: context.conversationId,
      toolName: call.name,
      arguments: call.arguments,
      result,
      durationMs: duration,
      timestamp: new Date().toISOString(),
    }).catch(() => {}); // Never fail on logging

    return result;
  } catch (e: any) {
    return { success: false, error: `Tool execution failed: ${e.message}` };
  }
}

async function logToolExecution(log: any) {
  // Insert into Supabase tool_executions table (to be created)
  // Or append to audit_log with type='tool_execution'
}
```

---

## Message Storage Changes

The `agent_messages` table currently has:
```sql
role TEXT NOT NULL,  -- 'user', 'assistant'
content TEXT NOT NULL,
tokens_used INT
```

Needs to also support:
```sql
role TEXT NOT NULL,  -- 'user', 'assistant', 'tool_call', 'tool_result'
content TEXT NOT NULL,
tool_name TEXT,      -- populated for tool_call and tool_result
tool_args JSONB,     -- populated for tool_call
tokens_used INT
```

**Migration**: Add `tool_name` and `tool_args` columns to `agent_messages`. Both nullable.

---

## Streaming with Tool Calls

When the LLM decides to use a tool, the flow is:
1. LLM returns a `tool_use` message (not streamed to user)
2. Server executes the tool (could take 1-30 seconds for verification jobs)
3. Server sends tool result back to LLM
4. LLM generates final text response (this IS streamed to user)

During step 2, the frontend should show a "thinking" or "executing" indicator. This can be sent as a custom SSE event:
```
event: tool_executing
data: {"tool": "start_verification", "status": "running"}

event: tool_complete
data: {"tool": "start_verification", "status": "done"}
```

Then the normal streaming text follows.
