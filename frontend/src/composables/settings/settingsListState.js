import { samePlainValue } from '../../utils/plainValues';

export function sameListItems(currentList, nextList) {
  if (!Array.isArray(currentList) || !Array.isArray(nextList) || currentList.length !== nextList.length) {
    return false;
  }
  for (let index = 0; index < currentList.length; index += 1) {
    if (!samePlainValue(currentList[index], nextList[index])) {
      return false;
    }
  }
  return true;
}

export function setPlainValueIfChanged(valueRef, nextValue) {
  if (samePlainValue(valueRef.value, nextValue)) {
    return false;
  }
  valueRef.value = nextValue;
  return true;
}

export function setListIfChanged(listRef, nextList) {
  const normalizedNextList = Array.isArray(nextList) ? nextList : [];
  if (sameListItems(listRef.value, normalizedNextList)) {
    return false;
  }
  listRef.value = normalizedNextList;
  return true;
}

export function getListItemById(listRef, itemId) {
  const targetId = String(itemId || '');
  if (!targetId) {
    return null;
  }
  const currentList = Array.isArray(listRef.value) ? listRef.value : [];
  for (const item of currentList) {
    if (item?.id === targetId) {
      return item;
    }
  }
  return null;
}

export function prependListItemByIdWithLimit(listRef, nextItem, limit) {
  const nextId = String(nextItem?.id || '');
  const normalizedLimit = Math.max(0, Number(limit) || 0);
  if (!nextId || normalizedLimit <= 0) {
    return false;
  }
  const currentList = Array.isArray(listRef.value) ? listRef.value : [];
  const nextList = [nextItem];
  for (const item of currentList) {
    if (item?.id === nextId) continue;
    if (nextList.length >= normalizedLimit) break;
    nextList.push(item);
  }
  return setListIfChanged(listRef, nextList);
}

export function removeListItemByIdIfPresent(listRef, itemId) {
  const targetId = String(itemId || '');
  if (!targetId) {
    return false;
  }
  const currentList = Array.isArray(listRef.value) ? listRef.value : [];
  const nextList = [];
  let changed = false;
  for (const item of currentList) {
    if (item?.id === targetId) {
      changed = true;
    } else {
      nextList.push(item);
    }
  }
  if (changed) {
    setListIfChanged(listRef, nextList);
  }
  return changed;
}

export function updateListItemByIdIfChanged(listRef, itemId, nextItem) {
  const targetId = String(itemId || '');
  if (!targetId) {
    return false;
  }
  const currentList = Array.isArray(listRef.value) ? listRef.value : [];
  const nextList = [];
  let changed = false;
  for (const item of currentList) {
    if (item?.id === targetId) {
      if (!samePlainValue(item, nextItem)) {
        changed = true;
        nextList.push(nextItem);
      } else {
        nextList.push(item);
      }
    } else {
      nextList.push(item);
    }
  }
  if (changed) {
    setListIfChanged(listRef, nextList);
  }
  return changed;
}

export function moveListItemToTargetIndexById(listRef, itemId, targetItemId) {
  const sourceId = String(itemId || '');
  const targetId = String(targetItemId || '');
  if (!sourceId || !targetId || sourceId === targetId) {
    return null;
  }
  const currentList = Array.isArray(listRef.value) ? listRef.value : [];
  let fromIndex = -1;
  let targetIndex = -1;
  for (let index = 0; index < currentList.length; index += 1) {
    const id = currentList[index]?.id;
    if (id === sourceId) {
      fromIndex = index;
    } else if (id === targetId) {
      targetIndex = index;
    }
  }
  if (fromIndex === -1 || targetIndex === -1) {
    return null;
  }
  const nextList = currentList.slice();
  const [moved] = nextList.splice(fromIndex, 1);
  nextList.splice(targetIndex, 0, moved);
  const ids = [];
  for (const item of nextList) {
    ids.push(item.id);
  }
  setListIfChanged(listRef, nextList);
  return { previousList: currentList, nextList, ids };
}
