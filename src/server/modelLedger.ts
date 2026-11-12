import 'server-only';

import { modelCostMicrocents } from '@/lib/models';
import type { ModelReply } from '@/server/agent';
import { logUsage } from '@/server/repos/usage';
import type { SearchSession } from '@/server/repos/sessions';

/** One ledger row per model call, failures included. Returns what the turn trace keeps. */
export async function logModelCalls(session: Pick<SearchSession, 'id' | 'userId'>, purpose: 'agent' | 'scan' | 'priorities' | 'near', replies: ModelReply[]) {
  let costMicrocents = 0;
  for (const r of replies) {
    if (!r.ok && r.failure === 'not_configured') continue;
    const cost = r.ok ? modelCostMicrocents(r.model, r.usage) : 0;
    costMicrocents += cost;
    await logUsage({
      sessionId: session.id,
      userId: session.userId,
      provider: 'anthropic',
      model: r.model,
      inputTokens: r.ok ? r.usage.input : 0,
      outputTokens: r.ok ? r.usage.output : 0,
      cacheWriteTokens: r.ok ? r.usage.cacheWrite : 0,
      cacheReadTokens: r.ok ? r.usage.cacheRead : 0,
      costMicrocents: cost,
      latencyMs: r.latencyMs,
      success: r.ok,
      errorMessage: r.ok ? null : r.errorMessage,
      // Why the model stopped. Anything but end_turn (or tool_use) means its output was cut short.
      meta: r.ok ? { purpose, stop_reason: r.stopReason } : { purpose },
    });
  }
  return { model_calls: replies.length, cost_microcents: costMicrocents };
}
