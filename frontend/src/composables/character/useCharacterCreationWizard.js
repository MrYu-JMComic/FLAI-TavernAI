import { computed, ref } from 'vue';

export const CHARACTER_CREATION_WIZARD_STEPS = [
  {
    id: 'basic',
    label: '基础信息',
    description: '先确定角色身份、头像、标签和关联世界书。',
    sections: ['basic']
  },
  {
    id: 'settings',
    label: '角色设定',
    description: '补充背景、世界观、人设、开场白，也可以用 AI 完善。',
    sections: ['settings', 'ai']
  },
  {
    id: 'advanced',
    label: '高级配置',
    description: '按需设置状态栏、附属技能、渲染插件和正则规则。',
    sections: ['advanced-settings', 'status-blueprint', 'accessories', 'custom-code', 'render-plugins', 'regex']
  }
];

export function useCharacterCreationWizard({
  isEditing,
  canEdit,
  setActiveSection = () => {}
} = {}) {
  const characterCreationMode = ref('wizard');
  const characterWizardStepId = ref('basic');
  const isCharacterCreationWizardAvailable = computed(() => !isEditing?.value && canEdit?.value);
  const isCharacterCreationWizardActive = computed(() => (
    isCharacterCreationWizardAvailable.value && characterCreationMode.value === 'wizard'
  ));
  const characterWizardStepIndex = computed(getCharacterWizardStepIndex);
  const currentCharacterWizardStep = computed(getCurrentCharacterWizardStep);
  const characterWizardProgressText = computed(() => (
    `步骤 ${characterWizardStepIndex.value + 1} / ${CHARACTER_CREATION_WIZARD_STEPS.length}`
  ));

  function getCharacterWizardStepIndex() {
    for (let index = 0; index < CHARACTER_CREATION_WIZARD_STEPS.length; index += 1) {
      if (CHARACTER_CREATION_WIZARD_STEPS[index].id === characterWizardStepId.value) {
        return index;
      }
    }
    return 0;
  }

  function getCurrentCharacterWizardStep() {
    return CHARACTER_CREATION_WIZARD_STEPS[characterWizardStepIndex.value] || CHARACTER_CREATION_WIZARD_STEPS[0];
  }

  function isCharacterSectionVisibleInCurrentMode(sectionId) {
    if (!isCharacterCreationWizardActive.value) {
      return true;
    }
    const step = currentCharacterWizardStep.value;
    for (const currentSectionId of step.sections) {
      if (currentSectionId === sectionId) {
        return true;
      }
    }
    return false;
  }

  function setCharacterCreationMode(nextMode) {
    const normalizedMode = nextMode === 'full' ? 'full' : 'wizard';
    if (characterCreationMode.value === normalizedMode) {
      return;
    }
    characterCreationMode.value = normalizedMode;
    if (normalizedMode === 'wizard') {
      setCharacterWizardStep(characterWizardStepId.value);
      return;
    }
    setActiveSection('basic');
  }

  function setCharacterWizardStep(stepId) {
    if (!isCharacterCreationWizardAvailable.value || !isValidCharacterWizardStep(stepId)) {
      return;
    }
    characterWizardStepId.value = stepId;
    const firstSectionId = getCharacterWizardStepFirstSectionId(stepId);
    if (firstSectionId) {
      setActiveSection(firstSectionId);
    }
  }

  function isValidCharacterWizardStep(stepId) {
    for (const step of CHARACTER_CREATION_WIZARD_STEPS) {
      if (step.id === stepId) {
        return true;
      }
    }
    return false;
  }

  function getCharacterWizardStepFirstSectionId(stepId) {
    for (const step of CHARACTER_CREATION_WIZARD_STEPS) {
      if (step.id === stepId) {
        return step.sections[0] || '';
      }
    }
    return '';
  }

  function goToPreviousCharacterWizardStep() {
    const previousIndex = characterWizardStepIndex.value - 1;
    if (previousIndex < 0) {
      return;
    }
    setCharacterWizardStep(CHARACTER_CREATION_WIZARD_STEPS[previousIndex].id);
  }

  function goToNextCharacterWizardStep() {
    const nextIndex = characterWizardStepIndex.value + 1;
    if (nextIndex >= CHARACTER_CREATION_WIZARD_STEPS.length) {
      return;
    }
    setCharacterWizardStep(CHARACTER_CREATION_WIZARD_STEPS[nextIndex].id);
  }

  return {
    CHARACTER_CREATION_WIZARD_STEPS,
    characterCreationMode,
    characterWizardProgressText,
    characterWizardStepId,
    characterWizardStepIndex,
    currentCharacterWizardStep,
    goToNextCharacterWizardStep,
    goToPreviousCharacterWizardStep,
    isCharacterCreationWizardActive,
    isCharacterCreationWizardAvailable,
    isCharacterSectionVisibleInCurrentMode,
    setCharacterCreationMode,
    setCharacterWizardStep
  };
}
