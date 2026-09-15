import { getBackendSrv } from '@grafana/runtime';
import { map, Observable, shareReplay, tap } from 'rxjs';

// An array value repeats the key, which is how the backend reads a
// multi-valued parameter such as `field` or `customField`.
export type ResourceParams = Record<string, string | number | string[] | undefined>;

// Caching, in-flight dedup and cancellation come free with a query library;
// on the RxJS path they have to be built, so they live here rather than being
// repeated in each hook.
//
// Entries are shared observables: two components asking for the same resource
// at the same time make one HTTP call, and a repeat ask inside the stale window
// resolves from the replayed value instead of refetching.
const STALE_TIME_MS = 10_000;

interface CacheEntry {
  observable: Observable<unknown>;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function resourceUrl(uid: string, path: string): string {
  return `/api/datasources/uid/${encodeURIComponent(uid)}/resources/${path}`;
}

function buildQuery(params?: ResourceParams): string {
  if (!params) {
    return '';
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== '') {
          search.append(key, item);
        }
      }
    } else if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

function pruneExpired(now: number) {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  }
}

/**
 * Calls a datasource resource endpoint and replays the result to every
 * subscriber for STALE_TIME_MS. Unsubscribing before the request settles
 * aborts it.
 */
export function fetchResource<T>(uid: string, path: string, params?: ResourceParams): Observable<T> {
  const url = resourceUrl(uid, path) + buildQuery(params);
  const now = Date.now();

  const cached = cache.get(url);
  if (cached && cached.expiresAt > now) {
    return cached.observable as Observable<T>;
  }

  pruneExpired(now);

  const observable = getBackendSrv()
    .fetch<T>({ url, method: 'GET', showErrorAlert: false })
    .pipe(
      map((response) => response.data),
      // A failed request must not be served from cache for the rest of the
      // stale window; drop the entry so the next call retries.
      tap({ error: () => cache.delete(url) }),
      // refCount stays false so the value survives the last unsubscribe and can
      // still serve a remount inside the stale window.
      shareReplay({ bufferSize: 1, refCount: false })
    );

  cache.set(url, { observable, expiresAt: now + STALE_TIME_MS });
  return observable;
}

/** Drops a cached entry so the next call refetches. Used by explicit refresh. */
export function invalidateResources() {
  cache.clear();
}

/**
 * Drops one cached entry.
 *
 * A trace still being ingested has to be asked again within the stale window,
 * and clearing the whole cache to do it would throw away every other panel's
 * work as well.
 */
export function invalidateResource(uid: string, path: string, params?: ResourceParams) {
  cache.delete(resourceUrl(uid, path) + buildQuery(params));
}
