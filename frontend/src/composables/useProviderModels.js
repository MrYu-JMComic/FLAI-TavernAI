import { onBeforeUnmount, ref, watch } from 'vue';
import {
  buildModelSelectOptions,
  readCachedProviderModels,
  subscribeProviderModelCache
} from '../services/modelCatalog';

export function useProviderModels(providerRef) {
  const providerModels = ref([]);

  function syncProviderModels() {
    providerModels.value = readCachedProviderModels(providerRef?.value || {});
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
