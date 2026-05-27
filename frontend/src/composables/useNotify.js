import { inject } from 'vue';

const noop = () => {};

const fallbackNotify = {
  show: noop,
  success: noop,
  error: noop,
  warning: noop,
  info: noop
};

export function useNotify() {
  return inject('notify', fallbackNotify);
}
