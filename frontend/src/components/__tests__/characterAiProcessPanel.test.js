import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import CharacterAiProcessPanel from '../character/CharacterAiProcessPanel.vue';

const tool = (name, argumentsValue, result = { ok: true }) => ({
  name,
  arguments: argumentsValue,
  result
});

function mountPanel(props = {}) {
  return mount(CharacterAiProcessPanel, { props });
}

describe('character assistant workflow timeline', () => {
  it('shows one live status without a zero-operation counter before activity arrives', () => {
    const wrapper = mountPanel({ loading: true, statusMessage: '正在整理上下文' });

    expect(wrapper.get('.ai-workflow-header').text()).toContain('正在处理');
    expect(wrapper.get('.ai-workflow-header').text()).not.toContain('0 项操作');
    expect(wrapper.findAll('.ai-workflow-current')).toHaveLength(1);
    expect(wrapper.get('.ai-workflow-current').text()).toContain('正在整理上下文');
    wrapper.unmount();
  });

  it('renders one cross-round timeline in content, tool batch, and next content order', () => {
    const wrapper = mountPanel({
      process: [
        {
          round: 1,
          activity: [
            { type: 'content', text: '先检查角色资料。' },
            { type: 'tool', index: 0 },
            { type: 'tool', index: 1 }
          ],
          tools: [
            tool('read_character_field', { field: 'persona' }, { ok: true, value: '已读取' }),
            tool('search_character_draft', { query: '状态栏' }, { ok: true, matches: 1 })
          ]
        },
        {
          round: 2,
          activity: [{ type: 'content', text: '已根据读取结果继续整理。' }],
          tools: []
        }
      ],
      toolCalls: [tool('read_character_field', {}), tool('search_character_draft', {})]
    });

    const timeline = wrapper.get('.ai-workflow-timeline');
    expect(wrapper.findAll('.ai-workflow-timeline')).toHaveLength(1);
    const entries = timeline.findAll('.ai-workflow-assistant-message, .ai-workflow-tool-batch');

    expect(entries).toHaveLength(3);
    expect(entries[0].classes()).toContain('ai-workflow-assistant-message');
    expect(entries[1].classes()).toContain('ai-workflow-tool-batch');
    expect(entries[2].classes()).toContain('ai-workflow-assistant-message');
    expect(timeline.text()).toContain('先检查角色资料。');
    expect(timeline.text()).toContain('已根据读取结果继续整理。');
    expect(entries[0].element.compareDocumentPosition(entries[1].element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(entries[1].element.compareDocumentPosition(entries[2].element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    wrapper.unmount();
  });

  it('merges adjacent tools from one round into one collapsible batch', async () => {
    const wrapper = mountPanel({
      process: [{
        round: 1,
        activity: [
          { type: 'content', text: '开始查找。' },
          { type: 'tool', index: 0 },
          { type: 'tool', index: 1 },
          { type: 'content', text: '查找完成。' }
        ],
        tools: [
          tool('read_character_field', { field: 'persona' }, { ok: true }),
          tool('search_character_draft', { query: '背景' }, { ok: true, matches: 2 })
        ]
      }]
    });

    const batch = wrapper.get('.ai-workflow-tool-batch');
    expect(batch.element.tagName).toBe('DETAILS');
    expect(batch.findAll('.ai-workflow-tool-item')).toHaveLength(2);
    expect(wrapper.findAll('.ai-workflow-tool-batch')).toHaveLength(1);
    expect(batch.text()).toContain('读取指定内容');
    expect(batch.text()).toContain('定位草稿片段');
    await batch.find('summary').trigger('click');
    expect(batch.attributes('open')).toBeDefined();
    wrapper.unmount();
  });

  it('keeps consecutive tool-only rounds in one operation batch', () => {
    const wrapper = mountPanel({
      process: [
        { round: 1, activity: [{ type: 'tool', index: 0 }], tools: [tool('read_character_field', {})] },
        { round: 2, activity: [{ type: 'tool', index: 0 }], tools: [tool('search_character_draft', {})] }
      ]
    });

    expect(wrapper.findAll('.ai-workflow-tool-batch')).toHaveLength(1);
    expect(wrapper.get('.ai-workflow-tool-batch').findAll('.ai-workflow-tool-item')).toHaveLength(2);
    wrapper.unmount();
  });

  it('keeps a single tool independently expandable with arguments and result', async () => {
    const wrapper = mountPanel({
      process: [{
        round: 1,
        activity: [{ type: 'tool', index: 0 }],
        tools: [tool('edit_character_text', { field: 'persona', search: '旧句子' }, { ok: true, changed: 1 })]
      }]
    });

    const item = wrapper.get('.ai-workflow-tool-item');
    expect(item.element.tagName).toBe('DETAILS');
    expect(item.find('summary').text()).toContain('精确修改文本');
    expect(item.attributes('open')).toBeUndefined();
    await item.find('summary').trigger('click');
    expect(item.findAll('pre')).toHaveLength(2);
    expect(item.text()).toContain('旧句子');
    expect(item.text()).toContain('changed');
    wrapper.unmount();
  });

  it('does not add nested decision, step, or model-activity labels to the timeline', () => {
    const wrapper = mountPanel({
      loading: true,
      reasoning: '内部推理不应作为时间线标题',
      process: [{
        round: 1,
        reasoning: '内部推理',
        activity: [
          { type: 'content', text: '检查完成。' },
          { type: 'tool', index: 0 }
        ],
        tools: [tool('read_character_field', { field: 'persona' })]
      }]
    });

    const timeline = wrapper.get('.ai-workflow-timeline');
    expect(wrapper.text()).not.toContain('模型决策');
    expect(wrapper.text()).not.toContain('步骤 1');
    expect(wrapper.text()).not.toContain('模型活动');
    expect(timeline.find('.ai-process-step').exists()).toBe(false);
    wrapper.unmount();
  });

  it('omits a trace tail that exactly duplicates the final assistant answer', () => {
    const wrapper = mountPanel({
      finalContent: '最终答复：角色资料已保存。',
      process: [{
        round: 1,
        activity: [{ type: 'content', text: '我已检查字段。最终答复：角色资料已保存。' }],
        tools: []
      }]
    });

    const timeline = wrapper.get('.ai-workflow-timeline');
    const message = wrapper.get('.ai-workflow-assistant-message');
    expect(message.text()).toBe('我已检查字段。');
    expect(timeline.text()).not.toContain('最终答复：角色资料已保存。');
    wrapper.unmount();
  });

  it('keeps legacy process content and tools visible without activity metadata', () => {
    const wrapper = mountPanel({
      process: [{
        round: 1,
        content: '这是旧版本保存的过程文字。',
        tools: [tool('read_character_field', { field: 'background' }, { ok: true, value: '旧数据仍可读' })]
      }],
      toolCalls: [tool('read_character_field', {})]
    });

    const timeline = wrapper.get('.ai-workflow-timeline');
    expect(timeline.text()).toContain('这是旧版本保存的过程文字。');
    expect(timeline.get('.ai-workflow-assistant-message').text()).toContain('这是旧版本保存的过程文字。');
    expect(timeline.get('.ai-workflow-tool-item').text()).toContain('读取指定内容');
    wrapper.unmount();
  });
});
