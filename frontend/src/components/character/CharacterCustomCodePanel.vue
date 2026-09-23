<script setup>
import { BookOpen, ChevronDown, TriangleAlert } from '@lucide/vue';

defineProps({
  advancedSettings: { type: Object, required: true },
  canEdit: { type: Boolean, default: false }
});

// Mirrors the context built in utils/chatAppearance.js; keep the two in sync.
const SCRIPT_API_REFERENCE = [
  { code: 'conversation · character · user · provider · settings · messages', summary: '当前会话、角色、用户、供应商、外观设置与消息列表的只读快照' },
  { code: 'statusBar', summary: '状态栏快照 { name, variables:[{name,value,max,color}], template }' },
  { code: 'await updateStatusVariables([{ name, value, max }])', summary: '写入状态变量并保存，不存在的变量会新建' },
  { code: 'insertText(text)', summary: '把文字填入输入框，由用户决定是否发送' },
  { code: 'notify(text) · setCssVar(name, value) · scrollToBottom()', summary: '提示、设置聊天区 CSS 变量、滚到底部' },
  { code: 'openSidebar / closeSidebar / openSettings / closeSettings', summary: '打开或收起侧栏与设置面板' },
  { code: 'query(selector) · queryAll(selector)', summary: '在聊天区内查找元素（沙箱内不可直接访问 DOM 节点）' },
  { code: 'await wait(ms) · await requestPaint() · state', summary: '延时、等待下一帧、跨脚本运行保留的状态对象' },
  { code: 'onCleanup(fn) 或 return () => {}', summary: '离开会话或重新应用脚本时执行清理' }
];
</script>

<template>
  <section id="section-custom-code" class="form-panel character-panel">
    <header class="character-panel-head">
      <div>
        <h2>扩展代码</h2>
        <p>角色自带的 CSS 与 JavaScript，只有同时勾选启用和确认风险才会生效。</p>
      </div>
    </header>

    <div class="character-panel-body">
      <p class="character-panel-warning">
        <TriangleAlert :size="16" />
        <span>扩展代码会在你的对话页面里执行，请只对信任的角色开启。JS 运行在隔离沙箱中，只能通过下方列出的接口影响页面。</span>
      </p>

      <div class="form-grid two-col advanced-code-grid">
        <div class="field">
          <span>内置 CSS</span>
          <label class="inline-checkbox">
            <input v-model="advancedSettings.customCssEnabled" type="checkbox" :disabled="!canEdit" />
            <span>启用角色自定义 CSS</span>
          </label>
          <label class="inline-checkbox">
            <input v-model="advancedSettings.customCssRiskAccepted" type="checkbox" :disabled="!canEdit" />
            <span>确认风险并允许角色 CSS 生效</span>
          </label>
          <textarea
            v-model="advancedSettings.customCss"
            rows="8"
            aria-label="角色自定义 CSS"
            placeholder=".deep-bubble { ... }"
            spellcheck="false"
            :disabled="!canEdit"
          />
        </div>
        <div class="field">
          <span>内置 JS</span>
          <label class="inline-checkbox">
            <input v-model="advancedSettings.customJsEnabled" type="checkbox" :disabled="!canEdit" />
            <span>启用角色自定义 JS</span>
          </label>
          <label class="inline-checkbox">
            <input v-model="advancedSettings.customJsRiskAccepted" type="checkbox" :disabled="!canEdit" />
            <span>确认风险并允许角色 JS 执行</span>
          </label>
          <textarea
            v-model="advancedSettings.customJs"
            rows="8"
            aria-label="角色自定义 JS"
            placeholder="const hp = statusBar?.variables.find((v) => v.name === 'HP');&#10;if (hp && hp.value < 20) notify('HP 偏低');&#10;return () => {};"
            spellcheck="false"
            :disabled="!canEdit"
          />
        </div>
      </div>

      <details class="status-blueprint-reference">
        <summary>
          <BookOpen :size="15" />
          <span>JS 可用接口速查</span>
          <ChevronDown :size="15" aria-hidden="true" />
        </summary>
        <div class="status-blueprint-reference-body">
          <section class="status-blueprint-reference-group">
            <h4>脚本以 async 函数体执行，以下名称可直接使用</h4>
            <dl>
              <template v-for="item in SCRIPT_API_REFERENCE" :key="item.code">
                <dt><code>{{ item.code }}</code></dt>
                <dd>{{ item.summary }}</dd>
              </template>
            </dl>
          </section>
        </div>
      </details>
    </div>
  </section>
</template>
