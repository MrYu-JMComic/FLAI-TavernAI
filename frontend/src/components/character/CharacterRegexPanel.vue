<script setup>
import { computed } from 'vue';
import { Plus, Trash2 } from '@lucide/vue';

const props = defineProps({
  canEdit: { type: Boolean, default: false },
  previewInput: { type: String, default: '' },
  regexPreview: { type: String, default: '' },
  rules: { type: Array, required: true }
});

const emit = defineEmits(['add-rule', 'remove-rule', 'update:previewInput']);

const previewInputModel = computed({
  get: () => props.previewInput,
  set: (value) => emit('update:previewInput', value)
});
</script>

<template>
  <section id="section-regex" class="form-panel regex-panel">
    <div class="inline-heading">
      <div>
        <h2>高阶正则替换</h2>
        <p>按顺序应用，可选择输入、输出或双向作用域。</p>
      </div>
      <button class="ghost-button" type="button" :disabled="!canEdit" @click="emit('add-rule')">
        <Plus :size="17" />
        <span>规则</span>
      </button>
    </div>

    <div v-for="(rule, index) in rules" :key="index" class="rule-row">
      <label class="checkbox-line rule-enabled">
        <input v-model="rule.enabled" type="checkbox" :disabled="!canEdit" />
        <span>启用</span>
      </label>
      <input
        v-model="rule.label"
        class="rule-name"
        placeholder="名称"
        :disabled="!canEdit"
        :aria-label="`正则规则 ${index + 1} 名称`"
      />
      <input
        v-model="rule.pattern"
        class="rule-pattern"
        placeholder="正则 pattern"
        :disabled="!canEdit"
        :aria-label="`正则规则 ${index + 1} 匹配模式`"
      />
      <input
        v-model="rule.replacement"
        class="rule-replacement"
        placeholder="替换为"
        :disabled="!canEdit"
        :aria-label="`正则规则 ${index + 1} 替换内容`"
      />
      <input
        v-model="rule.flags"
        class="flags-input rule-flags"
        placeholder="gim"
        :disabled="!canEdit"
        :aria-label="`正则规则 ${index + 1} 正则标志`"
      />
      <select
        v-model="rule.scope"
        class="rule-scope"
        :disabled="!canEdit"
        :aria-label="`正则规则 ${index + 1} 作用域`"
      >
        <option value="input">输入</option>
        <option value="output">输出</option>
        <option value="both">双向</option>
      </select>
      <input
        v-model="rule.groupName"
        class="rule-group"
        placeholder="分组名"
        :disabled="!canEdit"
        maxlength="60"
        :aria-label="`正则规则 ${index + 1} 分组名`"
      />
      <input
        v-model.number="rule.priority"
        class="rule-priority"
        type="number"
        min="0"
        placeholder="0"
        :disabled="!canEdit"
        title="优先级，数字越小越先执行"
        :aria-label="`正则规则 ${index + 1} 优先级`"
      />
      <button
        v-if="canEdit"
        class="icon-button danger rule-delete"
        type="button"
        title="删除规则"
        :aria-label="`删除正则规则 ${index + 1}`"
        @click="emit('remove-rule', index)"
      >
        <Trash2 :size="17" />
      </button>
    </div>

    <div class="preview-box">
      <label class="field">
        <span>预览输入</span>
        <input v-model="previewInputModel" placeholder="输入一段文本测试正则替换效果" />
      </label>
      <p v-if="previewInput.trim()">{{ regexPreview }}</p>
      <p v-else class="muted-text">输入测试文本后会显示替换结果。</p>
    </div>
  </section>
</template>
