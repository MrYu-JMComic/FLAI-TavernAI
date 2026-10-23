<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ArrowLeft, RefreshCw } from '@lucide/vue';
import { useNotify } from '../composables/useNotify';
import { useSettingsMods } from '../composables/settings/useSettingsMods';
import { useSettingsProfile } from '../composables/settings/useSettingsProfile';
import { useSettingsProvider } from '../composables/settings/useSettingsProvider';
import { useSettingsDataExports } from '../composables/settings/useSettingsDataExports';
import { useSettingsPresets } from '../composables/settings/useSettingsPresets';
import { useSettingsRegex } from '../composables/settings/useSettingsRegex';
import { useSettingsSectionNavigation } from '../composables/settings/useSettingsSectionNavigation';
import { useSettingsStatusTemplates } from '../composables/settings/useSettingsStatusTemplates';
import { useSettingsTags } from '../composables/settings/useSettingsTags';
import SettingsDataExportPanel from '../components/settings/SettingsDataExportPanel.vue';
import SettingsProfilePanel from '../components/settings/SettingsProfilePanel.vue';
import SettingsPresetPanel from '../components/settings/SettingsPresetPanel.vue';
import SettingsProviderPanel from '../components/settings/SettingsProviderPanel.vue';
import SettingsTagPanel from '../components/settings/SettingsTagPanel.vue';
import SettingsModPanel from '../components/settings/SettingsModPanel.vue';
import SettingsRegexPanel from '../components/settings/SettingsRegexPanel.vue';
import SettingsStatusTemplatePanel from '../components/settings/SettingsStatusTemplatePanel.vue';
import PersonalCenterOverview from '../components/settings/PersonalCenterOverview.vue';

const props = defineProps({
  route: {
    type: Object,
    default: () => ({ name: 'settings' })
  },
  user: {
    type: Object,
    default: null
  }
});
const emit = defineEmits(['navigate', 'provider-saved', 'profile-saved']);
const notify = useNotify();
const routeName = computed(() => props.route?.name || 'settings');
const isExtensionsPage = computed(() => props.route?.name === 'extensions');
const isOverviewPage = computed(() => routeName.value === 'settings');
const isProfilePage = computed(() => routeName.value === 'settingsProfile');
const isProfileContext = computed(() => isOverviewPage.value || isProfilePage.value);
const isProviderPage = computed(() => routeName.value === 'settingsProvider');
const isPresetsPage = computed(() => routeName.value === 'settingsPresets');
const isDataPage = computed(() => routeName.value === 'settingsData');
const pageTitle = computed(() => ({
  settings: '个人中心',
  settingsProfile: '个人资料',
  settingsPresets: '对话预设',
  settingsProvider: '模型网关',
  settingsData: '数据导出',
  extensions: '扩展管理'
}[routeName.value] || '个人中心'));
const {
  activeExtensionSection,
  extensionNavRef,
  extensionSections,
  scrollToExtensionSection
} = useSettingsSectionNavigation();

