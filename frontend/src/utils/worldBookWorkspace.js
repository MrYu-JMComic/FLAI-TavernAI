export function createWorldBookApplyRequestId() {
  // getRandomValues is also available on HTTP origins used by LAN deployments.
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

// Rebase only applied targets; unchecked drafts remain available for follow-up.
export function rebaseWorldBookWorkspace(workspace, appliedBooks = []) {
  if (!workspace) return null;
  const applied = new Map(appliedBooks.map(item => [item.ref, item.book]));
  const refMap = new Map();
  const targets = (workspace.targets || []).map(target => {
    const book = applied.get(target.ref);
    if (!book) return target;
    const ref = `existing:${book.id}`;
    refMap.set(target.ref, ref);
    return {
      ref,
      bookId: book.id,
      baseRevision: book.revision,
      profile: { name: book.name, description: book.description, scanDepth: book.scanDepth, lorebookContextPercent: book.lorebookContextPercent },
      linkedCharacterCount: book.linkedCharacters?.length || 0,
      entryCount: book.entries?.length ?? book.entryCount ?? 0,
      profilePatch: {},
      upserts: [],
      removals: []
    };
  });
  return { ...workspace, targets, activeRef: refMap.get(workspace.activeRef) || workspace.activeRef };
}

export function worldBookApplyRequest(changes) {
  // UI-only fields do not affect the saved transaction or its idempotency hash.
  return changes.map(change => ({
    ref: change.ref,
    bookId: change.bookId || null,
    ...(change.baseRevision ? { baseRevision: change.baseRevision } : {}),
    profile: change.profile || {},
    ...(change.bookId ? {
      upserts: (change.upserts || []).map(entry => ({ ...(entry.entryId ? { entryId: entry.entryId } : { localId: entry.localId }), patch: entry.patch })),
      removals: (change.removals || []).map(entry => typeof entry === 'string' ? entry : entry.entryId)
    } : { entries: change.entries || [] })
  }));
}
