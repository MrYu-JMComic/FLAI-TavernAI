# Chat Page Runtime

This note documents the single-role chat page. Server messages remain the source
of truth; browser caches are disposable and never replace server records.

## Ownership And Data Flow

1. `ChatView` loads a conversation and coordinates workspace operation locks.
2. `useChatConversation` reconciles fetched messages by ID. Equivalent rows keep
   their object references; changed rows use the complete server record, including
   removed fields. Equality uses `samePlainValue`, without serialized copies.
3. `useChatSubmit` owns requests and mutable local message drafts. Network chunks
   update only the current row. `useTypewriterText` owns the visible update cadence.
4. `MarkdownContent` sanitizes rich text and reconciles existing DOM. Text, plugin
   and streaming-state changes share one Vue post-flush watcher.
5. `VirtualMessageList` owns row identity and height measurement. `useChatScroll`
   owns reading anchors and the user's auto-follow intent.

## Rendering And Cache Rules

- More than 80 messages enables the existing TanStack virtualizer. Object keys
  survive local-to-server ID finalization; ID aliases also survive server refresh.
  Removed messages lose their ID aliases and cached measurements.
- Bottom jumps use existing measurements instead of resetting every row. Deferred
  corrections are invalidated by another jump, wheel/touch input, or unmount.
- Markdown keeps at most 200 settled renders, 8 MiB of estimated UTF-16 key/HTML
  text, and 512 KiB per entry. Cache hits refresh LRU order. Oversized renders still
  display normally. These are retained-text limits, not total browser heap limits.
- Streaming prefixes are sanitized and rendered but not cached. The final text is
  cached even when only the streaming flag changes. This preserves useful history
  entries during long replies. Fold plugins, code and KaTeX follow the same path.
- Only the row being edited receives the editing text prop, avoiding updates to
  every mounted message on each editor keystroke.

## Dialogue Presentation

- `highlightDialogue` defaults to true in the conversation's advanced settings.
  It controls message bodies, not generic Markdown previews or model reasoning.
  The setting previews immediately and persists through Save and Apply.
- `highlightDialogueQuotes` walks detached, sanitized text nodes and wraps only
  complete quote pairs. Newlines, paragraphs, emphasis and link labels can share
  a pair without changing their structure or attributes. Code, math and fold
  headings are excluded. Incomplete streaming quotes remain plain until closed.
- Nested pairs and common Tavern quote variants are supported. Unmatched inner
  marks cannot prevent a valid enclosing pair from closing. Matching is linear
  in text length; highlights never modify stored messages or cached HTML.
- `--chat-dialogue-color` has separate light/dark values checked for text contrast.
  The visual convention follows
  [SillyTavern's quote styling](https://github.com/SillyTavern/SillyTavern/blob/release/public/style.css)
  while using DOM traversal to support multiline Markdown.

## Draft And Reading State

- Text drafts use `sessionStorage` under `flai-chat-drafts:v1`, scoped by user ID
  and conversation ID. They survive reloads and navigation in the same tab, not a
  closed browser session. They are not sent to the server before submission.
- Writes are debounced for 250 ms and flushed on navigation, page hide, document
  hide, and cleanup. Submitted/erased text is removed immediately. No image data
  URLs or attachments are persisted by this cache.
- The cache retains up to 20 drafts for seven days, bounded to 512 Ki UTF-16 code
  units of serialized data. Old drafts are evicted first. Oversized active prompts
  are never truncated; storage denial or oversize shows a draft-not-cached status.
- Message scroll snapshots retain the existing message ID plus relative offset.
  Restoration runs after message layout, before optional status/swipe/branch API
  requests complete, so a slow auxiliary request cannot trigger a late jump.
  Anchor correction waits for three stable frames (at most 13 attempts), replaces
  pending virtual index jumps with exact offsets, and suppresses cache writes
  until restoration settles. User scroll intent cancels this work immediately.

## Operation Boundaries

- Sending acquires its lock before the first `nextTick`. Repeated clicks or Enter
  events cannot start another request or consume a newly typed draft.
- `sending` controls visible generation. `requestPending` stays true until abort
  and persisted-record reconciliation finish, even after the Stop button is used.
- Loading, active editing, message mutations, branch creation and swipe generation
  block send/continue. Generation and swipe work block message edit/delete/branch
  mutations. Copy and reading remain available. Existing request tokens still
  reject stale route/unmount completions.
- Swipe errors preserve the displayed version, release the lock and show the
  existing error notification. Initial conversation failures expose retry rather
  than presenting a failed request as an empty conversation.

## Verification

- Backend contract/runtime tests cover row reconciliation, operation locking,
  same-tick double-submit, stopped-request exclusivity and swipe error recovery.
- Frontend unit tests exercise mounted row identity, fold-state retention, deferred
  scroll cancellation, Markdown sanitization/cache behavior and draft storage.
- Browser tests cover long histories, scroll restoration, draft navigation/reload,
  slow auxiliary requests and desktop/mobile composer bounds.

No database schema, existing saved conversations, provider credentials, or image
storage is changed by this frontend work. Very large histories still fetch their
complete message payload; server pagination is outside this iteration.
