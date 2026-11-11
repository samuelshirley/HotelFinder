import 'server-only';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { chatHistory, CHAT_KINDS } from '@/server/db/schema';

export type ChatMessage = typeof chatHistory.$inferSelect;
export type ChatKind = (typeof CHAT_KINDS)[number];

/** The only kinds a model is ever shown. Forms, receipts and the payment row are not among them. */
export const MODEL_VISIBLE_KINDS: readonly ChatKind[] = ['user', 'ai'];

export async function appendMessage(input: {
  sessionId: string;
  turnId?: string | null;
  role: ChatMessage['role'];
  kind: ChatKind;
  content: string;
  meta?: Record<string, unknown> | null;
}): Promise<ChatMessage> {
  const [row] = await db.insert(chatHistory).values(input).returning();
  return row;
}

/** Everything, oldest first: what the client renders. */
export async function listMessages(sessionId: string): Promise<ChatMessage[]> {
  return db
    .select()
    .from(chatHistory)
    .where(eq(chatHistory.sessionId, sessionId))
    .orderBy(asc(chatHistory.createdAt), asc(chatHistory.id));
}

/** The tail of the conversation a model may read, oldest first. */
export async function listModelVisibleTail(sessionId: string, limit: number): Promise<ChatMessage[]> {
  const rows = await db
    .select()
    .from(chatHistory)
    .where(and(eq(chatHistory.sessionId, sessionId), inArray(chatHistory.kind, [...MODEL_VISIBLE_KINDS])))
    .orderBy(desc(chatHistory.createdAt), desc(chatHistory.id))
    .limit(limit);
  return rows.reverse();
}
