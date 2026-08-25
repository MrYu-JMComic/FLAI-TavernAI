<script setup>
import { TriangleAlert } from '@lucide/vue';

defineProps({
  advancedSettings: { type: Object, required: true },
  canEdit: { type: Boolean, default: false }
});
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
        <span>扩展代码会在你的对话页面里执行，请只对信任的角色开启。</span>
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
            placeholder="return () => {}"
            :disabled="!canEdit"
          />
        </div>
      </div>
    </div>
  </section>
</template>
