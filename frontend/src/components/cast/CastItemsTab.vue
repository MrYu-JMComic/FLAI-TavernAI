<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import {
  ArrowRightLeft,
  Package,
  Pencil,
  Plus,
  Save,
  Search,
  Shirt,
  Trash2,
  X,
} from '@lucide/vue';
import { useCastManagerContext } from './castManagerContext.js';

const emit = defineEmits(['delete']);
const manager = useCastManagerContext();
const query = ref('');
const category = ref('all');
const nameRef = ref(null);
const baseline = ref('');
const transferTargets = reactive({});
const form = reactive(emptyForm());
const editing = computed(() => manager.editor.kind === 'item');
const dirty = computed(() => editing.value && baseline.value && JSON.stringify(form) !== baseline.value);
const filtered = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase();
  return manager.items.value.filter((item) => {
    const isClothing = item.itemKind === 'clothing' || Boolean(item.clothingSlot);
    if (category.value === 'clothing' && !isClothing) return false;
    if (category.value === 'items' && isClothing) return false;
    if (!needle) return true;
    return [item.name, item.description, item.itemKind, item.clothingSlot]
      .join('\n').toLocaleLowerCase().includes(needle);
  });
});

watch(
  () => [manager.editor.kind, manager.editor.record?.id, manager.editor.record?.revision],
  async () => {
    if (!editing.value) {
      Object.assign(form, emptyForm());
      baseline.value = '';
      manager.setDirty('editor', false);
      return;
    }
    const record = manager.editor.record || {};
    Object.assign(form, {
      name: record.name || '',
      description: record.description || '',
      itemKind: record.itemKind || 'item',
      quantity: Number(record.quantity ?? 1),
      clothingSlot: record.clothingSlot || '',
      equipped: Boolean(record.equipped),
      movable: record.movable !== false,
      coverage: Array.isArray(record.coverage) ? record.coverage.join(', ') : '',
      iconKey: record.iconKey || '',
    });
    baseline.value = JSON.stringify(form);
    await nextTick();
    nameRef.value?.focus({ preventScroll: true });
  },
  { immediate: true }
);
watch(dirty, (value) => manager.setDirty('editor', value));

async function submit() {
  if (!form.name.trim()) return;
  await manager.saveItem({
    name: form.name.trim(),
    description: form.description.trim(),
    itemKind: form.itemKind,
    quantity: Number(form.quantity),
    clothingSlot: form.itemKind === 'clothing' ? form.clothingSlot.trim() : '',
    equipped: Boolean(form.equipped),
    movable: Boolean(form.movable),
    coverage: splitList(form.coverage),
    iconKey: form.iconKey.trim(),
  }, manager.editor.record);
}

async function toggleEquipped(item) {
  await manager.saveItem({ equipped: !item.equipped }, item);
}

async function transfer(item) {
  const destination = transferTargets[item.id];
  if (!destination) return;
  const result = await manager.moveItem(item, destination);
  if (result) delete transferTargets[item.id];
}

function splitList(value) {
  return [...new Set(String(value || '').split(/[,，\n]/).map((entry) => entry.trim()).filter(Boolean))];
}

function emptyForm() {
  return {
    name: '', description: '', itemKind: 'item', quantity: 1, clothingSlot: '',
    equipped: false, movable: true, coverage: '', iconKey: '',
  };
}

onBeforeUnmount(() => manager.setDirty('editor', false));
</script>

