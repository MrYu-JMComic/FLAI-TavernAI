import assert from 'node:assert/strict';
import test from 'node:test';
import { readVueBlocks } from './frontendSfcTestUtils.js';

const {
  script: townExperienceScript,
  template: townExperienceTemplate
} = readVueBlocks('frontend/src/features/town/TownExperience.vue', ['script', 'template']);

const {
  script: generatedMapScript,
  template: generatedMapTemplate
} = readVueBlocks('frontend/src/features/town/TownGeneratedMap.vue', ['script', 'template']);

test('town creation sends a natural-language prompt to AI without a script parser path', () => {
  assert.match(townExperienceScript, /const worldPrompt = ref\(''\);/);
  assert.match(townExperienceScript, /generateTown\(\{ prompt, simulationStatus: 'paused' \}\)/);
  assert.match(townExperienceScript, /snapshot\.generation\?\.provider/);
  assert.match(townExperienceScript, /worldCreationError\.value = `创建世界失败：\$\{error\.message\}`/);
  assert.doesNotMatch(townExperienceScript, /initializationScript|EXAMPLE_SCRIPT|parseTownInitializationScript/);
  assert.doesNotMatch(townExperienceScript, /bianjing-night-market/);
  assert.match(townExperienceTemplate, /自然语言世界构想/);
  assert.match(townExperienceTemplate, /AI 正在生成世界与地图/);
  assert.match(townExperienceTemplate, /class="town-world-error" role="alert"/);
});

test('new town maps render from procedural map configuration while legacy image worlds remain compatible', () => {
  assert.match(townExperienceScript, /worldMap\.value\.renderMode === 'procedural-v1'/);
  assert.match(
    townExperienceTemplate,
    /<TownGeneratedMap v-if="usesProceduralMap" :map-config="worldMap"[\s\S]*<img v-else-if="worldMap\.imageUrl"/
  );
  assert.match(generatedMapTemplate, /<canvas[\s\S]*role="img"/);
  assert.match(generatedMapScript, /drawTerrain\(context, map\.terrainPatches, palette\)/);
  assert.match(generatedMapScript, /drawWater\(context, map\.waterBodies, palette\)/);
  assert.match(generatedMapScript, /drawRoads\(context, map\.roads, palette\)/);
  assert.match(generatedMapScript, /drawBuildings\(context, map\.buildings, palette\)/);
});

test('paused worlds expose an explicit AI turn that refreshes the real snapshot without racing polling', () => {
  assert.match(townExperienceScript, /advanceTownWithAi/);
  assert.match(townExperienceScript, /const aiStepBusy = ref\(false\);/);
  assert.match(
    townExperienceScript,
    /async function refreshSnapshot\(\)[\s\S]*snapshotRequestActive\.value[\s\S]*aiStepBusy\.value[\s\S]*cognitionBusy\.value[\s\S]*worldCreatorOpen\.value[\s\S]*\) return;/
  );
  assert.match(townExperienceScript, /const result = await advanceTownWithAi\(activeTownId\);/);
  assert.match(townExperienceScript, /applyTownSnapshot\(result\.snapshot\);/);
  assert.match(townExperienceScript, /if \(source === 'ai-town-engine'\) return 'AI 推演';/);
  assert.match(townExperienceTemplate, /class="town-control-button ai-step"[\s\S]*:disabled="isRunning \|\| aiStepBusy \|\| cognitionBusy \|\| simulationBusy"/);
  assert.match(townExperienceTemplate, /<Sparkles :size="18" \/><span>\{\{ aiStepBusy \? 'AI 推演中…' : 'AI 推演' \}\}<\/span>/);
});

test('resident panel exposes AI-backed reflection status and daily schedule without local text parsing', () => {
  assert.match(townExperienceScript, /fetchTownResidentCognition/);
  assert.match(townExperienceScript, /planTownResidentCognitionWithAi/);
  assert.match(townExperienceScript, /const cognitionByResident = ref\(\{\}\);/);
  assert.match(townExperienceScript, /const result = await planTownResidentCognitionWithAi\(activeTownId, residentId\);/);
  assert.match(townExperienceScript, /cognitionByResident\.value = \{ \.\.\.cognitionByResident\.value, \[residentId\]: result\.cognition \};/);
  assert.match(townExperienceTemplate, /<span>认知<\/span>/);
  assert.match(townExperienceTemplate, /反思积累/);
  assert.match(townExperienceTemplate, /AI 反思与规划/);
  assert.match(townExperienceTemplate, /第 \{\{ selectedCognition\.day \}\} 天日程/);
  assert.doesNotMatch(townExperienceScript, /parse.*Reflection|parse.*Schedule|正则/);
});
