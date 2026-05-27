<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { Dice6, Sparkles, Trash2, X } from '@lucide/vue';
import { deleteAllCharacterTalents, deleteCharacterTalent, fetchCharacterTalents, fetchTalentPools, rollCharacterTalent } from '../api';
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
const clearingAll = ref(false);

const selectedPool = computed(() => pools.value.find((p) => p.id === selectedPoolId.value));

onMounted(async () => {
  try {
    const [poolData, talentData] = await Promise.all([fetchTalentPools(), fetchCharacterTalents(props.characterId)]);
    pools.value = poolData;
    talents.value = talentData;
    if (pools.value.length) {
      selectedPoolId.value = pools.value[0].id;
    }
  } catch (err) {
    notify.error(err.message);
  } finally {
    loading.value = false;
  }
});

function rarityClass(rarity) {
  return `rarity-${rarity || 'common'}`;
}

function rarityLabel(rarity) {
  const map = { common: '普通', rare: '稀有', epic: '史诗', legendary: '传说' };
  return map[rarity] || rarity || '普通';
}

async function doRoll() {
  if (!selectedPoolId.value) {
    notify.warning('请先选择一个天赋池');
    return;
  }

  rolling.value = true;
  rollResult.value = null;
  showResult.value = false;

  // Artificial delay for animation
  await new Promise((r) => setTimeout(r, 1200));

  try {
    const result = await rollCharacterTalent(props.characterId, selectedPoolId.value);
    rollResult.value = result;
    showResult.value = true;
    talents.value = [result, ...talents.value];
    emit('updated');
  } catch (err) {
    notify.error(err.message);
  } finally {
    rolling.value = false;
  }
}

async function removeTalent(talentId) {
  try {
    await deleteCharacterTalent(props.characterId, talentId);
    talents.value = talents.value.filter((t) => t.id !== talentId);
    emit('updated');
    notify.success('天赋已移除');
  } catch (err) {
    notify.error(err.message);
  }
}

async function clearAll() {
  if (!talents.value.length) return;
  clearingAll.value = true;
  try {
    await deleteAllCharacterTalents(props.characterId);
    talents.value = [];
    emit('updated');
    notify.success('已清空所有天赋');
  } catch (err) {
    notify.error(err.message);
  } finally {
    clearingAll.value = false;
  }
}

function closeResult() {
  showResult.value = false;
  rollResult.value = null;
}
</script>

<template>
  <Teleport to="body">
    <div class="talent-overlay" @click.self="emit('close')">
      <div class="talent-dialog">
        <div class="talent-dialog-header">
          <div>
            <p>天赋 Roll</p>
            <h2>{{ characterName || '角色' }}的天赋</h2>
          </div>
          <button class="icon-button" type="button" @click="emit('close')">
            <X :size="18" />
          </button>
        </div>

        <div class="talent-dialog-body">
          <!-- Roll Section -->
          <section class="talent-roll-section">
            <div class="talent-pool-selector">
              <label class="field">
                <span>选择天赋池</span>
                <select v-model="selectedPoolId" :disabled="rolling || !pools.length">
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
              :disabled="rolling || !pools.length || !selectedPoolId"
              @click="doRoll"
            >
              <div class="roll-dice-wrap" :class="{ spinning: rolling }">
                <Dice6 :size="22" />
              </div>
              <span>{{ rolling ? 'Roll 中...' : '🎲 Roll 天赋' }}</span>
            </button>
          </section>

          <!-- Roll Animation Overlay -->
          <Transition name="roll-result">
            <div v-if="showResult && rollResult" class="roll-result-card" :class="rarityClass(rollResult.talentRarity)">
              <button class="roll-result-close" type="button" @click="closeResult">
                <X :size="16" />
              </button>
              <div class="roll-result-sparkle">
                <Sparkles :size="28" />
              </div>
              <div class="roll-result-badge" :class="rarityClass(rollResult.talentRarity)">
                {{ rarityLabel(rollResult.talentRarity) }}
              </div>
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
                :disabled="clearingAll"
                @click="clearAll"
              >
                <Trash2 :size="14" />
                <span>清空</span>
              </button>
            </div>

            <div v-if="loading" class="muted-text talent-loading">加载中...</div>

            <div v-else-if="talents.length" class="talent-list">
              <div
                v-for="talent in talents"
                :key="talent.id"
                class="talent-item"
                :class="rarityClass(talent.talentRarity)"
              >
                <div class="talent-item-header">
                  <span class="talent-rarity-dot" :class="rarityClass(talent.talentRarity)" />
                  <span class="talent-item-name">{{ talent.talentName }}</span>
                  <span class="talent-rarity-label" :class="rarityClass(talent.talentRarity)">
                    {{ rarityLabel(talent.talentRarity) }}
                  </span>
                  <button
                    v-if="canEdit"
                    class="icon-button danger talent-remove-btn"
                    type="button"
                    title="移除天赋"
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
