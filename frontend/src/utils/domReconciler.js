const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const COMMENT_NODE = 8;
const SHOW_TEXT = 4;

export function reconcileDomChildren(currentParent, nextParent) {
  const activeGlyphs = captureActiveStreamGlyphs(currentParent);
  let currentNode = currentParent.firstChild;
  let nextNode = nextParent.firstChild;

  while (nextNode) {
    const followingNextNode = nextNode.nextSibling;
    if (!currentNode) {
      currentParent.appendChild(nextNode.cloneNode(true));
      nextNode = followingNextNode;
      continue;
    }

    if (canReconcileNode(currentNode, nextNode)) {
      const followingCurrentNode = currentNode.nextSibling;
      reconcileNode(currentNode, nextNode);
      currentNode = followingCurrentNode;
      nextNode = followingNextNode;
      continue;
    }

    const followingCurrentNode = currentNode.nextSibling;
    if (followingCurrentNode && canReconcileNode(followingCurrentNode, nextNode)) {
      currentParent.removeChild(currentNode);
      currentNode = followingCurrentNode;
      continue;
    }
    if (followingNextNode && canReconcileNode(currentNode, followingNextNode)) {
      currentParent.insertBefore(nextNode.cloneNode(true), currentNode);
      nextNode = followingNextNode;
      continue;
    }
    currentParent.replaceChild(nextNode.cloneNode(true), currentNode);
    currentNode = followingCurrentNode;
    nextNode = followingNextNode;
  }

  while (currentNode) {
    const followingCurrentNode = currentNode.nextSibling;
    currentParent.removeChild(currentNode);
    currentNode = followingCurrentNode;
  }
  restoreActiveStreamGlyphs(currentParent, activeGlyphs);
}

function captureActiveStreamGlyphs(parent) {
  // Preserve active glyph nodes across Markdown updates so their animation finishes.
  const glyphs = [];
  let offset = 0;
  for (const child of parent.childNodes) {
    if (child.nodeType === ELEMENT_NODE && child.classList.contains('stream-ink-glyph')) {
      glyphs.push({
        element: child,
        offset,
        animationTimes: typeof child.getAnimations === 'function'
          ? child.getAnimations().map((animation) => animation.currentTime)
          : []
      });
      offset += child.textContent?.length || 0;
    } else if (child.nodeType === TEXT_NODE || child.nodeType === ELEMENT_NODE) {
      offset += child.textContent?.length || 0;
    }
  }
  return glyphs;
}

function restoreActiveStreamGlyphs(parent, glyphs) {
  for (const glyph of glyphs) {
    const text = glyph.element.textContent || '';
    const target = findTextAtOffset(parent, glyph.offset);
    if (!target || target.text.slice(target.localOffset, target.localOffset + text.length) !== text) continue;

    const fragment = parent.ownerDocument.createDocumentFragment();
    const before = target.text.slice(0, target.localOffset);
    const after = target.text.slice(target.localOffset + text.length);
    if (before) fragment.append(parent.ownerDocument.createTextNode(before));
    fragment.append(glyph.element);
    if (after) fragment.append(parent.ownerDocument.createTextNode(after));
    target.node.replaceWith(fragment);

    if (glyph.animationTimes.length && typeof glyph.element.getAnimations === 'function') {
      const animations = glyph.element.getAnimations();
      for (let index = 0; index < Math.min(animations.length, glyph.animationTimes.length); index += 1) {
        animations[index].currentTime = glyph.animationTimes[index];
      }
    }
  }
}

function findTextAtOffset(parent, offset) {
  const walker = parent.ownerDocument.createTreeWalker(parent, SHOW_TEXT);
  let consumed = 0;
  let node = walker.nextNode();
  while (node) {
    const text = node.nodeValue || '';
    if (offset >= consumed && offset < consumed + text.length) {
      return { node, localOffset: offset - consumed, text };
    }
    consumed += text.length;
    node = walker.nextNode();
  }
  return null;
}

function canReconcileNode(currentNode, nextNode) {
  if (currentNode.nodeType !== nextNode.nodeType) return false;
  if (currentNode.nodeType !== ELEMENT_NODE) return true;
  if (currentNode.tagName !== nextNode.tagName) return false;

  const currentKey = semanticNodeKey(currentNode);
  const nextKey = semanticNodeKey(nextNode);
  return !currentKey && !nextKey ? true : currentKey === nextKey;
}

function semanticNodeKey(element) {
  const id = element.getAttribute('id');
  if (id) return `id:${id}`;
  if (['IMG', 'VIDEO', 'AUDIO', 'IFRAME'].includes(element.tagName)) {
    return `${element.tagName}:${element.getAttribute('src') || ''}`;
  }
  if (element.tagName === 'A') {
    return `A:${element.getAttribute('href') || ''}`;
  }
  if (element.tagName === 'DETAILS') {
    const summary = element.querySelector(':scope > summary');
    return `DETAILS:${String(summary?.textContent || '').trim()}`;
  }
  return '';
}

function reconcileNode(currentNode, nextNode) {
  if (currentNode.nodeType === TEXT_NODE || currentNode.nodeType === COMMENT_NODE) {
    if (currentNode.nodeValue !== nextNode.nodeValue) {
      currentNode.nodeValue = nextNode.nodeValue;
    }
    return;
  }
  if (currentNode.nodeType !== ELEMENT_NODE) return;

  reconcileAttributes(currentNode, nextNode);
  reconcileDomChildren(currentNode, nextNode);
}

function reconcileAttributes(currentElement, nextElement) {
  const preserveDetailsOpen = currentElement.tagName === 'DETAILS';
  for (const attribute of Array.from(currentElement.attributes)) {
    if (preserveDetailsOpen && attribute.name === 'open') continue;
    if (!nextElement.hasAttribute(attribute.name)) {
      currentElement.removeAttribute(attribute.name);
    }
  }
  for (const attribute of Array.from(nextElement.attributes)) {
    if (preserveDetailsOpen && attribute.name === 'open') continue;
    if (currentElement.getAttribute(attribute.name) !== attribute.value) {
      currentElement.setAttribute(attribute.name, attribute.value);
    }
  }
}
