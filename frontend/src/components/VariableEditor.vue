<script setup>
import { computed, nextTick, ref, watch } from 'vue';

const props = defineProps({
  modelValue: {
    type: String,
    default: ''
  },
  userValue: {
    type: String,
    default: ''
  },
  rows: {
    type: [Number, String],
    default: 4
  },
  placeholder: {
    type: String,
    default: ''
  },
  disabled: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['update:modelValue']);
const textarea = ref(null);
const mirror = ref(null);

const renderedHtml = computed(() => renderWithVariable(props.modelValue || '', props.userValue || ''));

watch(
  () => [props.modelValue, props.userValue],
  () => {
    nextTick(syncScroll);
  }
);

watch(
  () => props.disabled,
  () => {
    nextTick(syncScroll);
  }
);

function onInput(event) {
  emit('update:modelValue', event.target.value);
}

function syncScroll() {
  if (!textarea.value || !mirror.value) {
    return;
  }

  mirror.value.scrollTop = textarea.value.scrollTop;
  mirror.value.scrollLeft = textarea.value.scrollLeft;
}

function renderWithVariable(text, userValue) {
  const escaped = escapeHtml(String(text));
  const tokenText = escapeHtml(userValue || '{user}');
  return escaped.replaceAll('{user}', `<span class="variable-editor-token">${tokenText}</span>`);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case '\'':
        return '&#39;';
      default:
        return char;
    }
  });
}
</script>

<template>
  <div class="variable-editor-shell" :class="{ disabled }" :style="{ '--variable-editor-rows': String(rows) }">
    <div ref="mirror" class="variable-editor variable-editor-mirror" aria-hidden="true" v-html="renderedHtml"></div>
    <textarea
      ref="textarea"
      class="variable-editor variable-editor-input"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      @input="onInput"
      @scroll="syncScroll"
      @focus="syncScroll"
    />
  </div>
</template>
