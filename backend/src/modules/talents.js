import { newId, nowIso } from '../security.js';
import { parseJson } from '../utils/json.js';

// ── Rarity weights for weighted random roll ──
const RARITY_WEIGHTS = {
  common: 50,
  rare: 30,
  epic: 15,
  legendary: 5
};

const RARITY_LABELS = {
  common: '普通',
  rare: '稀有',
  epic: '史诗',
  legendary: '传说'
};

// ── Talent Pool CRUD ──

export function listTalentPools(database) {
  return database
    .prepare(
      `SELECT id, name, description, talents_json, created_at
       FROM talent_pools
       ORDER BY created_at DESC, rowid DESC`
    )
    .all()
    .map(toTalentPool);
}

export function getTalentPool(database, poolId) {
  const row = database
    .prepare('SELECT id, name, description, talents_json, created_at FROM talent_pools WHERE id = ?')
    .get(poolId);
  return row ? toTalentPool(row) : null;
}

export function createTalentPool(database, payload) {
  const name = normalizePoolName(payload.name);
  const description = String(payload.description || '').trim();
  const talents = normalizeTalentsList(payload.talents);

  const id = newId();
  const timestamp = nowIso();
  database
    .prepare(
      'INSERT INTO talent_pools (id, name, description, talents_json, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run(id, name, description, JSON.stringify(talents), timestamp);

  return { id, name, description, talents, createdAt: timestamp };
}

export function updateTalentPool(database, poolId, payload) {
  const existing = database.prepare('SELECT id FROM talent_pools WHERE id = ?').get(poolId);
  if (!existing) {
    return null;
  }

  const name = payload.name !== undefined ? normalizePoolName(payload.name) : undefined;
  const description = payload.description !== undefined ? String(payload.description || '').trim() : undefined;
  const talents = payload.talents !== undefined ? normalizeTalentsList(payload.talents) : undefined;

  const sets = [];
  const params = [];
  if (name !== undefined) {
    sets.push('name = ?');
    params.push(name);
  }
  if (description !== undefined) {
    sets.push('description = ?');
    params.push(description);
  }
  if (talents !== undefined) {
    sets.push('talents_json = ?');
    params.push(JSON.stringify(talents));
  }

  if (sets.length === 0) {
    return getTalentPool(database, poolId);
  }

  params.push(poolId);
  database.prepare(`UPDATE talent_pools SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getTalentPool(database, poolId);
}

export function deleteTalentPool(database, poolId) {
  const result = database.prepare('DELETE FROM talent_pools WHERE id = ?').run(poolId);
  return result.changes > 0;
}

// ── Character Talent (Roll) ──

export function rollTalent(database, characterId, poolId) {
  const pool = getTalentPool(database, poolId);
  if (!pool) {
    return { error: '天赋池不存在' };
  }

  if (!pool.talents || pool.talents.length === 0) {
    return { error: '天赋池为空，无法 Roll' };
  }

  const character = database.prepare('SELECT id FROM characters WHERE id = ?').get(characterId);
  if (!character) {
    return { error: '角色不存在' };
  }

  // Weighted random selection
  const rolledTalent = weightedRandomPick(pool.talents);

  const id = newId();
  const timestamp = nowIso();
  database
    .prepare(
      `INSERT INTO character_talents (id, character_id, talent_name, talent_rarity, talent_description, talent_effect, pool_id, rolled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      characterId,
      rolledTalent.name,
      rolledTalent.rarity,
      rolledTalent.description || '',
      rolledTalent.effect || '',
      poolId,
      timestamp
    );

  return {
    id,
    characterId,
    talentName: rolledTalent.name,
    talentRarity: rolledTalent.rarity,
    talentRarityLabel: RARITY_LABELS[rolledTalent.rarity] || rolledTalent.rarity,
    talentDescription: rolledTalent.description || '',
    talentEffect: rolledTalent.effect || '',
    poolId,
    poolName: pool.name,
    rolledAt: timestamp
  };
}

export function getCharacterTalents(database, characterId) {
  return database
    .prepare(
      `SELECT id, character_id, talent_name, talent_rarity, talent_description, talent_effect, pool_id, rolled_at
       FROM character_talents
       WHERE character_id = ?
       ORDER BY rolled_at DESC, rowid DESC`
    )
    .all(characterId)
    .map(toCharacterTalent);
}

export function deleteCharacterTalent(database, talentId, characterId = '') {
  const result = characterId
    ? database.prepare('DELETE FROM character_talents WHERE id = ? AND character_id = ?').run(talentId, characterId)
    : database.prepare('DELETE FROM character_talents WHERE id = ?').run(talentId);
  return result.changes > 0;
}

export function deleteAllCharacterTalents(database, characterId) {
  const result = database.prepare('DELETE FROM character_talents WHERE character_id = ?').run(characterId);
  return result.changes > 0;
}

// ── Build talent system prompt injection ──

export function buildTalentSystemPrompt(database, characterId) {
  const talents = getCharacterTalents(database, characterId);
  if (!talents.length) {
    return '';
  }

  const lines = talents.map((t) => {
    const rarityLabel = RARITY_LABELS[t.talentRarity] || t.talentRarity;
    const parts = [`「${t.talentName}」(${rarityLabel})`];
    if (t.talentDescription) {
      parts.push(t.talentDescription);
    }
    if (t.talentEffect) {
      parts.push(`效果：${t.talentEffect}`);
    }
    return parts.join(' — ');
  });

  return `[角色天赋]\n该角色拥有以下天赋，请在扮演时自然融入这些天赋特质：\n${lines.map((l) => `- ${l}`).join('\n')}`;
}

// ── Roll engine: weighted random ──

export function weightedRandomPick(talents) {
  // Calculate total weight based on rarity
  const weighted = talents.map((talent) => {
    const rarity = talent.rarity || 'common';
    const weight = RARITY_WEIGHTS[rarity] || RARITY_WEIGHTS.common;
    return { talent, weight };
  });

  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
  let random = Math.random() * totalWeight;

  for (const { talent, weight } of weighted) {
    random -= weight;
    if (random <= 0) {
      return talent;
    }
  }

  // Fallback (should not happen)
  return talents[talents.length - 1];
}

// ── Exported constants for testing ──

export const RARITY_CONFIG = { ...RARITY_WEIGHTS };
export const RARITY_LABEL_MAP = { ...RARITY_LABELS };

// ── Helpers ──

function normalizePoolName(name) {
  const value = String(name || '').trim();
  if (!value || value.length > 80) {
    throw new Error('天赋池名称长度需为 1-80 个字符');
  }
  return value;
}

function normalizeTalentsList(talents) {
  if (!Array.isArray(talents)) {
    return [];
  }

  return talents
    .map((t) => ({
      name: String(t.name || '').trim(),
      description: String(t.description || '').trim(),
      rarity: normalizeRarity(t.rarity),
      effect: String(t.effect || '').trim()
    }))
    .filter((t) => t.name.length > 0 && t.name.length <= 60)
    .slice(0, 100);
}

function normalizeRarity(value) {
  const v = String(value || 'common').trim().toLowerCase();
  if (['common', 'rare', 'epic', 'legendary'].includes(v)) {
    return v;
  }
  return 'common';
}

function toTalentPool(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    talents: parseJson(row.talents_json, []),
    createdAt: row.created_at
  };
}

function toCharacterTalent(row) {
  return {
    id: row.id,
    characterId: row.character_id,
    talentName: row.talent_name,
    talentRarity: row.talent_rarity || 'common',
    talentRarityLabel: RARITY_LABELS[row.talent_rarity] || row.talent_rarity || 'common',
    talentDescription: row.talent_description || '',
    talentEffect: row.talent_effect || '',
    poolId: row.pool_id,
    rolledAt: row.rolled_at
  };
}
