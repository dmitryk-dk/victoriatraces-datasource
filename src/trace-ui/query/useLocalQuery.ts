import { useCallback, useEffect, useMemo, useState } from 'react';
import { isObservable, from, type Observable } from 'rxjs';
import { LoadingState, type DataQueryRequest, type DataQueryResponse, type PanelData } from '@grafana/data';
import { getDataSourceSrv } from '@grafana/runtime';

import { isExploreLocation, navigateExplore, queryFromData } from './exploreQuery';

type Rebuild = (prev: any) => any;

/**
 * The query a panel edits, wherever it is rendered.
 *
 * In Explore an edit rewrites the URL and Explore re-runs the query, so the
 * panel just reads Explore's result back. A dashboard panel cannot rewrite its
 * saved query, and `navigateExplore` there has no pane to change — edits were
 * silently dropped. So on a dashboard the edited query is held here and run
 * against the datasource directly, and its result stands in for the panel's
 * until the saved query itself changes.
 */
export function useLocalQuery(panelData: PanelData, uid: string | undefined) {
  const inExplore = isExploreLocation();
  const base = queryFromData<any>(panelData);
  const baseKey = useMemo(() => JSON.stringify(base ?? null), [base]);

  // Tied to the saved query it was made from: once that is edited, the
  // panel's own result is the truth again.
  const [override, setOverride] = useState<{ baseKey: string; target: any } | null>(null);
  const target = override?.baseKey === baseKey ? override.target : undefined;

  const editQuery = useCallback(
    (rebuild: Rebuild) => {
      if (inExplore) {
        navigateExplore(rebuild);
        return;
      }
      setOverride((prev) => ({
        baseKey,
        target: rebuild(prev?.baseKey === baseKey ? prev.target : base),
      }));
    },
    [inExplore, base, baseKey]
  );

  const [result, setResult] = useState<PanelData | undefined>();
  const targetKey = useMemo(() => (target ? JSON.stringify(target) : ''), [target]);
  const request = panelData.request;
  const timeRange = panelData.timeRange;

  useEffect(() => {
    if (!target || !uid) {
      setResult(undefined);
      return;
    }
    const req = {
      ...(request ?? {}),
      requestId: `${request?.requestId ?? 'victoriatraces'}-local`,
      range: timeRange,
      targets: [target],
    } as DataQueryRequest;

    setResult((prev) => ({ ...(prev ?? panelData), state: LoadingState.Loading }));

    let cancelled = false;
    let unsubscribe = () => {
      cancelled = true;
    };
    getDataSourceSrv()
      .get(uid)
      .then((ds) => {
        if (cancelled) {
          return;
        }
        const res = ds.query(req) as Observable<DataQueryResponse> | Promise<DataQueryResponse>;
        const sub = (isObservable(res) ? res : from(res)).subscribe({
          next: (response) =>
            setResult({
              series: response.data ?? [],
              state: response.state ?? LoadingState.Done,
              error: response.error ?? response.errors?.[0],
              timeRange,
              request: req,
            }),
          error: (err: unknown) =>
            setResult({
              series: [],
              state: LoadingState.Error,
              error: { message: err instanceof Error ? err.message : String((err as any)?.data?.message ?? err) },
              timeRange,
              request: req,
            }),
        });
        unsubscribe = () => sub.unsubscribe();
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setResult({
            series: [],
            state: LoadingState.Error,
            error: { message: err instanceof Error ? err.message : String(err) },
            timeRange,
            request: req,
          });
        }
      });
    return () => unsubscribe();
    // The target is keyed by its JSON: a rebuild returns a new object for the
    // same query. The request id changes on every dashboard refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, uid, timeRange.from.valueOf(), timeRange.to.valueOf(), request?.requestId]);

  return { data: target && result ? result : panelData, editQuery, inExplore };
}
