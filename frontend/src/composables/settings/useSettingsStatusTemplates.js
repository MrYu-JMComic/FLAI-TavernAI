import { computed, ref } from 'vue';
import { exportEnvelope, importEnvelope } from '../../api/envelopes.js';
import { downloadJsonFile, todayStamp } from '../../utils/downloadJson.js';

export function useSettingsStatusTemplates({ isExtensionsPage, notify } = {}) {
  const statusTemplateActionBusyId = ref('');
  const statusTemplateActionBusy = computed(() => Boolean(statusTemplateActionBusyId.value));
  const statusTemplateControlsBusy = computed(() => statusTemplateActionBusy.value);
  let statusTemplateMutationToken = 0;

  function resetStatusTemplateAsyncScope() {
    statusTemplateMutationToken += 1;
    statusTemplateActionBusyId.value = '';
  }

  function beginStatusTemplateMutation(actionId) {
    resetStatusTemplateAsyncScope();
    statusTemplateActionBusyId.value = actionId;
    return statusTemplateMutationToken;
  }

  function finishStatusTemplateMutation(mutationToken) {
    if (mutationToken === statusTemplateMutationToken) {
      statusTemplateActionBusyId.value = '';
    }
  }

  function isCurrentStatusTemplateMutation(mutationToken) {
    return mutationToken === statusTemplateMutationToken && isExtensionsPage?.value === true;
  }

  async function exportStatusBarTemplates() {
    if (statusTemplateControlsBusy.value || isExtensionsPage?.value !== true) return;
    const mutationToken = beginStatusTemplateMutation('status-template-export');
    try {
      const envelope = await exportEnvelope('status-bar-templates');
      if (!isCurrentStatusTemplateMutation(mutationToken)) return;
      downloadJsonFile(envelope, `flai-status-bar-templates-${todayStamp()}.json`);
      notify?.success?.('状态栏模板已导出');
    } catch (err) {
      if (!isCurrentStatusTemplateMutation(mutationToken)) return;
      notify?.error?.(err?.message || '状态栏模板导出失败');
    } finally {
      finishStatusTemplateMutation(mutationToken);
    }
  }

  async function importStatusBarTemplates(importText, mutationToken = beginStatusTemplateMutation('status-template-import')) {
    try {
      const parsed = JSON.parse(String(importText || ''));
      const result = await importEnvelope('status-bar-templates', parsed);
      if (!isCurrentStatusTemplateMutation(mutationToken)) return;
      if (result?.skipped?.length) {
        notify?.warning?.(`已跳过 ${result.skipped.length} 个无效状态栏模板`);
      }
      notify?.success?.(`已导入 ${Number(result?.imported || 0)} 个状态栏模板`);
    } catch (err) {
      if (!isCurrentStatusTemplateMutation(mutationToken)) return;
      notify?.error?.(err instanceof SyntaxError ? '导入失败：JSON 格式不正确' : err?.message || '导入失败');
    } finally {
      finishStatusTemplateMutation(mutationToken);
    }
  }

  function handleStatusBarTemplateImportFile(event) {
    const input = event?.target;
    const file = input?.files?.[0];
    if (input) {
      input.value = '';
    }
    if (!file || statusTemplateControlsBusy.value || isExtensionsPage?.value !== true) return;
    const reader = new FileReader();
    const mutationToken = beginStatusTemplateMutation('status-template-import');
    reader.onload = async () => {
      if (!isCurrentStatusTemplateMutation(mutationToken)) return;
      await importStatusBarTemplates(reader.result, mutationToken);
    };
    reader.onerror = () => {
      if (!isCurrentStatusTemplateMutation(mutationToken)) return;
      notify?.error?.('导入失败：文件读取失败');
      finishStatusTemplateMutation(mutationToken);
    };
    try {
      reader.readAsText(file);
    } catch {
      reader.onerror?.();
    }
  }

  return {
    exportStatusBarTemplates,
    handleStatusBarTemplateImportFile,
    resetStatusTemplateAsyncScope,
    statusTemplateActionBusy,
    statusTemplateActionBusyId,
    statusTemplateControlsBusy
  };
}
