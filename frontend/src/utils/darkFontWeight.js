const DEFAULT_WEIGHT = 400;
const MIN_WEIGHT = 100;

// Track and restore authored weights while the theme attribute changes.
export function installDarkFontWeightAdaptation(doc = document) {
  const root = doc?.documentElement;
  const MutationObserverConstructor = doc?.defaultView?.MutationObserver;
  const getComputed = doc?.defaultView?.getComputedStyle?.bind(doc.defaultView);
  if (!root || !MutationObserverConstructor || !getComputed) return () => {};

  const adjusted = new Map();
  let active = false;

  function restoreElement(element) {
    const original = adjusted.get(element);
    if (!original) return;
    if (original.value) {
      element.style.setProperty('font-weight', original.value, original.priority);
    } else {
      element.style.removeProperty('font-weight');
    }
    adjusted.delete(element);
  }

  function restoreSubtree(element) {
    if (element.nodeType !== 1) return;
    restoreElement(element);
    for (const child of element.children) restoreSubtree(child);
  }

  function weightOf(element) {
    const value = Number.parseFloat(getComputed(element).fontWeight);
    return Number.isFinite(value) ? value : DEFAULT_WEIGHT;
  }

  function reduceElementWeight(element) {
    const parentWeight = element.parentElement ? weightOf(element.parentElement) : DEFAULT_WEIGHT;
    const weight = weightOf(element);
    if (weight === parentWeight) return;

    adjusted.set(element, {
      value: element.style.getPropertyValue('font-weight'),
      priority: element.style.getPropertyPriority('font-weight')
    });
    element.style.setProperty('font-weight', String(Math.max(MIN_WEIGHT, weight - 100)), 'important');
  }

  function reduceSubtree(element) {
    if (element.nodeType !== 1) return;
    reduceElementWeight(element);
    for (const child of element.children) reduceSubtree(child);
  }

  function applyTheme() {
    for (const element of adjusted.keys()) restoreElement(element);
    active = root.dataset.theme === 'dark';
    if (!active) return;

    adjusted.set(root, {
      value: root.style.getPropertyValue('font-weight'),
      priority: root.style.getPropertyPriority('font-weight')
    });
    root.style.setProperty('font-weight', String(Math.max(MIN_WEIGHT, weightOf(root) - 100)), 'important');
    for (const child of root.children) reduceSubtree(child);
  }

  const observer = new MutationObserverConstructor((records) => {
    if (records.some((record) => record.target === root && record.attributeName === 'data-theme')) {
      applyTheme();
      return;
    }
    if (!active) return;

    for (const record of records) {
      if (record.type === 'childList') {
        for (const node of record.removedNodes) restoreSubtree(node);
      }
    }

    const changedRoots = new Set();
    for (const record of records) {
      if (record.type === 'attributes' && record.attributeName === 'class') {
        changedRoots.add(record.target);
      }
      if (record.type === 'childList') {
        for (const node of record.addedNodes) {
          if (node.nodeType === 1) changedRoots.add(node);
        }
      }
    }
    for (const element of changedRoots) {
      restoreSubtree(element);
      reduceSubtree(element);
    }
  });

  observer.observe(root, {
    attributes: true,
    attributeFilter: ['class', 'data-theme'],
    childList: true,
    subtree: true
  });
  applyTheme();

  return () => {
    observer.disconnect();
    for (const element of adjusted.keys()) restoreElement(element);
  };
}
