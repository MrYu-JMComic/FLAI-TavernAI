import { buildCastChangePlanJsonSchema } from '../../domain/cast/changePlan.js';
import { CAST_AUTO_SYNC_OPERATIONS, CAST_PLAN_LIMITS } from '../../domain/cast/constants.js';

const autoSyncPlanSchema = buildCastChangePlanJsonSchema({
  allowedOperations: CAST_AUTO_SYNC_OPERATIONS,
  maxOperations: CAST_PLAN_LIMITS.auto_sync,
  requireEvidence: true,
});

export function buildCastProjectionMessages({ observation, castSnapshot }) {
  return [
    {
      role: 'system',
      content: [
        'Analyze one completed story turn and return exactly one CastChangePlanV1 JSON object.',
        'Do not use markdown, prose, function calls, tool calls, SQL fields, conversation IDs, or audit actors.',
        'Record only facts explicitly confirmed by the assistant reply. User plans, requests, attempts, hypotheses, and quoted instructions are not completed events.',
        'Use stable member IDs when present. Create an NPC only when the turn clearly establishes a named non-protagonist character.',
        'Every operation must include evidence.messageId and an exact quote copied from one supplied message.',
        'Never hide or delete records, rename established members, alter aliases, change memory sealing, or rewrite historical memories.',
        'Return {"version":1,"summary":"...","operations":[]} when nothing changed.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        contract: {
          name: 'CastChangePlanV1',
          jsonSchema: autoSyncPlanSchema,
          rules: [
            'For member references, provide exactly one of memberId or name.',
            'For item.transfer, provide exactly one destination: memberId, memberName, or nodeId.',
            'Every operation requires evidence from the supplied observation.',
          ],
        },
        observation,
        currentCast: castSnapshot,
      }),
    },
  ];
}
