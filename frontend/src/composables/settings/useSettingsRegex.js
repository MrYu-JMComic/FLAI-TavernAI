import { computed, ref } from 'vue';
import {
  fetchRegexRules,
  reorderRegexRules,
  toggleRegexRule
} from '../../api/settings.js';
import { exportEnvelope, importEnvelope } from '../../api/envelopes.js';
import {
  getListItemById,
  moveListItemToTargetIndexById,
  setListIfChanged
} from './settingsListState.js';
import { callEventMethod } from '../../utils/eventMethods';
import { downloadJsonFile, todayStamp } from '../../utils/downloadJson.js';

export function useSettingsRegex({ isExtensionsPage, notify } = {}) {
  const regexRules = ref([]);
  const regexLoading = ref(false);
  const regexLoadError = ref('');
  const regexActionBusyId = ref('');
  const regexActionBusy = computed(() => Boolean(regexActionBusyId.value));
  const regexControlsBusy = computed(() => regexLoading.value || regexActionBusy.value);
  const regexGroupFilter = ref('');
  const regexGroupOptions = ref([]);
  const regexGroups = computed(() => regexGroupOptions.value);
  const regexImportText = ref('');
  const showRegexImport = ref(false);
  const draggingRegexRuleId = ref('');
  let regexLoadToken = 0;
  let regexMutationToken = 0;

  async function loadRegexRules() {
    if (!isExtensionPageReady() || regexControlsBusy.value) {
      return;
    }
    const groupFilter = regexGroupFilter.value;
    const requestToken = ++regexLoadToken;
    regexLoading.value = true;
    regexLoadError.value = '';
    try {
      const nextRules = await fetchRegexRules(groupFilter);
      if (!isCurrentRegexLoad(requestToken, groupFilter)) return;
      setListIfChanged(regexRules, nextRules);
      setRegexGroupOptionsFromRules(nextRules, groupFilter);
    } catch (err) {
      if (!isCurrentRegexLoad(requestToken, groupFilter)) return;
      regexLoadError.value = loadFailureMessage(err, '正则规则加载失败');
    } finally {
      if (isCurrentRegexLoad(requestToken, groupFilter)) {
        regexLoading.value = false;
      }
    }
  }

  function isCurrentRegexLoad(requestToken, groupFilter) {
    return requestToken === regexLoadToken
      && isExtensionPageReady()
      && regexGroupFilter.value === groupFilter;
  }

  function resetRegexAsyncScope() {
    regexLoadToken += 1;
    regexLoading.value = false;
    regexActionBusyId.value = '';
    resetRegexMutationScope();
  }

  function resetRegexMutationScope() {
    regexMutationToken += 1;
    draggingRegexRuleId.value = '';
  }

  function regexToggleActionId(id) {
    return `regex-toggle:${id}`;
  }

  function beginRegexMutation(actionId) {
    resetRegexAsyncScope();
    regexActionBusyId.value = actionId;
    return regexMutationToken;
  }

  function finishRegexMutation(mutationToken) {
    if (mutationToken === regexMutationToken) {
      regexActionBusyId.value = '';
    }
  }

  function isCurrentRegexMutation(mutationToken, groupFilter) {
    return mutationToken === regexMutationToken
      && isExtensionPageReady()
      && regexGroupFilter.value === groupFilter;
  }

  function getCurrentRegexRule(ruleId) {
    return getListItemById(regexRules, ruleId);
  }

  function handleRegexGroupFilterChange() {
    if (regexControlsBusy.value) return;
    resetRegexMutationScope();
    loadRegexRules();
  }

  function updateRegexGroupFilter(value) {
    regexGroupFilter.value = String(value || '');
  }

  async function handleToggleRegexRule(ruleId) {
    if (regexControlsBusy.value) return;
    const currentRule = getCurrentRegexRule(ruleId);
    if (!currentRule) return;
    const groupFilter = regexGroupFilter.value;
    const mutationToken = beginRegexMutation(regexToggleActionId(currentRule.id));
    try {
      await toggleRegexRule(currentRule.id);
      if (!isCurrentRegexMutation(mutationToken, groupFilter)) return;
      finishRegexMutation(mutationToken);
      await loadRegexRules();
      if (!isCurrentRegexMutation(mutationToken, groupFilter)) return;
      notify?.success?.('规则状态已切换');
    } catch (err) {
      if (!isCurrentRegexMutation(mutationToken, groupFilter)) return;
      notify?.error?.(err.message);
    } finally {
      finishRegexMutation(mutationToken);
    }
  }

  function onRegexDragStart(event, ruleId) {
    if (regexControlsBusy.value) {
      callEventMethod(event, 'preventDefault');
      return;
    }
    const currentRule = getCurrentRegexRule(ruleId);
    if (!currentRule) {
      callEventMethod(event, 'preventDefault');
      return;
    }
    draggingRegexRuleId.value = currentRule.id;
  }

  function onRegexDragOver(event, ruleId) {
    if (regexControlsBusy.value) return;
    if (!getCurrentRegexRule(ruleId)) return;
    callEventMethod(event, 'preventDefault');
  }

  async function onRegexDrop(targetRuleId) {
    if (regexControlsBusy.value) return;
    const currentDraggedRule = getCurrentRegexRule(draggingRegexRuleId.value);
    const currentTargetRule = getCurrentRegexRule(targetRuleId);
    if (!currentDraggedRule || !currentTargetRule || currentDraggedRule.id === currentTargetRule.id) {
      draggingRegexRuleId.value = '';
      return;
    }
    const groupFilter = regexGroupFilter.value;
    const moveResult = moveListItemToTargetIndexById(regexRules, currentDraggedRule.id, currentTargetRule.id);
    if (!moveResult) {
      draggingRegexRuleId.value = '';
      return;
    }
    draggingRegexRuleId.value = '';
    const mutationToken = beginRegexMutation('regex-reorder');
    try {
      await reorderRegexRules(moveResult.ids, groupFilter);
      if (!isCurrentRegexMutation(mutationToken, groupFilter)) return;
      notify?.success?.('排序已保存');
    } catch (err) {
      if (!isCurrentRegexMutation(mutationToken, groupFilter)) return;
      setListIfChanged(regexRules, moveResult.previousList);
      notify?.error?.(err.message);
      finishRegexMutation(mutationToken);
      await loadRegexRules();
    } finally {
      finishRegexMutation(mutationToken);
    }
  }

  function setRegexGroupOptionsFromRules(rules, selectedGroup = '') {
    const nextGroups = [];
    const replacingAllGroups = !selectedGroup;
    if (!replacingAllGroups) {
      appendKnownRegexGroups(nextGroups, regexGroupOptions.value);
      appendRegexGroupIfMissing(nextGroups, selectedGroup);
    }
    appendKnownRegexGroups(nextGroups, normalizeRegexGroupNamesFromRules(rules));
    nextGroups.sort();
    return setListIfChanged(regexGroupOptions, nextGroups);
  }

  async function exportRegexRules() {
    if (regexControlsBusy.value) return;
    const groupFilter = regexGroupFilter.value;
    const mutationToken = beginRegexMutation('regex-export');
    try {
      const envelope = await exportEnvelope('regex-rules');
      if (!isCurrentRegexMutation(mutationToken, groupFilter)) return;
      downloadJsonFile(envelope, `flai-regex-rules-${todayStamp()}.json`);
      notify?.success?.('正则规则已导出');
    } catch (err) {
      if (!isCurrentRegexMutation(mutationToken, groupFilter)) return;
      notify?.error?.(err?.message || '正则规则导出失败');
    } finally {
      finishRegexMutation(mutationToken);
    }
  }

  async function importRegexRules(mutationToken = beginRegexMutation('regex-import'), groupFilter = regexGroupFilter.value) {
    try {
      const parsed = JSON.parse(regexImportText.value);
      const result = await importEnvelope('regex-rules', parsed);
      if (!isCurrentRegexMutation(mutationToken, groupFilter)) return;
      const imported = Number(result?.imported || 0);
      regexImportText.value = '';
      showRegexImport.value = false;
      finishRegexMutation(mutationToken);
      await loadRegexRules();
      if (!isCurrentRegexMutation(mutationToken, groupFilter)) return;
      if (result.skipped?.length) {
        notify?.warning?.(`已跳过 ${result.skipped.length} 条无效或无权限规则`);
      }
      notify?.success?.(`已导入 ${imported} 条规则`);
    } catch (err) {
      if (!isCurrentRegexMutation(mutationToken, groupFilter)) return;
      notify?.error?.(err instanceof SyntaxError ? '导入失败：JSON 格式不正确' : err?.message || '导入失败');
    } finally {
      finishRegexMutation(mutationToken);
    }
  }

  function handleRegexImportFile(event) {
    const input = event?.target;
    const file = input?.files?.[0];
    if (input) {
      input.value = '';
    }
    if (!file || regexControlsBusy.value) return;
    const reader = new FileReader();
    const groupFilter = regexGroupFilter.value;
    const mutationToken = beginRegexMutation('regex-import');
    reader.onload = () => {
      if (!isCurrentRegexMutation(mutationToken, groupFilter)) return;
      regexImportText.value = String(reader.result || '');
      importRegexRules(mutationToken, groupFilter);
    };
    reader.onerror = () => {
      if (!isCurrentRegexMutation(mutationToken, groupFilter)) return;
      notify?.error?.('导入失败：文件读取失败');
      finishRegexMutation(mutationToken);
    };
    try {
      reader.readAsText(file);
    } catch {
      reader.onerror?.();
    }
  }

  function isExtensionPageReady() {
    return isExtensionsPage?.value === true;
  }

  return {
    exportRegexRules,
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
  };
}

function normalizeRegexGroupNamesFromRules(rules) {
  const groups = [];
  for (const rule of Array.isArray(rules) ? rules : []) {
    appendRegexGroupIfMissing(groups, normalizeRegexGroupName(rule?.groupName));
  }
  return groups;
}

function appendKnownRegexGroups(targetGroups, sourceGroups) {
  for (const group of Array.isArray(sourceGroups) ? sourceGroups : []) {
    appendRegexGroupIfMissing(targetGroups, normalizeRegexGroupName(group));
  }
}

function appendRegexGroupIfMissing(groups, groupName) {
  const normalizedName = normalizeRegexGroupName(groupName);
  if (!normalizedName) {
    return false;
  }
  for (const group of groups) {
    if (group === normalizedName) {
      return false;
    }
  }
  groups.push(normalizedName);
  return true;
}

function normalizeRegexGroupName(groupName) {
  return String(groupName || '').trim() || '全局';
}

function loadFailureMessage(error, fallback) {
  return error?.message || fallback;
}
