import { onBeforeUnmount, ref, watch } from 'vue';
import {
  areProviderModelListsEqual,
  buildModelSelectOptions,
  readCachedProviderModels,
  subscribeProviderModelCache
} from '../services/modelCatalog.js';

export function useProviderModels(providerRef) {
  const providerModels = ref([]);

  function syncProviderModels() {
    const nextModels = readCachedProviderModels(providerRef?.value || {});
    if (areProviderModelListsEqual(providerModels.value, nextModels)) {
      return;
    }
    providerModels.value = nextModels;
  }

  const stopWatch = watch(providerRef, syncProviderModels, { deep: true, immediate: true });
  const unsubscribe = subscribeProviderModelCache(syncProviderModels);

  onBeforeUnmount(() => {
    stopWatch();
    unsubscribe();
  });

  function providerModelOptionsFor(currentValue = '', emptyLabel = '') {
    return buildModelSelectOptions(providerModels.value, currentValue, emptyLabel);
  }

  return {
    providerModels,
    providerModelOptionsFor,
    syncProviderModels
  };
}
