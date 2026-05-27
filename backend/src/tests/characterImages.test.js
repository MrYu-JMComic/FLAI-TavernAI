import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret';

const { createAppDatabase } = await import('../db.js');
const { createCharacter, getCharacter } = await import('../modules/characters.js');
const {
  createCharacterImage,
  deleteCharacterImage,
  detectSceneAndEmotion,
  findBestMatch,
  listCharacterImages,
  reorderCharacterImages,
  updateCharacterImage
} = await import('../modules/characterImages.js');

function setupDatabase() {
  const database = createAppDatabase(':memory:');
  const userId = 'user-1';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId,
    'tester',
    'hash',
    new Date().toISOString()
  );
  const character = createCharacter(database, userId, {
    name: 'CG测试角色',
    persona: '测试用角色',
    visibility: 'private'
  });
  return { database, userId, character };
}

test('character images CRUD operations', () => {
  const { database, character } = setupDatabase();

  // Initially empty
  const empty = listCharacterImages(database, character.id);
  assert.equal(empty.length, 0);

  // Create first image (default)
  const img1 = createCharacterImage(database, {
    characterId: character.id,
    imageUrl: 'data:image/png;base64,AAAA',
    sceneTag: '日常',
    emotionTag: '开心',
    isDefault: true
  });
  assert.equal(img1.sceneTag, '日常');
  assert.equal(img1.emotionTag, '开心');
  assert.equal(img1.isDefault, true);
  assert.equal(img1.orderIndex, 0);

  // Create second image
  const img2 = createCharacterImage(database, {
    characterId: character.id,
    imageUrl: 'data:image/png;base64,BBBB',
    sceneTag: '战斗',
    emotionTag: '愤怒',
    isDefault: false
  });
  assert.equal(img2.orderIndex, 1);

  // List images
  const all = listCharacterImages(database, character.id);
  assert.equal(all.length, 2);
  assert.equal(all[0].id, img1.id);
  assert.equal(all[1].id, img2.id);

  // Update image tags
  const updated = updateCharacterImage(database, character.id, img1.id, {
    sceneTag: '学校',
    emotionTag: '害羞'
  });
  assert.equal(updated.sceneTag, '学校');
  assert.equal(updated.emotionTag, '害羞');
  assert.equal(updated.isDefault, true);

  // Update returns null for non-existent image
  assert.equal(updateCharacterImage(database, character.id, 'nonexistent', { sceneTag: 'x' }), null);

  // Delete image
  assert.equal(deleteCharacterImage(database, character.id, img2.id), true);
  assert.equal(listCharacterImages(database, character.id).length, 1);
  assert.equal(deleteCharacterImage(database, character.id, 'nonexistent'), false);
});

test('character images reorder', () => {
  const { database, character } = setupDatabase();

  const img1 = createCharacterImage(database, {
    characterId: character.id,
    imageUrl: 'data:image/png;base64,1111',
    sceneTag: 'A'
  });
  const img2 = createCharacterImage(database, {
    characterId: character.id,
    imageUrl: 'data:image/png;base64,2222',
    sceneTag: 'B'
  });
  const img3 = createCharacterImage(database, {
    characterId: character.id,
    imageUrl: 'data:image/png;base64,3333',
    sceneTag: 'C'
  });

  // Reorder: move third to first
  const changed = reorderCharacterImages(database, character.id, [img3.id, img1.id, img2.id]);
  assert.equal(changed, 3);

  const ordered = listCharacterImages(database, character.id);
  assert.equal(ordered[0].id, img3.id);
  assert.equal(ordered[0].orderIndex, 0);
  assert.equal(ordered[1].id, img1.id);
  assert.equal(ordered[1].orderIndex, 1);
  assert.equal(ordered[2].id, img2.id);
  assert.equal(ordered[2].orderIndex, 2);
});

test('character images max limit', () => {
  const { database, character } = setupDatabase();

  // Create 20 images (the limit)
  for (let i = 0; i < 20; i++) {
    createCharacterImage(database, {
      characterId: character.id,
      imageUrl: `data:image/png;base64,${Buffer.from(`img${i}`).toString('base64')}`,
      sceneTag: `tag${i}`
    });
  }

  assert.equal(listCharacterImages(database, character.id).length, 20);

  // 21st should fail
  assert.throws(
    () => createCharacterImage(database, {
      characterId: character.id,
      imageUrl: 'data:image/png;base64,OVER',
      sceneTag: 'overflow'
    }),
    /最多.*20.*立绘/
  );
});