<template>
  <section class="cast-tab-panel" role="tabpanel" aria-labelledby="cast-tab-items">
    <header class="cast-list-toolbar">
      <div>
        <h3 tabindex="-1">物品与衣物</h3>
        <p>{{ manager.items.value.length }} 件记录</p>
      </div>
      <label class="cast-inline-search">
        <Search :size="16" aria-hidden="true" />
        <span class="sr-only">搜索物品</span>
        <input v-model="query" type="search" placeholder="搜索物品" />
      </label>
      <div class="cast-segmented" aria-label="物品类型筛选">
        <button v-for="option in [{ id: 'all', label: '全部' }, { id: 'items', label: '物品' }, { id: 'clothing', label: '衣物' }]" :key="option.id" type="button" :aria-pressed="category === option.id" @click="category = option.id">
          {{ option.label }}
        </button>
      </div>
      <button type="button" class="cast-button primary" :disabled="manager.busy.mutation || manager.hasUnsavedChanges.value" @click="manager.openEditor('item')">
        <Plus :size="16" aria-hidden="true" />
        添加物品
      </button>
    </header>

    <form v-if="editing" class="cast-inline-editor" @submit.prevent="submit">
      <header>
        <h4>{{ manager.editor.mode === 'edit' ? '编辑物品' : '添加物品' }}</h4>
        <button type="button" class="cast-icon-button" aria-label="关闭物品编辑" title="关闭" @click="manager.closeEditor">
          <X :size="17" aria-hidden="true" />
        </button>
      </header>
      <div class="cast-form-grid two-column">
        <label>
          <span>名称</span>
          <input ref="nameRef" v-model="form.name" maxlength="500" required autocomplete="off" />
        </label>
        <label>
          <span>类型</span>
          <select v-model="form.itemKind">
            <option value="item">普通物品</option>
            <option value="clothing">衣物</option>
            <option value="weapon">武器</option>
            <option value="consumable">消耗品</option>
            <option value="key">关键物品</option>
          </select>
        </label>
        <label>
          <span>数量</span>
          <input v-model.number="form.quantity" type="number" min="0" max="1000000" step="1" />
        </label>
        <label v-if="form.itemKind === 'clothing'">
          <span>穿戴部位</span>
          <input v-model="form.clothingSlot" maxlength="80" placeholder="例如：外套" autocomplete="off" />
        </label>
        <label class="full-width">
          <span>描述</span>
          <textarea v-model="form.description" maxlength="8000" rows="3"></textarea>
        </label>
        <label v-if="form.itemKind === 'clothing'" class="full-width">
          <span>覆盖区域</span>
          <input v-model="form.coverage" maxlength="1000" placeholder="用逗号分隔" autocomplete="off" />
        </label>
        <label>
          <span>图标键</span>
          <input v-model="form.iconKey" maxlength="120" autocomplete="off" />
        </label>
      </div>
      <div class="cast-check-grid">
        <label class="cast-check-row compact">
          <input v-model="form.movable" type="checkbox" />
          <ArrowRightLeft :size="17" aria-hidden="true" />
          <span><b>允许移动</b></span>
        </label>
        <label class="cast-check-row compact">
          <input v-model="form.equipped" type="checkbox" />
          <Shirt :size="17" aria-hidden="true" />
          <span><b>已装备</b></span>
        </label>
      </div>
      <footer>
        <button type="button" class="cast-button secondary" :disabled="manager.busy.mutation" @click="manager.closeEditor">取消</button>
        <button type="submit" class="cast-button primary" :disabled="!form.name.trim() || manager.busy.mutation">
          <Save :size="16" aria-hidden="true" />
          {{ manager.busy.kind.startsWith('item.') ? '保存中' : '保存物品' }}
        </button>
      </footer>
    </form>

    <div v-if="manager.loading.items && !manager.loaded.items" class="cast-row-skeleton" aria-label="正在加载物品">
      <span v-for="index in 5" :key="index"></span>
    </div>
    <div v-else-if="manager.errors.items" class="cast-error-state" role="alert">
      <p>{{ manager.errors.items }}</p>
      <button type="button" class="cast-button secondary" @click="manager.loadItems()">重试</button>
    </div>
    <div v-else-if="!filtered.length" class="cast-empty-state">
      <Package :size="28" aria-hidden="true" />
      <h4>{{ query ? '没有匹配物品' : '暂无物品' }}</h4>
    </div>
    <div v-else class="cast-record-list">
      <article v-for="item in filtered" :key="item.id" class="cast-record-row cast-item-row">
        <span class="cast-item-icon" aria-hidden="true">
          <Shirt v-if="item.itemKind === 'clothing' || item.clothingSlot" :size="18" />
          <Package v-else :size="18" />
        </span>
        <div class="cast-record-main">
          <div class="cast-record-meta">
            <span>{{ item.itemKind || 'item' }}</span>
            <span v-if="item.quantity !== 1">数量 {{ item.quantity }}</span>
            <span v-if="item.clothingSlot">{{ item.clothingSlot }}</span>
            <span v-if="item.equipped" class="cast-state-label">已装备</span>
          </div>
          <p><strong>{{ item.name }}</strong></p>
          <small v-if="item.description">{{ item.description }}</small>
          <div v-if="manager.members.value.length > 1" class="cast-item-transfer">
            <label :for="`cast-transfer-${item.id}`">转交</label>
            <select :id="`cast-transfer-${item.id}`" v-model="transferTargets[item.id]" :aria-label="`转交 ${item.name} 的目标人物`" :disabled="manager.busy.mutation || manager.hasUnsavedChanges.value">
              <option value="">选择人物</option>
              <option v-for="member in manager.members.value.filter((entry) => entry.id !== manager.selectedMemberId.value)" :key="member.id" :value="member.id">
                {{ member.canonicalName }}
              </option>
            </select>
            <button type="button" class="cast-icon-button" title="确认转交" :aria-label="`将 ${item.name} 转交给所选人物`" :disabled="!transferTargets[item.id] || manager.busy.mutation || manager.hasUnsavedChanges.value" @click="transfer(item)">
              <ArrowRightLeft :size="16" aria-hidden="true" />
            </button>
          </div>
        </div>
        <div class="cast-row-actions">
          <button type="button" class="cast-icon-button" :class="{ active: item.equipped }" :aria-label="item.equipped ? '取消装备' : '装备物品'" :title="item.equipped ? '取消装备' : '装备'" :disabled="manager.busy.mutation || manager.hasUnsavedChanges.value" @click="toggleEquipped(item)">
            <Shirt :size="16" aria-hidden="true" />
          </button>
          <button type="button" class="cast-icon-button" aria-label="编辑物品" title="编辑" :disabled="manager.busy.mutation || manager.hasUnsavedChanges.value" @click="manager.openEditor('item', item)">
            <Pencil :size="16" aria-hidden="true" />
          </button>
          <button type="button" class="cast-icon-button danger" aria-label="删除物品" title="删除" :disabled="manager.busy.mutation || manager.hasUnsavedChanges.value" @click="emit('delete', item)">
            <Trash2 :size="16" aria-hidden="true" />
          </button>
        </div>
      </article>
    </div>
  </section>
</template>
