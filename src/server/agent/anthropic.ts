import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

import type { ModelId, TokenUsage } from '@/lib/models';
import { anthropicCredentials } from '@/server/anthropicKey';

/**
 * One call to the model. Never throws: every failure is a typed value the
 * caller turns into a fixed line. Nothing from a request or a response body
 * is ever put in an error message, so nothing a user typed reaches a log.
 */
export type ToolDef = { name: string; description: string; input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean } };

export type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown };
export type ToolResult = { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
export type Turn = { role: 'user'; content: string | ToolResult[] } | { role: 'assistant'; content: Block[] };

export type ModelCall = {
  model: ModelId;
  system: string;
  messages: Turn[];
  tools: ToolDef[];
  /** Force one tool. The structure is forced, never requested in prose. */
  forceTool?: string;
  maxTokens: number;
};

export type ModelFailure = 'not_configured' | 'timeout' | 'network' | 'rate_limited' | 'overloaded' | `http_${number}`;

export type ModelReply =
  | { ok: true; model: ModelId; content: Block[]; stopReason: string | null; usage: TokenUsage; latencyMs: number }
  | { ok: false; model: ModelId; failure: ModelFailure; latencyMs: number; errorMessage: string };

export type CallModel = (call: ModelCall) => Promise<ModelReply>;

const TIMEOUT_MS = 30_000;

export const callAnthropic: CallModel = async (call) => {
  const credentials = anthropicCredentials();
  if (!credentials) return { ok: false, model: call.model, failure: 'not_configured', latencyMs: 0, errorMessage: 'ANTHROPIC_API_KEY is not set' };
  const client = new Anthropic({
    apiKey: credentials.apiKey,
    maxRetries: 1,
    timeout: TIMEOUT_MS,
    ...(credentials.workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': credentials.workspaceId } } : {}),
  });
  const started = Date.now();
  try {
    const res = await client.messages.create({
      model: call.model,
      max_tokens: call.maxTokens,
      // The instructions and the tools never change between turns, so they are the cached prefix.
      system: [{ type: 'text', text: call.system, cache_control: { type: 'ephemeral' } }],
      messages: call.messages,
      tools: call.tools,
      ...(call.forceTool ? { tool_choice: { type: 'tool' as const, name: call.forceTool } } : {}),
    });
    const content: Block[] = [];
    for (const block of res.content) {
      if (block.type === 'text') content.push({ type: 'text', text: block.text });
      else if (block.type === 'tool_use') content.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input });
    }
    return {
      ok: true,
      model: call.model,
      content,
      stopReason: res.stop_reason,
      usage: {
        input: res.usage.input_tokens,
        cacheWrite: res.usage.cache_creation_input_tokens ?? 0,
        cacheRead: res.usage.cache_read_input_tokens ?? 0,
        output: res.usage.output_tokens,
      },
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const fail = (failure: ModelFailure, errorMessage: string): ModelReply => ({ ok: false, model: call.model, failure, latencyMs, errorMessage });
    if (err instanceof Anthropic.APIConnectionTimeoutError) return fail('timeout', `timed out after ${TIMEOUT_MS} ms`);
    if (err instanceof Anthropic.APIConnectionError) return fail('network', 'connection error');
    if (err instanceof Anthropic.APIError && typeof err.status === 'number') {
      if (err.status === 429) return fail('rate_limited', 'HTTP 429');
      if (err.status === 529) return fail('overloaded', 'HTTP 529');
      // The error's type is Anthropic's own word ("invalid_request_error"); its message is never kept.
      return fail(`http_${err.status}`, `HTTP ${err.status}${typeof err.type === 'string' ? ` ${err.type}` : ''}`);
    }
    return fail('network', err instanceof Error ? err.name : 'unknown error');
  }
};
