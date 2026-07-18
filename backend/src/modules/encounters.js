import crypto from 'node:crypto';
import { newId, nowIso } from '../security.js';
import { clampInteger } from '../utils/number.js';
import { parseJson } from '../utils/json.js';
import { performSkillCheck } from './skillChecks.js';
import { getTravelMap } from './travel.js';
import { recordWorldEvent } from './worldEvents.js';
import { withSavepoint } from './savepoint.js';

const TERMINAL_NPC_STATUSES = new Set(['permanently_left', 'dead']);

export function getActiveEncounter(database, userId, conversationId) {
  if (!hasConversationAccess(database, userId, conversationId)) return null;
  const row = database.prepare("SELECT * FROM encounters WHERE conversation_id = ? AND status = 'active' ORDER BY created_at DESC, rowid DESC LIMIT 1").get(conversationId);
  return row ? readEncounter(database, row.id) : null;
}

export function createEncounter(database, userId, conversationId, payload = {}, options = {}) {
  if (!hasConversationAccess(database, userId, conversationId)) return { ok: false, error: '对话不存在' };
  if (getActiveEncounter(database, userId, conversationId)) return { ok: false, error: '已有进行中的遭遇' };
  const playerName = text(payload.playerName, 120);
  const npcNames = normalizeNpcNames(payload.npcNames);
  if (!playerName || !npcNames.length) return { ok: false, error: '遭遇需要玩家和至少一个 NPC' };
  const npcs = [];
  for (const name of npcNames) {
    const npc = database.prepare('SELECT npc_name, status, current_location FROM npc_registry WHERE conversation_id = ? AND npc_name = ?').get(conversationId, name);
    if (!npc) return { ok: false, error: `NPC 不存在：${name}` };
    if (TERMINAL_NPC_STATUSES.has(npc.status)) return { ok: false, error: `终止状态 NPC 不能加入遭遇：${name}` };
    npcs.push(npc);
  }
  const map = getTravelMap(database, userId, conversationId);
  const locationName = map?.currentNode?.name || '';
  for (const npc of npcs) if (locationName && npc.current_location && npc.current_location !== locationName) return { ok: false, error: `${npc.npc_name} 不在当前地点` };
  return withSavepoint(database, 'sp_create_encounter', () => {
    const encounterId = newId();
    const timestamp = nowIso();
    database.prepare(`INSERT INTO encounters (id, conversation_id, location_node_id, title, status, round_number, turn_index, outcome, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', 1, 0, '', ?, ?, ?)`)
      .run(encounterId, conversationId, map?.currentNode?.id || null, text(payload.title, 200) || `遭遇：${npcNames.join('、')}`, text(payload.source, 40) || 'player', timestamp, timestamp);
    const actors = [{ type: 'player', name: playerName, hp: clampInteger(payload.playerHp, 1, 999, 20), defense: clampInteger(payload.playerDefense, 2, 40, 10) }];
    for (const npc of npcs) actors.push({ type: 'npc', name: npc.npc_name, hp: 10, defense: 10 });
    for (let index = 0; index < actors.length; index += 1) {
      const actor = actors[index];
      const initiative = rollD20(options.initiativeRolls?.[index]);
      database.prepare(`INSERT INTO encounter_participants (id, encounter_id, actor_type, actor_name, initiative, max_hp, current_hp, defense, status, conditions_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', '[]', ?, ?)`)
        .run(newId(), encounterId, actor.type, actor.name, initiative, actor.hp, actor.hp, actor.defense, timestamp, timestamp);
    }
    recordWorldEvent(database, userId, conversationId, { eventType: 'encounter.started', source: payload.source || 'player', title: `遭遇开始：${text(payload.title, 200) || npcNames.join('、')}`, entityType: 'encounter', entityId: encounterId, severity: 'warning' });
    return { ok: true, encounter: readEncounter(database, encounterId) };
  });
}

