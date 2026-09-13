import { HistoryItem } from '@grafana/data';

import type { LogsqlFetchers } from '../../lang/logsql/fetchers';
import { VictoriaTracesQuery } from '../../types';

export type Props = {
  initialValue: string;
  history: Array<HistoryItem<VictoriaTracesQuery>>;
  placeholder: string;
  readOnly?: boolean;
  onRunQuery: (value: string) => void;
  onBlur: (value: string) => void;
  /** Field and value suggestions for this field's datasource and range. */
  fetchers?: LogsqlFetchers;
};
