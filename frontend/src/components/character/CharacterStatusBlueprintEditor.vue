<script setup>
import { Eye, Plus, RotateCcw, Sparkles, Trash2 } from '@lucide/vue';

defineProps({
  blueprint: { type: Object, required: true },
  canEdit: { type: Boolean, default: true },
  rows: { type: Array, default: () => [] },
  stats: { type: Object, required: true }
});

const emit = defineEmits([
  'add-variable',
  'clear-template',
  'preview',
  'remove-variable',
  'sample-template',
  'set-color',
  'set-composite-value',
  'set-variable-mode',
  'sync-template'
]);
</script>

<template>
  <div class="accessory-defaults-panel status-blueprint-panel">
    <div class="inline-heading compact">
      <div>
        <h3>初始状态栏</h3>
        <p>创建新会话时自动写入；模板会自动同步变量，并支持安全 HTML/CSS 与 data-sb-action 按钮。</p>
      </div>
      <div class="status-blueprint-heading-actions">
        <button class="ghost-button" type="button" @click="emit('preview')">
          <Eye :size="16" />
          <span>预览</span>
        </button>
        <button class="ghost-button" type="button" :disabled="!canEdit" @click="emit('add-variable')">
          <Plus :size="16" />
          <span>变量</span>
        </button>
      </div>
    </div>
    <div class="status-blueprint-toolbar" aria-live="polite">
      <div class="status-blueprint-summary">
        <span><strong>{{ stats.variables }}</strong> 变量</span>
        <span><strong>{{ stats.inferred }}</strong> 自动识别</span>
        <span><strong>{{ stats.meter }}</strong> 数值</span>
        <span><strong>{{ stats.placeholders }}</strong> 占位符</span>
        <span><strong>{{ stats.actions }}</strong> 按钮动作</span>
      </div>
      <div v-if="canEdit" class="status-blueprint-actions">
        <button class="chat-setting-inline-button" type="button" @click="emit('sync-template')">
          <RotateCcw :size="14" />
          <span>同步</span>
        </button>
        <button class="chat-setting-inline-button" type="button" @click="emit('sample-template')">
          <Sparkles :size="14" />
          <span>示例</span>
        </button>
        <button class="chat-setting-inline-button danger" type="button" @click="emit('clear-template')">
          <Trash2 :size="14" />
          <span>清空模板</span>
        </button>
      </div>
    </div>
    <label class="field compact">
      <span>状态栏名称</span>
      <input
        v-model="blueprint.name"
        type="text"
        placeholder="状态栏"
        maxlength="50"
        :disabled="!canEdit"
      />
    </label>
    <div class="status-blueprint-vars">
      <div
        v-for="row in rows"
        :key="row.key"
        class="variable-editor-row status-variable-row"
        :class="{
          'is-composite': row.kind === 'composite',
          'is-meter': row.kind === 'variable' && row.isMeter,
          'is-text': row.kind === 'variable' && !row.isMeter
        }"
      >
        <template v-if="row.kind === 'composite'">
          <input
            :value="row.label"
            class="variable-input name"
            type="text"
            readonly
            :disabled="!canEdit"
            :aria-label="`初始状态栏组合行 ${row.label}`"
          />
          <span class="variable-input kind status-composite-kind">组合</span>
          <div class="status-composite-values">
            <label
              v-for="part in row.parts"
              :key="part.name"
              class="status-composite-value"
            >
              <span>{{ part.name }}</span>
              <input
                class="variable-input value"
                type="text"
                :value="part.value"
                placeholder="文本内容"
                :disabled="!canEdit"
                :aria-label="`初始状态栏 ${row.label} 的 ${part.name}`"
                @input="emit('set-composite-value', part.name, $event)"
              />
            </label>
          </div>
        </template>
        <template v-else>
          <input
            v-model="row.variable.name"
            class="variable-input name"
            type="text"
            placeholder="变量名"
            maxlength="40"
            :disabled="!canEdit"
            :aria-label="`初始状态栏变量 ${row.index + 1} 名称`"
          />
          <select
            class="variable-input kind"
            :value="row.isMeter ? 'meter' : 'text'"
            :disabled="!canEdit"
            :aria-label="`初始状态栏变量 ${row.index + 1} 类型`"
            @change="emit('set-variable-mode', row.variable, $event)"
          >
            <option value="text">文本</option>
            <option value="meter">数值</option>
          </select>
          <input
            v-model="row.variable.value"
            class="variable-input value"
            type="text"
            :placeholder="row.isMeter ? '数值' : '文本内容'"
            :disabled="!canEdit"
            :aria-label="`初始状态栏变量 ${row.index + 1} 内容`"
          />
          <template v-if="row.isMeter">
            <span class="variable-separator">/</span>
            <input
              v-model.number="row.variable.max"
              class="variable-input num"
              type="number"
              placeholder="最大"
              :disabled="!canEdit"
              :aria-label="`初始状态栏变量 ${row.index + 1} 最大值`"
            />
            <input
              :value="row.color"
              class="variable-input color"
              type="color"
              title="颜色"
              :disabled="!canEdit"
              @input="emit('set-color', row.variable, 'color', $event)"
            />
          </template>
          <button
            v-if="canEdit"
            class="variable-remove"
            type="button"
            title="删除变量"
            :aria-label="`删除初始状态栏变量 ${row.index + 1}`"
            @click="emit('remove-variable', row.index)"
          >
            x
          </button>
        </template>
      </div>
      <p v-if="!rows.length" class="status-blueprint-vars-empty">
        粘贴模板会自动识别变量，也可以点击右上角“变量”手动添加。
      </p>
    </div>
    <div class="field status-blueprint-template-field">
      <div class="field-heading compact">
        <span>完全自定义模板</span>
        <small>
          {{ stats.hasTemplate ? `${stats.lines} 行` : '留空使用内置状态栏' }}
        </small>
      </div>
      <textarea
        v-model="blueprint.template"
        rows="6"
        placeholder="<div class=&quot;my-status&quot;><span class=&quot;sb-label&quot;>HP</span><span class=&quot;sb-val&quot;>{{HP}}</span><button data-sb-action=&quot;quick-reply&quot; data-sb-text=&quot;查看状态&quot;>查看</button></div>"
        :disabled="!canEdit"
        aria-label="完全自定义状态栏模板"
      />
      <div class="status-blueprint-hints">
        <span>标签 + 值：<code v-pre>&lt;span class="sb-label"&gt;姓名&lt;/span&gt;&lt;span class="sb-val"&gt;{{ 姓名 }}&lt;/span&gt;</code></span>
        <span>按钮：<code>data-sb-action="quick-reply"</code>、<code>copy</code>、<code>collapse</code></span>
      </div>
    </div>
  </div>
</template>
