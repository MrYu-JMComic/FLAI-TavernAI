<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { Dice6, Sparkles, Trash2, X } from '@lucide/vue';
import { deleteAllCharacterTalents, deleteCharacterTalent, fetchCharacterTalents, fetchTalentPools, rollCharacterTalent } from '../api';
import TalentBadge from './TalentBadge.vue';
import { useNotify } from '../composables/useNotify';

const props = defineProps({
  characterId: { type: String, required: true },
  characterName: { type: String, default: '' },
  canEdit: { type: Boolean, default: true }
});
const emit = defineEmits(['close', 'updated']);

const notify = useNotify();
const pools = ref([]);
const talents = ref([]);
const selectedPoolId = ref('');
const rolling = ref(false);
const rollResult = ref(null);
const showResult = ref(false);
const loading = ref(true);
const loadError = ref('');
const clearingAll = ref(false);
const removingTalentId = ref('');
let loadRequestId = 0;
let dialogContextVersion = 0;
let dialogDisposed = false;

const selectedPool = computed(() => pools.value.find((p) => p.id === selectedPoolId.value));
const talentMutationBusy = computed(() => clearingAll.value || Boolean(removingTalentId.value));
const talentActionBusy = computed(() => loading.value || rolling.value || talentMutationBusy.value);
const dialogCloseLocked = computed(() => rolling.value || talentMutationBusy.value);

watch(
  () => [props.characterId, props.canEdit],
  () => {
    resetDialogContext();
    loadDialogData();
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  dialogDisposed = true;
  dialogContextVersion += 1;
  rolling.value = false;
  clearingAll.value = false;
  removingTalentId.value = '';
});

async function loadDialogData() {
  const requestId = ++loadRequestId;
  const context = getDialogContext();
  loading.value = true;
  loadError.value = '';
  rollResult.value = null;
  showResult.value = false;
  try {
    const [poolData, talentData] = await Promise.all([
      context.canEdit ? fetchTalentPools() : Promise.resolve([]),
      fetchCharacterTalents(context.characterId)
    ]);
    if (requestId !== loadRequestId || !isCurrentDialogContext(context)) {
      return;
    }
    setPoolsIfChanged(poolData);
    setTalentsIfChanged(talentData);
    if (!pools.value.some((pool) => pool.id === selectedPoolId.value)) {
      selectedPoolId.value = '';
    }
    if (!selectedPoolId.value && pools.value.length) {
      selectedPoolId.value = pools.value[0].id;
    }
  } catch (err) {
    if (requestId !== loadRequestId || !isCurrentDialogContext(context)) {
      return;
    }
    setPoolsIfChanged([]);
    setTalentsIfChanged([]);
    loadError.value = err?.message || '天赋加载失败';
  } finally {
    if (requestId === loadRequestId && isCurrentDialogContext(context)) {
      loading.value = false;
    }
  }
}

function retryLoadDialogData() {
  if (loading.value) return;
  loadDialogData();
}

function resetDialogContext() {
  dialogContextVersion += 1;
  setPoolsIfChanged([]);
  setTalentsIfChanged([]);
  selectedPoolId.value = '';
  rolling.value = false;
  clearingAll.value = false;
  removingTalentId.value = '';
  rollResult.value = null;
  showResult.value = false;
}

function getDialogContext() {
  return {
    version: dialogContextVersion,
    characterId: props.characterId,
    canEdit: props.canEdit
  };
}

function isCurrentDialogContext(context) {
  return !dialogDisposed
    && context.version === dialogContextVersion
    && context.characterId === props.characterId
    && context.canEdit === props.canEdit;
}

function setPoolsIfChanged(nextPools) {
  const normalizedPools = Array.isArray(nextPools) ? nextPools : [];
  const currentPools = Array.isArray(pools.value) ? pools.value : [];
  if (sameListItems(currentPools, normalizedPools, samePoolSummary)) {
    return false;
  }
  pools.value = normalizedPools;
  return true;
}

function setTalentsIfChanged(nextTalents) {
  const normalizedTalents = Array.isArray(nextTalents) ? nextTalents : [];
  const currentTalents = Array.isArray(talents.value) ? talents.value : [];
  if (sameListItems(currentTalents, normalizedTalents, sameTalentSummary)) {
    return false;
  }
  talents.value = normalizedTalents;
  return true;
}

function sameListItems(currentItems, nextItems, sameItem) {
  if (currentItems === nextItems) {
    return true;
  }
  if (currentItems.length !== nextItems.length) {
    return false;
  }
  return currentItems.every((item, index) => sameItem(item, nextItems[index]));
}

