import { computed, ref } from 'vue';
import { exportProjectSnapshot } from '../../api/app.js';
import { exportDiagnostics } from '../../api/diagnostics.js';
import { downloadJsonFile, todayStamp } from '../../utils/downloadJson.js';

export function useSettingsDataExports({ isPersonalPage, notify } = {}) {
  const snapshotExporting = ref(false);
  const diagnosticsExporting = ref(false);
  const dataExportBusy = computed(() => snapshotExporting.value || diagnosticsExporting.value);
  let dataExportToken = 0;

  function resetDataExportScope() {
    dataExportToken += 1;
    snapshotExporting.value = false;
    diagnosticsExporting.value = false;
  }

  async function exportProjectSnapshotBundle() {
    if (!isPersonalExportReady()) {
      return;
    }
    const token = beginDataExport(snapshotExporting);
    try {
      const snapshot = await exportProjectSnapshot();
      if (!isCurrentDataExport(token)) return;
      downloadJsonFile(snapshot, `flai-project-snapshot-${todayStamp()}.json`);
      notify?.success?.('项目快照已导出');
    } catch (error) {
      if (!isCurrentDataExport(token)) return;
      notify?.error?.(error?.message || '项目快照导出失败');
    } finally {
      finishDataExport(token, snapshotExporting);
    }
  }

  async function exportDiagnosticsBundle() {
    if (!isPersonalExportReady()) {
      return;
    }
    const token = beginDataExport(diagnosticsExporting);
    try {
      const diagnostics = await exportDiagnostics();
      if (!isCurrentDataExport(token)) return;
      downloadJsonFile(diagnostics, `flai-diagnostics-${todayStamp()}.json`);
      notify?.success?.('诊断包已导出');
    } catch (error) {
      if (!isCurrentDataExport(token)) return;
      notify?.error?.(error?.message || '诊断包导出失败');
    } finally {
      finishDataExport(token, diagnosticsExporting);
    }
  }

  function isPersonalExportReady() {
    return isPersonalPage?.value === true && !dataExportBusy.value;
  }

  function beginDataExport(flagRef) {
    dataExportToken += 1;
    flagRef.value = true;
    return dataExportToken;
  }

  function finishDataExport(token, flagRef) {
    if (token === dataExportToken) {
      flagRef.value = false;
    }
  }

  function isCurrentDataExport(token) {
    return token === dataExportToken && isPersonalPage?.value === true;
  }

  return {
    dataExportBusy,
    diagnosticsExporting,
    exportDiagnosticsBundle,
    exportProjectSnapshotBundle,
    resetDataExportScope,
    snapshotExporting
  };
}
