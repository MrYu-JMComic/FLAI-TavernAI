<script setup>
defineProps({
  accessorySkillItems: { type: Array, default: () => [] },
  advancedSettings: { type: Object, required: true },
  canEdit: { type: Boolean, default: false },
  modelOverrideOptions: { type: Function, required: true }
});
</script>

<template>
  <section id="section-accessories" class="form-panel character-panel">
    <header class="character-panel-head">
      <div>
        <h2>附属技能</h2>
        <p>设定新会话的默认启用状态和模型；使用者可在会话内调整。</p>
      </div>
    </header>

    <div class="character-panel-body">
      <div class="accessory-skills-grid">
        <div v-for="item in accessorySkillItems" :key="item.key" class="accessory-skill-row">
          <label class="field compact">
            <span>{{ item.label }}</span>
            <select v-model="advancedSettings.accessorySkills[item.key].enabled" :disabled="!canEdit">
              <option :value="false">关闭</option>
              <option :value="true">开启</option>
              <option v-if="item.auto" value="auto">自动</option>
            </select>
          </label>
          <label class="field compact">
            <span>模型覆盖</span>
            <select v-model="advancedSettings.accessorySkills[item.key].modelOverride" :disabled="!canEdit">
              <option
                v-for="model in modelOverrideOptions(advancedSettings.accessorySkills[item.key].modelOverride)"
                :key="model.id || `current-${item.key}`"
                :value="model.id"
              >
                {{ model.label || model.id }}
              </option>
            </select>
          </label>
        </div>
      </div>
    </div>
  </section>
</template>
