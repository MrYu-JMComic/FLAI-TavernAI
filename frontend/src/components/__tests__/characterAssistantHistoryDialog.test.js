import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import CharacterAssistantHistoryDialog from '../character/CharacterAssistantHistoryDialog.vue';

let wrapper;
let opener;
const dialogMethods = new Map(['showModal', 'close'].map(key => [key, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, key)]));
const versions = [
  { id: 'version-before', title: '修改前的草稿', createdAt: '2026-10-19T01:00:00.000Z' },
  { id: 'version-after', title: '修改后的草稿', createdAt: '2026-10-19T01:01:00.000Z' }
];

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: vi.fn(function () {
    this.setAttribute('open', '');
    this.querySelector('[autofocus]')?.focus();
  }) });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: vi.fn(function () { this.removeAttribute('open'); }) });
  opener = document.createElement('button');
  document.body.append(opener);
  opener.focus();
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  opener.remove();
  for (const [key, descriptor] of dialogMethods) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, key, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, key);
  }
  vi.restoreAllMocks();
});

describe('character assistant draft history', () => {
  it('restores the selected version by id and returns focus when closed', async () => {
    wrapper = mount(CharacterAssistantHistoryDialog, { props: { versions }, attachTo: document.body });
    expect(wrapper.get('dialog').attributes()).toHaveProperty('open');
    expect(wrapper.findAll('li').map(item => item.get('strong').text())).toEqual(versions.map(version => version.title));
    expect(wrapper.findAll('time').map(time => time.attributes('datetime'))).toEqual(versions.map(version => version.createdAt));
    await wrapper.findAll('li button')[1].trigger('click');
    expect(wrapper.emitted('restore')).toEqual([['version-after']]);
    await wrapper.get('[aria-label="关闭历史版本"]').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
    wrapper = null;
    expect(document.activeElement).toBe(opener);
  });

  it('blocks restore and all dismissal paths while a version is being restored', async () => {
    wrapper = mount(CharacterAssistantHistoryDialog, { props: { versions, busy: true }, attachTo: document.body });
    expect(wrapper.findAll('button').every(button => button.element.disabled)).toBe(true);
    await wrapper.get('li button').trigger('click');
    await wrapper.get('[aria-label="关闭历史版本"]').trigger('click');
    await wrapper.get('footer button').trigger('click');
    await wrapper.get('dialog').trigger('cancel');
    await wrapper.get('dialog').trigger('click');
    expect(wrapper.emitted('restore')).toBeUndefined();
    expect(wrapper.emitted('close')).toBeUndefined();
    await wrapper.setProps({ busy: false });
    await wrapper.get('dialog').trigger('cancel');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('reports a load error and lets the user retry', async () => {
    wrapper = mount(CharacterAssistantHistoryDialog, { props: { error: '读取历史失败', versions }, attachTo: document.body });
    expect(wrapper.get('[role="alert"]').text()).toContain('读取历史失败');
    expect(wrapper.find('ol').exists()).toBe(true);
    await wrapper.get('[role="alert"] button').trigger('click');
    expect(wrapper.emitted('reload')).toEqual([[]]);
    await wrapper.setProps({ busy: true });
    expect(wrapper.get('[role="alert"] button').element.disabled).toBe(true);
    await wrapper.get('[role="alert"] button').trigger('click');
    expect(wrapper.emitted('reload')).toHaveLength(1);
  });

  it('shows loading and empty history without a restore action', async () => {
    wrapper = mount(CharacterAssistantHistoryDialog, { props: { loading: true }, attachTo: document.body });
    expect(wrapper.get('[role="status"]').text()).toContain('正在读取历史版本');
    expect(wrapper.find('li button').exists()).toBe(false);
    await wrapper.setProps({ loading: false });
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('暂无历史版本');
    expect(wrapper.find('ol').exists()).toBe(false);
    expect(wrapper.emitted('restore')).toBeUndefined();
  });

  it('replaces the draft from the saved card independently from version restore and shows success', async () => {
    wrapper = mount(CharacterAssistantHistoryDialog, { props: { versions, canResetDraft: true }, attachTo: document.body });
    await wrapper.get('[aria-label="用已保存角色卡覆盖草稿"]').trigger('click');
    expect(wrapper.emitted('reset-draft')).toEqual([[]]);
    expect(wrapper.emitted('restore')).toBeUndefined();
    expect(wrapper.findAll('li button')).toHaveLength(2);
    await wrapper.findAll('li button')[1].trigger('click');
    expect(wrapper.emitted('restore')).toEqual([['version-after']]);
    expect(wrapper.emitted('reset-draft')).toHaveLength(1);

    await wrapper.setProps({ draftReset: true });
    expect(wrapper.get('[role="status"]').text()).toBe('已用已保存角色卡覆盖当前草稿。');
  });

  it('disables reset without a saved card, during history loading and throughout the reset operation', async () => {
    wrapper = mount(CharacterAssistantHistoryDialog, { props: { versions }, attachTo: document.body });
    const reset = wrapper.get('[aria-label="用已保存角色卡覆盖草稿"]');
    expect(reset.element.disabled).toBe(true);
    await reset.trigger('click');
    expect(wrapper.emitted('reset-draft')).toBeUndefined();

    await wrapper.setProps({ canResetDraft: true, resettingDraft: true });
    expect(wrapper.findAll('button').every(button => button.element.disabled)).toBe(true);
    expect(reset.text()).toContain('正在覆盖草稿');
    await reset.trigger('click');
    await wrapper.get('li button').trigger('click');
    await wrapper.get('dialog').trigger('cancel');
    expect(wrapper.emitted('reset-draft')).toBeUndefined();
    expect(wrapper.emitted('restore')).toBeUndefined();
    expect(wrapper.emitted('close')).toBeUndefined();

    await wrapper.setProps({ resettingDraft: false, loading: true });
    expect(reset.element.disabled).toBe(true);
    expect(wrapper.findAll('.version-actions button').every(button => button.element.disabled)).toBe(true);
  });

  it('keeps history available after a reset error and retries reset instead of reloading versions', async () => {
    wrapper = mount(CharacterAssistantHistoryDialog, { props: {
      versions, canResetDraft: true, resetError: '覆盖草稿失败'
    }, attachTo: document.body });
    expect(wrapper.findAll('li')).toHaveLength(2);
    expect(wrapper.get('[role="alert"]').text()).toContain('覆盖草稿失败');
    await wrapper.get('[role="alert"] button').trigger('click');
    expect(wrapper.emitted('reset-draft')).toEqual([[]]);
    expect(wrapper.emitted('reload')).toBeUndefined();
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
  });
});
