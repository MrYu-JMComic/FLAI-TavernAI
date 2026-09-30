<script setup>
import { BookOpen, ChevronDown, Eye, Plus, RotateCcw, Sparkles, Trash2, TriangleAlert } from '@lucide/vue';
import { STATUS_TEMPLATE_REFERENCE } from '../../utils/statusTemplateReference.js';
import { STATUS_VARIABLE_TYPES, STATUS_VARIABLE_TYPE_LABELS } from '../../../../shared/statusVariables.js';

// Both lists are rendered from the SFC template; keep the script bindings
// visible to source hygiene checks.
void STATUS_TEMPLATE_REFERENCE;
void STATUS_VARIABLE_TYPES;
void STATUS_VARIABLE_TYPE_LABELS;

defineProps({
  blueprint: { type: Object, required: true },
  canEdit: { type: Boolean, default: true },
  issues: { type: Array, default: () => [] },
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
  <div class="status-blueprint-panel">
    <header class="status-blueprint-head">
      <div class="status-blueprint-head-text">
        <h3>初始状态栏</h3>
        <p>创建新会话时自动写入；模板里的占位符会自动同步成变量。</p>
      </div>
      <div class="status-blueprint-head-actions">
        <button class="ghost-button" type="button" @click="emit('preview')">
          <Eye :size="16" />
          <span>预览</span>
        </button>
        <button class="ghost-button" type="button" :disabled="!canEdit" @click="emit('add-variable')">
          <Plus :size="16" />
          <span>变量</span>
        </button>
      </div>
    </header>

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

    <!-- Variables: one heading row carries the title, the counts and the
         only action, so the old chip toolbar is gone. -->
    <section class="status-blueprint-block" aria-label="初始状态变量">
      <div class="status-blueprint-block-head">
        <strong>变量</strong>
        <span class="status-blueprint-stats" aria-live="polite">
          {{ stats.variables }} 个
          <template v-if="stats.variables"> · {{ stats.text }} 文本 · {{ stats.meter }} 数值</template>
          <template v-if="stats.inferred"> · {{ stats.inferred }} 来自模板</template>
        </span>
        <button
          v-if="canEdit"
          class="chat-setting-inline-button"
          type="button"
          title="按模板重新识别变量"
          @click="emit('sync-template')"
        >
          <RotateCcw :size="14" />
          <span>同步</span>
        </button>
      </div>
      <div class="status-blueprint-vars">
        <div
          v-for="row in rows"
          :key="row.key"
          class="status-variable-card"
          :class="`is-${row.kind === 'composite' ? 'composite' : row.type}`"
        >
          <template v-if="row.kind === 'composite'">
            <div class="status-variable-line">
              <input
                :value="row.label"
                class="variable-input name"
                type="text"
                readonly
                :disabled="!canEdit"
                :aria-label="`初始状态栏组合行 ${row.label}`"
              />
              <span class="status-variable-type-tag">组合行</span>
            </div>
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
            <div class="status-variable-line">
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
                :value="row.type"
                :disabled="!canEdit"
                :aria-label="`初始状态栏变量 ${row.index + 1} 类型`"
                @change="emit('set-variable-mode', row.variable, $event)"
              >
                <option v-for="type in STATUS_VARIABLE_TYPES" :key="type" :value="type">
                  {{ STATUS_VARIABLE_TYPE_LABELS[type] }}
                </option>
              </select>
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
            </div>
            <div class="status-variable-line is-detail">
              <label class="status-variable-field is-value">
                <span>{{ row.type === 'list' ? '条目' : '初始值' }}</span>
                <input
                  v-model="row.variable.value"
                  class="variable-input value"
                  :type="row.isNumeric ? 'number' : 'text'"
                  :placeholder="row.valuePlaceholder"
                  :disabled="!canEdit"
                  :aria-label="`初始状态栏变量 ${row.index + 1} 内容`"
                />
              </label>
              <template v-if="row.type === 'meter'">
                <label class="status-variable-field is-num">
                  <span>下限</span>
                  <input
                    v-model.number="row.variable.min"
                    class="variable-input num"
                    type="number"
                    placeholder="0"
                    :disabled="!canEdit"
                    :aria-label="`初始状态栏变量 ${row.index + 1} 最小值`"
                  />
                </label>
                <label class="status-variable-field is-num">
                  <span>上限</span>
                  <input
                    v-model.number="row.variable.max"
                    class="variable-input num"
                    type="number"
                    placeholder="100"
                    :disabled="!canEdit"
                    :aria-label="`初始状态栏变量 ${row.index + 1} 最大值`"
                  />
                </label>
              </template>
              <label v-if="row.isNumeric" class="status-variable-field is-unit">
                <span>单位</span>
                <input
                  v-model="row.variable.unit"
                  class="variable-input unit"
                  type="text"
                  placeholder="点 / G"
                  maxlength="12"
                  :disabled="!canEdit"
                  :aria-label="`初始状态栏变量 ${row.index + 1} 单位`"
                />
              </label>
              <label v-if="row.type === 'meter'" class="status-variable-field is-color">
                <span>颜色</span>
                <input
                  :value="row.color"
                  class="variable-input color"
                  type="color"
                  :disabled="!canEdit"
                  :aria-label="`初始状态栏变量 ${row.index + 1} 颜色`"
                  @input="emit('set-color', row.variable, 'color', $event)"
                />
              </label>
            </div>
          </template>
        </div>
        <p v-if="!rows.length" class="status-blueprint-vars-empty">
          粘贴模板会自动识别变量，也可以点击右上角“变量”手动添加。
        </p>
      </div>
    </section>

    <section class="status-blueprint-block status-blueprint-template-field" aria-label="自定义状态栏模板">
      <div class="status-blueprint-block-head">
        <strong>自定义模板</strong>
        <span class="status-blueprint-stats">
          <template v-if="stats.hasTemplate">{{ stats.lines }} 行 · {{ stats.placeholders }} 占位符 · {{ stats.actions }} 按钮</template>
          <template v-else>留空使用内置样式</template>
        </span>
        <template v-if="canEdit">
          <button class="chat-setting-inline-button" type="button" title="套用示例模板" @click="emit('sample-template')">
            <Sparkles :size="14" />
            <span>示例</span>
          </button>
          <button
            class="chat-setting-inline-button danger"
            type="button"
            title="清空模板，变量仍保留"
            :disabled="!stats.hasTemplate"
            @click="emit('clear-template')"
          >
            <Trash2 :size="14" />
            <span>清空</span>
          </button>
        </template>
      </div>
      <textarea
        v-model="blueprint.template"
        rows="8"
        placeholder="<div class=&quot;sb-row&quot;><span class=&quot;sb-label&quot;>体力</span><span class=&quot;sb-val&quot;>{{体力}} / {{体力.max}}</span></div>&#10;{{#if 体力 < 30}}<p class=&quot;sb-note sb-bad&quot;>还需休息 {{= 30 - 体力}} 点</p>{{/if}}&#10;<button data-sb-action=&quot;quick-reply&quot; data-sb-text=&quot;查看状态&quot;>查看</button>"
        :disabled="!canEdit"
        spellcheck="false"
        aria-label="完全自定义状态栏模板"
      />
      <div v-if="issues.length" class="status-bar-template-alert" role="alert">
        <span><TriangleAlert :size="14" /> 模板需要调整</span>
        <ul>
          <li v-for="issue in issues" :key="issue">{{ issue }}</li>
        </ul>
      </div>
      <details class="status-blueprint-reference">
        <summary>
          <BookOpen :size="15" />
          <span>语法速查：占位符、变量类型、过滤器、条件循环、表达式、按钮动作、样式类</span>
          <ChevronDown :size="15" aria-hidden="true" />
        </summary>
        <div class="status-blueprint-reference-body">
          <section v-for="group in STATUS_TEMPLATE_REFERENCE" :key="group.key" class="status-blueprint-reference-group">
            <h4>{{ group.title }}</h4>
            <dl>
              <template v-for="item in group.items" :key="item.code">
                <dt><code>{{ item.code }}</code></dt>
                <dd>{{ item.summary }}</dd>
              </template>
            </dl>
          </section>
        </div>
      </details>
    </section>
  </div>
</template>
