import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTfAuth } from "@/auth/tf-auth";
import { validatePlaylistImportInput, type ImportDraft, type ImportDraftInput, type ImportDraftSummary } from "@/lib/playlist-imports";
import { canUseTfProtectedActivity, captureTfSecurityGeneration, isCurrentTfSecurityGeneration, TfApiError, tfFetch } from "@/lib/tf-session-client";

type ImportOwner = readonly [accountId: string, installationId: string];
const importsPath = "/collections/imports";
const importIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const importsKey = (owner: ImportOwner | null) => ["tf", "playlist-imports", owner?.[0] ?? null, owner?.[1] ?? null] as const;

function draftPath(id: string) {
  if (!importIdPattern.test(id)) throw new Error("invalid_import_id");
  return `${importsPath}/${id}`;
}

export function usePlaylistImportAccess() {
  const { status, session, hasEntitlement } = useTfAuth();
  const owner: ImportOwner | null = status === "authenticated" && session && hasEntitlement("tf.collections")
    ? [session.accountId, session.installationId]
    : null;
  function requireCurrent() {
    if (!owner || !canUseTfProtectedActivity(session)) {
      throw new TfApiError(403, "collection_session_changed", "forbidden");
    }
    return owner;
  }
  return { status, owner, requireCurrent };
}

export function usePlaylistImports() {
  const access = usePlaylistImportAccess();
  return useQuery({
    queryKey: importsKey(access.owner),
    enabled: access.owner !== null,
    queryFn: ({ signal }) => {
      access.requireCurrent();
      return tfFetch<{ imports: ImportDraftSummary[] }>(importsPath, { cache: "no-store", signal });
    },
    gcTime: 0,
    retry: false,
  });
}

export function usePlaylistImport(id: string | null) {
  const access = usePlaylistImportAccess();
  return useQuery({
    queryKey: [...importsKey(access.owner), id],
    enabled: access.owner !== null && !!id,
    queryFn: ({ signal }) => {
      access.requireCurrent();
      return tfFetch<{ draft: ImportDraft }>(draftPath(id ?? ""), { cache: "no-store", signal });
    },
    gcTime: 0,
    retry: false,
  });
}

export function useSavePlaylistImport() {
  const access = usePlaylistImportAccess();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: ImportDraftInput }) => {
      const owner = access.requireCurrent();
      const generation = captureTfSecurityGeneration();
      const body = JSON.stringify(validatePlaylistImportInput(input));
      await tfFetch<unknown>(draftPath(id), { method: "PUT", headers: { "Content-Type": "application/json" }, body });
      if (isCurrentTfSecurityGeneration(generation)) {
        await client.invalidateQueries({ queryKey: importsKey(owner) });
      }
    },
    gcTime: 0,
    retry: false,
  });
}

export function useDeletePlaylistImport() {
  const access = usePlaylistImportAccess();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const owner = access.requireCurrent();
      const generation = captureTfSecurityGeneration();
      await tfFetch<void>(draftPath(id), { method: "DELETE" });
      if (isCurrentTfSecurityGeneration(generation)) {
        await client.invalidateQueries({ queryKey: importsKey(owner), exact: true });
      }
    },
    gcTime: 0,
    retry: false,
  });
}
