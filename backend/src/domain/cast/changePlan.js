import { z } from 'zod';
import {
  CAST_AUTO_SYNC_OPERATIONS,
  CAST_OPERATION_NAMES,
  CAST_PLAN_LIMITS,
  CAST_SOURCE_KINDS,
} from './constants.js';
import { CastDomainError } from './errors.js';

const idSchema = z.string().trim().min(1).max(160);
const nameSchema = z.string().trim().min(1).max(120);
const shortText = z.string().max(500);
const longText = z.string().max(20_000);
const unitNumber = z.number().finite().min(0).max(1);
const revisionSchema = z.number().int().min(1).max(2_147_483_647);

const evidenceSchema = z.object({
  messageId: idSchema,
  quote: z.string().trim().min(1).max(1_000),
}).strict();

const memberRefSchema = z.object({
  memberId: idSchema.optional(),
  name: nameSchema.optional(),
}).strict().refine((value) => Boolean(value.memberId) !== Boolean(value.name), {
  message: 'Provide exactly one of memberId or name',
});

const memberCreateChangesSchema = z.object({
  aliases: z.array(nameSchema).max(24).optional(),
  status: z.string().max(80).optional(),
  customStatus: shortText.optional(),
  relationship: z.string().max(1_000).optional(),
  currentLocationLabel: shortText.optional(),
  currentSceneNodeId: idSchema.nullable().optional(),
  memorySealed: z.boolean().optional(),
}).strict();

const memberUpdateChangesSchema = memberCreateChangesSchema.extend({
  canonicalName: nameSchema.optional(),
  confidence: unitNumber.optional(),
  visibility: z.enum(['visible', 'hidden']).optional(),
  revision: revisionSchema.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: 'Member update must contain at least one change',
});

const memoryCreateChangesSchema = z.object({
  memoryType: z.string().max(80).optional(),
  content: longText.trim().min(1),
  layer: z.string().max(80).optional(),
  importance: unitNumber.optional(),
  emotionalIntensity: unitNumber.optional(),
  decayRate: unitNumber.optional(),
  lastReinforcedAt: z.string().max(80).nullable().optional(),
  reinforcementCount: z.number().int().min(0).max(1_000_000).optional(),
  forgottenAt: z.string().max(80).nullable().optional(),
  linkedMemoryIds: z.array(idSchema).max(32).optional(),
  sharedMemberIds: z.array(idSchema).max(32).optional(),
}).strict();

const memoryUpdateChangesSchema = memoryCreateChangesSchema.partial().extend({
  revision: revisionSchema.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: 'Memory update must contain at least one change',
});

const behaviorCreateChangesSchema = z.object({
  behaviorType: z.string().max(80).optional(),
  triggerCondition: z.string().max(2_000).optional(),
  action: z.string().trim().min(1).max(4_000),
  priority: z.number().int().min(-1_000).max(1_000).optional(),
  enabled: z.boolean().optional(),
}).strict();

const behaviorUpdateChangesSchema = behaviorCreateChangesSchema.partial().extend({
  revision: revisionSchema.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: 'Behavior update must contain at least one change',
});

const itemChangesSchema = z.object({
  itemCode: z.string().max(120).optional(),
  name: z.string().trim().min(1).max(500),
  description: z.string().max(8_000).optional(),
  state: z.record(z.string(), z.unknown()).optional(),
  position: z.record(z.string(), z.unknown()).optional(),
  movable: z.boolean().optional(),
  itemKind: z.string().max(80).optional(),
  quantity: z.number().int().min(0).max(1_000_000).optional(),
  clothingSlot: z.string().max(80).optional(),
  equipped: z.boolean().optional(),
  coverage: z.array(z.string().max(120)).max(32).optional(),
  iconKey: z.string().max(120).optional(),
  revision: revisionSchema.optional(),
}).strict();

const appearanceChangesSchema = z.object({
  summary: z.string().max(8_000).optional(),
  outfit: z.string().max(4_000).optional(),
  injuries: z.array(z.unknown()).max(64).optional(),
  transformations: z.array(z.unknown()).max(64).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  revision: revisionSchema.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: 'Appearance update must contain at least one change',
});

const operationMeta = {
  evidence: evidenceSchema.optional(),
  confidence: unitNumber.optional(),
};

const operationSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('member.create'),
    target: z.object({ name: nameSchema }).strict(),
    changes: memberCreateChangesSchema.optional().default({}),
    ...operationMeta,
  }).strict(),
  z.object({
    op: z.literal('member.update'),
    target: memberRefSchema,
    changes: memberUpdateChangesSchema,
    ...operationMeta,
  }).strict(),
  ...['member.hide', 'member.restore'].map((op) => z.object({
    op: z.literal(op),
    target: memberRefSchema,
    ...operationMeta,
  }).strict()),
  z.object({
    op: z.literal('memory.create'),
    target: memberRefSchema,
    changes: memoryCreateChangesSchema,
    ...operationMeta,
  }).strict(),
  z.object({
    op: z.literal('memory.update'),
    target: memberRefSchema.extend({ memoryId: idSchema }).strict(),
    changes: memoryUpdateChangesSchema,
    ...operationMeta,
  }).strict(),
  z.object({
    op: z.literal('memory.delete'),
    target: memberRefSchema.extend({ memoryId: idSchema, revision: revisionSchema.optional() }).strict(),
    ...operationMeta,
  }).strict(),
  z.object({
    op: z.literal('behavior.create'),
    target: memberRefSchema,
    changes: behaviorCreateChangesSchema,
    ...operationMeta,
  }).strict(),
  z.object({
    op: z.literal('behavior.update'),
    target: memberRefSchema.extend({ behaviorId: idSchema }).strict(),
    changes: behaviorUpdateChangesSchema,
    ...operationMeta,
  }).strict(),
  z.object({
    op: z.literal('behavior.delete'),
    target: memberRefSchema.extend({ behaviorId: idSchema, revision: revisionSchema.optional() }).strict(),
    ...operationMeta,
  }).strict(),
  z.object({
    op: z.literal('item.upsert'),
    target: memberRefSchema.extend({ itemId: idSchema.optional() }).strict(),
    changes: itemChangesSchema,
    ...operationMeta,
  }).strict(),
  z.object({
    op: z.literal('item.transfer'),
    target: z.object({ itemId: idSchema }).strict(),
    changes: z.object({
      memberId: idSchema.optional(),
      memberName: nameSchema.optional(),
      nodeId: idSchema.optional(),
      revision: revisionSchema.optional(),
    }).strict().refine((value) => [value.memberId, value.memberName, value.nodeId].filter(Boolean).length === 1, {
      message: 'Item transfer needs exactly one destination',
    }),
    ...operationMeta,
  }).strict(),
  z.object({
    op: z.literal('item.delete'),
    target: z.object({ itemId: idSchema, revision: revisionSchema.optional() }).strict(),
    ...operationMeta,
  }).strict(),
  z.object({
    op: z.literal('appearance.update'),
    target: memberRefSchema,
    changes: appearanceChangesSchema,
    ...operationMeta,
  }).strict(),
]);

export const castChangePlanSchema = z.object({
  version: z.literal(1),
  summary: z.string().max(1_000).optional().default(''),
  operations: z.array(operationSchema).max(CAST_PLAN_LIMITS.ai_organize_conversation),
}).strict();

export function buildCastChangePlanJsonSchema(options = {}) {
  const allowedOperations = normalizeSchemaOperationNames(options.allowedOperations);
  const maxOperations = normalizeSchemaOperationLimit(options.maxOperations);
  const requireEvidence = options.requireEvidence === true;
  const schema = z.toJSONSchema(castChangePlanSchema);
  const operationItems = schema?.properties?.operations?.items;
  const variants = Array.isArray(operationItems?.oneOf) ? operationItems.oneOf : [];
  const variantsByName = new Map(
    variants.map((variant) => [variant?.properties?.op?.const, variant])
  );
  const selectedVariants = allowedOperations.map((name) => variantsByName.get(name)).filter(Boolean);
  if (selectedVariants.length !== allowedOperations.length) {
    throw new Error('CastChangePlanV1 JSON Schema is missing an operation variant');
  }
  operationItems.oneOf = selectedVariants;
  schema.properties.operations.maxItems = maxOperations;
  if (requireEvidence) {
    for (const variant of selectedVariants) {
      variant.required = [...new Set([...(variant.required || []), 'evidence'])];
    }
  }
  return schema;
}

export function parseCastChangePlanText(text) {
  let source = String(text ?? '').trim();
  const fenced = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  if (fenced) source = fenced[1].trim();
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    throw planError('Model response is not a single valid JSON object', 'CAST_PLAN_JSON');
  }
  return validateCastChangePlan(value);
}

export function validateCastChangePlan(value) {
  const result = castChangePlanSchema.safeParse(value);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    throw planError('Cast change plan does not match CastChangePlanV1', 'CAST_PLAN_SCHEMA', details);
  }
  return result.data;
}

export function assertCastPlanPermissions(plan, options = {}) {
  const sourceKind = String(options.sourceKind || 'manual');
  if (!CAST_SOURCE_KINDS.includes(sourceKind)) {
    throw planError('Unknown cast change source', 'CAST_PLAN_SOURCE');
  }
  const scope = options.scope === 'conversation' ? 'conversation' : 'member';
  const limitKey = sourceKind === 'ai_organize'
    ? `ai_organize_${scope}`
    : sourceKind;
  const limit = CAST_PLAN_LIMITS[limitKey] ?? CAST_PLAN_LIMITS.manual;
  if (plan.operations.length > limit) {
    throw planError(`Cast change plan exceeds the ${limit} operation limit`, 'CAST_PLAN_LIMIT');
  }
  if (sourceKind === 'auto_sync') {
    const allowed = new Set(CAST_AUTO_SYNC_OPERATIONS);
    for (const operation of plan.operations) {
      if (!allowed.has(operation.op)) {
        throw planError(`Auto sync cannot perform ${operation.op}`, 'CAST_PLAN_FORBIDDEN_OPERATION');
      }
      if (!operation.evidence) {
        throw planError('Every auto sync operation requires evidence', 'CAST_PLAN_EVIDENCE');
      }
    }
  }
  if (!plan.operations.every((operation) => CAST_OPERATION_NAMES.includes(operation.op))) {
    throw planError('Cast change plan contains an unknown operation', 'CAST_PLAN_OPERATION');
  }
  return plan;
}

function normalizeSchemaOperationNames(value) {
  const source = Array.isArray(value) && value.length ? value : CAST_OPERATION_NAMES;
  const names = [...new Set(source.map((entry) => String(entry || '').trim()).filter(Boolean))];
  if (!names.length || names.some((name) => !CAST_OPERATION_NAMES.includes(name))) {
    throw new Error('Unknown CastChangePlanV1 JSON Schema operation');
  }
  return names;
}

function normalizeSchemaOperationLimit(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return CAST_PLAN_LIMITS.ai_organize_conversation;
  }
  return Math.min(parsed, CAST_PLAN_LIMITS.ai_organize_conversation);
}

function planError(message, code, details = null) {
  return new CastDomainError(message, { code, statusCode: 400, details });
}
