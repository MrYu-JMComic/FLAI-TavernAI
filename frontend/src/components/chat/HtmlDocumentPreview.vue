<script setup>
defineProps({
  source: { type: String, required: true }
});
</script>

<template>
  <section class="html-document-preview" aria-label="HTML 网页预览">
    <header class="html-document-preview-header">
      <strong>网页预览</strong>
      <small>沙箱隔离运行</small>
    </header>
    <iframe
      class="html-document-frame"
      :srcdoc="source"
      title="AI 生成的 HTML 网页"
      sandbox="allow-scripts"
      referrerpolicy="no-referrer"
      loading="lazy"
    />
  </section>
</template>
