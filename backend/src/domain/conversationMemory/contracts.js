import crypto from 'node:crypto';

export const MEMORY_PACKET_VERSION = 1;
export const MEMORY_PACKET_LIMITS = Object.freeze({
  characters: 500_000, sources: 12, entities: 80, events: 80, claims: 120, knowledge: 240,
  threads: 80, domainRefs: 80, actions: 160, aliases: 20, participants: 20, actorIds: 30, evidence: 12,
  identifierCharacters: 160, eventContentCharacters: 5000, evidenceQuoteCharacters: 1000,
  threadTextCharacters: 1000, domainCharacters: 80, jsonItems: 40
});
export const MEMORY_ENTITY_KINDS = Object.freeze(['actor','place','object','group','concept']);
export const MEMORY_EVENT_KINDS = Object.freeze(['event','fact','relationship','location','preference','summary','intent','hypothesis','utterance','promise','attempt','outcome','inference','rumor','disclosure']);
export const MEMORY_TRUTH_STATES = Object.freeze(['established','unverified','false','disputed','unknown']);
export const MEMORY_EPISTEMIC_STATES = Object.freeze(['experienced','told','knows','believes','suspects','false_belief','unknown']);
export const MEMORY_LIFECYCLES = Object.freeze(['candidate','active','superseded','rejected']);
export const MEMORY_VISIBILITIES = Object.freeze(['public','restricted','author']);
export const MEMORY_LAYERS = Object.freeze(['canon','working','current','history']);
export const MEMORY_CLAIM_MODALITIES = Object.freeze(['assertion','utterance','promise','attempt','inference','rumor','hypothesis','intent']);
export const MEMORY_THREAD_KINDS = Object.freeze(['goal','promise','conflict','clue','question']);
export const MEMORY_THREAD_STATUSES = Object.freeze(['open','resolved','abandoned']);

/** A correctable packet-shape error with a stable field path for tool feedback. */
export class MemoryPacketValidationError extends Error {
  constructor(path, message) {
    super(`记忆 ${path} ${message}`);
    this.name = 'MemoryPacketValidationError'; this.code = 'MEMORY_PACKET_INVALID';
    this.status = 400; this.accepted = false; this.path = path;
    this.issues = [{ path, message }];
  }
}