function samePoolSummary(current = {}, next = {}) {
  return current?.id === next?.id
    && String(current?.name || '') === String(next?.name || '')
    && String(current?.description || '') === String(next?.description || '')
    && Number(current?.talents?.length || 0) === Number(next?.talents?.length || 0);
}

function sameTalentSummary(current = {}, next = {}) {
  return current?.id === next?.id
    && current?.characterId === next?.characterId
    && current?.poolId === next?.poolId
    && String(current?.poolName || '') === String(next?.poolName || '')
    && String(current?.talentName || '') === String(next?.talentName || '')
    && String(current?.talentRarity || '') === String(next?.talentRarity || '')
    && String(current?.talentDescription || '') === String(next?.talentDescription || '')
    && String(current?.talentEffect || '') === String(next?.talentEffect || '');
}

function rarityClass(rarity) {
  return `rarity-${rarity || 'common'}`;
}

function rarityLabel(rarity) {
  const map = { common: '普通', rare: '稀有', epic: '史诗', legendary: '传说' };
  return map[rarity] || rarity || '普通';
}

async function doRoll() {
  if (talentActionBusy.value) {
    return;
  }
  if (!props.canEdit) {
    notify.warning('只有角色拥有者可以 Roll 天赋');
    return;
  }
  if (!selectedPoolId.value) {
    notify.warning('请先选择一个天赋池');
    return;
  }

  const context = getDialogContext();
  const poolId = selectedPoolId.value;
  rolling.value = true;
  rollResult.value = null;
  showResult.value = false;

  // Artificial delay for animation
  await new Promise((r) => setTimeout(r, 1200));
  if (!isCurrentDialogContext(context)) {
    return;
  }

  try {
    const result = await rollCharacterTalent(context.characterId, poolId);
    if (!isCurrentDialogContext(context)) {
      return;
    }
    rollResult.value = result;
    showResult.value = true;
    setTalentsIfChanged([result, ...talents.value]);
    emit('updated');
  } catch (err) {
    if (isCurrentDialogContext(context)) {
      notify.error(err.message);
    }
  } finally {
    if (isCurrentDialogContext(context)) {
      rolling.value = false;
    }
  }
}

async function removeTalent(talentId) {
  if (!props.canEdit || talentActionBusy.value) {
    return;
  }
  const context = getDialogContext();
  removingTalentId.value = talentId;
  try {
    await deleteCharacterTalent(context.characterId, talentId);
    if (!isCurrentDialogContext(context)) {
      return;
    }
    setTalentsIfChanged(talents.value.filter((t) => t.id !== talentId));
    emit('updated');
    notify.success('天赋已移除');
  } catch (err) {
    if (isCurrentDialogContext(context)) {
      notify.error(err.message);
    }
  } finally {
    if (isCurrentDialogContext(context) && removingTalentId.value === talentId) {
      removingTalentId.value = '';
    }
  }
}

async function clearAll() {
  if (!props.canEdit || talentActionBusy.value) return;
  if (!talents.value.length) return;
  if (!window.confirm('确定清空这个角色的全部天赋吗？')) return;
  const context = getDialogContext();
  clearingAll.value = true;
  try {
    await deleteAllCharacterTalents(context.characterId);
    if (!isCurrentDialogContext(context)) {
      return;
    }
    setTalentsIfChanged([]);
    emit('updated');
    notify.success('已清空所有天赋');
  } catch (err) {
    if (isCurrentDialogContext(context)) {
      notify.error(err.message);
    }
  } finally {
    if (isCurrentDialogContext(context)) {
      clearingAll.value = false;
    }
  }
}

function closeResult() {
  showResult.value = false;
  rollResult.value = null;
}

function requestClose() {
  if (dialogCloseLocked.value) return;
  emit('close');
}
</script>

