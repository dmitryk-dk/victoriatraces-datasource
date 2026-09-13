import { useEffect, useMemo, useState } from 'react';

import { fetchResource, ResourceParams } from './resource';

export interface ResourceState<T> {
  data?: T;
  loading: boolean;
  error?: Error;
}

interface Options {
  /** When false the request is not made and any previous result is dropped. */
  enabled?: boolean;
  /** Changing this re-runs the request; the caller drops the cached entry first. */
  reloadToken?: number;
}

/**
 * Subscribes to a datasource resource for the lifetime of the component.
 * Unmounting, or a change of uid/path/params, cancels the in-flight request.
 */
export function useResource<T>(
  uid: string | undefined,
  path: string,
  params?: ResourceParams,
  { enabled = true, reloadToken = 0 }: Options = {}
): ResourceState<T> {
  const [state, setState] = useState<ResourceState<T>>({ loading: false });

  // params is typically an inline object literal, so identity changes every
  // render; serialising it keeps the effect from resubscribing in a loop.
  const paramsKey = useMemo(() => JSON.stringify(params ?? {}), [params]);

  useEffect(() => {
    if (!uid || !enabled) {
      setState({ loading: false });
      return;
    }

    // A reload keeps what is already on screen: blanking it makes a view that
    // refreshes itself flash a loader on every pass.
    setState((previous) => ({ ...previous, loading: true, error: undefined }));

    const subscription = fetchResource<T>(uid, path, JSON.parse(paramsKey)).subscribe({
      next: (data) => setState({ data, loading: false }),
      error: (error: Error) => setState({ loading: false, error }),
    });

    return () => subscription.unsubscribe();
    // reloadToken is not read here: changing it is the request to run again,
    // which a caller does after dropping the cached entry.
  }, [uid, path, paramsKey, enabled, reloadToken]);

  return state;
}
