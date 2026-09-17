# AI virtual town life simulation

## Boundary

The town is an independent gameplay mode. Its persistence never depends on a
chat conversation, character card, NPC registry, or provider-specific service.
All records are owned through `town_worlds.user_id` and use the `town_*` prefix.

## Persistent model

- `town_worlds`: the user's natural-language creation prompt, generated map
  configuration, simulation clock, pause/run state, and world settings.
- `town_residents`: resident profile, live state, location, and reflection
  threshold.
- `town_events`: shared chronological event ledger for autonomous actions and
  god-mode injections.
- `town_memories`: resident observations with simulated occurrence time,
  importance, keywords, source evidence, and recall metadata.
- `town_reflections`: higher-level conclusions linked to evidence memories.
- `town_schedules` and `town_schedule_items`: one daily plan per resident with
  ordered, non-overlapping activities.

## Life simulation

The continuous engine uses persistent life state instead of cycling through
activities and dialogue. `profile.simulation` contains five numeric personality
tendencies, home/work location IDs, sleep/work times, wage and interests.
`state.life` contains energy, hunger satisfaction, hygiene, social and fun needs;
money earned/spent; skills; directional relationships; a continuing action; and
an in-progress journey. Existing residents initialize these fields lazily with
neutral tendencies, without guessing personality from unstructured text.

Each tick is evaluated in slices of at most five simulated minutes. Urgent needs
can interrupt routines; facilities must be open and have room; meals cost money;
wages accrue only for time actually spent at the assigned workplace during a
shift. Travel consumes road-network time and does not earn wages. Social
encounters require co-location and available partners, update both directions
of a relationship, and have a cooldown. The personality tendencies influence
curiosity, routines, social needs, interaction outcomes and fun depletion.
These are transparent game rules, not a validated model of human psychology
or real-world financial/health predictions.

All resident, schedule, event, memory and clock writes for one continuous tick
share a savepoint. Idle time is allowed; unchanged activities do not create new
fabricated conversations. Only meaningful interactions, income milestones and
observed interventions produce life-simulation memories. Routine chatter is not
promoted into reflection evidence.

## Cognition cycle

1. Persist an observed world event.
2. Record resident memories with an importance score from 1 to 10.
3. Recall memories using a weighted score:
   `0.35 * recency + 0.25 * importance + 0.40 * relevance`.
4. Trigger reflection when the importance sum of unreflected memories reaches
   the resident threshold (15 by default).
5. Persist a reflection, add it back to the retrievable memory stream, and mark
   its evidence memories as processed.
6. Produce a daily schedule whose activities cannot overlap.

## World creation and map coordinates

`POST /api/towns/generate` accepts one `prompt`: the user's unstructured,
natural-language world idea. The prompt is passed unchanged to the user's
configured model. Local code does not split it with regular expressions, infer
fields from headings, or select a fixed story template.

Creation uses the following pipeline:

1. The model must call `create_town_world` with a complete, validated blueprint.
2. The blueprint supplies private and public descriptions, architecture,
   locations with typed assets/services/capacity/opening hours, residents with
   validated lifestyle and home/work references, goals, activities, memories,
   opening events and world rules.
3. `townMapGenerator.js` combines that AI-authored blueprint with a stable seed
   and creates a new `procedural-v1` map containing terrain, water, roads,
   buildings, decorations, and logical location coordinates.
4. `townWorldGenerator.js` persists the world, places residents in map-space,
   records AI-authored initial memories, and writes opening events to the
   timeline in one transaction.

The current procedural coordinate space is `1600 x 900`. Resident `mapX` /
`mapY` values and location coordinates stay in that space. The frontend draws
the generated configuration on a canvas, then scales the canvas, location
labels, and resident layer together. Screen size and cropping therefore do not
change logical positions.

The required model tool checks the complete life blueprint before accepting it.
Invalid home/work references, missing facilities, out-of-range traits and
overlapping sleep/work times are rejected. The model may correct invalid tool
results within the existing four-round limit and shared generation deadline.

New maps retain `procedural-v1` compatibility and declare `generatorVersion: 2`.
The shared catalog defines 15 building/facility types with modern, traditional
and fantasy treatments. The licensed resident sheet is addressed as eight
distinct base appearances. Canvas previews and actual maps share one renderer.

