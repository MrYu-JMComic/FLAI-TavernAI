import { ref } from 'vue';

export const personalSections = [
  { id: 'profile', label: '个人资料' },
  { id: 'provider', label: '模型网关' },
  { id: 'data', label: '数据导出' }
];

export const extensionSections = [
  { id: 'tags', label: '标签管理', icon: 'Tag' },
  { id: 'presets', label: '对话预设', icon: 'Sliders' },
  { id: 'mods', label: 'Mod 管理', icon: 'Puzzle' },
  { id: 'regex', label: '正则规则', icon: 'Regex' },
  { id: 'status-templates', label: '状态栏模板', icon: 'Save' }
];

export function useSettingsSectionNavigation() {
  const activePersonalSection = ref('profile');
  const personalNavRef = ref(null);
  const activeExtensionSection = ref('tags');
  const extensionNavRef = ref(null);

  function scrollToPersonalSection(sectionId) {
    scrollToSettingsSection('personal-section', activePersonalSection, personalSections, personalNavRef, sectionId);
  }

  function scrollToExtensionSection(sectionId) {
    scrollToSettingsSection('extension-section', activeExtensionSection, extensionSections, extensionNavRef, sectionId);
  }

  return {
    activeExtensionSection,
    activePersonalSection,
    extensionNavRef,
    extensionSections,
    personalNavRef,
    personalSections,
    scrollToExtensionSection,
    scrollToPersonalSection
  };
}

function hasSettingsSection(sections, sectionId) {
  for (const section of sections) {
    if (section.id === sectionId) {
      return true;
    }
  }
  return false;
}

function setActiveSettingsSection(activeSectionRef, sections, sectionId) {
  if (!hasSettingsSection(sections, sectionId)) {
    return false;
  }
  activeSectionRef.value = sectionId;
  return true;
}

function scrollActiveSettingsTab(navRef, sectionId) {
  const nav = navRef.value;
  const tab = nav?.querySelector(`[data-section-id="${sectionId}"]`);
  if (!tab) {
    return;
  }
  tab.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
}

function getSettingsScrollContainer(navRef) {
  if (typeof document === 'undefined') {
    return null;
  }
  return navRef.value?.closest?.('.page-shell') || document.querySelector('.page-shell');
}

function getSettingsTopbarBottom() {
  if (typeof document === 'undefined') {
    return 0;
  }
  const topbarBottom = document.querySelector('.topbar')?.getBoundingClientRect().bottom;
  return Math.max(0, Math.ceil(Number.isFinite(topbarBottom) ? topbarBottom : 0));
}

function getSettingsSectionActivationOffset(navRef) {
  const navBottom = navRef.value?.getBoundingClientRect().bottom;
  if (Number.isFinite(navBottom)) {
    return Math.max(0, Math.ceil(navBottom)) + 14;
  }
  const navHeight = navRef.value?.getBoundingClientRect().height || 0;
  return getSettingsTopbarBottom() + navHeight + 14;
}

function getSettingsScrollTop(navRef) {
  const scroller = getSettingsScrollContainer(navRef);
  return scroller ? scroller.scrollTop : window.scrollY || 0;
}

function scrollSettingsPageTo(navRef, top) {
  const roundedTop = Math.max(0, Math.round(top));
  const scroller = getSettingsScrollContainer(navRef);
  if (scroller && typeof scroller.scrollTo === 'function') {
    scroller.scrollTo({ top: roundedTop, behavior: 'smooth' });
    return;
  }
  window.scrollTo({ top: roundedTop, behavior: 'smooth' });
}

function scrollToSettingsSection(prefix, activeSectionRef, sections, navRef, sectionId) {
  if (!setActiveSettingsSection(activeSectionRef, sections, sectionId)) {
    return;
  }
  scrollActiveSettingsTab(navRef, sectionId);
  const el = document.getElementById(`${prefix}-${sectionId}`);
  if (el) {
    const top = el.getBoundingClientRect().top + getSettingsScrollTop(navRef) - getSettingsSectionActivationOffset(navRef);
    scrollSettingsPageTo(navRef, top);
  }
}
