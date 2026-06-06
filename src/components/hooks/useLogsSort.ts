import { useEffect } from 'react';

import { CoreApp, LogSortOrderChangeEvent } from '@grafana/data';
import { getAppEvents } from '@grafana/runtime';

import { storeKeys } from '../../store/constants';
import store from '../../store/store';
import { VictoriaTracesQuery } from '../../types';

/**
 * Listens to log sort order changes in Dashboard/PanelEditor and updates
 * the query direction accordingly. Mirrors the VictoriaLogs implementation.
 */
export const useLogsSort = (
  app: CoreApp | undefined,
  query: VictoriaTracesQuery,
  onChange: (query: VictoriaTracesQuery) => void,
  onRunQuery: () => void
) => {
  useEffect(() => {
    if (app !== CoreApp.Dashboard && app !== CoreApp.PanelEditor) {
      return;
    }
    const subscription = getAppEvents().subscribe(
      LogSortOrderChangeEvent,
      (sortEvent: LogSortOrderChangeEvent) => {
        const direction = sortEvent.payload.order === 'Ascending' ? 'asc' : 'desc';
        if ((query as any).direction !== direction) {
          onChange({ ...query, ...(({ direction } as unknown) as Partial<VictoriaTracesQuery>) });
          onRunQuery();
        }
      }
    );
    return () => {
      subscription.unsubscribe();
    };
  }, [app, onChange, onRunQuery, query]);

  useEffect(() => {
    if ('subscribe' in store) {
      (store as any).subscribe(storeKeys.LOGS_SORT_ORDER, () => {
        onRunQuery();
      });
    }
  }, [onRunQuery]);
};
