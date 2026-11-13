import 'server-only';

import { logUsage } from '@/server/repos/usage';
import { createLiteApiAdapter } from './liteapi/adapter';
import type { SupplierAdapter } from './types';

/**
 * BOUNDED MODULE. This file and `./types` are the only things the rest of the
 * app may import from `supplier/` (supplierBoundaryGuard.test.ts). Nothing
 * outside knows which supplier it is talking to.
 */
export type * from './types';
export { recordedExampleSearch } from './liteapi/example';

let instance: SupplierAdapter | null = null;

/**
 * The configured supplier, with every call written to the usage ledger.
 * `context` ties those rows to a session or user; `language` asks for place
 * names and hotel text in the user's language (docs/i18n.md).
 */
type SupplierContext = { sessionId?: string | null; userId?: string | null; anonId?: string | null; language?: string };

export function getSupplier(context: SupplierContext = {}): SupplierAdapter {
  const apiKey = process.env.LITE_API_KEY;
  if (!apiKey) throw new Error('LITE_API_KEY is not set');
  if (context.sessionId || context.userId || context.anonId || (context.language && context.language !== 'en')) return build(apiKey, context);
  instance ??= build(apiKey, {});
  return instance;
}

function build(apiKey: string, context: SupplierContext): SupplierAdapter {
  return createLiteApiAdapter({
    apiKey,
    language: context.language,
    meter: async (event) => {
      await logUsage({
        provider: event.provider,
        latencyMs: event.latencyMs,
        success: event.success,
        errorMessage: event.errorMessage,
        costMicrocents: event.costMicrocents,
        meta: event.meta,
        sessionId: context.sessionId ?? null,
        userId: context.userId ?? null,
        anonId: context.anonId ?? null,
      });
    },
  });
}
