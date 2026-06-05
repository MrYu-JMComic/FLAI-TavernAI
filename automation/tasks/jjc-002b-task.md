# JJC-002B Task

Make ALL of the following changes. All files must be UTF-8.

## Change 1: Backend routes - Character world book linking

File: `backend/src/routes/characters.js`

### 1a. Update import
Line 22 has the end of the worldBooks.js import:
```js
} from '../modules/worldBooks.js';
```
Add `listCharacterWorldBooks` and `unlinkWorldBookFromCharacter` to that import.

### 1b. Add 3 new routes
Add these routes before the `return router;` at the end of createCharactersRouter:

```js
// ── Character World Books ──

router.get('/:id/world-books', requireAuth, (request, response) => {
  const character = getCharacter(db, request.auth.user.id, request.params.id);
  if (!character) {
    response.status(404).json({ error: '角色不存在' });
    return;
  }
  response.json(listCharacterWorldBooks(db, request.params.id));
});

router.post('/:id/world-books', requireAuth, (request, response) => {
  const character = getCharacter(db, request.auth.user.id, request.params.id);
  if (!character) {
    response.status(404).json({ error: '角色不存在' });
    return;
  }
  if (!character.canEdit) {
    response.status(403).json({ error: '只有角色拥有者可以编辑此角色' });
    return;
  }
  const bookId = String(request.body?.worldBookId || '').trim();
  if (!bookId) {
    response.status(400).json({ error: '请提供世界书 ID' });
    return;
  }
  const orderIndex = Number(request.body?.orderIndex) || 0;
  linkWorldBookToCharacter(db, bookId, request.params.id, orderIndex);
  response.json({ ok: true });
});

router.delete('/:id/world-books/:bookId', requireAuth, (request, response) => {
  const character = getCharacter(db, request.auth.user.id, request.params.id);
  if (!character) {
    response.status(404).json({ error: '角色不存在' });
    return;
  }
  if (!character.canEdit) {
    response.status(403).json({ error: '只有角色拥有者可以编辑此角色' });
    return;
  }
  if (!unlinkWorldBookFromCharacter(db, request.params.bookId, request.params.id)) {
    response.status(404).json({ error: '关联不存在' });
    return;
  }
  response.json({ ok: true });
});
```

## Change 2: Frontend API functions

File: `frontend/src/api.js`

Add these 3 functions after the existing `deleteCharacter` export or near the other character exports:

```js
export function fetchCharacterWorldBooks(characterId) {
  return apiRequest(`/api/characters/${characterId}/world-books`);
}

export function linkCharacterWorldBook(characterId, worldBookId) {
  return apiRequest(`/api/characters/${characterId}/world-books`, {
    method: 'POST',
    body: JSON.stringify({ worldBookId })
  });
}

export function unlinkCharacterWorldBook(characterId, worldBookId) {
  return apiRequest(`/api/characters/${characterId}/world-books/${worldBookId}`, {
    method: 'DELETE'
  });
}
```

## Change 3: Frontend - Multi world book selection

File: `frontend/src/views/CharacterFormView.vue`

### 3a. Update imports
In the script setup, the existing import line:
```js
import { completeCharacterDraft, createCharacter, createTag, deleteCharacter, exportCharacter, fetchCharacter, fetchTags, fetchWorldBooks, updateCharacter } from '../api';
```
Add: `fetchCharacterWorldBooks`, `linkCharacterWorldBook`, `unlinkCharacterWorldBook`

### 3b. Add reactive state
After `const worldBooks = ref([]);`, add:
```js
const selectedWorldBookIds = ref([]);
```

### 3c. Update onMounted
After the existing `worldBooks.value` fetch and after loading the character in edit mode, add:
```js
const linkedBooks = await fetchCharacterWorldBooks(props.route.params.id);
selectedWorldBookIds.value = linkedBooks.map((b) => b.id);
```
This should be inside the edit mode try block, after `Object.assign(form, normalizeForForm(character));`

### 3d. Add toggleWorldBook function
```js
function toggleWorldBook(bookId) {
  const idx = selectedWorldBookIds.value.indexOf(bookId);
  if (idx >= 0) {
    selectedWorldBookIds.value.splice(idx, 1);
  } else {
    selectedWorldBookIds.value.push(bookId);
  }
}
```

### 3e. Update submit function
After the character is saved (after the `notify.success` call), add world book sync:
```js
// Sync world book links
if (isEditing.value) {
  const currentLinked = await fetchCharacterWorldBooks(saved.id);
  const currentIds = currentLinked.map((b) => b.id);
  const toAdd = selectedWorldBookIds.value.filter((id) => !currentIds.includes(id));
  const toRemove = currentIds.filter((id) => !selectedWorldBookIds.value.includes(id));
  for (const bookId of toAdd) {
    await linkCharacterWorldBook(saved.id, bookId);
  }
  for (const bookId of toRemove) {
    await unlinkCharacterWorldBook(saved.id, bookId);
  }
} else {
  for (const bookId of selectedWorldBookIds.value) {
    await linkCharacterWorldBook(saved.id, bookId);
  }
}
```

