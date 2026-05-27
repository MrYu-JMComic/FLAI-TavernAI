import { newId, nowIso } from '../security.js';
import { avatarShortUrl } from '../services/avatars.js';

const maxImagesPerCharacter = 20;

// ── Scene / Emotion keyword maps ──

const sceneKeywords = {
  日常: ['日常', '平时', '普通', '一般', '普通'],
  学校: ['学校', '教室', '上课', '老师', '同学', '校园', '操场', '图书馆'],
  街道: ['街道', '街上', '马路', '路口', '城市', '步行', '散步'],
  家里: ['家', '房间', '卧室', '客厅', '厨房', '沙发', '床上'],
  餐厅: ['餐厅', '吃饭', '食物', '咖啡', '茶', '饭店', '食堂', '餐桌'],
  战斗: ['战斗', '攻击', '敌人', '战斗', '武器', '剑', '魔法', '打', '防御'],
  夜晚: ['夜晚', '深夜', '月亮', '星空', '夜里', '晚上'],
  雨天: ['雨', '下雨', '雨天', '雨中', '淋雨', '雨伞'],
  雪天: ['雪', '下雪', '雪花', '雪地', '雪景'],
  海边: ['海', '海滩', '海边', '沙滩', '海浪', '海岸'],
  森林: ['森林', '树林', '树木', '林中', '丛林'],
  节日: ['节日', '庆典', '派对', '宴会', '聚会', '生日', '新年', '圣诞']
};

const emotionKeywords = {
  开心: ['开心', '高兴', '快乐', '喜悦', '笑', '愉快', '兴奋', '欣喜', '欢乐', '幸福'],
  悲伤: ['悲伤', '难过', '伤心', '哭', '眼泪', '痛苦', '忧伤', '哀伤', '落泪'],
  愤怒: ['愤怒', '生气', '怒', '恼火', '暴怒', '气愤', '恼怒'],
  惊讶: ['惊讶', '吃惊', '震惊', '惊', '意外', '意想不到'],
  害羞: ['害羞', '脸红', '羞涩', '不好意思', '腼腆', '羞怯'],
  害怕: ['害怕', '恐惧', '畏惧', '颤抖', '惊恐', '恐'],
  温柔: ['温柔', '柔和', '温暖', '轻声', '柔声', '细语'],
  严肃: ['严肃', '认真', '郑重', '庄重', '正经'],
  困倦: ['困', '疲倦', '打哈欠', '睡觉', '睡着', '困倦', '疲惫'],
  得意: ['得意', '骄傲', '自豪', '自信', '傲慢']
};

// ── Database operations ──

export function listCharacterImages(database, characterId) {
  return database
    .prepare(
      `SELECT id, character_id, image_url, scene_tag, emotion_tag, is_default, order_index, created_at
       FROM character_images
       WHERE character_id = ?
       ORDER BY order_index ASC, created_at ASC`
    )
    .all(characterId)
    .map(toCharacterImage);
}

