import { computed } from 'vue';
import { applyLocalRules } from './useCharacterFormPayload';

export function useCharacterRegexRules({ canEdit, form, previewInput }) {
  const regexPreview = computed(() => {
    if (!previewInput.value.trim()) {
      return '';
    }
    return applyLocalRules(previewInput.value, form.regexRules, 'input');
  });

  function addRule() {
    if (!canEdit.value) {
      return;
    }

    form.regexRules.push({
      label: `规则 ${form.regexRules.length + 1}`,
      pattern: '',
      replacement: '',
      flags: 'g',
      scope: 'input',
      enabled: true,
      groupName: '全局',
      priority: 0
    });
  }

  function removeRule(index) {
    if (!canEdit.value) {
      return;
    }

    form.regexRules.splice(index, 1);
  }

  return {
    addRule,
    regexPreview,
    removeRule
  };
}