test('scene and emotion detection from text', () => {
  // Scene detection
  const r1 = detectSceneAndEmotion('我们在教室里上课，老师正在讲课');
  assert.equal(r1.sceneTag, '学校');

  const r2 = detectSceneAndEmotion('下雨了，雨下得很大，我们打着雨伞');
  assert.equal(r2.sceneTag, '雨天');

  const r3 = detectSceneAndEmotion('我们在海边散步，看着海浪');
  assert.equal(r3.sceneTag, '海边');

  const r4 = detectSceneAndEmotion('今晚的月亮真美，星空很亮');
  assert.equal(r4.sceneTag, '夜晚');

  // Emotion detection
  const r5 = detectSceneAndEmotion('她开心地笑了，高兴极了');
  assert.equal(r5.emotionTag, '开心');

  const r6 = detectSceneAndEmotion('她难过地哭了起来，眼泪流下来');
  assert.equal(r6.emotionTag, '悲伤');

  const r7 = detectSceneAndEmotion('她害羞地脸红了，不好意思地说');
  assert.equal(r7.emotionTag, '害羞');

  const r8 = detectSceneAndEmotion('她愤怒地吼道，气得发抖');
  assert.equal(r8.emotionTag, '愤怒');

  // No match
  const r9 = detectSceneAndEmotion('今天天气不错');
  assert.equal(r9.sceneTag, '');
  assert.equal(r9.emotionTag, '');

  // Empty text
  const r10 = detectSceneAndEmotion('');
  assert.equal(r10.sceneTag, '');
  assert.equal(r10.emotionTag, '');
});

test('findBestMatch selects by scene, emotion, default, or first', () => {
  const images = [
    { id: '1', sceneTag: '日常', emotionTag: '', isDefault: false },
    { id: '2', sceneTag: '学校', emotionTag: '开心', isDefault: false },
    { id: '3', sceneTag: '学校', emotionTag: '', isDefault: true },
    { id: '4', sceneTag: '', emotionTag: '悲伤', isDefault: false }
  ];

  // Exact match (scene + emotion)
  assert.equal(findBestMatch(images, '学校', '开心').id, '2');

  // Scene match only
  assert.equal(findBestMatch(images, '日常', '').id, '1');

  // Emotion match only
  assert.equal(findBestMatch(images, '', '悲伤').id, '4');

  // Falls back to default
  assert.equal(findBestMatch(images, '森林', '').id, '3');

  // Falls back to first when no default
  const noDefault = [
    { id: 'a', sceneTag: 'X', emotionTag: '', isDefault: false },
    { id: 'b', sceneTag: 'Y', emotionTag: '', isDefault: false }
  ];
  assert.equal(findBestMatch(noDefault, 'Z', '').id, 'a');

  // Returns null for empty list
  assert.equal(findBestMatch([], '学校', '开心'), null);

  // Returns null for null list
  assert.equal(findBestMatch(null, '', ''), null);
});

test('delete reorders remaining images', () => {
  const { database, character } = setupDatabase();

  const img1 = createCharacterImage(database, {
    characterId: character.id,
    imageUrl: 'data:image/png;base64,1111'
  });
  const img2 = createCharacterImage(database, {
    characterId: character.id,
    imageUrl: 'data:image/png;base64,2222'
  });
  const img3 = createCharacterImage(database, {
    characterId: character.id,
    imageUrl: 'data:image/png;base64,3333'
  });

  // Delete the middle one
  deleteCharacterImage(database, character.id, img2.id);

  const remaining = listCharacterImages(database, character.id);
  assert.equal(remaining.length, 2);
  assert.equal(remaining[0].id, img1.id);
  assert.equal(remaining[0].orderIndex, 0);
  assert.equal(remaining[1].id, img3.id);
  assert.equal(remaining[1].orderIndex, 1);
});

test('character images tag normalization', () => {
  const { database, character } = setupDatabase();

  const img = createCharacterImage(database, {
    characterId: character.id,
    imageUrl: 'data:image/png;base64,AAAA',
    sceneTag: '  日常  ',
    emotionTag: '  开心  '
  });

  assert.equal(img.sceneTag, '日常');
  assert.equal(img.emotionTag, '开心');

  // Long tags are truncated
  const longTag = 'a'.repeat(50);
  const img2 = createCharacterImage(database, {
    characterId: character.id,
    imageUrl: 'data:image/png;base64,BBBB',
    sceneTag: longTag
  });
  assert.equal(img2.sceneTag.length, 32);
});

test('character images belong to character, not user', () => {
  const { database, character } = setupDatabase();

  createCharacterImage(database, {
    characterId: character.id,
    imageUrl: 'data:image/png;base64,AAAA',
    sceneTag: '日常'
  });

  // Different character has no images
  const otherChar = createCharacter(database, 'user-1', {
    name: '另一个角色',
    visibility: 'private'
  });
  assert.equal(listCharacterImages(database, otherChar.id).length, 0);

  // Non-existent character
  assert.equal(listCharacterImages(database, 'nonexistent').length, 0);
});
