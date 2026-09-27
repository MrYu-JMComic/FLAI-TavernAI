import { buildCastChangePlanJsonSchema } from '../../domain/cast/changePlan.js';
import { CAST_AUTO_SYNC_OPERATIONS, CAST_PLAN_LIMITS } from '../../domain/cast/constants.js';

const schemaCache = new Map();

function autoSyncPlanSchemaFor(allowedOperations) {
  const operations = Array.isArray(allowedOperations) && allowedOperations.length
    ? CAST_AUTO_SYNC_OPERATIONS.filter((name) => allowedOperations.includes(name))
    : [...CAST_AUTO_SYNC_OPERATIONS];
  const key = operations.join(',');
  if (!schemaCache.has(key)) {
    schemaCache.set(key, buildCastChangePlanJsonSchema({
      allowedOperations: operations,
      maxOperations: CAST_PLAN_LIMITS.auto_sync,
      requireEvidence: false,
    }));
  }
  return schemaCache.get(key);
}

export function buildCastProjectionMessages({ observation, castSnapshot, allowedOperations }) {
  const autoSyncPlanSchema = autoSyncPlanSchemaFor(allowedOperations);
  return [
    {
      role: 'system',
      content: [
        'Analyze one completed story turn and return exactly one CastChangePlanV1 JSON object.',
        'OUTPUT CONTRACT (mandatory):',
        'Output exactly one raw JSON object and nothing else.',
        'The first non-whitespace character must be { and the last non-whitespace character must be }.',
        'Never wrap the JSON in Markdown fences, XML tags, quotes, or any other container.',
        'Do not add comments, explanations, prefixes, or suffixes.',
        'Use double-quoted JSON keys and strings. Do not use trailing commas, undefined, or NaN.',
        'The top-level object must contain exactly the keys "version", "summary", and "operations".',
        'Use only fields allowed by contract.jsonSchema.',
        'Do not use function calls, tool calls, SQL fields, conversation IDs, or audit actors.',
        'Record facts explicitly narrated as already occurring by either participant, including user-authored actions for their own character. Do not exclude evidence merely because the user wrote it.',
        'Plans, wishes, attempts, hypotheses, and requests are not their successful outcomes. Label evidence.kind as fact, intent, or hypothesis. Intent and hypothesis may only create or update memories with the matching memoryType; they cannot change completed-event state.',
        'Use stable member IDs when present. Create an NPC only when the turn clearly establishes a named non-protagonist character.',
        'Include evidence.messageId and a short supporting quote when the source is clear. If the provider cannot quote exactly, omit evidence rather than dropping a clear memory or behavior update.',
        'Never hide or delete records, rename established members, alter aliases, change memory sealing, or rewrite historical memories.',
        'Memory responsibility: create only character-specific memories of events that this member witnessed, was told, or explicitly knows. An event occurring elsewhere does not grant every member knowledge of it.',
        'Do not copy user interaction preferences or global story summaries into character memories. Conversation-memory extraction owns those records; it does not authorize cast writes.',
        'Record concrete actions, short events, promises, preferences, and changes in relationships even when ordinary or brief. A meaningful event may update state and also create a memory. Do not require dramatic importance or repeated confirmation.',
        'Intent evidence may create a planned behavior with a trigger condition; it must not change location, appearance, or ownership as if completed.',
        'Return {"version":1,"summary":"...","operations":[]} when nothing changed.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        contract: {
          name: 'CastChangePlanV1',
          jsonSchema: autoSyncPlanSchema,
          format: {
            mediaType: 'application/json',
            rawObjectOnly: true,
            requiredTopLevelKeys: ['version', 'summary', 'operations'],
            example: { version: 1, summary: 'No safe changes', operations: [] },
          },
          rules: [
            'For member references, provide exactly one of memberId or name.',
            'For item.transfer, provide exactly one destination: memberId, memberName, or nodeId.',
            'Evidence should refer to the supplied observation when present; missing evidence is allowed for a clear, local update.',
          ],
        },
        observation,
        currentCast: castSnapshot,
      }),
    },
  ];
}