### 3f. Remove worldBookId from toPayload
In toPayload(), remove or delete the line:
```
worldBookId: form.worldBookId || null,
```

### 3g. Remove worldBookId from emptyCharacter
In emptyCharacter(), remove:
```
worldBookId: '',
```

### 3h. Update normalizeForForm
Remove or update the line `worldBookId: character.worldBookId || '',` in normalizeForForm.

### 3i. Replace template
Replace the existing "关联世界书" field that uses `<select>`:
```html
<label class="field full-span">
  <span>关联世界书</span>
  <select v-model="form.worldBookId" :disabled="!canEdit">
    <option value="">不关联</option>
    <option v-for="wb in worldBooks" :key="wb.id" :value="wb.id">{{ wb.name }}</option>
  </select>
  <small v-if="worldBooks.length" class="muted-text">选择世界书后，对话中触发词匹配时会自动注入设定</small>
  <small v-else class="muted-text">还没有世界书，去 <a href="#/world-books">世界书管理</a> 创建</small>
</label>
```

With:
```html
<label class="field full-span">
  <span>关联世界书</span>
  <div v-if="worldBooks.length" class="world-book-selector">
    <label v-for="wb in worldBooks" :key="wb.id" class="checkbox-line">
      <input
        type="checkbox"
        :checked="selectedWorldBookIds.includes(wb.id)"
        :disabled="!canEdit"
        @change="toggleWorldBook(wb.id)"
      />
      <span>{{ wb.name }}</span>
      <small class="muted-text">({{ wb.entryCount || 0 }} 条目)</small>
    </label>
  </div>
  <small v-else class="muted-text">还没有世界书，去 <a href="#/world-books">世界书管理</a> 创建</small>
  <small v-if="selectedWorldBookIds.length" class="muted-text">已关联 {{ selectedWorldBookIds.length }} 本世界书</small>
</label>
```

## Change 4: Backend tests

File: `backend/src/tests/backend.test.js`

Add these 3 test cases at the END of the file (after the last existing test):

### Test 1: alwaysActive
```js
test('world book alwaysActive entry matches without any trigger keys', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'user-1', 'tester', 'hash', new Date().toISOString()
  );
  const character = createCharacter(database, 'user-1', { name: 'AlwaysActive角色', visibility: 'private' });
  const book = createWorldBook(database, 'user-1', { name: 'AlwaysActive测试书' });
  linkWorldBookToCharacter(database, book.id, character.id);

  createEntry(database, 'user-1', book.id, {
    name: '永久条目',
    triggerKeys: '',
    content: '永久激活的内容',
    enabled: true,
    alwaysActive: true
  });

  const matches = matchWorldBookEntries(database, character.id, '');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].name, '永久条目');
  assert.equal(matches[0].content, '永久激活的内容');
});
```

### Test 2: regexMode
```js
test('world book regexMode entry matches by regex pattern', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'user-1', 'tester', 'hash', new Date().toISOString()
  );
  const character = createCharacter(database, 'user-1', { name: 'RegexMode角色', visibility: 'private' });
  const book = createWorldBook(database, 'user-1', { name: 'RegexMode测试书' });
  linkWorldBookToCharacter(database, book.id, character.id);

  createEntry(database, 'user-1', book.id, {
    name: '数字匹配',
    triggerKeys: '\\d+',
    content: '检测到数字',
    enabled: true,
    regexMode: true
  });

  const matches = matchWorldBookEntries(database, character.id, '我有42个苹果');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].content, '检测到数字');

  const noMatches = matchWorldBookEntries(database, character.id, '我没有苹果');
  assert.equal(noMatches.length, 0);
});
```

### Test 3: selective NOT
```js
test('world book selective NOT logic filters out when secondary key present', () => {
  const database = createAppDatabase(':memory:');
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'user-1', 'tester', 'hash', new Date().toISOString()
  );
  const character = createCharacter(database, 'user-1', { name: 'SelectiveNot角色', visibility: 'private' });
  const book = createWorldBook(database, 'user-1', { name: 'SelectiveNot测试书' });
  linkWorldBookToCharacter(database, book.id, character.id);

  createEntry(database, 'user-1', book.id, {
    name: '和平场景',
    triggerKeys: '场景',
    content: '和平的场景描述',
    enabled: true,
    selective: true,
    selectiveLogic: 1,
    keysSecondary: '战斗'
  });

  const matches = matchWorldBookEntries(database, character.id, '一个美丽的场景');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].content, '和平的场景描述');

  const blocked = matchWorldBookEntries(database, character.id, '一个激烈的战斗场景');
  assert.equal(blocked.length, 0);
});
```

## IMPORTANT
- All files must be UTF-8 encoded
- Do NOT remove any existing code that is not mentioned
- Make minimal changes - only what's described above
- Verify the changes compile correctly
