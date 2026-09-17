import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();
const facades = new WeakMap();
const originals = new WeakMap();

export function withConversationMutationContext(context, operation) {
  return storage.run(context, operation);
}

export function getConversationMutationContext() {
  return storage.getStore() || null;
}

export function unwrapConversationDatabase(database) {
  return originals.get(database) || database;
}

export function createConversationDatabaseFacade(database) {
  const raw = unwrapConversationDatabase(database);
  if (facades.has(raw)) return facades.get(raw);
  const facade = new Proxy(raw, {
    get(target, key) {
      if (key === 'prepare') {
        return (sql) => {
          const statement = target.prepare(sql);
          return new Proxy(statement, {
            get(query, method) {
              const value = Reflect.get(query, method, query);
              if (typeof value !== 'function') return value;
              return (...args) => {
                assertMutationContext(sql);
                return value.apply(query, args);
              };
            }
          });
        };
      }
      if (key === 'exec') return (sql) => { assertMutationContext(sql); return target.exec(sql); };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
  facades.set(raw, facade);
  originals.set(facade, raw);
  return facade;
}

function assertMutationContext(sql) {
  // A stale operation must still be able to release its synchronous savepoint.
  if (/^\s*(?:ROLLBACK|RELEASE)\b/i.test(sql)) return;
  storage.getStore()?.assert?.();
}
