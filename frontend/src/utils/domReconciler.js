const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const COMMENT_NODE = 8;

export function reconcileDomChildren(currentParent, nextParent) {
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
