import { HistoryItem } from '@grafana/data';

import { VictoriaTracesQuery } from '../../types';

export type Props = {
  initialValue: string;
  history: Array<HistoryItem<VictoriaTracesQuery>>;
  placeholder: string;
  readOnly?: boolean;
  onRunQuery: (value: string) => void;
  onBlur: (value: string) => void;
};