export function createCharacterImage(database, { characterId, imageUrl, sceneTag, emotionTag, isDefault }) {
  const id = newId();
  const timestamp = nowIso();

  const existingCount = database
    .prepare('SELECT COUNT(*) AS count FROM character_images WHERE character_id = ?')
    .get(characterId).count;

  if (existingCount >= maxImagesPerCharacter) {
    throw new Error(`每个角色最多 ${maxImagesPerCharacter} 张立绘`);
  }

  const orderIndex = existingCount;

  database
    .prepare(
      `INSERT INTO character_images (id, character_id, image_url, scene_tag, emotion_tag, is_default, order_index, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      characterId,
      imageUrl,
      normalizeTag(sceneTag),
      normalizeTag(emotionTag),
      isDefault ? 1 : 0,
      orderIndex,
      timestamp
    );

  return toCharacterImage(database.prepare('SELECT * FROM character_images WHERE id = ?').get(id));
}

export function updateCharacterImage(database, characterId, imageId, { sceneTag, emotionTag, isDefault }) {
  const existing = database
    .prepare('SELECT * FROM character_images WHERE id = ? AND character_id = ?')
    .get(imageId, characterId);
  if (!existing) {
    return null;
  }

  database
    .prepare(
      `UPDATE character_images
       SET scene_tag = ?, emotion_tag = ?, is_default = ?
       WHERE id = ? AND character_id = ?`
    )
    .run(
      sceneTag !== undefined ? normalizeTag(sceneTag) : existing.scene_tag,
      emotionTag !== undefined ? normalizeTag(emotionTag) : existing.emotion_tag,
      isDefault !== undefined ? (isDefault ? 1 : 0) : existing.is_default,
      imageId,
      characterId
    );

  return toCharacterImage(database.prepare('SELECT * FROM character_images WHERE id = ?').get(imageId));
}

export function deleteCharacterImage(database, characterId, imageId) {
  const result = database
    .prepare('DELETE FROM character_images WHERE id = ? AND character_id = ?')
    .run(imageId, characterId);
  if (result.changes > 0) {
    reorderAfterDelete(database, characterId);
    return true;
  }
  return false;
}

export function reorderCharacterImages(database, characterId, orderedIds) {
  const update = database.prepare(
    'UPDATE character_images SET order_index = ? WHERE id = ? AND character_id = ?'
  );
  let changed = 0;
  orderedIds.forEach((id, index) => {
    const result = update.run(index, id, characterId);
    changed += result.changes;
  });
  return changed;
}

// ── Scene detection from AI text ──

export function detectSceneAndEmotion(text) {
  const normalizedText = String(text || '').toLowerCase();
  const result = { sceneTag: '', emotionTag: '' };

  // Find scene
  let bestSceneScore = 0;
  for (const [tag, keywords] of Object.entries(sceneKeywords)) {
    let score = 0;
    for (const kw of keywords) {
      if (normalizedText.includes(kw)) {
        score++;
      }
    }
    if (score > bestSceneScore) {
      bestSceneScore = score;
      result.sceneTag = tag;
    }
  }

  // Find emotion
  let bestEmotionScore = 0;
  for (const [tag, keywords] of Object.entries(emotionKeywords)) {
    let score = 0;
    for (const kw of keywords) {
      if (normalizedText.includes(kw)) {
        score++;
      }
    }
    if (score > bestEmotionScore) {
      bestEmotionScore = score;
      result.emotionTag = tag;
    }
  }

  return result;
}

export function findBestMatch(images, sceneTag, emotionTag) {
  if (!images || !images.length) {
    return null;
  }

  // Exact match: both scene and emotion
  if (sceneTag && emotionTag) {
    const exact = images.find((img) => img.sceneTag === sceneTag && img.emotionTag === emotionTag);
    if (exact) return exact;
  }

  // Scene match only
  if (sceneTag) {
    const sceneMatch = images.find((img) => img.sceneTag === sceneTag);
    if (sceneMatch) return sceneMatch;
  }

  // Emotion match only
  if (emotionTag) {
    const emotionMatch = images.find((img) => img.emotionTag === emotionTag);
    if (emotionMatch) return emotionMatch;
  }

  // Default image
  const defaultImg = images.find((img) => img.isDefault);
  if (defaultImg) return defaultImg;

  // First image as fallback
  return images[0] || null;
}

// ── Helpers ──

function normalizeTag(value) {
  return String(value || '').trim().slice(0, 32);
}

function reorderAfterDelete(database, characterId) {
  const rows = database
    .prepare('SELECT id FROM character_images WHERE character_id = ? ORDER BY order_index ASC')
    .all(characterId);
  const update = database.prepare('UPDATE character_images SET order_index = ? WHERE id = ?');
  rows.forEach((row, index) => update.run(index, row.id));
}

function toCharacterImage(row) {
  if (!row) return null;
  return {
    id: row.id,
    characterId: row.character_id,
    imageUrl: row.image_url,
    sceneTag: row.scene_tag || '',
    emotionTag: row.emotion_tag || '',
    isDefault: Boolean(row.is_default),
    orderIndex: row.order_index,
    createdAt: row.created_at
  };
}
