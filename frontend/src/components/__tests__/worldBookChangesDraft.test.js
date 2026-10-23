import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import WorldBookChanges from '../worldbook/WorldBookChanges.vue';

let wrapper;
const changes = [
  { ref: 'existing:harbor', bookId: 'harbor', name: '雾港', profile: { description: '港口新描述' }, before: { description: '港口原描述' }, upserts: [], removals: [] },
  { ref: 'new:voyage', bookId: null, profile: { name: '远航手册' }, entries: [{ name: '航线', content: '东海航线' }] }
];

afterEach(() => { wrapper?.unmount(); wrapper = null; });

describe('world book changes saved with a character draft', () => {
  it('keeps draft changes visible without an immediate apply or selection control', () => {
    wrapper = mount(WorldBookChanges, { props: { changes, characterContext: true, deferSave: true } });
    expect(wrapper.findAll('.worldbook-change')).toHaveLength(2);
    expect(wrapper.find('.worldbook-change-head input').exists()).toBe(false);
    expect(wrapper.find('.worldbook-apply').exists()).toBe(false);
    expect(wrapper.text()).toContain('点击保存角色后生效');
    expect(wrapper.emitted('apply')).toBeUndefined();
  });

  it('emits new book association changes and uses the updated draft value', async () => {
    wrapper = mount(WorldBookChanges, { props: { changes, characterContext: true, deferSave: true } });
    const association = wrapper.get('.worldbook-add-link input');
    expect(association.element.checked).toBe(true);
    await association.setValue(false);
    expect(wrapper.emitted('update-add-to-character')).toEqual([[changes[1], false]]);
    expect(wrapper.emitted('apply')).toBeUndefined();
    await wrapper.setProps({ changes: [changes[0], { ...changes[1], addToCharacter: false }] });
    expect(association.element.checked).toBe(false);
    await association.setValue(true);
    expect(wrapper.emitted('update-add-to-character').at(-1)).toEqual([{ ...changes[1], addToCharacter: false }, true]);
  });

  it('retains discard and reload actions while changes are deferred', async () => {
    wrapper = mount(WorldBookChanges, { props: { changes, deferSave: true } });
    await wrapper.findAll('.worldbook-discard')[1].trigger('click');
    expect(wrapper.emitted('discard')).toEqual([[changes[1]]]);
    await wrapper.get('.worldbook-reload button').trigger('click');
    expect(wrapper.emitted('reload')).toEqual([[changes[0]]]);
    expect(wrapper.emitted('apply')).toBeUndefined();
    await wrapper.setProps({ busy: true });
    expect(wrapper.findAll('button').every(button => button.element.disabled)).toBe(true);
    await wrapper.findAll('.worldbook-discard')[0].trigger('click');
    expect(wrapper.emitted('discard')).toHaveLength(1);
  });

  it('keeps the explicit apply action for callers using the default mode', async () => {
    wrapper = mount(WorldBookChanges, { props: { changes, characterContext: true } });
    expect(wrapper.findAll('.worldbook-change-head input')).toHaveLength(2);
    expect(wrapper.get('.worldbook-apply').text()).toContain('应用 2 项变更');
    expect(wrapper.emitted('apply')).toBeUndefined();
    await wrapper.get('.worldbook-apply').trigger('click');
    expect(wrapper.emitted('apply')).toEqual([[changes.map(change => ({ ...change, addToCharacter: true }))]]);
    expect(wrapper.emitted('update-add-to-character')).toBeUndefined();
  });
});
