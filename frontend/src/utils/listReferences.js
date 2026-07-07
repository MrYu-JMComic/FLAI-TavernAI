export function sameListItems(currentItems, nextItems, sameItem = Object.is) {
  const currentList = Array.isArray(currentItems) ? currentItems : [];
  const nextList = Array.isArray(nextItems) ? nextItems : [];
  if (currentList === nextList) {
    return true;
  }
  if (currentList.length !== nextList.length) {
    return false;
  }
  for (let index = 0; index < currentList.length; index += 1) {
    if (!sameItem(currentList[index], nextList[index])) {
      return false;
    }
  }
  return true;
}
