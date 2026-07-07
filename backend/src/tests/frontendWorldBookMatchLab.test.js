import assert from 'node:assert/strict';
import test from 'node:test';
import { readRepoText, readVueBlocks } from './frontendSfcTestUtils.js';

const {
  script: matchLabScript,
  template: matchLabTemplate
} = readVueBlocks('frontend/src/components/worldbook/WorldBookMatchLab.vue');
const {
  script: worldBookViewScript,
  template: worldBookViewTemplate
} = readVueBlocks('frontend/src/views/WorldBookView.vue');
const downloadJsonSource = readRepoText('frontend/src/utils/downloadJson.js');

test('WorldBookMatchLab reuses the world book match preview API', () => {
  assert.match(matchLabScript, /import \{ previewWorldBookMatches \} from '\.\.\/\.\.\/api\/worldBooks\.js';/);
  assert.match(
    matchLabScript,
    /const result = await previewWorldBookMatches\(worldBookId, \{ text \}\);/
  );
  assert.match(
    matchLabScript,
    /const requestToken = \+\+matchPreviewToken;[\s\S]*if \(!isCurrentMatchPreview\(requestToken, worldBookId\)\) \{[\s\S]*return;/
  );
  assert.match(
    matchLabScript,
    /function isCurrentMatchPreview\(requestToken, worldBookId\) \{[\s\S]*!matchLabDisposed[\s\S]*requestToken === matchPreviewToken[\s\S]*String\(props\.worldBookId \|\| ''\)\.trim\(\) === worldBookId;[\s\S]*\}/
  );
  assert.match(matchLabScript, /watch\(\(\) => props\.worldBookId/);
});

test('WorldBookMatchLab exposes trigger testing and hit explanation UI', () => {
  assert.match(matchLabTemplate, /<h2>匹配实验室<\/h2>/);
  assert.match(matchLabTemplate, /v-model="matchText"/);
  assert.match(matchLabTemplate, /@click="runMatchPreview"/);
  assert.match(matchLabTemplate, /{{ matchLoading \? '测试中\.\.\.' : '测试触发' }}/);
  assert.match(matchLabTemplate, /{{ matchCount }}/);
  assert.match(matchLabTemplate, /v-for="match in matchItems"/);
  assert.match(matchLabTemplate, /match\.matchedKeys\.join\('、'\)/);
  assert.match(matchLabTemplate, /{{ match\.positionLabel }}/);
  assert.match(matchLabScript, /const effectiveMatchCount = computed/);
  assert.match(matchLabScript, /const groupItems = computed/);
  assert.match(matchLabScript, /const blockedItems = computed/);
  assert.match(matchLabScript, /function statusLabel\(status\)/);
  assert.match(matchLabScript, /function selectiveLabel\(match\)/);
  assert.match(matchLabScript, /function probabilityLabel\(match\)/);
  assert.match(matchLabScript, /function statefulLabels\(match\)/);
  assert.match(matchLabTemplate, /有效 {{ effectiveMatchCount }} · 扫描 {{ scannedTextLength }} 字/);
  assert.match(matchLabTemplate, /<h3>分组权重<\/h3>/);
  assert.match(matchLabTemplate, /v-for="group in groupItems"/);
  assert.match(matchLabTemplate, /冲突预览：/);
  assert.match(matchLabTemplate, /权重 {{ entry\.weight }} · {{ entry\.shareLabel }}/);
  assert.match(matchLabTemplate, /<h3>未命中诊断<\/h3>/);
  assert.match(matchLabTemplate, /v-for="entry in blockedItems"/);
  assert.match(matchLabTemplate, /无效正则：{{ entry\.invalidRegexKeys\.join\('、'\) }}/);
});

test('WorldBookView mounts the match lab in the detail workspace', () => {
  assert.match(worldBookViewScript, /import WorldBookMatchLab from '\.\.\/components\/worldbook\/WorldBookMatchLab\.vue';/);
  assert.match(
    worldBookViewTemplate,
    /<WorldBookMatchLab[\s\S]*:world-book-id="currentBook\.id"[\s\S]*:disabled="saving \|\| loading"[\s\S]*\/>/
  );
  assert.match(
    worldBookViewTemplate,
    /<\/div>\s*<WorldBookMatchLab[\s\S]*<div class="form-panel entries-panel">/
  );
});

test('WorldBookView exports and imports world books through unified envelopes', () => {
  assert.match(
    worldBookViewScript,
    /import \{[\s\S]*Download,[\s\S]*Upload,[\s\S]*\} from '@lucide\/vue';/
  );
  assert.match(worldBookViewScript, /import \{ exportEnvelope, importEnvelope \} from '\.\.\/api\/envelopes\.js';/);
  assert.match(worldBookViewScript, /import \{ downloadJsonFile, todayStamp \} from '\.\.\/utils\/downloadJson\.js';/);
  assert.match(
    worldBookViewScript,
    /async function exportWorldBooks\(\) \{\s*if \(saving\.value \|\| isDetailView\.value\) return;[\s\S]*const envelope = await exportEnvelope\('world-books'\);[\s\S]*downloadJsonFile\(envelope, `flai-world-books-\$\{todayStamp\(\)\}\.json`\);/
  );
  assert.match(
    worldBookViewScript,
    /async function importWorldBooks\(importText, mutationToken = worldBookMutationToken, routeKey = currentWorldBookRouteKey\(\)\) \{[\s\S]*const parsed = JSON\.parse\(String\(importText \|\| ''\)\);[\s\S]*const result = await importEnvelope\('world-books', parsed\);[\s\S]*await loadBooks\(\);/
  );
  assert.match(
    worldBookViewScript,
    /function handleWorldBookImportFile\(event\) \{[\s\S]*const input = event\?\.target;[\s\S]*const file = input\?\.files\?\.\[0\];[\s\S]*if \(input\) \{[\s\S]*input\.value = '';[\s\S]*\}[\s\S]*if \(!file \|\| saving\.value \|\| isDetailView\.value\) return;/
  );
  assert.match(
    worldBookViewScript,
    /try \{\s*reader\.readAsText\(file\);\s*\} catch \{\s*reader\.onerror\?\.\(\);\s*\}/
  );
  assert.match(
    worldBookViewTemplate,
    /:disabled="saving \|\| !books\.length"[\s\S]*@click="exportWorldBooks"/
  );
  assert.match(
    worldBookViewTemplate,
    /<label class="ghost-button file-import-button" :class="\{ disabled: saving \}" :aria-busy="saving">[\s\S]*<input type="file" accept="\.json" :disabled="saving" @change="handleWorldBookImportFile" \/>/
  );
  assert.match(downloadJsonSource, /export function downloadJsonFile\(data, filename\)/);
  assert.doesNotMatch(worldBookViewScript, /URL\.createObjectURL/);
});
