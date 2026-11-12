import { db, playlistImportSelectionsTable as selections, type PlaylistImportDraftEntry } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

export type PlaylistImportSelection = {
  readonly candidateId: string;
  readonly evidenceRevision: string;
  readonly selectedAt: string;
};

type SelectionInput = Pick<PlaylistImportSelection, "candidateId" | "evidenceRevision">;

// The caller supplies the verified TF account ID, never a provider identity.
export type PlaylistImportSelectionStore = {
  get(accountId: string, draftId: string, position: number): Promise<PlaylistImportSelection | null>;
  put(
    accountId: string, draftId: string, position: number, input: SelectionInput, expectedEntry: PlaylistImportDraftEntry,
  ): Promise<PlaylistImportSelection | null>;
};

const selectionInput = z.object({
  candidateId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  evidenceRevision: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

type SelectionRow = SelectionInput & { selectedAt: Date | string };

function toSelection(row: SelectionRow | undefined): PlaylistImportSelection | null {
  if (!row) return null;
  const selectedAt = typeof row.selectedAt === "string" ? new Date(row.selectedAt) : row.selectedAt;
  return { ...row, selectedAt: selectedAt.toISOString() };
}

function validPosition(position: number): boolean {
  return Number.isInteger(position) && position >= 0 && position < 200;
}

export const defaultPlaylistImportSelectionStore: PlaylistImportSelectionStore = {
  async get(accountId, draftId, position) {
    if (!validPosition(position)) return null;
    const [row] = await db.select({
      candidateId: selections.candidateId,
      evidenceRevision: selections.evidenceRevision,
      selectedAt: selections.selectedAt,
    }).from(selections).where(and(
      eq(selections.accountId, accountId),
      eq(selections.importId, draftId),
      eq(selections.position, position),
    ));
    return toSelection(row);
  },

  async put(accountId, draftId, position, input, expectedEntry) {
    if (!validPosition(position)) return null;
    const { candidateId, evidenceRevision } = selectionInput.parse(input);
    return db.transaction(async (tx) => {
      // Share the draft store's lock so delete-and-recreate cannot change the parent under this write.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('tf:playlist-import-drafts:' || ${accountId}::uuid::text, 0))`);
      const result = await tx.execute<SelectionRow>(sql`
        insert into public.playlist_import_selections as stored
          (account_id, import_id, position, candidate_id, evidence_revision)
        select draft.account_id, draft.id, ${position}::integer, ${candidateId}::text, ${evidenceRevision}::text
        from public.playlist_import_drafts as draft
        where draft.account_id = ${accountId}::uuid and draft.id = ${draftId}::uuid
          and ${position}::integer < jsonb_array_length(draft.entries)
          and draft.entries -> ${position}::integer = ${JSON.stringify(expectedEntry)}::jsonb
        on conflict (account_id, import_id, position) do update set
          candidate_id = excluded.candidate_id,
          evidence_revision = excluded.evidence_revision,
          selected_at = case
            when stored.candidate_id = excluded.candidate_id and stored.evidence_revision = excluded.evidence_revision
              then stored.selected_at
            else greatest(clock_timestamp(), stored.selected_at + interval '1 millisecond')
          end
        returning candidate_id as "candidateId", evidence_revision as "evidenceRevision", selected_at as "selectedAt"
      `);
      return toSelection(result.rows[0]);
    }, { isolationLevel: "read committed" });
  },
};
