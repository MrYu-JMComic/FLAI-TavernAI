export function createStreamEmitQueue(emit) {
  let tail = Promise.resolve();
  let firstError = null;

  function queuedEmit(event, data) {
    if (typeof emit !== 'function') {
      return Promise.resolve();
    }

    const current = tail.then(() => emit(event, data));
    tail = current.catch((error) => {
      firstError ??= error;
    });
    return current;
  }

  return {
    emit: queuedEmit,
    async wait() {
      await tail;
      if (firstError) {
        throw firstError;
      }
    }
  };
}
