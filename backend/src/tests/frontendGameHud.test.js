import assert from 'node:assert/strict';
import test from 'node:test';
import { readRepoText, readVueBlocks } from './frontendSfcTestUtils.js';

const { script, template, style } = readVueBlocks('frontend/src/components/game/GameHud.vue', ['script', 'template', 'style']);
const apiSource = readRepoText('frontend/src/api/chat.js');
const routeSource = readRepoText('backend/src/routes/conversationGameplay.js');
const { script: chatViewScript, template: chatViewTemplate } = readVueBlocks('frontend/src/views/ChatView.vue', ['script', 'template']);
const chatAccessorySource = readRepoText('frontend/src/composables/chat/useChatAccessory.js');

test('GameHud reads persistent world events incrementally and tracks unread changes', () => {
  assert.match(apiSource, /export function fetchGameplayEvents\(conversationId, options = \{\}\)/);
  assert.match(apiSource, /gameplay\/events/);
  assert.match(script, /fetchGameplayEvents\(conversationId, \{ afterCursor: previousCursor, limit: 100 \}\)/);
  assert.match(script, /unreadEventCount\.value \+= newEvents\.length/);
  assert.match(script, /eventCursor\.value = Math\.max/);
  assert.match(template, /class="game-hud-event-list"/);
  assert.match(template, /v-for="event in worldEvents"/);
  assert.match(template, /aria-label="未读世界事件"/);
  assert.match(style, /\.game-hud-event-list/);
});

test('GameHud is completely removed from layout when its accessory switch is off', () => {
  assert.match(chatViewTemplate, /<GameHud\s+[\s\S]*v-if="conversation\?\.id && showGameHudFeature"/);
  assert.match(chatViewScript, /showEconomyFeature, showSceneFeature, showGameHudFeature/);
  assert.match(chatAccessorySource, /\{ key: 'gameHud', label: '游戏驾驶舱 \/ 地图', auto: false \}/);
  assert.match(chatAccessorySource, /const showGameHudFeature = computed\(\(\) => isAccessorySkillActiveLocal\('gameHud'\)\)/);
});

test('gameplay event route exposes owned incremental reads', () => {
  assert.match(routeSource, /router\.get\('\/events', requireAuth/);
  assert.match(routeSource, /afterCursor: request\.query\.afterCursor/);
  assert.match(routeSource, /if \(!result\) return response\.status\(404\)/);
});

test('GameHud exposes task and confirmed server-side checks', () => {
  assert.match(apiSource, /export function performGameplayCheck/);
  assert.match(script, /const pendingCheck = ref\(null\)/);
  assert.match(script, /await performGameplayCheck\(props\.conversationId, pendingCheck\.value\)/);
  assert.match(template, /class="game-hud-quest"/);
  assert.match(template, /确认掷骰/);
  assert.match(template, /icon-key="action\.dice"/);
  assert.match(style, /\.game-hud-check-confirm/);
});

test('GameHud advances the world clock', () => {
  assert.match(apiSource, /export function advanceGameplayTime/);
  assert.match(apiSource, /export function updateGameplayWeather/);
  assert.match(script, /await advanceGameplayTime\(props\.conversationId, minutes\)/);
  assert.match(script, /await updateGameplayWeather/);
  assert.match(template, /class="game-hud-world-controls"/);
  assert.match(template, /advanceTime\(15\)/);
  assert.match(template, /advanceTime\(60\)/);
  assert.match(style, /\.game-hud-world-controls/);
});

test('GameHud exposes only server-provided direct travel routes', () => {
  assert.match(apiSource, /export function travelGameplayToNode\(conversationId, destinationNodeId\)/);
  assert.match(script, /const travelMap = computed/);
  assert.match(script, /travelGameplayToNode\(props\.conversationId, destinationNodeId\)/);
  assert.match(template, /class="game-hud-map-routes"/);
  assert.match(template, /v-for="route in availableRoutes"/);
  assert.match(template, /route\.minutes/);
});

test('reward UI is independently gated and claims server grants', () => {
  assert.match(chatViewScript, /showGameHudFeature, showRewardFeature/);
  assert.match(chatViewTemplate, /:reward-enabled="showRewardFeature"/);
  assert.match(chatAccessorySource, /\{ key: 'rewardMode', label: '战利品与奖励结算', auto: false \}/);
  assert.match(template, /v-if="rewardEnabled && pendingRewards\.length" class="game-hud-rewards"/);
  assert.match(script, /claimGameplayReward\(props\.conversationId, grantId\)/);
});

test('GameHud reports world director execution and rejection diagnostics', () => {
  assert.match(script, /directorExecutions/);
  assert.match(script, /directorRejected/);
  assert.match(template, /class="game-hud-director"/);
  assert.match(template, /世界导演/);
  assert.match(template, /拒绝 \{\{ directorRejected\.length \}\} 项/);
  assert.match(style, /\.game-hud-director\.has-error/);
});
