import { PanelPlugin } from '@grafana/data';
import { NodeGraphPanel } from './NodeGraphPanel';

export const plugin = new PanelPlugin(NodeGraphPanel);

