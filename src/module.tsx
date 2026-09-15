import React, { lazy, Suspense } from 'react';
import { DataSourcePlugin } from '@grafana/data';
import { LoadingPlaceholder } from '@grafana/ui';

import { DataSource } from './datasource';
import { VictoriaTracesOptions, VictoriaTracesQuery } from './types';

const QueryEditor = lazy(() =>
  import(/* webpackChunkName: "query-editor" */ './components/QueryEditor').then((m) => ({
    default: m.QueryEditor,
  }))
);

const ConfigEditor = lazy(() =>
  import(/* webpackChunkName: "config-editor" */ './components/ConfigEditor').then((m) => ({
    default: m.ConfigEditor,
  }))
);

function withSuspense<P extends object>(Component: React.ComponentType<P>) {
  return function WithSuspense(props: P) {
    return (
      <Suspense fallback={<LoadingPlaceholder text="Loading…" />}>
        <Component {...props} />
      </Suspense>
    );
  };
}

export const plugin = new DataSourcePlugin<DataSource, VictoriaTracesQuery, VictoriaTracesOptions>(DataSource)
  .setConfigEditor(withSuspense(ConfigEditor))
  .setQueryEditor(withSuspense(QueryEditor));