/** Hash canonical JSON independently of object key order for source and packet guards. */
export function memoryHash(value) {
  const canonical = input => Array.isArray(input) ? input.map(canonical) : input && typeof input === 'object'
    ? Object.fromEntries(Object.keys(input).sort().map(key => [key, canonical(input[key])])) : input;
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export class MemoryRevisionError extends Error {
  constructor(message = '记忆来源或版本已变化，请重新整理', code = 'MEMORY_REVISION_CHANGED') {
    super(message); this.name = 'MemoryRevisionError'; this.code = code; this.status = 409; this.accepted = false;
  }
}

/** Validates a bounded extraction packet before any database mutation. Entity refs are local IDs or packet keys. */
export function normalizeMemoryPacket(value = {}) {
  requireObject(value, 'packet');
  if (JSON.stringify(value).length>MEMORY_PACKET_LIMITS.characters) throw new MemoryPacketValidationError('packet', '超过大小限制');
  if (value.version !== undefined && value.version !== MEMORY_PACKET_VERSION) throw new Error('不支持的记忆提取版本');
  const array = name => objectArray(value[name], name, MEMORY_PACKET_LIMITS[name]);
  const sources = array('sources').map(source => ({
    messageId: text(source.messageId ?? source.id, 160), revision: positive(source.revision ?? 1),
    contentHash: text(source.contentHash, 64)
  }));
  const entities = array('entities').map((entity, index) => ({
    key: text(entity.key ?? entity.id,160), id: text(entity.id,160), name: text(entity.name,160),
    kind: oneOf(entity.kind,MEMORY_ENTITY_KINDS,'actor'), castKey:text(entity.castKey,160),
    aliases: stringArray(entity.aliases, `entities[${index}].aliases`, MEMORY_PACKET_LIMITS.aliases, false)
  }));
  for (const entity of entities) if (!entity.key || !entity.name) throw new Error('角色／实体需要 key 和名称');
  if (new Set(entities.map(entity => entity.key)).size !== entities.length) throw new Error('实体 key 重复');
  const events = array('events').map((event, index) => ({
    key:text(event.key,160), kind:oneOf(event.kind,MEMORY_EVENT_KINDS,'event'),
    content:text(event.content,5000), subjectEntityId:text(event.subjectEntityId ?? event.subjectKey,160),
    participants: stringArray(event.participants,`events[${index}].participants`,MEMORY_PACKET_LIMITS.participants),
    actorIds:stringArray(event.actorIds,`events[${index}].actorIds`,MEMORY_PACKET_LIMITS.actorIds), locationEntityId:text(event.locationEntityId,160),
    visibility:oneOf(event.visibility,MEMORY_VISIBILITIES,'public'),
    truthStatus:oneOf(event.truthStatus,MEMORY_TRUTH_STATES,'unverified'),
    lifecycle:oneOf(event.lifecycle,MEMORY_LIFECYCLES,'active'),
    confidence:unit(event.confidence,0.8), importance:unit(event.importance,0), emotionalIntensity:unit(event.emotionalIntensity,0),
    narrativeTime:text(event.narrativeTime,160), layer:oneOf(event.layer,MEMORY_LAYERS,'history'),
    supersedesId:text(event.supersedesId,160),
    evidence:objectArray(event.evidence,`events[${index}].evidence`,MEMORY_PACKET_LIMITS.evidence).map(item => ({messageId:text(item.messageId ?? item.sourceMessageId,160), revision:item.revision===undefined||item.revision===null?null:positive(item.revision), quote:text(item.quote,1000)}))
  }));
  const eventKeys = new Set();
  for (const [index, event] of events.entries()) {
    if (event.key && eventKeys.has(event.key)) throw new MemoryPacketValidationError(`events[${index}].key`, '不能重复');
    if (event.key) eventKeys.add(event.key);
    if (!event.content) throw new Error('事件内容不能为空');
    if (['intent','hypothesis','attempt','rumor','inference','utterance'].includes(event.kind) && event.truthStatus === 'established') {
      // A statement/attempt can be established as an occurrence, but its proposition/outcome cannot become true implicitly.
      event.truthStatus = 'unverified';
    }
  }
  return { version:1, sources, entities, events, claims:array('claims'), knowledge:array('knowledge'),
    threads:array('threads'), domainRefs:array('domainRefs'), actions:array('actions'),
    messageId:text(value.messageId,160), idempotencyKey:text(value.idempotencyKey,500), summary:text(value.summary,1000) };
}

export function normalizeEntityAlias(value) { return String(value || '').normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g,' '); }
export function text(value,limit = 1000) { return String(value ?? '').trim().slice(0,limit); }
export function oneOf(value,values,fallback) { return values.includes(value) ? value : fallback; }
export function unit(value,fallback=0) { return Number.isFinite(Number(value)) ? Math.max(0,Math.min(1,Number(value))) : fallback; }
function positive(value) { const number=Number(value); if (!Number.isInteger(number)||number<1) throw new Error('消息版本无效'); return number; }

/** Rejects malformed collections before their contents can be dropped, spread, or dereferenced. */
function boundedArray(value, path, limit) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new MemoryPacketValidationError(path, '必须是数组');
  if (value.length > limit) throw new MemoryPacketValidationError(path, `数量不能超过 ${limit}（当前 ${value.length}）`);
  return value;
}

function requireObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    throw new MemoryPacketValidationError(path, '必须是 JSON 对象');
  return value;
}

function objectArray(value, path, limit) {
  return boundedArray(value, path, limit).map((item, index) => requireObject(item, `${path}[${index}]`));
}

function stringArray(value, path, limit, unique = true) {
  const items = boundedArray(value, path, limit).map((item, index) => {
    if (typeof item !== 'string') throw new MemoryPacketValidationError(`${path}[${index}]`, '必须是字符串');
    return text(item, MEMORY_PACKET_LIMITS.identifierCharacters);
  }).filter(Boolean);
  return unique ? [...new Set(items)] : items;
}