const loading = ref(false);
const loadError = ref('');
let settingsLoadToken = 0;
const {
  addProvider,
  balance,
  balanceLoading,
  canCheckBalance,
  canFetchModels,
  isRootAdmin,
  checkBalance,
  currentProviderCapability,
  form,
  loadModels,
  loadProviderSettingsBundle,
  modelLoading,
  modelProbeLoading,
  modelProbeMessage,
  modelProbeStatus,
  probeProviderConnection,
  providerCapabilityLoadError,
  providerActionLoading,
  providerControlsBusy,
  providerNetworkPolicy,
  providerProfiles,
  removeProvider,
  resetProviderAsyncScope,
  applyPreset,
  applyProviderSettingsBundle,
  saving,
  selectedProviderId,
  settingsModelOptions,
  submit,
  switchProvider,
  updateProviderFormField
} = useSettingsProvider({
  isPersonalPage: isProviderPage,
  user: computed(() => props.user),
  notify,
  emitProviderSaved: () => emit('provider-saved')
});
const {
  applyProfile,
  avatarSaving,
  handleUserAvatar,
  loadUserProfile,
  ownedCharacters,
  profile,
  profileSaving,
  profileStats,
  resetProfileAsyncScope,
  submitProfile,
  updateProfileDisplayName
} = useSettingsProfile({
  user: computed(() => props.user),
  isPersonalPage: isProfileContext,
  notify,
  emitProfileSaved: (user) => emit('profile-saved', user)
});
const {
  dataExportBusy,
  diagnosticsExporting,
  exportDiagnosticsBundle,
  exportProjectSnapshotBundle,
  resetDataExportScope,
  snapshotExporting
} = useSettingsDataExports({
  isPersonalPage: isDataPage,
  notify
});
const {
  addTag,
  loadTags,
  newTagName,
  normalizedTagLoadLimit,
  removeTag,
  resetTagAsyncScope,
  tagActionBusyId,
  tagControlsBusy,
  tagList,
  tagLoadError,
  tagLoading,
  tagLoadLimit,
  updateNewTagName,
  updateTagLoadLimit,
  updateTagLoadLimitDraft
} = useSettingsTags({
  isExtensionsPage,
  notify
});
const {
  cancelPresetEdit,
  exportPresets,
  handlePresetImportFile,
  loadPresets,
  makeDefaultPreset,
  presetActionBusy,
  presetActionBusyId,
  presetControlsBusy,
  presetEditing,
  presetForm,
  presetList,
  presetLoadError,
  presetLoading,
  removePreset,
  resetPresetAsyncScope,
  savePreset,
  showPresetEditor,
  startEditPreset,
  startNewPreset,
  updatePresetFormField
} = useSettingsPresets({
  isPresetsPage,
  notify
});
const {
  cancelModEdit,
  clearModCharacters,
  dragOverMod,
  draggingMod,
  exportMods,
  handleModImportFile,
  loadModCharacterOptions,
  loadMods,
  modActionBusy,
  modActionBusyId,
  modCharacterOptions,
  modCharactersLoadError,
  modCharactersLoading,
  modControlsBusy,
  modEditing,
  modForm,
  modList,
  modLoadError,
  modLoading,
  onModDragEnd,
  onModDragOver,
  onModDragStart,
  onModDrop,
  removeMod,
  resetModAsyncScope,
  resetModCharacterLoadScope,
  saveMod,
  selectAllModCharacters,
  showModEditor,
  startEditMod,
  startNewMod,
  toggleMod,
  updateModFormField
} = useSettingsMods({
  isExtensionsPage,
  notify
});
const {
  exportRegexRules,
  handleDeleteRegexRule,
  handleRegexGroupFilterChange,
  handleRegexImportFile,
  handleToggleRegexRule,
  loadRegexRules,
  onRegexDragOver,
  onRegexDragStart,
  onRegexDrop,
  regexActionBusy,
  regexActionBusyId,
  regexControlsBusy,
  regexGroupFilter,
  regexGroups,
  regexLoadError,
  regexLoading,
  regexRules,
  resetRegexAsyncScope,
  updateRegexGroupFilter
} = useSettingsRegex({
  isExtensionsPage,
  notify
});
const {
  exportStatusBarTemplates,
  handleStatusBarTemplateImportFile,
  resetStatusTemplateAsyncScope,
  statusTemplateActionBusyId,
  statusTemplateControlsBusy
} = useSettingsStatusTemplates({
  isExtensionsPage,
  notify
});

onMounted(loadSettings);
onMounted(loadTags);
onMounted(loadPresets);
onMounted(loadMods);
onMounted(loadModCharacterOptions);
onMounted(loadRegexRules);
onBeforeUnmount(resetSettingsAsyncScopes);

async function loadSettings() {
  if ((!isProfileContext.value && !isProviderPage.value) || loading.value) {
    return;
  }
  const requestToken = ++settingsLoadToken;
  loading.value = true;
  loadError.value = '';
  try {
    const result = isProviderPage.value
      ? await loadProviderSettingsBundle()
      : await loadUserProfile();
    if (!isCurrentSettingsLoad(requestToken)) return;
    if (isProviderPage.value) {
      applyProviderSettingsBundle(result);
    } else {
      applyProfile(result);
    }
  } catch (err) {
    if (!isCurrentSettingsLoad(requestToken)) return;
    const message = err?.message || '加载个人设置失败';
    loadError.value = message;
    notify.error(message);
  } finally {
    if (isCurrentSettingsLoad(requestToken)) {
      loading.value = false;
    }
  }
}

function isCurrentSettingsLoad(requestToken) {
  return requestToken === settingsLoadToken && (isProfileContext.value || isProviderPage.value);
}

function resetPersonalAsyncScope() {
  settingsLoadToken += 1;
  resetProviderAsyncScope();
  resetProfileAsyncScope();
  resetDataExportScope();
  resetPresetAsyncScope();
  loading.value = false;
}

function resetSettingsAsyncScopes() {
  resetPersonalAsyncScope();
  resetExtensionAsyncScopes();
}

function resetExtensionAsyncScopes() {
  resetTagAsyncScope();
  resetModAsyncScope();
  resetModCharacterLoadScope();
  resetRegexAsyncScope();
  resetStatusTemplateAsyncScope();
}

