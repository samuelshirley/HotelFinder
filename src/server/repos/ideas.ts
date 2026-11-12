import 'server-only';
import { desc } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { ideas } from '@/server/db/schema';

export type Idea = typeof ideas.$inferSelect;

/** Something a user asked for that the app cannot do yet, in a few words. */
export async function insertIdea(input: { sessionId: string; userId: string | null; text: string }): Promise<Idea> {
  const [row] = await db.insert(ideas).values(input).returning();
  return row;
}

export async function listIdeas(limit = 100): Promise<Idea[]> {
  return db.select().from(ideas).orderBy(desc(ideas.createdAt)).limit(limit);
}
