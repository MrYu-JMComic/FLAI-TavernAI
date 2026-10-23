import { defineComponent, h, nextTick, reactive, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsRegexPanel from '../settings/SettingsRegexPanel.vue';
import { useSettingsRegex } from '../../composables/settings/useSettingsRegex.js';

const api = vi.hoisted(() => ({
  deleteRegexRule: vi.fn(),
  fetchRegexRules: vi.fn(),
  reorderRegexRules: vi.fn(),
  toggleRegexRule: vi.fn()
}));
vi.mock('../../api/settings.js', () => api);

let wrapper;
let serverRules;
let confirm;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function setupPanel() {
  const isExtensionsPage = ref(true);
  const notify = { success: vi.fn(), error: vi.fn() };
  let state;
  wrapper = mount(defineComponent({
    setup() {
      state = reactive(useSettingsRegex({ isExtensionsPage, notify }));
      return () => h(SettingsRegexPanel, {
        actionBusyId: state.regexActionBusyId,
        controlsBusy: state.regexControlsBusy,
        groupFilter: state.regexGroupFilter,
        groups: state.regexGroups,
        loadError: state.regexLoadError,
        loading: state.regexLoading,
        regexRules: state.regexRules,
        onRemove: state.handleDeleteRegexRule,
        onToggle: state.handleToggleRegexRule,
        onExport: state.exportRegexRules,
        onLoad: state.loadRegexRules,
        onDrop: state.onRegexDrop,
        'onDrag-start': state.onRegexDragStart,
        'onDrag-over': state.onRegexDragOver,
        'onImport-file': state.handleRegexImportFile,
        'onUpdate-group-filter': state.updateRegexGroupFilter,
        'onGroup-filter-change': state.handleRegexGroupFilterChange
      });
    }
  }));
  await state.loadRegexRules();
  await nextTick();
  return { state, notify, isExtensionsPage };
}

function deleteButton(label = '禁用词过滤') {
  return wrapper.get(`button[aria-label="删除正则规则：${label}"]`);
}

function renderedRuleLabels() {
  return wrapper.findAll('.regex-rule-info strong').map(item => item.text());
}

beforeEach(() => {
  vi.resetAllMocks();
  confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  serverRules = [
    { id: 'disabled-rule', label: '禁用词过滤', pattern: '指甲|血丝', replacement: '', enabled: false, groupName: '可删分组', scope: 'output', priority: 0 },
    { id: 'keep-rule', label: '输出替换', pattern: 'user', replacement: 'traveler', enabled: true, groupName: '保留分组', scope: 'output', priority: 1 }
  ];
  api.fetchRegexRules.mockImplementation(async group => serverRules
    .filter(rule => !group || rule.groupName === group)
    .map(rule => ({ ...rule })));
  api.deleteRegexRule.mockImplementation(async id => {
    serverRules = serverRules.filter(rule => rule.id !== id);
    return { ok: true };
  });
  api.toggleRegexRule.mockImplementation(async id => {
    serverRules = serverRules.map(rule => rule.id === id ? { ...rule, enabled: !rule.enabled } : rule);
    return { ok: true };
  });
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.restoreAllMocks();
});

describe('settings regex rule deletion', () => {
  it('confirms the current rule label and leaves cancellation or missing ids unchanged', async () => {
    const { state, notify } = await setupPanel();
    await state.handleDeleteRegexRule('missing-rule');
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockReturnValue(false);

    await deleteButton().trigger('click');

    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('禁用词过滤'));
    expect(api.deleteRegexRule).not.toHaveBeenCalled();
    expect(renderedRuleLabels()).toEqual(['禁用词过滤', '输出替换']);
    expect(state.regexControlsBusy).toBe(false);
    expect(notify.success).not.toHaveBeenCalled();
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('deletes a disabled rule after server success and keeps it removed after reload', async () => {
    const { state, notify } = await setupPanel();
    expect(wrapper.get('.regex-rule-card').classes()).toContain('disabled');
    expect(deleteButton().element.disabled).toBe(false);

    await deleteButton().trigger('click');
    await flushPromises();

    expect(api.deleteRegexRule).toHaveBeenCalledExactlyOnceWith('disabled-rule');
    expect(renderedRuleLabels()).toEqual(['输出替换']);
    expect(wrapper.findAll('select option').map(option => option.element.value)).toEqual(['', '保留分组']);
    expect(notify.success).toHaveBeenCalledWith(expect.stringContaining('已删除'));
    expect(notify.error).not.toHaveBeenCalled();
    await state.loadRegexRules();
    await nextTick();
    expect(api.fetchRegexRules).toHaveBeenCalledTimes(2);
    expect(renderedRuleLabels()).toEqual(['输出替换']);
    expect(state.regexControlsBusy).toBe(false);
  });

  it('preserves the rule on failure, reports the error and releases controls for retry', async () => {
    const pending = deferred();
    api.deleteRegexRule.mockReturnValueOnce(pending.promise);
    const { state, notify } = await setupPanel();
    await deleteButton().trigger('click');
    pending.reject(new Error('删除失败，请重试'));
    await flushPromises();

    expect(renderedRuleLabels()).toEqual(['禁用词过滤', '输出替换']);
    expect(notify.error).toHaveBeenCalledExactlyOnceWith('删除失败，请重试');
    expect(notify.success).not.toHaveBeenCalled();
    expect(state.regexActionBusyId).toBe('');
    expect(wrapper.findAll('button, select, input').every(control => !control.element.disabled)).toBe(true);
    await deleteButton().trigger('click');
    await flushPromises();
    expect(api.deleteRegexRule).toHaveBeenCalledTimes(2);
    expect(renderedRuleLabels()).toEqual(['输出替换']);
  });

  it('retains the row while pending, locks controls and suppresses duplicate or competing mutations', async () => {
    const pending = deferred();
    api.deleteRegexRule.mockReturnValueOnce(pending.promise);
    const { state, notify } = await setupPanel();
    await deleteButton().trigger('click');

    expect(state.regexActionBusyId).toBe('regex-delete:disabled-rule');
    expect(renderedRuleLabels()).toEqual(['禁用词过滤', '输出替换']);
    expect(deleteButton().attributes('aria-busy')).toBe('true');
    expect(wrapper.get('.regex-rule-card').attributes('aria-busy')).toBe('true');
    expect(wrapper.findAll('button, select, input').every(control => control.element.disabled)).toBe(true);
    expect(wrapper.findAll('.regex-rule-card').every(card => card.attributes('draggable') === 'false')).toBe(true);
    await deleteButton().trigger('click');
    await state.handleDeleteRegexRule('disabled-rule');
    await state.handleDeleteRegexRule('keep-rule');
    await state.handleToggleRegexRule('keep-rule');
    const preventDefault = vi.fn();
    state.onRegexDragStart({ preventDefault }, 'keep-rule');
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(api.deleteRegexRule).toHaveBeenCalledOnce();
    expect(api.toggleRegexRule).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledOnce();
    expect(notify.success).not.toHaveBeenCalled();

    pending.resolve({ ok: true });
    await flushPromises();
    expect(renderedRuleLabels()).toEqual(['输出替换']);
    expect(state.regexControlsBusy).toBe(false);
  });

  it('ignores a response from a reset scope without clearing a newer mutation', async () => {
    const oldDelete = deferred();
    const currentDelete = deferred();
    api.deleteRegexRule.mockReturnValueOnce(oldDelete.promise).mockReturnValueOnce(currentDelete.promise);
    const { state, notify } = await setupPanel();
    await deleteButton().trigger('click');
    state.resetRegexAsyncScope();
    await nextTick();
    await deleteButton('输出替换').trigger('click');
    expect(state.regexActionBusyId).toBe('regex-delete:keep-rule');

    oldDelete.resolve({ ok: true });
    await flushPromises();

    expect(renderedRuleLabels()).toEqual(['禁用词过滤', '输出替换']);
    expect(state.regexActionBusyId).toBe('regex-delete:keep-rule');
    expect(notify.success).not.toHaveBeenCalled();
    expect(notify.error).not.toHaveBeenCalled();
    currentDelete.resolve({ ok: true });
    await flushPromises();
    expect(renderedRuleLabels()).toEqual(['禁用词过滤']);
    expect(state.regexControlsBusy).toBe(false);
    expect(notify.success).toHaveBeenCalledOnce();
  });

  it('ignores a late success after leaving the extensions page', async () => {
    const pending = deferred();
    api.deleteRegexRule.mockReturnValueOnce(pending.promise);
    const { state, notify, isExtensionsPage } = await setupPanel();
    await deleteButton().trigger('click');
    isExtensionsPage.value = false;
    pending.resolve({ ok: true });
    await flushPromises();

    expect(renderedRuleLabels()).toEqual(['禁用词过滤', '输出替换']);
    expect(state.regexControlsBusy).toBe(false);
    expect(notify.success).not.toHaveBeenCalled();
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('keeps enabling a rule available beside deletion and refreshes its enabled state', async () => {
    const { state, notify } = await setupPanel();
    await wrapper.get('button[aria-label="启用正则规则：禁用词过滤"]').trigger('click');
    await flushPromises();

    expect(api.toggleRegexRule).toHaveBeenCalledExactlyOnceWith('disabled-rule');
    expect(api.deleteRegexRule).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(wrapper.get('.regex-rule-card').classes()).not.toContain('disabled');
    expect(wrapper.find('button[aria-label="禁用正则规则：禁用词过滤"]').exists()).toBe(true);
    expect(deleteButton().element.disabled).toBe(false);
    expect(renderedRuleLabels()).toEqual(['禁用词过滤', '输出替换']);
    expect(state.regexControlsBusy).toBe(false);
    expect(notify.success).toHaveBeenCalledWith('规则状态已切换');
  });
});
