<script setup>
import { ref } from 'vue';
import { Settings2 } from '@lucide/vue';
import MemoryAgentSettingsDialog from '../chat/MemoryAgentSettingsDialog.vue';
import StatusBarAgentSettingsDialog from '../chat/StatusBarAgentSettingsDialog.vue';

const props = defineProps({
  accessorySkillItems: { type: Array, default: () => [] },
  advancedSettings: { type: Object, required: true },
  canEdit: { type: Boolean, default: false },
  modelOverrideOptions: { type: Function, required: true }
});

const statusBarAgentDialogOpen = ref(false);
const memoryAgentDialogOpen = ref(false);

function saveStatusBarAgentSettings(patch) {
  if (!props.canEdit) return;
  props.advancedSettings.accessorySkills.statusBarAgent = {
    ...props.advancedSettings.accessorySkills.statusBarAgent,
    ...patch
  };
  statusBarAgentDialogOpen.value = false;
}

function saveMemoryAgentSettings(patch) {
  if (!props.canEdit) return;
  props.advancedSettings.accessorySkills.memoryAgent = {
    ...props.advancedSettings.accessorySkills.memoryAgent,
    ...patch
  };
  memoryAgentDialogOpen.value = false;
}

function agentSummary(skill = {}) {
  const source = skill.providerProfileId ? '独立供应商' : '跟随主聊天';
  return `${source}${skill.modelOverride ? ` · ${skill.modelOverride}` : ''}${skill.thinkingLevel ? ` · 思考 ${skill.thinkingLevel}` : ''}`;
}
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
          <div v-if="item.key === 'statusBarAgent'" class="field compact accessory-skill-configure">
            <span>模型、思考与工具</span>
            <button class="accessory-skill-configure-button" type="button" :disabled="!canEdit" @click="statusBarAgentDialogOpen = true">
              <span>{{ agentSummary(advancedSettings.accessorySkills.statusBarAgent) }}</span>
              <small><Settings2 :size="14" aria-hidden="true" />设置</small>
            </button>
          </div>
          <div v-else-if="item.key === 'memoryAgent'" class="field compact accessory-skill-configure">
            <span>模型与工具</span>
            <button class="accessory-skill-configure-button" type="button" :disabled="!canEdit" @click="memoryAgentDialogOpen = true">
              <span>{{ agentSummary(advancedSettings.accessorySkills.memoryAgent) }}</span>
              <small><Settings2 :size="14" aria-hidden="true" />设置</small>
            </button>
          </div>
          <label v-else class="field compact">
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
    <StatusBarAgentSettingsDialog
      :open="statusBarAgentDialogOpen"
      :skill="advancedSettings.accessorySkills.statusBarAgent"
      :main-model-options="modelOverrideOptions(advancedSettings.accessorySkills.statusBarAgent.modelOverride)"
      @close="statusBarAgentDialogOpen = false"
      @save="saveStatusBarAgentSettings"
    />
    <MemoryAgentSettingsDialog
      :open="memoryAgentDialogOpen"
      :skill="advancedSettings.accessorySkills.memoryAgent"
      :main-model-options="modelOverrideOptions(advancedSettings.accessorySkills.memoryAgent.modelOverride)"
      @close="memoryAgentDialogOpen = false"
      @save="saveMemoryAgentSettings"
    />
  </section>
</template>