<template>
  <Teleport to="body">
    <div class="talent-overlay" @click.self="requestClose">
      <div class="talent-dialog" role="dialog" aria-modal="true" @keydown.esc.prevent="requestClose">
        <div class="talent-dialog-header">
          <div>
            <p>天赋 Roll</p>
            <h2>{{ characterName || '角色' }}的天赋</h2>
          </div>
          <button
            class="icon-button"
            type="button"
            title="关闭"
            aria-label="关闭天赋 Roll 面板"
            :disabled="dialogCloseLocked"
            :aria-busy="dialogCloseLocked"
            @click="requestClose"
          >
            <X :size="18" />
          </button>
        </div>

        <div class="talent-dialog-body">
          <!-- Roll Section -->
          <section v-if="canEdit" class="talent-roll-section">
            <div class="talent-pool-selector">
              <label class="field">
                <span>选择天赋池</span>
                <select v-model="selectedPoolId" :disabled="talentActionBusy || !pools.length">
                  <option v-if="!pools.length" value="" disabled>暂无天赋池</option>
                  <option v-for="pool in pools" :key="pool.id" :value="pool.id">
                    {{ pool.name }}（{{ pool.talents?.length || 0 }} 个天赋）
                  </option>
                </select>
              </label>
              <p v-if="selectedPool" class="muted-text pool-desc">{{ selectedPool.description }}</p>
            </div>

            <button
              class="primary-button roll-button"
              type="button"
              :disabled="talentActionBusy || !pools.length || !selectedPoolId"
              :aria-busy="rolling"
              @click="doRoll"
            >
              <div class="roll-dice-wrap" :class="{ spinning: rolling }">
                <Dice6 :size="22" />
              </div>
              <span>{{ rolling ? 'Roll 中...' : '🎲 Roll 天赋' }}</span>
            </button>
          </section>
          <p v-else class="muted-text">只读模式下可查看天赋，不能 Roll 或移除。</p>

          <!-- Roll Animation Overlay -->
          <Transition name="roll-result">
            <div v-if="showResult && rollResult" class="roll-result-card" :class="rarityClass(rollResult.talentRarity)">
              <button class="roll-result-close" type="button" aria-label="关闭天赋 Roll 结果" @click="closeResult">
                <X :size="16" />
              </button>
              <div class="roll-result-sparkle">
                <Sparkles :size="28" />
              </div>
              <TalentBadge :name="rarityLabel(rollResult.talentRarity)" :rarity="rollResult.talentRarity" compact />
              <h3 class="roll-result-name">{{ rollResult.talentName }}</h3>
              <p v-if="rollResult.talentDescription" class="roll-result-desc">{{ rollResult.talentDescription }}</p>
              <p v-if="rollResult.talentEffect" class="roll-result-effect">
                <strong>效果：</strong>{{ rollResult.talentEffect }}
              </p>
              <p class="roll-result-pool muted-text">来自：{{ rollResult.poolName }}</p>
            </div>
          </Transition>

          <!-- Current Talents List -->
          <section class="talent-list-section">
            <div class="talent-list-header">
              <h3>已拥有的天赋（{{ talents.length }}）</h3>
              <button
                v-if="talents.length && canEdit"
                class="ghost-button clear-all-btn"
                type="button"
                :disabled="talentActionBusy"
                :aria-busy="clearingAll"
                @click="clearAll"
              >
                <Trash2 :size="14" />
                <span>清空</span>
              </button>
            </div>

            <div v-if="loadError" class="empty-state talent-empty" role="alert">
              <Dice6 :size="32" />
              <p>{{ loadError }}</p>
              <button class="ghost-button" type="button" :disabled="loading" :aria-busy="loading" @click="retryLoadDialogData">
                {{ loading ? '重试中...' : '重试' }}
              </button>
            </div>

            <div v-else-if="loading" class="muted-text talent-loading">加载中...</div>

            <div v-else-if="talents.length" class="talent-list">
              <div
                v-for="talent in talents"
                :key="talent.id"
                class="talent-item"
                :class="rarityClass(talent.talentRarity)"
              >
                <div class="talent-item-header">
                  <TalentBadge :name="talent.talentName" :rarity="talent.talentRarity" compact />
                  <button
                    v-if="canEdit"
                    class="icon-button danger talent-remove-btn"
                    type="button"
                    title="移除天赋"
                    :aria-label="`移除天赋：${talent.talentName}`"
                    :disabled="talentActionBusy"
                    :aria-busy="removingTalentId === talent.id"
                    @click="removeTalent(talent.id)"
                  >
                    <Trash2 :size="14" />
                  </button>
                </div>
                <p v-if="talent.talentDescription" class="talent-item-desc">{{ talent.talentDescription }}</p>
                <p v-if="talent.talentEffect" class="talent-item-effect">{{ talent.talentEffect }}</p>
              </div>
            </div>

            <div v-else class="empty-state talent-empty">
              <Dice6 :size="32" />
              <p>还没有天赋，点击上方 Roll 获取！</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  </Teleport>
</template>
