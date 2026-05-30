import { computed, reactive, ref } from 'vue';
import {
  deleteStatusBar,
  fetchConversationAccessorySkills,
  fetchConversationEconomy,
  fetchStatusBar,
  saveConversationAccessorySkills,
  saveStatusBar
} from '../../api';

export function useChatAccessory({ conversation, showActionNotice, showError }) {
  const statusBar = ref(null);
  const statusBarEditorOpen = ref(false);
  const statusBarSaving = ref(false);
  const accessorySettingsOpen = ref(false);
  const accessorySaving = ref(false);
  const accessorySkillResults = ref([]);
  const economyAccounts = ref([]);
  const statusBarForm = reactive({
    name: '',
    variables: [],
    template: ''
  });
  const accessorySkills = reactive(createDefaultAccessorySkills());

  const accessorySkillItems = [
    { key: 'npcAgent', label: 'NPC Agent', auto: false },
    { key: 'statusBarAgent', label: '状态栏 Agent', auto: true },
    { key: 'economyAgent', label: '经济识别', auto: false },
    { key: 'talentPrompt', label: '天赋提示', auto: false },
    { key: 'cgScene', label: 'CG 场景', auto: false }
  ];

  const hasStatusBarContent = computed(() => {
    return Boolean(statusBar.value && Array.isArray(statusBar.value.variables) && statusBar.value.variables.length);
  });

  const showEconomyFeature = computed(() => {
    return isAccessorySkillActiveLocal('economyAgent') || economyAccounts.value.length > 0;
  });

  const showNpcFeature = computed(() => isAccessorySkillActiveLocal('npcAgent'));

  async function loadStatusBar() {
    if (!conversation.value?.id) {
      statusBar.value = null;
      return;
    }
    try {
      const result = await fetchStatusBar(conversation.value.id);
      statusBar.value = result;
      if (result) {
        syncStatusBarForm(result);
      }
    } catch {
      statusBar.value = null;
    }
  }

  async function loadEconomyBalance() {
    if (!conversation.value?.id) {
      economyAccounts.value = [];
      return;
    }
    try {
      const result = await fetchConversationEconomy(conversation.value.id, { ensure: false });
      economyAccounts.value = result.accounts || [];
    } catch {
      economyAccounts.value = [];
    }
  }

  async function loadAccessorySkills() {
    if (!conversation.value?.id) {
      syncAccessorySkills();
      return;
    }
    try {
      const payload = await fetchConversationAccessorySkills(conversation.value.id);
      syncAccessorySkills(payload.skills);
    } catch {
      syncAccessorySkills(conversation.value?.settings?.accessorySkills);
    }
  }

  function createDefaultAccessorySkills() {
    return {
      npcAgent: { enabled: false, modelOverride: '' },
      statusBarAgent: { enabled: 'auto', modelOverride: '' },
      economyAgent: { enabled: false, modelOverride: '' },
      talentPrompt: { enabled: false, modelOverride: '' },
      cgScene: { enabled: false, modelOverride: '' }
    };
  }

  function syncAccessorySkills(next = {}) {
    const defaults = createDefaultAccessorySkills();
    for (const key of Object.keys(defaults)) {
      const source = next?.[key] || {};
      accessorySkills[key] = {
        enabled: normalizeSkillEnabled(source.enabled, defaults[key].enabled),
        modelOverride: String(source.modelOverride || source.model_override || '').trim()
      };
    }
  }

  function normalizeSkillEnabled(value, fallback = false) {
    if (value === 'auto') return 'auto';
    if (value === true || value === 'true' || value === 'on') return true;
    if (value === false || value === 'false' || value === 'off') return false;
    return fallback;
  }

  function isAccessorySkillActiveLocal(key) {
    const skill = accessorySkills[key] || {};
    if (skill.enabled === true) return true;
    if (skill.enabled !== 'auto') return false;
    return key === 'statusBarAgent' && hasStatusBarContent.value;
  }

  async function saveAccessorySkillChanges() {
    if (!conversation.value?.id || accessorySaving.value) return;
    accessorySaving.value = true;
    try {
      const payload = await saveConversationAccessorySkills(conversation.value.id, { accessorySkills });
      syncAccessorySkills(payload.skills);
      conversation.value = {
        ...conversation.value,
        settings: {
          ...(conversation.value?.settings || {}),
          accessorySkills: payload.skills
        },
        userSettings: {
          ...(conversation.value?.userSettings || {}),
          accessorySkills: payload.skills
        }
      };
      await loadEconomyBalance();
      showActionNotice('附属技能已保存');
    } catch (err) {
      showError(err.message);
    } finally {
      accessorySaving.value = false;
    }
  }

  function handleSkillResult(data = {}) {
    accessorySkillResults.value = [data, ...accessorySkillResults.value].slice(0, 8);
    if (!data.ok) {
      return;
    }
    const result = data.result || {};
    if (data.skill === 'statusBarAgent' && result.statusBar) {
      statusBar.value = result.statusBar;
      syncStatusBarForm(result.statusBar);
    }
    if (data.skill === 'economyAgent' && Array.isArray(result.transactions) && result.transactions.length) {
      loadEconomyBalance();
    }
  }

  function syncStatusBarForm(data = {}) {
    statusBarForm.name = data.name || '状态栏';
    statusBarForm.variables = Array.isArray(data.variables)
      ? data.variables.map((v) => ({ ...v }))
      : [];
    statusBarForm.template = data.template || '';
  }

  function addStatusBarVariable() {
    statusBarForm.variables.push({
      name: '新变量',
      value: 100,
      max: 100,
      color: '#6c757d'
    });
  }

  function removeStatusBarVariable(index) {
    statusBarForm.variables.splice(index, 1);
  }

  async function saveStatusBarChanges() {
    if (!conversation.value?.id || statusBarSaving.value) return;
    statusBarSaving.value = true;
    try {
      const result = await saveStatusBar(conversation.value.id, {
        name: statusBarForm.name,
        variables: statusBarForm.variables,
        template: statusBarForm.template
      });
      statusBar.value = result;
      showActionNotice('状态栏已保存');
    } catch (err) {
      showError(err.message);
    } finally {
      statusBarSaving.value = false;
    }
  }

  async function deleteStatusBarAction() {
    if (!conversation.value?.id) return;
    if (!window.confirm('确定删除当前状态栏？')) return;
    try {
      await deleteStatusBar(conversation.value.id);
      statusBar.value = null;
      statusBarForm.name = '';
      statusBarForm.variables = [];
      statusBarForm.template = '';
      showActionNotice('状态栏已删除');
    } catch (err) {
      showError(err.message);
    }
  }

  function openStatusBarEditor() {
    if (statusBar.value) {
      syncStatusBarForm(statusBar.value);
    } else {
      statusBarForm.name = '状态栏';
      statusBarForm.variables = [
        { name: 'HP', value: 100, max: 100, color: '#e74c3c' },
        { name: 'MP', value: 50, max: 50, color: '#3498db' }
      ];
      statusBarForm.template = '';
    }
    statusBarEditorOpen.value = true;
  }

  function closeStatusBarEditor() {
    statusBarEditorOpen.value = false;
  }

  return {
    statusBar,
    statusBarForm,
    statusBarEditorOpen,
    statusBarSaving,
    accessorySettingsOpen,
    accessorySaving,
    accessorySkills,
    accessorySkillResults,
    economyAccounts,
    accessorySkillItems,
    hasStatusBarContent,
    showEconomyFeature,
    showNpcFeature,
    loadStatusBar,
    loadEconomyBalance,
    loadAccessorySkills,
    syncAccessorySkills,
    isAccessorySkillActiveLocal,
    saveAccessorySkillChanges,
    handleSkillResult,
    syncStatusBarForm,
    addStatusBarVariable,
    removeStatusBarVariable,
    saveStatusBarChanges,
    deleteStatusBarAction,
    openStatusBarEditor,
    closeStatusBarEditor
  };
}
