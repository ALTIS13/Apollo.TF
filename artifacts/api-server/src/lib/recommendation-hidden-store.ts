import { db, recommendationHiddenTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

export interface HiddenRecommendationInput {
  readonly accountId: string;
  readonly trackId: string;
}

export async function loadHiddenTrackIds(accountId: string): Promise<readonly string[]> {
  const rows = await db.select({ trackId: recommendationHiddenTable.trackId })
    .from(recommendationHiddenTable)
    .where(eq(recommendationHiddenTable.accountId, accountId));
  return rows.map((row) => row.trackId);
}

export async function hideRecommendation(input: HiddenRecommendationInput): Promise<void> {
  await db.insert(recommendationHiddenTable).values(input).onConflictDoNothing({
    target: [recommendationHiddenTable.accountId, recommendationHiddenTable.trackId],
  });
}

export async function restoreRecommendation(input: HiddenRecommendationInput): Promise<void> {
  await db.delete(recommendationHiddenTable).where(and(
    eq(recommendationHiddenTable.accountId, input.accountId),
    eq(recommendationHiddenTable.trackId, input.trackId),
  ));
}

export async function clearHiddenRecommendations(accountId: string): Promise<void> {
  await db.delete(recommendationHiddenTable).where(eq(recommendationHiddenTable.accountId, accountId));
}
