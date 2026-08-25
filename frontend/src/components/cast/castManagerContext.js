import { inject } from 'vue';

export const CAST_MANAGER_CONTEXT = Symbol('cast-manager');

export function useCastManagerContext() {
  const manager = inject(CAST_MANAGER_CONTEXT, null);
  if (!manager) throw new Error('Cast manager context is unavailable');
  return manager;
}
