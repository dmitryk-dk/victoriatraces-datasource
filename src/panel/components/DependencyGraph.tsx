import React, { useCallback, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import { useStyles2, useTheme2 } from '@grafana/ui';
import type { GrafanaTheme2 } from '@grafana/data';
import dagre from '@dagrejs/dagre';
import {
  Background,
  ConnectionLineType,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

interface ServiceEdge {
  source: string;
  target: string;
  callCount: number;
}

interface DependencyGraphProps {
  nodeIds: string[];
  edges: ServiceEdge[];
  height?: number;
  onNodeClick?: (id: string) => void;
}

interface ServiceNodeData extends Record<string, unknown> {
  label: string;
  hasParent: boolean;
  hasChild: boolean;
  selected: boolean;
  dimmed: boolean;
}

const NODE_W = 160;
const NODE_H = 60;
const HEAT_LOW = '#22bb22';
const HEAT_HIGH = '#bb2222';

function interpolateColor(c1: string, c2: string, t: number): string {
  const hex = (s: string) => parseInt(s, 16);
  const r1 = hex(c1.slice(1, 3)), g1 = hex(c1.slice(3, 5)), b1 = hex(c1.slice(5, 7));
  const r2 = hex(c2.slice(1, 3)), g2 = hex(c2.slice(3, 5)), b2 = hex(c2.slice(5, 7));
  const r = Math.round(r1 + (r2 - r1) * t).toString(16).padStart(2, '0');
  const g = Math.round(g1 + (g2 - g1) * t).toString(16).padStart(2, '0');
  const b = Math.round(b1 + (b2 - b1) * t).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    width: '100%',
    background: theme.colors.background.primary,
    position: 'relative',
  }),
  nodeBox: css({
    background: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    padding: `${theme.spacing(1)} ${theme.spacing(1.5)}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'monospace',
    fontSize: 13,
    fontWeight: 600,
    width: NODE_W,
    height: NODE_H,
    cursor: 'pointer',
    transition: 'border-color 120ms ease, box-shadow 120ms ease, opacity 120ms ease',
    '&:hover': { borderColor: theme.colors.primary.main },
  }),
  nodeBoxSelected: css({
    borderColor: theme.colors.primary.main,
    boxShadow: `0 0 0 2px ${theme.colors.primary.transparent}`,
  }),
  nodeBoxDimmed: css({
    opacity: 0.3,
  }),
  nodeLabel: css({
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }),
  hint: css({
    position: 'absolute',
    top: theme.spacing(1),
    left: theme.spacing(1),
    padding: `${theme.spacing(0.25)} ${theme.spacing(1)}`,
    background: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.pill,
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    pointerEvents: 'none',
    zIndex: 5,
  }),
  legend: css({
    position: 'absolute',
    bottom: theme.spacing(1),
    left: theme.spacing(1),
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    padding: `${theme.spacing(0.25)} ${theme.spacing(1)}`,
    background: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.pill,
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    pointerEvents: 'none',
    zIndex: 5,
  }),
  legendBar: css({
    width: 60,
    height: 6,
    borderRadius: 3,
    background: `linear-gradient(to right, ${HEAT_LOW}, ${HEAT_HIGH})`,
  }),
  resetBtn: css({
    position: 'absolute',
    top: theme.spacing(1),
    right: theme.spacing(1),
    padding: `${theme.spacing(0.25)} ${theme.spacing(1)}`,
    background: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.primary,
    cursor: 'pointer',
    zIndex: 5,
    '&:hover': { background: theme.colors.action.hover },
  }),
});

function ServiceNode({ data }: NodeProps<Node<ServiceNodeData>>) {
  const styles = useStyles2(getStyles);
  const cls = [
    styles.nodeBox,
    data.selected ? styles.nodeBoxSelected : '',
    data.dimmed ? styles.nodeBoxDimmed : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls} title={`Click to search traces for "${data.label}"`}>
      {data.hasParent && <Handle type="target" position={Position.Top} />}
      <span className={styles.nodeLabel}>{data.label}</span>
      {data.hasChild && <Handle type="source" position={Position.Bottom} />}
    </div>
  );
}

const nodeTypes = { service: ServiceNode };

function layoutNodes(nodeIds: string[], edges: ServiceEdge[]): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', ranksep: 60, nodesep: 40 });
  nodeIds.forEach((id) => g.setNode(id, { width: NODE_W, height: NODE_H }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  const positions = new Map<string, { x: number; y: number }>();
  nodeIds.forEach((id) => {
    const pos = g.node(id);
    positions.set(id, { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 });
  });
  return positions;
}

export function DependencyGraph({ nodeIds, edges, height = 400, onNodeClick }: DependencyGraphProps) {
  const styles = useStyles2(getStyles);
  const theme = useTheme2();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const positions = useMemo(() => layoutNodes(nodeIds, edges), [nodeIds, edges]);
  const hasChild = useMemo(() => new Set(edges.map((e) => e.source)), [edges]);
  const hasParent = useMemo(() => new Set(edges.map((e) => e.target)), [edges]);

  const minCalls = useMemo(() => Math.min(...edges.map((e) => e.callCount), 1), [edges]);
  const maxCalls = useMemo(() => Math.max(...edges.map((e) => e.callCount), 1), [edges]);

  const neighbors = useMemo(() => {
    if (!selectedId) {
      return null;
    }
    const set = new Set<string>([selectedId]);
    for (const e of edges) {
      if (e.source === selectedId) {
        set.add(e.target);
      }
      if (e.target === selectedId) {
        set.add(e.source);
      }
    }
    return set;
  }, [selectedId, edges]);

  const flowNodes: Array<Node<ServiceNodeData>> = useMemo(
    () =>
      nodeIds.map((id) => ({
        id,
        type: 'service',
        position: positions.get(id) ?? { x: 0, y: 0 },
        data: {
          label: id,
          hasChild: hasChild.has(id),
          hasParent: hasParent.has(id),
          selected: selectedId === id,
          dimmed: neighbors ? !neighbors.has(id) : false,
        },
      })),
    [nodeIds, positions, hasChild, hasParent, selectedId, neighbors]
  );

  const flowEdges: Edge[] = useMemo(
    () =>
      edges.map((e) => {
        const ratio = maxCalls > minCalls ? (e.callCount - minCalls) / (maxCalls - minCalls) : 0;
        const color = interpolateColor(HEAT_LOW, HEAT_HIGH, ratio);
        const onSelectedPath = selectedId === e.source || selectedId === e.target;
        const dim = selectedId !== null && !onSelectedPath;
        return {
          id: `${e.source}--${e.target}`,
          source: e.source,
          target: e.target,
          label: String(e.callCount),
          animated: onSelectedPath || selectedId === null,
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color },
          style: {
            stroke: color,
            strokeWidth: 1 + ratio * 2 + (onSelectedPath ? 1 : 0),
            opacity: dim ? 0.18 : 1,
          },
          labelStyle: { opacity: dim ? 0.3 : 1 },
        };
      }),
    [edges, minCalls, maxCalls, selectedId]
  );

  const handleNodeClick = useCallback(
    (_e: React.MouseEvent, node: Node) => {
      setSelectedId(node.id);
      onNodeClick?.(node.id);
    },
    [onNodeClick]
  );

  const clearSelection = useCallback(() => setSelectedId(null), []);

  return (
    <div className={styles.container} style={{ height }}>
      <span className={styles.hint}>Click a service to filter • click empty space to clear</span>
      <span className={styles.legend}>
        <span>Calls:</span>
        <span>low</span>
        <span className={styles.legendBar} />
        <span>high</span>
      </span>
      {selectedId && (
        <button className={styles.resetBtn} onClick={clearSelection}>
          Clear selection
        </button>
      )}
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        onPaneClick={clearSelection}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        connectionLineType={ConnectionLineType.SmoothStep}
        proOptions={{ hideAttribution: true }}
      >
        <Background color={theme.colors.border.weak} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}