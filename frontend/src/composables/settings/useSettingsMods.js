import { computed, reactive, ref } from 'vue';
import { fetchCharacters } from '../../api/characters.js';
import {
  createMod,
  deleteMod,
  fetchMods,
  reorderMods,
  updateMod
} from '../../api/mods.js';
import { exportEnvelope, importEnvelope } from '../../api/envelopes.js';
import {
  getListItemById,
  moveListItemToTargetIndexById,
  removeListItemByIdIfPresent,
  setListIfChanged,
  updateListItemByIdIfChanged
} from './settingsListState.js';
import { callEventMethod } from '../../utils/eventMethods';
import { downloadJsonFile, todayStamp } from '../../utils/downloadJson.js';
import { normalizeModCharacterIds, normalizeModScope } from '../../utils/modDisplay';

export function useSettingsMods({ isExtensionsPage, notify } = {}) {
  const modList = ref([]);
  const modLoading = ref(false);
  const modLoadError = ref('');
  const modActionBusyId = ref('');
  const modActionBusy = computed(() => Boolean(modActionBusyId.value));
  const modControlsBusy = computed(() => modLoading.value || modActionBusy.value);
  let modLoadToken = 0;
  let modMutationToken = 0;
  const modCharacterOptions = ref([]);
  const modCharactersLoading = ref(false);
  const modCharactersLoadError = ref('');
  let modCharactersLoadToken = 0;
  const showModEditor = ref(false);
  const modEditing = ref(null);
  const modForm = reactive(defaultModForm());
  const draggingMod = ref(null);
  const dragOverMod = ref(null);

  async function loadMods() {
    if (!isExtensionPageReady() || modControlsBusy.value) {
      return;
    }
    const requestToken = ++modLoadToken;
    modLoading.value = true;
    modLoadError.value = '';
    try {
      const nextMods = await fetchMods();
      if (!isCurrentModLoad(requestToken)) return;
      setListIfChanged(modList, nextMods);
    } catch (err) {
      if (!isCurrentModLoad(requestToken)) return;
      modLoadError.value = loadFailureMessage(err, 'Mod 加载失败');
    } finally {
      if (isCurrentModLoad(requestToken)) {
        modLoading.value = false;
      }
    }
  }

  function isCurrentModLoad(requestToken) {
    return requestToken === modLoadToken && isExtensionPageReady();
  }

  async function loadModCharacterOptions() {
    if (!isExtensionPageReady() || modCharactersLoading.value || modActionBusy.value) {
      return;
    }
    const requestToken = ++modCharactersLoadToken;
    modCharactersLoading.value = true;
    modCharactersLoadError.value = '';
    try {
      const characters = await fetchCharacters({ sort: 'name' });
      if (!isCurrentModCharacterLoad(requestToken)) return;
      setModCharacterOptionsIfChanged(characters);
    } catch (err) {
      if (!isCurrentModCharacterLoad(requestToken)) return;
      modCharactersLoadError.value = loadFailureMessage(err, '角色加载失败');
    } finally {
      if (isCurrentModCharacterLoad(requestToken)) {
        modCharactersLoading.value = false;
      }
    }
  }

  function isCurrentModCharacterLoad(requestToken) {
    return requestToken === modCharactersLoadToken && isExtensionPageReady();
  }

  function resetModMutationScope() {
    modMutationToken += 1;
    draggingMod.value = null;
    dragOverMod.value = null;
  }

  function resetModAsyncScope() {
    modLoadToken += 1;
    modLoading.value = false;
    modActionBusyId.value = '';
    resetModMutationScope();
  }

  function resetModCharacterLoadScope() {
    modCharactersLoadToken += 1;
    modCharactersLoading.value = false;
  }

  function modToggleActionId(id) {
    return `mod-toggle:${id}`;
  }

  function modDeleteActionId(id) {
    return `mod-delete:${id}`;
  }

  function beginModMutation(actionId) {
    resetModAsyncScope();
    modActionBusyId.value = actionId;
    return modMutationToken;
  }

  function finishModMutation(mutationToken) {
    if (mutationToken === modMutationToken) {
      modActionBusyId.value = '';
    }
  }

  function isCurrentModMutation(mutationToken) {
    return mutationToken === modMutationToken && isExtensionPageReady();
  }

  function getCurrentMod(id) {
    return getListItemById(modList, id);
  }

  function resetModForm() {
    Object.assign(modForm, defaultModForm());
  }

  function updateModFormField(key, value) {
    if (!Object.prototype.hasOwnProperty.call(modForm, key)) {
      return;
    }
    modForm[key] = value;
  }

  function closeModEditor() {
    showModEditor.value = false;
    modEditing.value = null;
    resetModForm();
  }

  function startNewMod() {
    if (modControlsBusy.value) return;
    resetModAsyncScope();
    modEditing.value = null;
    resetModForm();
    showModEditor.value = true;
  }

  function startEditMod(mod) {
    if (modControlsBusy.value) return;
    const currentMod = getCurrentMod(mod?.id);
    if (!currentMod) return;
    resetModAsyncScope();
    modEditing.value = currentMod.id;
    Object.assign(modForm, {
      name: currentMod.name,
      description: currentMod.description,
      type: currentMod.type,
      content: currentMod.content,
      enabled: currentMod.enabled,
      scope: normalizeModScope(currentMod.scope, currentMod.characterIds),
      characterIds: normalizeModCharacterIds(currentMod.characterIds)
    });
    showModEditor.value = true;
  }

  function cancelModEdit() {
    if (modActionBusy.value) return;
    resetModAsyncScope();
    closeModEditor();
  }

  async function saveMod() {
    if (modControlsBusy.value) return;
    const editingId = modEditing.value;
    if (editingId && !getCurrentMod(editingId)) {
      closeModEditor();
      return;
    }
    const scope = normalizeModScope(modForm.scope, modForm.characterIds);
    const characterIds = scope === 'characters' ? normalizeModCharacterIds(modForm.characterIds) : [];
    if (scope === 'characters' && !characterIds.length) {
      notify?.warning?.('请至少绑定一个角色');
      return;
    }
    const mutationToken = beginModMutation('mod-save');
    const payload = {
      name: modForm.name,
      description: modForm.description,
      type: modForm.type,
      content: modForm.content,
      enabled: modForm.enabled,
      scope,
      characterIds
    };
    try {
      if (editingId) {
        await updateMod(editingId, payload);
        if (!isCurrentModMutation(mutationToken)) return;
        closeModEditor();
        finishModMutation(mutationToken);
        await loadMods();
        if (!isCurrentModMutation(mutationToken)) return;
        notify?.success?.('Mod 已更新');
      } else {
        await createMod(payload);
        if (!isCurrentModMutation(mutationToken)) return;
        closeModEditor();
        finishModMutation(mutationToken);
        await loadMods();
        if (!isCurrentModMutation(mutationToken)) return;
        notify?.success?.('Mod 已创建');
      }
    } catch (err) {
      if (!isCurrentModMutation(mutationToken)) return;
      notify?.error?.(err.message);
    } finally {
      finishModMutation(mutationToken);
    }
  }

  async function removeMod(id, name) {
    if (modControlsBusy.value) return;
    const currentMod = getCurrentMod(id);
    if (!currentMod) return;
    name = currentMod.name || name;
    if (!window.confirm(`确定删除 Mod「${name}」吗？`)) return;
    const mutationToken = beginModMutation(modDeleteActionId(currentMod.id));
    try {
      await deleteMod(currentMod.id);
      if (!isCurrentModMutation(mutationToken)) return;
      removeListItemByIdIfPresent(modList, currentMod.id);
      if (modEditing.value === currentMod.id) {
        closeModEditor();
      }
      notify?.success?.(`Mod「${name}」已删除`);
    } catch (err) {
      if (!isCurrentModMutation(mutationToken)) return;
      notify?.error?.(err.message);
    } finally {
      finishModMutation(mutationToken);
    }
  }

  async function toggleMod(mod) {
    if (modControlsBusy.value) return;
    const currentMod = getCurrentMod(mod?.id);
    if (!currentMod) return;
    const mutationToken = beginModMutation(modToggleActionId(currentMod.id));
    const nextEnabled = !currentMod.enabled;
    try {
      const updated = await updateMod(currentMod.id, { enabled: nextEnabled });
      if (!isCurrentModMutation(mutationToken)) return;
      if (!getCurrentMod(currentMod.id)) return;
      const nextMod = updated && typeof updated === 'object' ? updated : { ...currentMod, enabled: nextEnabled };
      updateListItemByIdIfChanged(modList, currentMod.id, nextMod);
      notify?.success?.(nextEnabled ? `Mod「${nextMod.name}」已启用` : `Mod「${nextMod.name}」已禁用`);
    } catch (err) {
      if (!isCurrentModMutation(mutationToken)) return;
      notify?.error?.(err.message);
    } finally {
      finishModMutation(mutationToken);
    }
  }

  async function exportMods() {
    if (modControlsBusy.value) return;
    const mutationToken = beginModMutation('mod-export');
    try {
      const envelope = await exportEnvelope('mods');
      if (!isCurrentModMutation(mutationToken)) return;
      downloadJsonFile(envelope, `flai-mods-${todayStamp()}.json`);
      notify?.success?.('Mod 已导出');
    } catch (err) {
      if (!isCurrentModMutation(mutationToken)) return;
      notify?.error?.(err?.message || 'Mod 导出失败');
    } finally {
      finishModMutation(mutationToken);
    }
  }

  async function importMods(importText, mutationToken = beginModMutation('mod-import')) {
    try {
      const parsed = JSON.parse(String(importText || ''));
      const result = await importEnvelope('mods', parsed);
      if (!isCurrentModMutation(mutationToken)) return;
      const imported = Number(result?.imported || 0);
      finishModMutation(mutationToken);
      await loadMods();
      if (!isCurrentModMutation(mutationToken)) return;
      if (result?.skipped?.length) {
        notify?.warning?.(`已跳过 ${result.skipped.length} 个无效 Mod`);
      }
      notify?.success?.(`已导入 ${imported} 个 Mod`);
    } catch (err) {
      if (!isCurrentModMutation(mutationToken)) return;
      notify?.error?.(err instanceof SyntaxError ? '导入失败：JSON 格式不正确' : err?.message || '导入失败');
    } finally {
      finishModMutation(mutationToken);
    }
  }

  function handleModImportFile(event) {
    const input = event?.target;
    const file = input?.files?.[0];
    if (input) {
      input.value = '';
    }
    if (!file || modControlsBusy.value) return;
    const reader = new FileReader();
    const mutationToken = beginModMutation('mod-import');
    reader.onload = async () => {
      if (!isCurrentModMutation(mutationToken)) return;
      await importMods(reader.result, mutationToken);
    };
    reader.onerror = () => {
      if (!isCurrentModMutation(mutationToken)) return;
      notify?.error?.('导入失败：文件读取失败');
      finishModMutation(mutationToken);
    };
    try {
      reader.readAsText(file);
    } catch {
      reader.onerror?.();
    }
  }

  function selectAllModCharacters() {
    if (modActionBusy.value) return;
    const characterIds = [];
    for (const character of modCharacterOptions.value) {
      characterIds.push(character.id);
    }
    modForm.characterIds = characterIds;
  }

  function clearModCharacters() {
    if (modActionBusy.value) return;
    modForm.characterIds = [];
  }

  function onModDragStart(event, mod) {
    if (modControlsBusy.value) {
      callEventMethod(event, 'preventDefault');
      return;
    }
    const currentMod = getCurrentMod(mod?.id);
    if (!currentMod) {
      callEventMethod(event, 'preventDefault');
      return;
    }
    draggingMod.value = currentMod.id;
    const dataTransfer = event?.dataTransfer;
    if (dataTransfer) {
      dataTransfer.effectAllowed = 'move';
    }
  }

  function onModDragOver(event, mod) {
    if (modControlsBusy.value) return;
    const currentMod = getCurrentMod(mod?.id);
    if (!currentMod) return;
    callEventMethod(event, 'preventDefault');
    if (dragOverMod.value !== currentMod.id) {
      dragOverMod.value = currentMod.id;
    }
  }

  function onModDragEnd() {
    draggingMod.value = null;
    dragOverMod.value = null;
  }

  async function onModDrop(event, targetMod) {
    callEventMethod(event, 'preventDefault');
    if (modControlsBusy.value) return;
    const draggedId = draggingMod.value;
    const currentDraggedMod = getCurrentMod(draggedId);
    const currentTargetMod = getCurrentMod(targetMod?.id);
    if (!currentDraggedMod || !currentTargetMod || currentDraggedMod.id === currentTargetMod.id) {
      dragOverMod.value = null;
      return;
    }

    const moveResult = moveListItemToTargetIndexById(modList, currentDraggedMod.id, currentTargetMod.id);
    if (!moveResult) {
      dragOverMod.value = null;
      return;
    }

    const mutationToken = beginModMutation('mod-reorder');
    dragOverMod.value = null;

    try {
      await reorderMods(moveResult.ids);
      if (!isCurrentModMutation(mutationToken)) return;
    } catch (err) {
      if (!isCurrentModMutation(mutationToken)) return;
      setListIfChanged(modList, moveResult.previousList);
      notify?.error?.(err.message);
      finishModMutation(mutationToken);
      await loadMods();
    } finally {
      finishModMutation(mutationToken);
    }
  }

  function setModCharacterOptionsIfChanged(characters) {
    const nextOptions = [];
    if (Array.isArray(characters)) {
      for (const character of characters) {
        if (character?.canUse !== false) {
          nextOptions.push(character);
        }
      }
    }
    return setListIfChanged(modCharacterOptions, nextOptions);
  }

  function isExtensionPageReady() {
    return isExtensionsPage?.value === true;
  }

  return {
    cancelModEdit,
    clearModCharacters,
    dragOverMod,
    draggingMod,
    exportMods,
    handleModImportFile,
    loadModCharacterOptions,
    loadMods,
    importMods,
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
  };
}

function defaultModForm() {
  return {
    name: '',
    description: '',
    type: 'prompt_inject',
    content: '',
    enabled: true,
    scope: 'global',
    characterIds: []
  };
}

function loadFailureMessage(error, fallback) {
  return error?.message || fallback;
}
