import { computed, ref, watch } from 'vue';

/**
 * Single-section navigation for the character editor.
 *
 * The editor renders exactly one section at a time, so this composable only
 * tracks which section is active. There is no scroll spy, no scroll listener
 * and no layout probing - clicking a section switches the rendered panel.
 *
 * @param {object} options
 * @param {Array} options.sections - section definitions
 *   `{ id, label, hint, group, visible?: () => boolean, status?: () => SectionStatus }`
 * @param {(section: object) => boolean} options.isSectionVisible - extra visibility gate
 * @param {Array} options.groups - `{ id, label }` display order for grouping
 */
export function useCharacterSections({
  sections = [],
  isSectionVisible = () => true,
  groups = []
} = {}) {
  const activeSection = ref(sections[0]?.id || 'basic');

  const visibleSections = computed(getVisibleSections);
  const sectionGroups = computed(getSectionGroups);
  const activeSectionIndex = computed(() => indexOfSection(activeSection.value));
  const activeSectionDefinition = computed(() => visibleSections.value[activeSectionIndex.value] || null);
  const hasPreviousSection = computed(() => activeSectionIndex.value > 0);
  const hasNextSection = computed(() => (
    activeSectionIndex.value >= 0 && activeSectionIndex.value < visibleSections.value.length - 1
  ));

  watch(
    visibleSections,
    (nextSections) => {
      if (!hasSection(activeSection.value, nextSections)) {
        activeSection.value = nextSections[0]?.id || '';
      }
    },
    { flush: 'post' }
  );

  function getVisibleSections() {
    const nextSections = [];
    for (const section of sections) {
      if (isSectionVisible(section) && (typeof section.visible !== 'function' || section.visible())) {
        nextSections.push(section);
      }
    }
    return nextSections;
  }

  function getSectionGroups() {
    const nextGroups = [];
    for (const group of groups) {
      const groupSections = [];
      for (const section of visibleSections.value) {
        if (section.group === group.id) {
          groupSections.push(section);
        }
      }
      if (groupSections.length) {
        nextGroups.push({ ...group, sections: groupSections });
      }
    }
    return nextGroups;
  }

  function hasSection(sectionId, nextSections = visibleSections.value) {
    for (const section of nextSections) {
      if (section.id === sectionId) {
        return true;
      }
    }
    return false;
  }

  function indexOfSection(sectionId) {
    for (let index = 0; index < visibleSections.value.length; index += 1) {
      if (visibleSections.value[index].id === sectionId) {
        return index;
      }
    }
    return -1;
  }

  function setActiveSection(sectionId) {
    if (!hasSection(sectionId)) {
      return;
    }
    activeSection.value = sectionId;
  }

  function goToPreviousSection() {
    const previous = visibleSections.value[activeSectionIndex.value - 1];
    if (previous) {
      activeSection.value = previous.id;
    }
  }

  function goToNextSection() {
    const next = visibleSections.value[activeSectionIndex.value + 1];
    if (next) {
      activeSection.value = next.id;
    }
  }

  /**
   * @returns {{ state: 'complete'|'partial'|'empty'|'none', text: string }}
   */
  function sectionStatus(sectionId) {
    for (const section of sections) {
      if (section.id === sectionId && typeof section.status === 'function') {
        return normalizeSectionStatus(section.status());
      }
    }
    return { state: 'none', text: '' };
  }

  return {
    activeSection,
    activeSectionDefinition,
    activeSectionIndex,
    goToNextSection,
    goToPreviousSection,
    hasNextSection,
    hasPreviousSection,
    sectionGroups,
    sectionStatus,
    setActiveSection,
    visibleSections
  };
}

function normalizeSectionStatus(status) {
  if (!status || typeof status !== 'object') {
    return { state: 'none', text: '' };
  }
  const state = ['complete', 'partial', 'empty'].includes(status.state) ? status.state : 'none';
  return { state, text: String(status.text || '') };
}

/**
 * Builds a `filled / total` status from a list of booleans.
 */
export function countedSectionStatus(flags = []) {
  let filled = 0;
  for (const flag of flags) {
    if (flag) {
      filled += 1;
    }
  }
  if (!flags.length) {
    return { state: 'none', text: '' };
  }
  if (filled === flags.length) {
    return { state: 'complete', text: '已填' };
  }
  if (filled === 0) {
    return { state: 'empty', text: `0/${flags.length}` };
  }
  return { state: 'partial', text: `${filled}/${flags.length}` };
}

/**
 * Builds a configured / not-configured status for optional sections.
 */
export function configuredSectionStatus(configured) {
  return configured
    ? { state: 'complete', text: '已配' }
    : { state: 'empty', text: '未配' };
}
