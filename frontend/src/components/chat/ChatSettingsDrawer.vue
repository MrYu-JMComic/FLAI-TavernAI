<script setup>
import { ChevronDown, Save, Upload, X } from '@lucide/vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  conversation: { type: Object, default: null },
  authorChatAppearance: { type: Object, default: () => ({}) },
  chatAppearanceForm: { type: Object, default: () => ({}) },
  appearanceSaving: { type: Boolean, default: false },
  accessorySettingsOpen: { type: Boolean, default: false },
  accessorySaving: { type: Boolean, default: false },
  accessorySkills: { type: Object, default: () => ({}) },
  accessorySkillItems: { type: Array, default: () => [] },
  statusBar: { type: Object, default: null },
  statusBarEditorOpen: { type: Boolean, default: false },
  statusBarSaving: { type: Boolean, default: false },
  statusBarForm: { type: Object, default: () => ({}) },
  statusBarTemplateCfg: { type: Object, default: () => ({ variant: 'default', density: 'default', accentColor: '', effects: [], customCss: '' }) }
});

const emit = defineEmits([
  'close',
  'save-appearance',
  'reset-appearance',
  'background-upload',
  'clear-field',
  'update:accessorySettingsOpen',
  'save-accessory',
  'update:accessorySkillEnabled',
  'update:accessorySkillModel',
  'open-status-bar-editor',
  'close-status-bar-editor',
  'add-status-bar-variable',
  'remove-status-bar-variable',
  'save-status-bar',
  'delete-status-bar',
  'add-status-character',
  'remove-status-character',
  'add-character-variable',
  'remove-character-variable',
  'add-quick-reply',
  'remove-quick-reply'
]);

function toggleEffect(effect) {
  const cfg = props.statusBarTemplateCfg;
  const idx = cfg.effects.indexOf(effect);
  if (idx >= 0) {
    cfg.effects.splice(idx, 1);
  } else {
    cfg.effects.push(effect);
  }
}
</script>