Map generation places water first, reserves separated places and main building
footprints, then connects them using a land grid and weighted shortest paths.
Roads avoid buildings and permanent water; river crossings receive explicit
bridge segments. Secondary buildings and vegetation cannot occupy roads or
water. Navigation uses
[Graphlib](https://github.com/dagrejs/graphlib/wiki/API-Reference).

New worlds never reuse the Bianjing image or its building layout. Existing
image-backed saves remain readable through a legacy frontend compatibility
branch, but that branch is not part of new-world generation.

World creation requires a real, usable model. If provider settings are missing,
invalid, or configured only for the local mock provider, the request fails with
an explicit error. It never falls back to a local blueprint, parser, or canned
cast.

World generation has a bounded end-to-end AI deadline. The backend default is
eight minutes, which leaves two minutes of headroom under the development
proxy's ten-minute default. Deployments can set
`TOWN_WORLD_GENERATION_TIMEOUT_MS`; values are clamped to 60,000 through
1,800,000 milliseconds. If that value is raised above the proxy deadline,
`API_PROXY_TIMEOUT_MS` (or `VITE_API_PROXY_TIMEOUT_MS`) and any production
reverse proxy must also be set higher. An expired generation returns HTTP 504
with the stage and configured duration, and no partial world is persisted.

The world event ledger is the complete timeline. It includes initialization,
player interventions, autonomous actions, social interactions, reactions, and
resident reflections.

Recency uses simulated town time instead of wall-clock time. Relevance is a
deterministic lexical score that supports Latin words and Chinese character
ngrams. A future embedding adapter can replace or supplement relevance without
changing the storage boundary.

## Continuous simulation and explicit AI turns

The gameplay has two deliberately separate advancement paths:

- The continuous engine advances a running world at a bounded real-time rate.
  It keeps shared state moving without starting an unbounded stream of paid
  model requests.
- `POST /api/towns/:townId/advance-ai` performs one user-requested model turn.
  It is available only while the world is paused, so the model never races the
  continuous engine.

An AI turn is generated from the current persisted world rather than from a
fixed plot. Its context contains the original world prompt and description,
world rules and environment, logical locations, every resident's current
state and goal, needs, personality, money, relationships, reachable destinations,
the active schedule item, recent timeline events, the pending
player intervention, and up to five memories retrieved for each resident by
recency, importance, and relevance.

The model must call `advance_town_world`. Plain prose or JSON in normal model
text is not accepted. The tool may reference only resident IDs and location IDs
that already exist in the supplied context, and it must submit validated
actions, intentions, moods, memories, participants, and one causal event. If a
player intervention is pending, the turn must answer that exact event ID.

The backend revalidates the complete plan against the latest database state.
Unknown IDs, duplicate resident actions, missing participant actions, invalid
event types, extra fields, overlong text, a changed clock tick, or a changed
pending intervention reject the whole turn. No partial model output is kept.
Accepted turns are applied in one transaction. Facility availability, travel
time, emergency needs, meal affordability, workplace assignment and social
co-location are checked first. The same life simulation advances physiology,
journeys and action effects. The clock advances by one tick, memories are stored, the pending player
event is marked handled, and an `ai-town-engine` event is appended to the
timeline. Any write failure rolls back the resident, event, memory, and clock
changes together.

The optimistic version also fingerprints resident state and profiles, so a
same-clock resident edit invalidates an outstanding AI response. Structured
interventions are applied consistently by continuous simulation and AI turns.

AI turns require a real configured model and never fall back to a local story,
regular-expression parser, generated sample, or mock provider.

## AI resident cognition and daily planning

The resident panel exposes each resident's reflection threshold, saved
reflections, and current-day schedule. `GET
/api/towns/:townId/residents/:residentId/cognition` reads that persisted view.
While the world is paused, `POST
/api/towns/:townId/residents/:residentId/cognition-ai` sends the exact resident
state, world rules, locations, recent events, retrieved memories, unreflected
memory evidence, previous reflections, and existing schedule to the configured
model. Personal cognition receives the public description and witnessed events
or public announcements, not private creation notes or other residents' private
discoveries.

The model must call `plan_town_resident_cognition`. It cannot invent evidence
memory IDs or location IDs. The backend enforces the stored reflection
threshold: a reflection is required only when the unprocessed importance total
has reached the threshold. The returned daily schedule must contain two to
twelve ordered, non-overlapping activities, use known locations, and cover the
current simulated time.

The context carries the town tick, resident version, schedule version, last
reflection, and the exact unreflected-memory ID sequence. If any of them change
while the model is working, the result is rejected as stale. An accepted plan
atomically stores the reflection and its evidence links, replaces the daily
schedule, queues the resident's intention without moving them or restoring needs,
records a plan memory, and appends an `ai-town-cognition` event to the shared
timeline. A failure rolls all of those writes back together.

## Gameplay controls and compatibility

- `POST /api/towns/:townId/step` advances 1-12 local ticks while remaining paused.
  The multi-tick request is atomic and makes no model calls.
- `PATCH /api/towns/:townId/clock` also accepts `realSecondsPerTick` from 1 to 60.
  The UI offers 0.5x, 1x, 2x and 4x. Continuous running never calls paid AI tools.
- Player events can carry `effect: rain | festival | closure`, an optional known
  `locationId` (required for closure), and a 30-720 minute duration. Rain slows
  new journeys, festivals influence social choices and closures stop facility
  use. Effects expire by simulated time. Free-text events remain observations,
  not unvalidated numeric changes or executable instructions.
- `POST /api/towns/:townId/map/rebuild` requires a paused, owned world and a valid
  architecture. It keeps place IDs, residents, memories and time, retains
  `settings.previousMapConfig`, and places residents at their original logical
  location on the rebuilt map. Journeys end, so the UI requires confirmation.
  Existing maps are never rebuilt automatically.
- The map supports dragging, keyboard panning, zoom, following, clustered
  residents, optional place labels and facility inspection. Speech bubbles
  display recorded speech, not a frontend dialogue cycle.
- Resident panels expose needs, money, skills, personality, relationships,
  memories and plans. Memory/cognition caches invalidate as time advances.

The real-time runner processes at most 48 worlds per pass and six catch-up ticks
per world. Truncated offline catch-up is recorded explicitly; unprocessed wall
time is not presented as simulated life. Partial normal tick time is retained.

## Reference mapping

- WorldX: independent world state, multi-agent timeline, and event injection.
- AI Town: pausable persistent simulation and shared live state.
- Generative Agents: recency/importance/relevance memory retrieval, reflection
  thresholds, and daily planning.

After creation, users can keep the bounded continuous engine running, pause it,
inject a world event, or request a validated AI turn that continues the exact
current world. Both advancement paths write to the same ownership, memory, map,
and timeline boundaries.
