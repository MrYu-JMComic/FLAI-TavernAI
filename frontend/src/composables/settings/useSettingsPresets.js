import { computed, reactive, ref } from 'vue';
import {
  createPreset,
  deletePreset,
  fetchPresets,
  setDefaultPreset,
  updatePreset
} from '../../api/presets.js';
import { exportEnvelope, importEnvelope } from '../../api/envelopes.js';
import {
  getListItemById,
  removeListItemByIdIfPresent,
  setListIfChanged
} from './settingsListState.js';
import { downloadJsonFile, todayStamp } from '../../utils/downloadJson.js';

export function useSettingsPresets({ isExtensionsPage, notify } = {}) {
  const presetList = ref([]);
  const presetLoading = ref(false);
  const presetLoadError = ref('');
  const presetActionBusyId = ref('');
  const presetActionBusy = computed(() => Boolean(presetActionBusyId.value));
  const presetControlsBusy = computed(() => presetLoading.value || presetActionBusy.value);
  const presetEditing = ref(null);
  const presetForm = reactive(defaultPresetForm());
  const showPresetEditor = ref(false);
  const presetImportText = ref('');
  let presetLoadToken = 0;
  let presetMutationToken = 0;

  async function loadPresets() {
    if (!isExtensionPageReady() || presetControlsBusy.value) {
      return;
    }
    const requestToken = ++presetLoadToken;
    presetLoading.value = true;
    presetLoadError.value = '';
    try {
      const nextPresets = await fetchPresets();
      if (!isCurrentPresetLoad(requestToken)) return;
      setListIfChanged(presetList, nextPresets);
    } catch (err) {
      if (!isCurrentPresetLoad(requestToken)) return;
      presetLoadError.value = loadFailureMessage(err, '预设加载失败');
    } finally {
      if (isCurrentPresetLoad(requestToken)) {
        presetLoading.value = false;
      }
    }
  }

  function isCurrentPresetLoad(requestToken) {
    return requestToken === presetLoadToken && isExtensionPageReady();
  }

  function resetPresetMutationScope() {
    presetMutationToken += 1;
  }

  function resetPresetAsyncScope() {
    presetLoadToken += 1;
    presetLoading.value = false;
    presetActionBusyId.value = '';
    resetPresetMutationScope();
  }

  function presetDefaultActionId(id) {
    return `preset-default:${id}`;
  }

  function presetDeleteActionId(id) {
    return `preset-delete:${id}`;
  }

  function beginPresetMutation(actionId) {
    resetPresetAsyncScope();
    presetActionBusyId.value = actionId;
    return presetMutationToken;
  }

  function finishPresetMutation(mutationToken) {
    if (mutationToken === presetMutationToken) {
      presetActionBusyId.value = '';
    }
  }

  function isCurrentPresetMutation(mutationToken) {
    return mutationToken === presetMutationToken && isExtensionPageReady();
  }

  function getCurrentPreset(id) {
    return getListItemById(presetList, id);
  }

  function resetPresetForm() {
    Object.assign(presetForm, defaultPresetForm());
  }

  function updatePresetFormField(key, value) {
    if (!Object.prototype.hasOwnProperty.call(presetForm, key)) {
      return;
    }
    presetForm[key] = value;
  }

  function startNewPreset() {
    if (presetControlsBusy.value) return;
    resetPresetMutationScope();
    presetEditing.value = null;
    resetPresetForm();
    showPresetEditor.value = true;
  }

  function startEditPreset(preset) {
    if (presetControlsBusy.value) return;
    const currentPreset = getCurrentPreset(preset?.id);
    if (!currentPreset) return;
    resetPresetMutationScope();
    presetEditing.value = currentPreset.id;
    Object.assign(presetForm, {
      name: currentPreset.name,
      systemPrompt: currentPreset.systemPrompt,
      temperature: currentPreset.temperature,
      maxTokens: currentPreset.maxTokens,
      topP: currentPreset.topP,
      frequencyPenalty: currentPreset.frequencyPenalty,
      presencePenalty: currentPreset.presencePenalty
    });
    showPresetEditor.value = true;
  }

  function cancelPresetEdit() {
    if (presetActionBusy.value) return;
    resetPresetMutationScope();
    closePresetEditor();
  }

  async function savePreset() {
    if (presetControlsBusy.value) return;
    const editingId = presetEditing.value;
    const editingPreset = editingId ? getCurrentPreset(editingId) : null;
    if (editingId && !editingPreset) {
      closePresetEditor();
      return;
    }
    const mutationToken = beginPresetMutation('preset-save');
    const payload = buildPresetPayload();
    try {
      if (editingId) {
        await updatePreset(editingPreset.id, payload);
        if (!isCurrentPresetMutation(mutationToken)) return;
        notify?.success?.('预设已更新');
      } else {
        await createPreset(payload);
        if (!isCurrentPresetMutation(mutationToken)) return;
        notify?.success?.('预设已创建');
      }
      closePresetEditor();
      finishPresetMutation(mutationToken);
      await loadPresets();
    } catch (err) {
      if (!isCurrentPresetMutation(mutationToken)) return;
      notify?.error?.(err.message);
    } finally {
      finishPresetMutation(mutationToken);
    }
  }

  async function removePreset(id, name) {
    if (presetControlsBusy.value) return;
    const currentPreset = getCurrentPreset(id);
    if (!currentPreset) return;
    name = currentPreset.name || name;
    if (!window.confirm(`确定删除预设「${name}」吗？`)) return;
    const mutationToken = beginPresetMutation(presetDeleteActionId(currentPreset.id));
    try {
      await deletePreset(currentPreset.id);
      if (!isCurrentPresetMutation(mutationToken)) return;
      removeListItemByIdIfPresent(presetList, currentPreset.id);
      if (presetEditing.value === currentPreset.id) {
        closePresetEditor();
      }
      notify?.success?.(`预设「${name}」已删除`);
    } catch (err) {
      if (!isCurrentPresetMutation(mutationToken)) return;
      notify?.error?.(err.message);
    } finally {
      finishPresetMutation(mutationToken);
    }
  }

  async function makeDefaultPreset(id) {
    if (presetControlsBusy.value) return;
    const currentPreset = getCurrentPreset(id);
    if (!currentPreset) return;
    const mutationToken = beginPresetMutation(presetDefaultActionId(currentPreset.id));
    try {
      await setDefaultPreset(currentPreset.id);
      if (!isCurrentPresetMutation(mutationToken)) return;
      finishPresetMutation(mutationToken);
      await loadPresets();
      if (!isCurrentPresetMutation(mutationToken)) return;
      notify?.success?.('已设为默认预设');
    } catch (err) {
      if (!isCurrentPresetMutation(mutationToken)) return;
      notify?.error?.(err.message);
    } finally {
      finishPresetMutation(mutationToken);
    }
  }

  async function exportPresets() {
    if (presetControlsBusy.value) return;
    const mutationToken = beginPresetMutation('preset-export');
    try {
      const envelope = await exportEnvelope('presets');
      if (!isCurrentPresetMutation(mutationToken)) return;
      downloadJsonFile(envelope, `flai-presets-${todayStamp()}.json`);
      notify?.success?.('预设已导出');
    } catch (err) {
      if (!isCurrentPresetMutation(mutationToken)) return;
      notify?.error?.(err?.message || '预设导出失败');
    } finally {
      finishPresetMutation(mutationToken);
    }
  }

  async function importPresets(mutationToken = beginPresetMutation('preset-import')) {
    try {
      const parsed = JSON.parse(presetImportText.value);
      const result = await importEnvelope('presets', parsed);
      if (!isCurrentPresetMutation(mutationToken)) return;
      const imported = Number(result?.imported || 0);
      presetImportText.value = '';
      finishPresetMutation(mutationToken);
      await loadPresets();
      if (!isCurrentPresetMutation(mutationToken)) return;
      if (result?.skipped?.length) {
        notify?.warning?.(`已跳过 ${result.skipped.length} 个无效预设`);
      }
      notify?.success?.(`已导入 ${imported} 个预设`);
    } catch (err) {
      if (!isCurrentPresetMutation(mutationToken)) return;
      notify?.error?.(err instanceof SyntaxError ? '导入失败：JSON 格式不正确' : err?.message || '导入失败');
    } finally {
      finishPresetMutation(mutationToken);
    }
  }

  function handlePresetImportFile(event) {
    const input = event?.target;
    const file = input?.files?.[0];
    if (input) {
      input.value = '';
    }
    if (!file || presetControlsBusy.value) return;
    const reader = new FileReader();
    const mutationToken = beginPresetMutation('preset-import');
    reader.onload = async () => {
      if (!isCurrentPresetMutation(mutationToken)) return;
      presetImportText.value = String(reader.result || '');
      await importPresets(mutationToken);
    };
    reader.onerror = () => {
      if (!isCurrentPresetMutation(mutationToken)) return;
      notify?.error?.('导入失败：文件读取失败');
      finishPresetMutation(mutationToken);
    };
    try {
      reader.readAsText(file);
    } catch {
      reader.onerror?.();
    }
  }

  function closePresetEditor() {
    showPresetEditor.value = false;
    presetEditing.value = null;
    resetPresetForm();
  }

  function buildPresetPayload() {
    return {
      name: presetForm.name,
      systemPrompt: presetForm.systemPrompt,
      temperature: Number(presetForm.temperature),
      maxTokens: Math.round(Number(presetForm.maxTokens)),
      topP: Number(presetForm.topP),
      frequencyPenalty: Number(presetForm.frequencyPenalty),
      presencePenalty: Number(presetForm.presencePenalty)
    };
  }

  function isExtensionPageReady() {
    return isExtensionsPage?.value === true;
  }

  return {
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
  };
}

function defaultPresetForm() {
  return {
    name: '',
    systemPrompt: '',
    temperature: 1.0,
    maxTokens: 4096,
    topP: 1.0,
    frequencyPenalty: 0,
    presencePenalty: 0
  };
}

function loadFailureMessage(error, fallback) {
  return error?.message || fallback;
}