function navigateTo(page) {
  emit('navigate', page);
}

</script>

<template>
  <section class="page-stack settings-workbench" :class="[isExtensionsPage ? 'extensions-page' : 'narrow-page', { 'personal-overview-page': isOverviewPage, 'personal-detail-page': !isExtensionsPage && !isOverviewPage }]">
    <h1 class="visually-hidden settings-page-title">{{ pageTitle }}</h1>
    <nav v-if="!isExtensionsPage && !isOverviewPage" class="settings-detail-back" aria-label="页面导航">
      <button class="ghost-button settings-back-button" type="button" @click="navigateTo('settings')">
        <ArrowLeft :size="17" aria-hidden="true" />
        <span>返回个人中心</span>
      </button>
    </nav>

    <nav v-if="isExtensionsPage" ref="extensionNavRef" class="form-section-nav settings-section-nav extension-section-nav" aria-label="扩展管理分区">
      <button
        v-for="section in extensionSections"
        :key="section.id"
        class="form-section-tab"
        :class="{ active: activeExtensionSection === section.id }"
        :aria-current="activeExtensionSection === section.id ? 'location' : undefined"
        :data-section-id="section.id"
        type="button"
        @click="scrollToExtensionSection(section.id)"
      >
        {{ section.label }}
      </button>
    </nav>

    <p v-if="isProviderPage && !loading && !loadError && form.apiKeyNeedsReset" class="error-text">
      已保存的 API Key 无法解密。请重新粘贴 SK 并保存设置，之后再获取模型或查询余额。
    </p>
    <p v-if="(isProfileContext || isProviderPage) && loading" class="muted-text" aria-live="polite">正在加载设置...</p>

    <section v-if="(isProfileContext || isProviderPage) && loadError" class="form-panel empty-state error-state" role="alert">
      <h2>设置加载失败</h2>
      <p>{{ loadError }}</p>
      <button class="ghost-button" type="button" :disabled="loading" @click="loadSettings">
        <RefreshCw :size="17" />
        <span>{{ loading ? '重试中...' : '重试' }}</span>
      </button>
    </section>

    <PersonalCenterOverview
      v-if="isOverviewPage && !loading && !loadError"
      :profile="profile"
      :stats="profileStats"
      @navigate="navigateTo"
    />

    <SettingsProfilePanel
      v-if="isProfilePage && !loading && !loadError"
      :avatar-saving="avatarSaving"
      :owned-characters="ownedCharacters"
      :profile="profile"
      :profile-saving="profileSaving"
      :stats="profileStats"
      @avatar-change="handleUserAvatar"
      @submit="submitProfile"
      @update-display-name="updateProfileDisplayName"
    />

    <SettingsProviderPanel
      v-if="isProviderPage && !loading && !loadError"
      :balance-loading="balanceLoading"
      :can-check-balance="canCheckBalance"
      :can-fetch-models="canFetchModels"
      :is-root-admin="isRootAdmin"
      :controls-busy="providerControlsBusy"
      :form="form"
      :model-loading="modelLoading"
      :model-options="settingsModelOptions"
      :provider-capability="currentProviderCapability"
      :provider-capability-error="providerCapabilityLoadError"
      :probe-loading="modelProbeLoading"
      :probe-message="modelProbeMessage"
      :probe-status="modelProbeStatus"
      :provider-action-loading="providerActionLoading"
      :provider-network-policy="providerNetworkPolicy"
      :providers="providerProfiles"
      :saving="saving"
      :selected-provider-id="selectedProviderId"
      @add-provider="addProvider"
      @apply-preset="applyPreset"
      @check-balance="checkBalance"
      @load-models="loadModels"
      @probe-provider="probeProviderConnection"
      @remove-provider="removeProvider"
      @select-provider="switchProvider"
      @submit="submit"
      @update-field="updateProviderFormField"
    />

    <SettingsPresetPanel
      v-if="isPresetsPage"
      :action-busy="presetActionBusy"
      :action-busy-id="presetActionBusyId"
      :controls-busy="presetControlsBusy"
      :editing="presetEditing"
      :form="presetForm"
      :load-error="presetLoadError"
      :loading="presetLoading"
      :preset-list="presetList"
      :show-editor="showPresetEditor"
      @cancel-edit="cancelPresetEdit"
      @export="exportPresets"
      @import-file="handlePresetImportFile"
      @load="loadPresets"
      @make-default="makeDefaultPreset"
      @remove="removePreset"
      @save="savePreset"
      @start-edit="startEditPreset"
      @start-new="startNewPreset"
      @update-form-field="updatePresetFormField"
    />

    <SettingsDataExportPanel
      v-if="isDataPage"
      :busy="dataExportBusy"
      :diagnostics-exporting="diagnosticsExporting"
      :snapshot-exporting="snapshotExporting"
      @export-diagnostics="exportDiagnosticsBundle"
      @export-snapshot="exportProjectSnapshotBundle"
    />

    <SettingsTagPanel
      v-if="isExtensionsPage"
      :action-busy-id="tagActionBusyId"
      :controls-busy="tagControlsBusy"
      :load-error="tagLoadError"
      :load-limit="tagLoadLimit"
      :loading="tagLoading"
      :new-tag-name="newTagName"
      :normalized-load-limit="normalizedTagLoadLimit"
      :tag-list="tagList"
      @add="addTag"
      @load="loadTags"
      @remove="removeTag"
      @update-load-limit="updateTagLoadLimit"
      @update-load-limit-draft="updateTagLoadLimitDraft"
      @update-new-tag-name="updateNewTagName"
    />

    <SettingsModPanel
      v-if="isExtensionsPage"
      :action-busy="modActionBusy"
      :action-busy-id="modActionBusyId"
      :character-options="modCharacterOptions"
      :characters-load-error="modCharactersLoadError"
      :characters-loading="modCharactersLoading"
      :controls-busy="modControlsBusy"
      :drag-over-mod="dragOverMod"
      :dragging-mod="draggingMod"
      :editing="modEditing"
      :form="modForm"
      :load-error="modLoadError"
      :loading="modLoading"
      :mod-list="modList"
      :show-editor="showModEditor"
      @cancel-edit="cancelModEdit"
      @clear-characters="clearModCharacters"
      @drag-end="onModDragEnd"
      @drag-over="onModDragOver"
      @drag-start="onModDragStart"
      @drop="onModDrop"
      @export="exportMods"
      @import-file="handleModImportFile"
      @load="loadMods"
      @load-characters="loadModCharacterOptions"
      @remove="removeMod"
      @save="saveMod"
      @select-all-characters="selectAllModCharacters"
      @start-edit="startEditMod"
      @start-new="startNewMod"
      @toggle="toggleMod"
      @update-form-field="updateModFormField"
    />

    <SettingsRegexPanel
      v-if="isExtensionsPage"
      :action-busy-id="regexActionBusyId"
      :controls-busy="regexControlsBusy"
      :group-filter="regexGroupFilter"
      :groups="regexGroups"
      :load-error="regexLoadError"
      :loading="regexLoading"
      :regex-rules="regexRules"
      @drag-over="onRegexDragOver"
      @drag-start="onRegexDragStart"
      @drop="onRegexDrop"
      @export="exportRegexRules"
      @group-filter-change="handleRegexGroupFilterChange"
      @import-file="handleRegexImportFile"
      @load="loadRegexRules"
      @remove="handleDeleteRegexRule"
      @toggle="handleToggleRegexRule"
      @update-group-filter="updateRegexGroupFilter"
    />

    <SettingsStatusTemplatePanel
      v-if="isExtensionsPage"
      :action-busy-id="statusTemplateActionBusyId"
      :controls-busy="statusTemplateControlsBusy"
      @export="exportStatusBarTemplates"
      @import-file="handleStatusBarTemplateImportFile"
    />

    <section v-if="isProviderPage && canCheckBalance && balance" class="balance-panel">
      <div class="inline-heading">
        <div>
          <h2>DeepSeek 余额</h2>
          <p>来自官方余额接口的原始账户信息。</p>
        </div>
        <RefreshCw :size="20" />
      </div>
      <pre>{{ JSON.stringify(balance, null, 2) }}</pre>
    </section>
  </section>
</template>

<style scoped>
.provider-probe-message {
  margin: 8px 0 0;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--line) 82%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface-strong) 84%, transparent);
  color: var(--muted);
  font-size: 0.82rem;
  line-height: 1.45;
}

.provider-probe-message.probe-success {
  border-color: color-mix(in srgb, var(--green) 34%, var(--line));
  color: color-mix(in srgb, var(--green) 70%, var(--text));
}

.provider-probe-message.probe-warning {
  border-color: color-mix(in srgb, var(--primary) 34%, var(--line));
  color: color-mix(in srgb, var(--primary) 72%, var(--text));
}

.provider-probe-message.probe-error {
  border-color: color-mix(in srgb, #c44 42%, var(--line));
  color: color-mix(in srgb, #c44 78%, var(--text));
}
</style>
