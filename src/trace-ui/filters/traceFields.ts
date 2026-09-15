// Readable names for the span fields people add as columns most often. Anything
// not listed falls back to the field name with its storage prefix stripped.
const FIELD_LABELS: Record<string, string> = {
  'span_attr:http.request.method': 'HTTP method',
  'span_attr:http.method': 'HTTP method',
  'span_attr:http.response.status_code': 'HTTP status',
  'span_attr:http.status_code': 'HTTP status',
  'span_attr:http.route': 'HTTP route',
  'span_attr:http.target': 'HTTP target',
  'span_attr:url.path': 'URL path',
  'span_attr:url.full': 'URL',
  'span_attr:db.system': 'DB system',
  'span_attr:db.statement': 'DB statement',
  'span_attr:db.query.text': 'DB query',
  'span_attr:db.name': 'DB name',
  'span_attr:rpc.system': 'RPC system',
  'span_attr:rpc.method': 'RPC method',
  'span_attr:rpc.service': 'RPC service',
  'span_attr:rpc.grpc.status_code': 'gRPC status',
  'span_attr:messaging.system': 'Messaging system',
  'span_attr:messaging.operation': 'Messaging operation',
  'span_attr:messaging.destination.name': 'Messaging destination',
  'resource_attr:service.namespace': 'Service namespace',
  'resource_attr:service.version': 'Service version',
  'resource_attr:service.instance.id': 'Service instance',
  'resource_attr:k8s.namespace.name': 'K8s namespace',
  'resource_attr:k8s.pod.name': 'K8s pod',
  'resource_attr:k8s.deployment.name': 'K8s deployment',
  'resource_attr:k8s.node.name': 'K8s node',
  'resource_attr:host.name': 'Host',
  status_code: 'Status code',
  status_message: 'Status message',
  kind: 'Span kind',
  span_id: 'Span ID',
  parent_span_id: 'Parent span ID',
  scope_name: 'Scope',
  scope_version: 'Scope version',
};

/** Fields worth offering first when adding a column. */
export const COMMON_FIELDS: readonly string[] = [
  'span_attr:http.request.method',
  'span_attr:http.response.status_code',
  'span_attr:http.route',
  'span_attr:url.path',
  'span_attr:db.system',
  'span_attr:db.statement',
  'span_attr:rpc.system',
  'span_attr:rpc.method',
  'span_attr:messaging.system',
  'resource_attr:service.namespace',
  'resource_attr:k8s.namespace.name',
  'resource_attr:k8s.pod.name',
  'status_code',
  'kind',
];

const STORAGE_PREFIX = /^(span_attr:|resource_attr:|event:event_attr:)/;

export function traceFieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field.replace(STORAGE_PREFIX, '');
}

/** Frame columns carrying a custom field are named "attr:<field>". */
export const ATTR_COLUMN_PREFIX = 'attr:';

export function attrColumnKey(field: string): string {
  return `${ATTR_COLUMN_PREFIX}${field}`;
}

export function fieldFromAttrColumnKey(key: string): string {
  return key.startsWith(ATTR_COLUMN_PREFIX) ? key.slice(ATTR_COLUMN_PREFIX.length) : key;
}
