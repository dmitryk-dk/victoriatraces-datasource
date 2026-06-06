import { PanelPlugin } from '@grafana/data';
import { TracePanel } from './TracePanel';

export const plugin = new PanelPlugin(TracePanel);