export function performEncounterAction(database, userId, conversationId, encounterId, payload = {}, options = {}) {
  if (!hasConversationAccess(database, userId, conversationId)) return { ok: false, error: '对话不存在' };
  const encounter = readEncounter(database, encounterId);
  if (!encounter || encounter.conversationId !== conversationId) return { ok: false, error: '遭遇不存在' };
  if (encounter.status !== 'active') return { ok: false, error: '遭遇已结束' };
  const actor = encounter.participants[encounter.turnIndex];
  if (!actor || actor.id !== payload.actorId) return { ok: false, error: '尚未轮到该参与者行动' };
  if (actor.status !== 'active') return { ok: false, error: '该参与者无法行动' };
  const actionType = ['attack', 'skill', 'defend', 'flee'].includes(payload.actionType) ? payload.actionType : '';
  if (!actionType) return { ok: false, error: '行动类型无效' };
  return withSavepoint(database, 'sp_encounter_action', () => {
    let target = null;
    let check = null;
    let damage = 0;
    const result = {};
    if (actionType === 'attack' || actionType === 'skill') {
      target = encounter.participants.find(item => item.id === payload.targetId);
      if (!target || target.status !== 'active' || target.actorType === actor.actorType) return { ok: false, error: '目标无效' };
      check = performSkillCheck(database, userId, conversationId, {
        actorName: actor.actorName, skill: text(payload.skill, 100) || (actionType === 'attack' ? '攻击' : '技能'),
        difficulty: target.defense, modifier: clampInteger(payload.modifier, -20, 20, 0),
        context: `遭遇：${encounter.title}`, source: payload.source || 'encounter'
      }, { roll: options.roll });
      if (check.outcome.includes('success')) {
        damage = rollDamage(options.damageRoll) + (check.outcome === 'critical_success' ? rollDamage(options.bonusDamageRoll) : 0);
        const nextHp = Math.max(0, target.currentHp - damage);
        database.prepare("UPDATE encounter_participants SET current_hp = ?, status = CASE WHEN ? = 0 THEN 'defeated' ELSE status END, updated_at = ? WHERE id = ?")
          .run(nextHp, nextHp, nowIso(), target.id);
        result.targetHp = nextHp;
      }
    } else if (actionType === 'defend') {
      database.prepare("UPDATE encounter_participants SET defense = MIN(40, defense + 2), conditions_json = ?, updated_at = ? WHERE id = ?")
        .run(JSON.stringify(['defending']), nowIso(), actor.id);
      result.defenseRaised = true;
    } else {
      check = performSkillCheck(database, userId, conversationId, { actorName: actor.actorName, skill: '脱离', difficulty: 12, modifier: clampInteger(payload.modifier, -20, 20, 0), context: `逃离${encounter.title}`, source: payload.source || 'encounter' }, { roll: options.roll });
      result.escaped = check.outcome.includes('success');
      if (result.escaped) finishEncounter(database, userId, encounter, actor.actorType === 'player' ? 'escaped' : 'opponents_escaped', payload.source);
    }
    const actionId = newId();
    database.prepare(`INSERT INTO encounter_actions (id, encounter_id, round_number, turn_index, actor_id, target_id, action_type, skill_check_id, damage, result_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(actionId, encounter.id, encounter.roundNumber, encounter.turnIndex, actor.id, target?.id || null, actionType, check?.id || null, damage, JSON.stringify(result), nowIso());
    if (!result.escaped) resolveEncounterOrAdvance(database, userId, encounter.id, payload.source || 'encounter');
    const updated = readEncounter(database, encounter.id);
    recordWorldEvent(database, userId, conversationId, { eventType: 'encounter.action', source: payload.source || 'player', title: `${actor.actorName}：${actionLabel(actionType)}${damage ? `（${damage} 伤害）` : ''}`, entityType: 'encounter', entityId: encounter.id, payload: { actionId, actorId: actor.id, targetId: target?.id || '', damage, checkId: check?.id || '' } });
    return { ok: true, action: { id: actionId, actionType, damage, check, result }, encounter: updated };
  });
}

export function endEncounter(database, userId, conversationId, encounterId, outcome = 'ended', source = 'player') {
  const encounter = readEncounter(database, encounterId);
  if (!encounter || encounter.conversationId !== conversationId || !hasConversationAccess(database, userId, conversationId)) return null;
  if (encounter.status !== 'active') return encounter;
  finishEncounter(database, userId, encounter, text(outcome, 40) || 'ended', source);
  return readEncounter(database, encounterId);
}

function resolveEncounterOrAdvance(database, userId, encounterId, source) {
  const encounter = readEncounter(database, encounterId);
  const playerActive = encounter.participants.some(item => item.actorType === 'player' && item.status === 'active');
  const npcActive = encounter.participants.some(item => item.actorType === 'npc' && item.status === 'active');
  if (!playerActive) return finishEncounter(database, userId, encounter, 'defeat', source);
  if (!npcActive) return finishEncounter(database, userId, encounter, 'victory', source);
  let nextIndex = encounter.turnIndex;
  let round = encounter.roundNumber;
  for (let step = 0; step < encounter.participants.length; step += 1) {
    nextIndex += 1;
    if (nextIndex >= encounter.participants.length) { nextIndex = 0; round += 1; }
    if (encounter.participants[nextIndex].status === 'active') break;
  }
  database.prepare('UPDATE encounters SET round_number = ?, turn_index = ?, updated_at = ? WHERE id = ?').run(round, nextIndex, nowIso(), encounter.id);
}

function finishEncounter(database, userId, encounter, outcome, source) {
  database.prepare("UPDATE encounters SET status = 'completed', outcome = ?, updated_at = ? WHERE id = ? AND status = 'active'").run(outcome, nowIso(), encounter.id);
  recordWorldEvent(database, userId, encounter.conversationId, { eventType: 'encounter.completed', source: source || 'encounter', title: `遭遇结束：${outcomeLabel(outcome)}`, entityType: 'encounter', entityId: encounter.id, severity: outcome === 'victory' ? 'success' : outcome === 'defeat' ? 'danger' : 'info' });
}

function readEncounter(database, id) {
  const row = database.prepare('SELECT * FROM encounters WHERE id = ?').get(id);
  if (!row) return null;
  const participants = database.prepare('SELECT * FROM encounter_participants WHERE encounter_id = ? ORDER BY initiative DESC, created_at, rowid').all(id).map(toParticipant);
  const actions = database.prepare('SELECT * FROM encounter_actions WHERE encounter_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 20').all(id).map(item => ({ id: item.id, roundNumber: item.round_number, turnIndex: item.turn_index, actorId: item.actor_id, targetId: item.target_id || '', actionType: item.action_type, skillCheckId: item.skill_check_id || '', damage: item.damage, result: parseJson(item.result_json, {}), createdAt: item.created_at }));
  return { id: row.id, conversationId: row.conversation_id, locationNodeId: row.location_node_id || '', title: row.title, status: row.status, roundNumber: row.round_number, turnIndex: row.turn_index, outcome: row.outcome, source: row.source, participants, currentActor: participants[row.turn_index] || null, actions, createdAt: row.created_at, updatedAt: row.updated_at };
}

function toParticipant(row) { return { id: row.id, actorType: row.actor_type, actorName: row.actor_name, initiative: row.initiative, maxHp: row.max_hp, currentHp: row.current_hp, defense: row.defense, status: row.status, conditions: parseJson(row.conditions_json, []), createdAt: row.created_at, updatedAt: row.updated_at }; }
function normalizeNpcNames(value) { const result = []; const seen = new Set(); for (const item of Array.isArray(value) ? value : []) { const name = text(item, 120); if (name && !seen.has(name) && result.length < 12) { seen.add(name); result.push(name); } } return result; }
function hasConversationAccess(database, userId, conversationId) { return Boolean(database.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?').get(conversationId, userId)); }
function rollD20(value) { return value === undefined ? crypto.randomInt(1, 21) : clampInteger(value, 1, 20, 10); }
function rollDamage(value) { return value === undefined ? crypto.randomInt(1, 7) : clampInteger(value, 1, 6, 3); }
function text(value, max) { return String(value || '').trim().slice(0, max); }
function actionLabel(value) { return ({ attack: '攻击', skill: '技能', defend: '防御', flee: '脱离' })[value] || value; }
function outcomeLabel(value) { return ({ victory: '胜利', defeat: '失败', escaped: '成功脱离', opponents_escaped: '对手脱离', ended: '安全终止' })[value] || value; }
