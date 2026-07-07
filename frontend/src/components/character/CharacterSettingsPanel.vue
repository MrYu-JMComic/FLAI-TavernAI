<script setup>
import VariableEditor from '../VariableEditor.vue';

const SETTINGS_FIELDS = [
  { key: 'background', label: '背景', rows: 4, ariaLabel: '角色背景内容' },
  { key: 'worldview', label: '世界观', rows: 4, ariaLabel: '角色世界观内容' },
  { key: 'persona', label: '人设', rows: 5, ariaLabel: '角色人设内容' },
  { key: 'openingMessage', label: '开场白', rows: 4, ariaLabel: '角色开场白内容' }
];

defineProps({
  canEdit: { type: Boolean, default: false },
  form: { type: Object, required: true },
  userVariableValue: { type: String, default: '' }
});

const emit = defineEmits(['insert-user-variable', 'update-field']);
</script>

<template>
  <section id="section-settings" class="form-panel form-section-group character-settings-panel">
    <h3 class="form-section-title">角色设定</h3>
    <p class="form-section-desc">定义角色的背景、世界观、人设和开场白。支持 <span class="variable-token">{user}</span> 变量替换。</p>

    <div v-for="field in SETTINGS_FIELDS" :key="field.key" class="field">
      <div class="field-heading">
        <span>{{ field.label }}</span>
        <button class="variable-insert-button" type="button" :disabled="!canEdit" @click="emit('insert-user-variable', field.key)">
          {user}
        </button>
      </div>
      <VariableEditor
        :model-value="form[field.key]"
        :rows="field.rows"
        :disabled="!canEdit"
        :user-value="userVariableValue"
        :aria-label="field.ariaLabel"
        placeholder=""
        @update:model-value="emit('update-field', field.key, $event)"
      />
    </div>
  </section>
</template>
