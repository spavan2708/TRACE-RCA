// Display ranges match the synthetic generator. Only percentages and nonnegative
// values are constrained; values beyond training ranges receive a warning.
export const FEATURES = [
  { key: 'cpu_usage', label: 'CPU usage', unit: '%', min: 0, max: 100, range: [0, 100], group: 'compute' },
  { key: 'memory_usage', label: 'Memory usage', unit: '%', min: 0, max: 100, range: [0, 100], group: 'compute' },
  { key: 'disk_usage', label: 'Disk usage', unit: '%', min: 0, max: 100, range: [0, 100], group: 'compute' },
  { key: 'network_latency', label: 'Network latency', unit: 'ms', min: 0, range: [1, 1000], group: 'network' },
  { key: 'request_rate', label: 'Request rate', unit: 'req/s', min: 0, range: [0, 2000], group: 'network' },
  { key: 'response_time', label: 'Response time', unit: 'ms', min: 0, range: [1, 5000], group: 'network' },
  { key: 'error_rate', label: 'Error rate', unit: '%', min: 0, max: 100, range: [0, 100], group: 'runtime' },
  { key: 'service_restarts', label: 'Service restarts', unit: 'count', min: 0, integer: true, range: [0, 50], group: 'runtime' },
  { key: 'queue_length', label: 'Queue length', unit: 'count', min: 0, range: [0, 1000], group: 'runtime' },
  { key: 'db_connections', label: 'DB connections', unit: 'count', min: 0, range: [0, 300], group: 'runtime' },
];

export const CLASSES = ['CPU Saturation', 'Database Connection Exhaustion', 'Memory Leak', 'Network Latency', 'Service Crash'];
export const DEFAULT_SAMPLE = {
  cpu_usage: 40, memory_usage: 55, network_latency: 50, request_rate: 100,
  error_rate: 90, response_time: 400, db_connections: 30, disk_usage: 55,
  service_restarts: 8, queue_length: 20,
};
const baseline = { cpu_usage: 45, memory_usage: 50, network_latency: 45, request_rate: 250, error_rate: 2, response_time: 180, db_connections: 45, disk_usage: 55, service_restarts: 0, queue_length: 25 };
export const PRESETS = {
  crash: { ...DEFAULT_SAMPLE },
  cpu: { ...baseline, cpu_usage: 95, response_time: 360, queue_length: 60, error_rate: 5 },
  memory: { ...baseline, memory_usage: 96, response_time: 255, service_restarts: 1, disk_usage: 63 },
  network: { ...baseline, network_latency: 325, response_time: 400, error_rate: 6 },
  database: { ...baseline, db_connections: 175, response_time: 330, error_rate: 10, queue_length: 50 },
};

// UI heuristics, not feature attribution or learned model explanations.
// All thresholds are inclusive and are shown alongside each observation.
export const SIGNAL_RULES = [
  { key: 'cpu_usage', threshold: 85, label: 'Elevated CPU usage' },
  { key: 'memory_usage', threshold: 85, label: 'Elevated memory usage' },
  { key: 'disk_usage', threshold: 85, label: 'Elevated disk usage' },
  { key: 'network_latency', threshold: 200, label: 'Elevated network latency' },
  { key: 'error_rate', threshold: 10, label: 'Elevated error rate' },
  { key: 'response_time', threshold: 350, label: 'Elevated response time' },
  { key: 'service_restarts', threshold: 3, label: 'Repeated service restarts' },
  { key: 'queue_length', threshold: 60, label: 'Elevated queue length' },
  { key: 'db_connections', threshold: 140, label: 'Elevated connection count' },
];

export const GUIDANCE = {
  'CPU Saturation': ['Inspect CPU-intensive processes and profile hot paths.', 'Compare request volume with recent workload changes.', 'Review resource limits and autoscaling thresholds.'],
  'Memory Leak': ['Inspect heap growth and memory usage over time.', 'Review long-lived allocations and retained objects.', 'Compare recent deployments with the start of memory growth.'],
  'Network Latency': ['Compare upstream and downstream dependency latency.', 'Inspect network errors, retries, and timeouts.', 'Review recent routing or dependency changes.'],
  'Database Connection Exhaustion': ['Inspect connection pool utilization and limits.', 'Review long-running queries and open transactions.', 'Check for leaked or idle connections.'],
  'Service Crash': ['Inspect service logs around restart timestamps.', 'Review exception traces and repeated restart loops.', 'Compare recent deployments and configuration changes.'],
};

export function validateValue(feature, raw) {
  if (raw === '' || raw === null || raw === undefined) return 'A value is required.';
  const value = Number(raw);
  if (!Number.isFinite(value)) return 'Enter a finite number.';
  if (value < feature.min) return `Must be at least ${feature.min}.`;
  if (feature.max !== undefined && value > feature.max) return `Must not exceed ${feature.max}.`;
  if (feature.integer && !Number.isInteger(value)) return 'Enter a whole number.';
  return '';
}

export function validPrediction(value) {
  if (!value || !CLASSES.includes(value.root_cause) || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) return false;
  const probabilities = value.probabilities;
  if (!probabilities || typeof probabilities !== 'object' || Object.keys(probabilities).length !== CLASSES.length) return false;
  if (!CLASSES.every(name => Number.isFinite(probabilities[name]) && probabilities[name] >= 0 && probabilities[name] <= 1)) return false;
  const sum = Object.values(probabilities).reduce((total, p) => total + p, 0);
  return Math.abs(sum - 1) < 0.001
    && Math.abs(probabilities[value.root_cause] - value.confidence) < 0.00001
    && value.confidence >= Math.max(...Object.values(probabilities)) - 0.00001;
}

export function validRecord(record) {
  return record && typeof record.id === 'string' && record.id.length <= 100
    && typeof record.timestamp === 'string' && Number.isFinite(Date.parse(record.timestamp))
    && Number.isFinite(record.duration_ms) && record.duration_ms >= 0
    && validPrediction(record.result) && record.telemetry && FEATURES.every(feature =>
      typeof record.telemetry[feature.key] === 'number' && !validateValue(feature, record.telemetry[feature.key]));
}
