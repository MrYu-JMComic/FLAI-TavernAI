import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import CharacterStatusPreviewDialog from '../character/CharacterStatusPreviewDialog.vue';

let wrapper;
let opener;
const dialogMethods = new Map(['showModal', 'close'].map((key) => [key, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, key)]));

beforeEach(() => {
  localStorage.clear();
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

const draft = () => ({
  id: 'saved-role-status', name: '旅行面板',
  variables: [{ name: '体力', value: 80, max: 100, type: 'meter', color: '#27ae60' }],
  template: '<div class="preview-identity">{{user}} · {{char}}</div><div class="preview-value">{{体力}}</div><button data-sb-action="adjust" data-sb-var="体力" data-sb-delta="-10">受伤</button><button data-sb-action="send" data-sb-text="查看状态">发送</button>'
});

describe('character status bar preview', () => {
  it('renders the current draft and keeps action and input changes local', async () => {
    const statusBar = draft();
    const original = JSON.stringify(statusBar);
    wrapper = mount(CharacterStatusPreviewDialog, {
      props: { statusBar, templateConfig: {}, context: { user: '旅人', char: '艾莉希雅' } },
      attachTo: document.body
    });
    expect(wrapper.get('dialog').attributes()).toHaveProperty('open');
    expect(wrapper.get('.preview-identity').text()).toBe('旅人 · 艾莉希雅');
    expect(wrapper.get('.preview-value').text()).toBe('80');
    await wrapper.get('[data-sb-action="adjust"]').trigger('click');
    expect(wrapper.get('.preview-value').text()).toBe('70');
    await wrapper.get('[aria-label="预览变量 体力"]').setValue('45');
    expect(wrapper.get('.preview-value').text()).toBe('45');
    await wrapper.get('[data-sb-action="send"]').trigger('click');
    expect(wrapper.get('.status-preview-action').text()).toBe('发送预览：查看状态');
    expect(wrapper.emitted('send')).toBeUndefined();
    expect(wrapper.emitted('update-variables')).toBeUndefined();
    expect(JSON.stringify(statusBar)).toBe(original);
    await wrapper.get('.status-preview-footer button').trigger('click');
    expect(wrapper.get('.preview-value').text()).toBe('80');
    expect(wrapper.find('.status-preview-action').exists()).toBe(false);
  });

  it('supports collapse and updates from a new draft while preserving the source', async () => {
    const source = draft();
    wrapper = mount(CharacterStatusPreviewDialog, { props: { statusBar: source, templateConfig: {} }, attachTo: document.body });
    await wrapper.get('[aria-label="收起状态栏"]').trigger('click');
    expect(wrapper.find('.preview-value').exists()).toBe(false);
    await wrapper.get('.flai-statusbar-collapsed-card').trigger('click');
    expect(wrapper.get('.preview-value').text()).toBe('80');
    await wrapper.get('[data-sb-action="adjust"]').trigger('click');
    const updated = { ...source, variables: [{ ...source.variables[0], value: 60 }] };
    await wrapper.setProps({ statusBar: updated });
    await flushPromises();
    expect(wrapper.get('.preview-value').text()).toBe('60');
    expect(source.variables[0].value).toBe(80);
    expect(updated.variables[0].value).toBe(60);
  });

  it('shows an empty state and restores focus when the modal closes', async () => {
    wrapper = mount(CharacterStatusPreviewDialog, { props: { statusBar: null, templateConfig: {} }, attachTo: document.body });
    expect(wrapper.text()).toContain('尚未配置状态栏');
    expect(wrapper.find('.status-bar-root').exists()).toBe(false);
    await wrapper.get('dialog').trigger('cancel');
    expect(wrapper.emitted('close')).toHaveLength(1);
    await wrapper.get('[aria-label="关闭状态栏预览"]').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(2);
    wrapper.unmount();
    wrapper = null;
    expect(document.activeElement).toBe(opener);
  });
});
