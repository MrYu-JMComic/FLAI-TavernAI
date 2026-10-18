// Drop the process-global world book trigger state table.
//
// `world_book_entry_state` held sticky / cooldown / delay windows keyed by entry
// only, so every conversation using the same world book shared one activation
// window. Migration 0013 introduced the conversation-scoped replacement
// (`conversation_world_book_state` + `conversation_world_book_clock`) and every
// runtime caller has passed a conversation id since; the global table has been
// dead weight behind a fallback branch that is now removed.
//
// The rows are not migrated: a global window cannot be attributed to any one
// conversation, and inventing an attribution would fabricate activation history.
// Conversations simply start their windows fresh, which is the same thing that
// happens for any conversation created after 0013.
export function migrateWorldBookGlobalStateRemoval(database) {
  database.exec('DROP TABLE IF EXISTS world_book_entry_state');
}
