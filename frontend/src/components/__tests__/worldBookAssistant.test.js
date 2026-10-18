import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import WorldBookChanges from '../worldbook/WorldBookChanges.vue';
import WorldBookTargetPicker from '../worldbook/WorldBookTargetPicker.vue';
let wrapper;
afterEach(() => { wrapper?.unmount(); });
describe('world book choices and results', () => {
  it('keeps creation available while a book is selected and keeps target changes separate', async () => {
    wrapper=mount(WorldBookTargetPicker,{props:{books:[{id:'a',name:'雾港',entryCount:80},{id:'b',name:'海域',entryCount:4}],selectedIds:['a'],automatic:false}});
    await wrapper.findAll('button').find(button => button.text().includes('新建世界书')).trigger('click');
    expect(wrapper.emitted('new-book')).toHaveLength(1);
    expect(wrapper.emitted('update:selectedIds')).toBeUndefined();
    await wrapper.findAll('button').find(button => button.text().includes('调整')).trigger('click');
    await wrapper.findAll('.worldbook-target-option input')[1].setValue(true);
    expect(wrapper.emitted('update:selectedIds').at(-1)[0]).toEqual(['a','b']);
  });
  it('applies only checked books and can opt out of a new character association', async () => {
    const changes=[{ref:'existing:a',bookId:'a',name:'雾港',profile:{description:'新描述'},before:{description:'原描述'},upserts:[],removals:[],linkedCharacterCount:2},{ref:'new:b',bookId:null,profile:{name:'远航手册'},entries:[{name:'航线',content:'东海航线'}]}];
    wrapper=mount(WorldBookChanges,{props:{changes,characterContext:true}});
    await wrapper.findAll('.worldbook-change-head input')[0].setValue(false);
    await wrapper.get('.worldbook-add-link input').setValue(false);
    expect(wrapper.text()).toContain('原描述');
    expect(wrapper.text()).toContain('同时供 2 个角色使用');
    await wrapper.get('.worldbook-apply').trigger('click');
    expect(wrapper.emitted('apply')[0][0]).toEqual([{...changes[1],addToCharacter:false}]);
    await wrapper.get('.worldbook-reload button').trigger('click');
    expect(wrapper.emitted('reload')[0][0]).toEqual(changes[0]);
  });
});
