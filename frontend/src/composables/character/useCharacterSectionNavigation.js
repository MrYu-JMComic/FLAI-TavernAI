import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

export function useCharacterSectionNavigation({
  sections = [],
  isSectionVisible = () => true
} = {}) {
  const activeSection = ref('basic');
  const sectionNavRef = ref(null);
  const visibleFormSections = computed(getVisibleFormSections);
  let sectionNavRafId = null;
  let characterScrollListenerTarget = null;

  watch(
    visibleFormSections,
    (nextSections) => {
      if (!hasVisibleFormSection(activeSection.value, nextSections)) {
        activeSection.value = nextSections[0]?.id || 'basic';
      }
      scheduleCharacterSectionNavSync();
    },
    { flush: 'post' }
  );

  watch(
    sectionNavRef,
    () => {
      syncCharacterScrollListener();
      scheduleCharacterSectionNavSync();
    },
    { flush: 'post' }
  );

  onMounted(() => {
    syncCharacterScrollListener();
    window.addEventListener('resize', onWindowResize);
    scheduleCharacterSectionNavSync();
  });

  onBeforeUnmount(disposeCharacterSectionNavigation);

  function getVisibleFormSections() {
    const nextSections = [];
    for (const section of sections) {
      if (isSectionVisible(section)) {
        nextSections.push(section);
      }
    }
    return nextSections;
  }

  function hasVisibleFormSection(sectionId, nextSections = visibleFormSections.value) {
    for (const section of nextSections) {
      if (section.id === sectionId) {
        return true;
      }
    }
    return false;
  }

  function scrollToSection(id, { defer = false } = {}) {
    if (defer) {
      nextTick(() => scrollToSection(id));
      return;
    }
    const scrollTarget = getCharacterSectionTarget(id);
    if (!scrollTarget) {
      return;
    }
    setActiveCharacterSection(id);
    scrollActiveSectionTab(id);
    const top = scrollTarget.getBoundingClientRect().top + getCharacterScrollTop() - getCharacterSectionActivationOffset();
    scrollCharacterPageTo(top);
  }

  function getCharacterScrollContainer() {
    if (typeof document === 'undefined') {
      return null;
    }
    return sectionNavRef.value?.closest?.('.page-shell') || document.querySelector('.page-shell');
  }

  function getCharacterScrollTop() {
    const scroller = getCharacterScrollContainer();
    return scroller ? scroller.scrollTop : window.scrollY || 0;
  }

  function scrollCharacterPageTo(top) {
    const roundedTop = Math.max(0, Math.round(top));
    const scroller = getCharacterScrollContainer();
    if (scroller && typeof scroller.scrollTo === 'function') {
      scroller.scrollTo({ top: roundedTop, behavior: 'smooth' });
      return;
    }
    window.scrollTo({ top: roundedTop, behavior: 'smooth' });
  }

  function getCharacterScrollState() {
    const scroller = getCharacterScrollContainer();
    if (scroller) {
      return {
        scrollTop: scroller.scrollTop,
        clientHeight: scroller.clientHeight,
        scrollHeight: scroller.scrollHeight
      };
    }
    const scrollHeight = Math.max(
      document.documentElement?.scrollHeight || 0,
      document.body?.scrollHeight || 0
    );
    return {
      scrollTop: window.scrollY || 0,
      clientHeight: window.innerHeight || 0,
      scrollHeight
    };
  }

  function getCharacterSectionTarget(id) {
    if (typeof document === 'undefined') {
      return null;
    }
    const el = document.getElementById(`section-${id}`);
    if (!el) {
      return null;
    }
    return el.getClientRects().length
      ? el
      : el.querySelector('.form-panel, .form-section-group, [id^="section-"]') || el;
  }

  function setActiveCharacterSection(sectionId) {
    if (!hasVisibleFormSection(sectionId)) {
      return;
    }
    if (activeSection.value !== sectionId) {
      activeSection.value = sectionId;
      scrollActiveSectionTab(sectionId);
    }
  }

  function scrollActiveSectionTab(sectionId) {
    const nav = sectionNavRef.value;
    const tab = nav?.querySelector(`[data-section-id="${sectionId}"]`);
    if (tab) {
      tab.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
    }
  }

  function getTopbarBottom() {
    if (typeof document === 'undefined') {
      return 0;
    }
    const topbarBottom = document.querySelector('.topbar')?.getBoundingClientRect().bottom;
    return Math.max(0, Math.ceil(Number.isFinite(topbarBottom) ? topbarBottom : 0));
  }

  function syncCharacterSectionNavMetrics() {
    const nav = sectionNavRef.value;
    if (!nav) {
      return;
    }
    nav.style.setProperty('--character-section-nav-top', `${getTopbarBottom()}px`);
  }

  function onCharacterScroll() {
    scheduleCharacterSectionNavSync();
  }

  function syncCharacterScrollListener() {
    const nextTarget = getCharacterScrollContainer() || (typeof window !== 'undefined' ? window : null);
    if (characterScrollListenerTarget === nextTarget) {
      return;
    }
    if (characterScrollListenerTarget) {
      characterScrollListenerTarget.removeEventListener('scroll', onCharacterScroll);
    }
    characterScrollListenerTarget = nextTarget;
    if (characterScrollListenerTarget) {
      characterScrollListenerTarget.addEventListener('scroll', onCharacterScroll, { passive: true });
    }
  }

  function stopCharacterScrollListener() {
    if (!characterScrollListenerTarget) {
      return;
    }
    characterScrollListenerTarget.removeEventListener('scroll', onCharacterScroll);
    characterScrollListenerTarget = null;
  }

  function onWindowResize() {
    syncCharacterScrollListener();
    scheduleCharacterSectionNavSync();
  }

  function getCharacterSectionActivationOffset() {
    const navBottom = sectionNavRef.value?.getBoundingClientRect().bottom;
    if (Number.isFinite(navBottom)) {
      return Math.max(0, Math.ceil(navBottom)) + 14;
    }
    const navHeight = sectionNavRef.value?.getBoundingClientRect().height || 0;
    return getTopbarBottom() + navHeight + 14;
  }

  function syncActiveSectionFromScroll() {
    const activationOffset = getCharacterSectionActivationOffset();
    let nextSectionId = '';
    let nextDistance = Number.POSITIVE_INFINITY;
    let lastSectionId = '';
    for (const section of visibleFormSections.value) {
      const target = getCharacterSectionTarget(section.id);
      if (!target) {
        continue;
      }
      if (!nextSectionId) {
        nextSectionId = section.id;
      }
      lastSectionId = section.id;
      const top = target.getBoundingClientRect().top;
      if (top <= activationOffset) {
        const distance = Math.abs(activationOffset - top);
        if (distance <= nextDistance) {
          nextSectionId = section.id;
          nextDistance = distance;
        }
      }
    }
    if (!nextSectionId) {
      return;
    }
    const scrollState = getCharacterScrollState();
    if (lastSectionId && scrollState.clientHeight + scrollState.scrollTop >= scrollState.scrollHeight - 2) {
      nextSectionId = lastSectionId;
    }
    setActiveCharacterSection(nextSectionId);
  }

  function flushCharacterSectionNavSync() {
    sectionNavRafId = null;
    syncCharacterSectionNavMetrics();
    syncActiveSectionFromScroll();
  }

  function scheduleCharacterSectionNavSync() {
    if (sectionNavRafId !== null) {
      return;
    }
    if (typeof requestAnimationFrame === 'function') {
      sectionNavRafId = requestAnimationFrame(flushCharacterSectionNavSync);
      return;
    }
    flushCharacterSectionNavSync();
  }

  function cancelCharacterSectionNavSync() {
    if (sectionNavRafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(sectionNavRafId);
    }
    sectionNavRafId = null;
  }

  function disposeCharacterSectionNavigation() {
    cancelCharacterSectionNavSync();
    stopCharacterScrollListener();
    window.removeEventListener('resize', onWindowResize);
  }

  return {
    activeSection,
    cancelCharacterSectionNavSync,
    getCharacterScrollContainer,
    scheduleCharacterSectionNavSync,
    scrollToSection,
    sectionNavRef,
    setActiveCharacterSection,
    visibleFormSections
  };
}
