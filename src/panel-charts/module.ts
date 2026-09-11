import { PanelPlugin } from '@grafana/data';
import { TraceChartsPanel } from './TraceChartsPanel';

export const plugin = new PanelPlugin(TraceChartsPanel);