<template>
  <button
    class="chat-settings-backdrop"
    :class="{ visible: open }"
    type="button"
    aria-label="关闭高阶设置"
    :aria-hidden="String(!open)"
    @click="emit('close')"
  ></button>

  <aside class="chat-settings-drawer" :class="{ open: open }" aria-label="高阶设置" :aria-hidden="String(!open)">
    <header class="chat-settings-header">
      <div>
        <p>高阶设置</p>
        <h2>{{ conversation?.title || '当前会话' }}</h2>
      </div>
      <button class="deep-icon-button" type="button" title="关闭设置" @click="emit('close')">
        <X :size="18" />
      </button>
    </header>

    <div class="chat-settings-body">
      <section class="chat-settings-section author-settings-section">
        <div class="settings-section-title">
          <h3>作者固定设置</h3>
          <p>来自角色创建/编辑页，只读展示；下方会话设置会叠加在作者设置之后。</p>
        </div>
        <div class="readonly-settings-grid">
          <label class="chat-setting-field">
            <span>电脑端背景</span>
            <input :value="authorChatAppearance.desktopBackgroundUrl || '未设置'" type="text" readonly />
          </label>
          <label class="chat-setting-field">
            <span>手机端背景</span>
            <input :value="authorChatAppearance.mobileBackgroundUrl || '未设置'" type="text" readonly />
          </label>
        </div>
        <label class="chat-setting-field">
          <span>状态栏提示词</span>
          <textarea
            class="chat-code-textarea readonly"
            rows="4"
            :value="authorChatAppearance.statusBarPrompt || '未设置'"
            readonly
          />
        </label>
      </section>

      <section class="chat-settings-section">
        <div class="settings-section-title">
          <h3>聊天背景</h3>
          <p>电脑端和手机端可以分别设置，留空则回退到默认暖色背景。</p>
        </div>

        <label class="chat-setting-field">
          <span>电脑端背景</span>
          <input
            v-model="chatAppearanceForm.desktopBackgroundUrl"
            type="text"
            placeholder="图片链接、短链或 data URL"
          />
        </label>
        <div class="chat-setting-actions">
          <label class="chat-setting-upload">
            <Upload :size="15" />
            <span>上传图片</span>
            <input type="file" accept="image/*" @change="emit('background-upload', { event: $event, field: 'desktopBackgroundUrl' })" />
          </label>
          <button class="chat-setting-inline-button" type="button" @click="emit('clear-field', 'desktopBackgroundUrl')">
            清空
          </button>
        </div>

        <label class="chat-setting-field">
          <span>手机端背景</span>
          <input
            v-model="chatAppearanceForm.mobileBackgroundUrl"
            type="text"
            placeholder="图片链接、短链或 data URL"
          />
        </label>
        <div class="chat-setting-actions">
          <label class="chat-setting-upload">
            <Upload :size="15" />
            <span>上传图片</span>
            <input type="file" accept="image/*" @change="emit('background-upload', { event: $event, field: 'mobileBackgroundUrl' })" />
          </label>
          <button class="chat-setting-inline-button" type="button" @click="emit('clear-field', 'mobileBackgroundUrl')">
            清空
          </button>
        </div>
      </section>

      <section class="chat-settings-section">
        <div class="settings-section-title">
          <h3>内置 CSS</h3>
          <p>只会作用于当前会话。可以写动画、布局和局部样式，留空则不生效。</p>
        </div>
        <textarea
          v-model="chatAppearanceForm.customCss"
          class="chat-code-textarea"
          rows="10"
          placeholder=".deep-bubble { border-radius: 22px; }\n@keyframes floatIn { ... }"
        />
      </section>

      <section class="chat-settings-section">
        <div class="settings-section-title">
          <h3>内置 JS</h3>
          <p>可读取当前会话、消息区和聊天容器。脚本可返回清理函数，留空则不执行。</p>
        </div>
        <textarea
          v-model="chatAppearanceForm.customJs"
          class="chat-code-textarea code-js"
          rows="12"
          placeholder="const bubble = query('.deep-bubble');\nif (bubble) bubble.classList.add('pulse');\nreturn () => bubble?.classList.remove('pulse');"
        />
      </section>

      <section class="chat-settings-section">
        <div class="settings-section-title">
          <h3>状态栏提示词</h3>
          <p>供状态栏 Agent 判断变量变化；主聊天回复不会被要求调用状态栏工具。</p>
        </div>
        <textarea
          v-model="chatAppearanceForm.statusBarPrompt"
          class="chat-code-textarea"
          rows="6"
          placeholder="例如：HP 降低、好感变化、获得金币时更新对应变量。"
        />
      </section>

      <section class="chat-settings-section accessory-skills-section">
        <button class="settings-section-toggle" type="button" @click="emit('update:accessorySettingsOpen', !accessorySettingsOpen)">
          <span class="settings-section-title">
            <h3>附属技能</h3>
            <p>为当前会话单独启用子智能体；未配置模型时使用当前聊天模型。</p>
          </span>
          <ChevronDown :size="17" :class="{ rotated: accessorySettingsOpen }" />
        </button>

        <div v-if="accessorySettingsOpen" class="accessory-skills-grid">
          <div v-for="item in accessorySkillItems" :key="item.key" class="accessory-skill-row">
            <label class="chat-setting-field compact">
              <span>{{ item.label }}</span>
              <select
                v-model="accessorySkills[item.key].enabled"
              >
                <option :value="false">关闭</option>
                <option :value="true">开启</option>
                <option v-if="item.auto" value="auto">自动</option>
              </select>
            </label>
            <label class="chat-setting-field compact">
              <span>模型覆盖</span>
              <input
                v-model="accessorySkills[item.key].modelOverride"
                type="text"
                placeholder="留空使用当前模型"
                maxlength="100"
              />
            </label>
          </div>
          <button class="chat-settings-save" type="button" :disabled="accessorySaving" @click="emit('save-accessory')">
            <Save :size="15" />
            <span>{{ accessorySaving ? '保存中...' : '保存附属技能' }}</span>
          </button>
        </div>
      </section>

      <section class="chat-settings-section">
        <div class="settings-section-title">
          <h3>状态栏</h3>
          <p>在聊天顶部显示自定义状态栏；变量更新由状态栏 Agent 或手动编辑完成。</p>
        </div>
        <div class="status-bar-editor-actions">
          <button v-if="!statusBar" class="chat-setting-inline-button" type="button" @click="emit('open-status-bar-editor')">
            创建状态栏
          </button>
          <template v-else>
            <button class="chat-setting-inline-button" type="button" @click="emit('open-status-bar-editor')">
              编辑状态栏
            </button>
            <button class="chat-setting-inline-button danger" type="button" @click="emit('delete-status-bar')">
              删除状态栏
            </button>
          </template>
        </div>

        <div v-if="statusBarEditorOpen" class="status-bar-editor">
          <label class="chat-setting-field">
            <span>状态栏名称</span>
            <input
              v-model="statusBarForm.name"
              type="text"
              placeholder="状态栏"
              maxlength="50"
            />
          </label>

          <div class="sb-template-editor">
            <div class="sb-template-row">
              <label class="chat-setting-field compact">
                <span>样式风格</span>
                <select v-model="statusBarTemplateCfg.variant">
                  <option value="default">默认</option>
                  <option value="compact">紧凑</option>
                  <option value="minimal">极简</option>
                  <option value="neon">霓虹</option>
                </select>
              </label>
              <label class="chat-setting-field compact">
                <span>间距</span>
                <select v-model="statusBarTemplateCfg.density">
                  <option value="default">默认</option>
                  <option value="cozy">宽松</option>
                  <option value="compact">紧凑</option>
                </select>
              </label>
              <label class="chat-setting-field compact">
                <span>显示模式</span>
                <select v-model="statusBarTemplateCfg.displayMode">
                  <option value="compact">紧凑</option>
                  <option value="immersive">沉浸</option>
                </select>
              </label>
            </div>
            <label class="chat-setting-field compact">
              <span>强调色</span>
              <div class="sb-accent-row">
                <input
                  v-model="statusBarTemplateCfg.accentColor"
                  type="text"
                  placeholder="留空使用主题色，如 #e91e63"
                  maxlength="30"
                />
                <input
                  v-model="statusBarTemplateCfg.accentColor"
                  type="color"
                  class="sb-accent-picker"
                  title="选择颜色"
                />
              </div>
            </label>
            <div class="sb-effects-field">
              <span class="sb-effects-label">动效</span>
              <div class="sb-effects-grid">
                <label class="sb-effect-check">
                  <input
                    type="checkbox"
                    :checked="statusBarTemplateCfg.effects.includes('glow')"
                    @change="toggleEffect('glow')"
                  />
                  <span>光晕</span>
                </label>
                <label class="sb-effect-check">
                  <input
                    type="checkbox"
                    :checked="statusBarTemplateCfg.effects.includes('striped')"
                    @change="toggleEffect('striped')"
                  />
                  <span>条纹</span>
                </label>
                <label class="sb-effect-check">
                  <input
                    type="checkbox"
                    :checked="statusBarTemplateCfg.effects.includes('pulse')"
                    @change="toggleEffect('pulse')"
                  />
                  <span>脉冲</span>
                </label>
              </div>
            </div>
            <label class="chat-setting-field compact">
              <span>自定义 CSS 变量</span>
              <textarea
                v-model="statusBarTemplateCfg.customCss"
                class="chat-code-textarea sb-custom-css"
                rows="3"
                placeholder='--sb-accent: #e91e63; border-radius: 20px;'
              />
            </label>
          </div>

          <div v-if="statusBarTemplateCfg.displayMode === 'immersive'" class="sb-characters-editor">
            <div class="variables-editor-header">
              <span>角色列表</span>
              <button class="chat-setting-inline-button small" type="button" @click="emit('add-status-character')">
                + 添加角色
              </button>
            </div>
            <div
              v-for="(ch, ci) in statusBarTemplateCfg.characters"
              :key="ch.id || ci"
              class="sb-char-editor-row"
            >
              <div class="sb-char-editor-grid">
                <label class="chat-setting-field compact">
                  <span>名称</span>
                  <input v-model="ch.name" type="text" placeholder="角色名" maxlength="30" class="variable-input name" />
                </label>
                <label class="chat-setting-field compact">
                  <span>分类</span>
                  <input v-model="ch.role" type="text" placeholder="如 主角/NPC" maxlength="20" class="variable-input name" />
                </label>
                <label class="chat-setting-field compact">
                  <span>状态</span>
                  <select v-model="ch.status" class="variable-input">
                    <option value="active">在线</option>
                    <option value="dead">死亡</option>
                    <option value="forgotten">遗忘</option>
                    <option value="left">离开</option>
                    <option value="hidden">隐藏</option>
                  </select>
                </label>
                <label class="chat-setting-field compact">
                  <span>备注</span>
                  <input v-model="ch.note" type="text" placeholder="简短备注" maxlength="80" class="variable-input name" />
                </label>
                <label class="chat-setting-field compact">
                  <span>强调色</span>
                  <input v-model="ch.accentColor" type="color" class="variable-input color" title="角色强调色" />
                </label>
                <label class="chat-setting-field compact sb-char-css-field">
                  <span>自定义 CSS</span>
                  <input v-model="ch.customCss" type="text" placeholder='--sb-ch-accent: #e91e63;' maxlength="120" class="variable-input name" />
                </label>
              </div>
              <div class="sb-char-vars">
                <span class="sb-char-vars-label">角色变量</span>
                <div
                  v-for="(v, vi) in ch.variables"
                  :key="vi"
                  class="variable-editor-row"
                >
                  <input v-model="v.name" class="variable-input name" type="text" placeholder="变量名" maxlength="20" />
                  <input v-model.number="v.value" class="variable-input num" type="number" placeholder="值" />
                  <span class="variable-separator">/</span>
                  <input v-model.number="v.max" class="variable-input num" type="number" placeholder="最大" />
                  <input v-model="v.color" class="variable-input color" type="color" title="颜色" />
                  <button class="variable-remove" type="button" title="删除变量" @click="emit('remove-character-variable', ci, vi)">x</button>
                </div>
                <button class="chat-setting-inline-button small" type="button" @click="emit('add-character-variable', ci)">+ 添加变量</button>
              </div>
              <button class="variable-remove char-remove" type="button" title="删除角色" @click="emit('remove-status-character', ci)">x</button>
            </div>
          </div>

          <div class="sb-quick-replies-editor">
            <div class="variables-editor-header">
              <span>快捷回复</span>
              <button class="chat-setting-inline-button small" type="button" @click="emit('add-quick-reply')">+ 添加</button>
            </div>
            <div
              v-for="(qr, qi) in statusBarTemplateCfg.quickReplies"
              :key="qi"
              class="variable-editor-row"
            >
              <input v-model="qr.label" class="variable-input name" type="text" placeholder="按钮文字" maxlength="20" />
              <input v-model="qr.text" class="variable-input name" type="text" placeholder="发送文本" maxlength="200" />
              <button class="variable-remove" type="button" title="删除" @click="emit('remove-quick-reply', qi)">x</button>
            </div>
          </div>

          <div class="status-bar-variables-editor">
            <div class="variables-editor-header">
              <span>变量列表</span>
              <button class="chat-setting-inline-button small" type="button" @click="emit('add-status-bar-variable')">
                + 添加变量
              </button>
            </div>
            <div
              v-for="(variable, index) in statusBarForm.variables"
              :key="index"
              class="variable-editor-row"
            >
              <input
                v-model="variable.name"
                class="variable-input name"
                type="text"
                placeholder="变量名"
                maxlength="20"
              />
              <input
                v-model.number="variable.value"
                class="variable-input num"
                type="number"
                placeholder="当前值"
              />
              <span class="variable-separator">/</span>
              <input
                v-model.number="variable.max"
                class="variable-input num"
                type="number"
                placeholder="最大值"
              />
              <input
                v-model="variable.color"
                class="variable-input color"
                type="color"
                title="颜色"
              />
              <button
                class="variable-remove"
                type="button"
                title="删除变量"
                @click="emit('remove-status-bar-variable', index)"
              >
                x
              </button>
            </div>
          </div>

          <div class="status-bar-editor-footer">
            <button class="chat-settings-save" type="button" :disabled="statusBarSaving" @click="emit('save-status-bar')">
              <Save :size="15" />
              <span>{{ statusBarSaving ? '保存中...' : '保存状态栏' }}</span>
            </button>
            <button class="chat-setting-inline-button" type="button" @click="emit('close-status-bar-editor')">
              取消
            </button>
          </div>
        </div>
      </section>
    </div>

    <footer class="chat-settings-footer">
      <button class="chat-setting-inline-button" type="button" @click="emit('reset-appearance')">
        恢复当前会话
      </button>
      <button class="chat-settings-save" type="button" :disabled="appearanceSaving" @click="emit('save-appearance')">
        <Save :size="15" />
        <span>{{ appearanceSaving ? '保存中...' : '保存并应用' }}</span>
      </button>
    </footer>
  </aside>
</template>
