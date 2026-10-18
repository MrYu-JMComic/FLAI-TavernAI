import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defineComponent, h, reactive } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { useCharacterEditor } from '../useCharacterEditor.js';
import CharacterAiDraftPanel from '../../../components/character/CharacterAiDraftPanel.vue';
import { apiRequest, streamAssistantDraft } from '../../../api/core.js';

vi.mock('../../../api/core.js', () => ({ apiRequest: vi.fn(), streamAssistantDraft: vi.fn() }));
vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn() }));

let wrapper;
beforeEach(() => {
  localStorage.clear();
  apiRequest.mockImplementation(async (url) => url === '/api/world-books' ? [{ id: 'book-a', name: '关联书 A' }, { id: 'book-b', name: '关联书 B' }] : []);
});
afterEach(() => { wrapper?.unmount(); wrapper = null; vi.resetAllMocks(); });

it('mounts the real editor with a restored assistant session and initializes current world book selections', async () => {
  localStorage.setItem('flai-character-ai-session:new', JSON.stringify({
    version: 4, requirement: '继续上次世界书任务',
    worldBookWorkspace: { version: 1, targets: [{ ref: 'new:saved', bookId: null, profile: { name: '未应用草稿' }, entries: [] }] },
    worldBookChanges: [{ ref: 'new:saved', bookId: null, profile: { name: '未应用草稿' }, entries: [] }]
  }));
  let editor;
  const Host = defineComponent({
    setup() {
      editor = useCharacterEditor({ props: reactive({ route: { name: 'characterNew', params: {} }, user: null, provider: null }), emit: vi.fn() });
      return () => h('output', editor.aiWorldBookSelectedIds.value.join(','));
    }
  });
  wrapper = mount(Host);
  await flushPromises();
  expect(editor.aiRequirement.value).toBe('继续上次世界书任务');
  expect(editor.aiWorldBookChanges.value).toHaveLength(1);
  editor.toggleWorldBook('book-a');
  editor.toggleWorldBook('book-b');
  await flushPromises();
  expect(editor.aiWorldBookSelectedIds.value).toEqual(['book-a', 'book-b']);
  expect(wrapper.text()).toBe('book-a,book-b');
});

it('keeps new-book and target adjustments available with selected books and groups existing/new results', async () => {
  wrapper = mount(CharacterAiDraftPanel, { props: {
    options: { worldBook: true },
    worldBooks: [{ id: 'book-a', name: '关联书 A', entryCount: 80 }],
    worldBookSelectedIds: ['book-a'], worldBookSourceLabel: '来自角色关联',
    worldBookChanges: [
      { ref: 'existing:book-a', bookId: 'book-a', name: '关联书 A', profile: {}, upserts: [{ entryId: 'entry-65', patch: { content: '已更新' } }], removals: [] },
      { ref: 'new:b', bookId: null, profile: { name: '新书 B' }, entries: [{ name: '航线', content: '北方航线', triggerKeys: '航线' }] }
    ]
  } });
  const newBookButton = wrapper.findAll('button').find((button) => button.text() === '新建世界书');
  expect(newBookButton).toBeTruthy();
  await newBookButton.trigger('click');
  expect(wrapper.emitted('new-world-book')).toHaveLength(1);
  expect(wrapper.text()).toContain('来自角色关联');
  expect(wrapper.text()).toContain('更新原书');
  expect(wrapper.text()).toContain('新书 B');
  expect(wrapper.text()).toContain('保存角色完成关联');
  const apply = wrapper.findAll('button').find((button) => button.text() === '应用 2 项变更');
  await apply.trigger('click');
  const selectedChanges = wrapper.emitted('apply-world-books')[0][0];
  expect(selectedChanges).toHaveLength(2);
  expect(selectedChanges[1].addToCharacter).toBe(true);
});

it('creates and selects a world book for an unsaved character without saving the character form', async () => {
  let editor;
  const Host = defineComponent({
    setup() {
      editor = useCharacterEditor({ props: reactive({ route: { name: 'characterNew', params: {} }, user: null, provider: null }), emit: vi.fn() });
      return () => h('output', editor.selectedWorldBookIds.value.join(','));
    }
  });
  wrapper = mount(Host);
  await flushPromises();
  expect(editor.aiWorldBookSelectedIds.value).toEqual([]);
  editor.form.name = '尚未保存的角色';
  editor.aiRequirement.value = '创建航海手册';
  const draft = { ref: 'new:guide', bookId: null, profile: { name: '航海手册' }, entries: [{ name: '航线', triggerKeys: '航线', content: '北方航线' }] };
  streamAssistantDraft.mockResolvedValue({ character: { worldBookWorkspace: { targets: [draft], activeRef: draft.ref }, worldBookChanges: [draft] }, summary: '新书草稿已准备' });
  apiRequest.mockImplementation(async (url) => url === '/api/world-books/apply-changes'
    ? { books: [{ ref: draft.ref, book: { id: 'created-guide', name: '航海手册', revision: 'saved-revision' } }] }
    : []);
  await editor.completeWithAi();
  await editor.applyAiWorldBookChanges();
  expect(editor.selectedWorldBookIds.value).toEqual(['created-guide']);
  expect(editor.worldBooks.value.some((book) => book.id === 'created-guide')).toBe(true);
  expect(apiRequest.mock.calls.filter(([url, options]) => url.startsWith('/api/characters') && ['POST', 'PATCH', 'PUT'].includes(options?.method))).toEqual([]);
  expect(editor.form.name).toBe('尚未保存的角色');
});
