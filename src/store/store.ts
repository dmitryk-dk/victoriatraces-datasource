import { store as grafanaStore } from '@grafana/data';

type LocalStorage = {
  get: (key: string) => string | null;
  set: (key: string, value: string) => void;
  subscribe?: (key: string, callback: () => void) => void;
};
type Store = typeof grafanaStore;

// Wrap the grafana store with a localStorage fallback for older Grafana versions.
const store: Store | LocalStorage = grafanaStore || {};
if (!store?.get) {
  store.get = localStorage.getItem.bind(localStorage);
}
if (!store?.set) {
  store.set = localStorage.setItem.bind(localStorage);
}

export default store;
