# Character Memory Workbench API

Date: 2026-11-01. Execution reference:
[`memory-character-workflow-upgrade-plan.md`](memory-character-workflow-upgrade-plan.md).

Read `AGENTS.md`, the execution reference, `conversation-memory-v1-plan.md`,
`conversation-memory-v1-impact-analysis.md` and
`memory-packet-contract-fix-plan.md` before extending this transport. The
canonical commit/retrieval/checkpoint contracts remain authoritative.

## Character inspection

All paths use the existing authenticated `/api` router and require ownership
of the conversation. GET requests return `Cache-Control: no-store` and never
create actors or fabricate historical events.

| Method | Path after `/api/conversations/:id/memory-state` | Behavior |
| --- | --- | --- |
| GET | `/actors` | List native active actor entities and exact record counts. Optional `query` searches canonical names and aliases. |
| GET | `/actors/:actorId` | Return the target's `memories`, `events`, `relations` and `items`. |
| POST | `/actors/:actorId/records/batch` | Append 1-80 author records in one canonical transaction. |
| PATCH | `/actors/:actorId/records/:memoryId` | Append a version replacing only the selected record's text. |

The path's `actorId` selects the author's dossier target. An optional
`viewerActorId` query selects a strict knowledge perspective and is separate
from the existing general workbench's `actorId` query. A strict viewer may
inspect only its own dossier. False beliefs use the actor's belief text;
author claims, original evidence and other actors' dossiers are excluded.

Both GETs accept `asOfMessageId`, `beforeCutoff` or `asOfOrder` through the
existing verified checkpoint resolver. Entities, aliases, events and counts
follow that commit lineage. Historical scene quantities come from its
checkpoint, and the response's `revision` is the checkpoint's memory revision.
Missing checkpoints or invalid history fail closed.

List responses are `{version:1,revision,actors}`. Each actor has `id`, `name`,
`canonicalName`, `aliases`, `castKey`, `origin` and
`counts:{memories,events,relations,items}`. The known `main-character` cast key
identifies the native card actor; arbitrary extraction cast keys are story
actors. Existing conversations without enrolled canonical actors return an
empty list until an authorized write enrolls them.

Dossier responses also contain `actor`, the four sections, full `counts` and
`pagination:{offset,limit,hasMore}`. `offset` defaults to 0; `limit` defaults to
200 and is bounded to 1-500. Each section applies the same offset and limit;
`hasMore` means at least one section has another page. Counts and selection
iterate the complete eligible log rather than truncating at 1,000 records.

Associations use exact entity references: event subject, participants and
audience; current non-unknown knowledge; claim endpoints; or plot-thread
owner. Mentioning a name in prose does not create an association. Same-name
entities remain separate.

Relationships are current canonical claims connecting two actors and include
`direction`, `subjectId`, `objectId`, names, `predicate`, `value`, truth,
modality and validity interval. Possessions require a positive assertion to
an object with an explicit possession predicate. Observing an object does not
make it an asset. Structured claim quantities remain optional; prose is not
parsed into a number.

An item links an authoritative scene object only when its source event has
exactly one possession claim and one typed `scene_object`/`scene_item`
receipt, with an existing owned scene record. Ambiguous receipts remain
narrative records. The API creates no inventory, currency account or quantity
ledger. Item fields distinguish `source`, `recordId`, `recordRevision` and
`authoritative` so callers can show the provenance.

## Bounded author changes

Batch body:

```json
{
  "expectedRevision": 4,
  "idempotencyKey": "author-generated-request-key",
  "records": [
    { "content": "Mira returned to the inn.", "kind": "event" }
  ]
}
```

Each record permits only `content`, `kind`, `visibility`, `truthStatus`,
`layer`, `confidence`, `importance`, `emotionalIntensity`, `participants`,
`actorIds` and `narrativeTime`. Content is 1-5,000 characters; unit weights are
0-1; references are bounded arrays of exact currently visible actor IDs in
this conversation. The server fixes the subject to the path actor. Restricted
visibility requires a nonempty explicit audience. Unknown fields and any
invalid row reject the whole batch before a commit. No model extraction or
embedding call occurs synchronously.

Text patch body:

```json
{
  "expectedRevision": 5,
  "revision": 2,
  "eventId": "the-current-canonical-event-id",
  "content": "Corrected wording of the same event.",
  "idempotencyKey": "another-author-request-key"
}
```

Both the global memory revision and the selected event/memory revision must
match. The record must be associated with the selected actor. A text patch
preserves subject, participants, audience, privacy, type, layer, temporal
claims (including future/expired intervals), current knowledge, false-belief
content, plot-thread identity/status and typed domain receipts. It does not
interpret new prose into a new structured assertion. Semantic changes to
claims or knowledge use the existing structured author packet API.

The existing all-memories reviewer shares the same typed inheritance helper
for text, confidence and pin changes. Unchanged subject text retains the exact
old entity ID, including when actors have identical names. Plain review edits
that change a structured record's subject, event type, truth or audience fail
with `MEMORY_STRUCTURED_SCOPE_CHANGED` and require a structured correction.
Merges involving typed dependents fail with `MEMORY_STRUCTURED_MERGE_UNSAFE`
when an earlier legacy scope guard has not already rejected them. Disabling,
invalidating or deleting records does not copy their graph facts into the new
inactive version; confirming a previously invalidated record does not restore
discarded claims implicitly.

The prior event and source evidence remain immutable. The new wording gets
author provenance; old source quotes are not presented as evidence for the
new wording. Canonical acceptance advances one revision and queues derived
work through the existing transaction/outbox. It does not advance processed
turn coverage.

An exact retry returns the original receipt with `duplicate:true`, even after
the revision has advanced. Reusing its key with different normalized content
returns 409. A key belonging to a discarded future also returns 409; callers
must refresh the selected history and use a new key. Actor requests reject
unknown fields and do not accept arbitrary packet actions.

## Verification

`backend/src/tests/memoryActors.test.js` covers exact same-name identity,
aliases, graph ownership, unknown knowledge, strict false beliefs, scene
receipts and ambiguity, historical quantities and revision, discarded future,
all-or-nothing batches, stale and conflicting retries, preserved patch
associations, more than 1,000 records, pagination and HTTP transport.
Legacy review and real branch-copy tests also verify graph preservation,
semantic edit/merge protection, non-revival after invalidation, and remapping
of actor and scene-record references.

Run `node --test src/tests/memoryActors.test.js` from `backend`, then the
memory V1, integration, recovery, operations and packet-contract suites.
Repository-wide acceptance, encoding/whitespace checks and frontend visual
verification are tracked in the execution reference.
