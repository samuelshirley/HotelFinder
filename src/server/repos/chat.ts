import 'server-only';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

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

/**
 * Penny's line for a header-chip edit (a filter, the nationality, the dates…).
 * A run of chip edits keeps ONE line: if the newest message in the chat is
 * already a chip line it is rewritten to the latest change, otherwise a new
 * line is added. So stepping through ten filters leaves one up-to-date line,
 * not ten; a typed message in between starts a fresh one. The per-session
 * advisory lock makes two overlapping edits (arrow keys on a select) agree on
 * which row is the newest, so a race cannot add a second line.
 */
export async function upsertChipLine(sessionId: string, content: string): Promise<ChatMessage> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`chip:${sessionId}`}))`);
    const [last] = await tx
      .select()
      .from(chatHistory)
      .where(eq(chatHistory.sessionId, sessionId))
      .orderBy(desc(chatHistory.seq))
      .limit(1);
    if (last && last.role === 'assistant' && last.kind === 'line' && last.meta?.by === 'chip') {
      const [row] = await tx.update(chatHistory).set({ content }).where(eq(chatHistory.id, last.id)).returning();
      return row;
    }
    const [row] = await tx.insert(chatHistory).values({ sessionId, role: 'assistant', kind: 'line', content, meta: { by: 'chip' } }).returning();
    return row;
  });
}

/** Everything, oldest first: what the client renders. */
export async function listMessages(sessionId: string): Promise<ChatMessage[]> {
  return db
    .select()
    .from(chatHistory)
    .where(eq(chatHistory.sessionId, sessionId))
    .orderBy(asc(chatHistory.seq));
}

/** The tail of the conversation a model may read, oldest first. */
export async function listModelVisibleTail(sessionId: string, limit: number): Promise<ChatMessage[]> {
  const rows = await db
    .select()
    .from(chatHistory)
    .where(and(eq(chatHistory.sessionId, sessionId), inArray(chatHistory.kind, [...MODEL_VISIBLE_KINDS])))
    .orderBy(desc(chatHistory.seq))
    .limit(limit);
  return rows.reverse();
}
