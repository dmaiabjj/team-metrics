import { KPI_META, DORA_LEVELS } from './constants';

// ─── FORMAT VALUE ──────────────────────────────────────────────────────────
export function fmt(kpiKey, value) {
  if (value == null) return '—';
  const m = KPI_META[kpiKey];
  if (!m) return String(value);
  if (m.unit === '%') return `${(value * 100).toFixed(1)}%`;
  if (m.unit === '/d') return `${value.toFixed(2)}/d`;
  if (m.unit === 'd') return `${value.toFixed(1)}d`;
  if (m.unit === 'h') return `${Math.round(value)}h`;
  return value.toFixed(2);
}

// Format for DORA UI (lead_time in hours to match kpi_report)
export function fmtDora(kpiKey, value) {
  if (value == null) return '—';
  const m = KPI_META[kpiKey];
  if (!m) return String(value);
  if (kpiKey === 'lead_time' && m.displayUnit === 'h') {
    return `${Math.round(value * 24)}h`;
  }
  return fmt(kpiKey, value);
}

// ─── RAG STATUS from API → UI status ─────────────────────────────────────
const RAG_TO_STATUS = { green: 'good', amber: 'warn', red: 'bad' };

export function ragToStatus(rag) {
  return RAG_TO_STATUS[rag] || 'unknown';
}

// ─── KPI STATUS (good / warn / bad / unknown) ─────────────────────────────
export function kpiStatus(kpiKey, value) {
  if (value == null) return 'unknown';
  const m = KPI_META[kpiKey];
  if (!m) return 'unknown';
  const { good, warn } = m.thresholds;
  if (m.lower_better) {
    if (value <= good) return 'good';
    if (value <= warn) return 'warn';
    return 'bad';
  }
  if (value >= good) return 'good';
  if (value >= warn) return 'warn';
  return 'bad';
}

// ─── KPI COLOR ─────────────────────────────────────────────────────────────
const STATUS_COLORS = {
  good: '#10b981',
  warn: '#f59e0b',
  bad: '#ef4444',
  unknown: '#64748b',
};

export function kpiColor(kpiKey, value) {
  return STATUS_COLORS[kpiStatus(kpiKey, value)] ?? STATUS_COLORS.unknown;
}

export function statusColor(status) {
  return STATUS_COLORS[status] ?? STATUS_COLORS.unknown;
}

// ─── DORA LEVEL ────────────────────────────────────────────────────────────
export function doraLevel(kpiKey, value) {
  if (value == null) return null;
  const levels = DORA_LEVELS[kpiKey];
  if (!levels) return null;
  if (kpiKey === 'deploy_frequency') {
    return levels.find((l) => value >= l.min) ?? levels[levels.length - 1];
  }
  if (kpiKey === 'lead_time') {
    // DORA_LEVELS use hours (max: 1, 24, 168); API returns days
    const valueHours = value * 24;
    return levels.find((l) => valueHours <= l.max) ?? levels[levels.length - 1];
  }
  return null;
}

// ─── DATE FORMATTING ───────────────────────────────────────────────────────
export function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtDateTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── SEEDED HASH (for avatar colors) ──────────────────────────────────────
export function seed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// ─── EXTRACT VALUE FROM team_metrics API responses ───────────────────────
// team_metrics KPIs use `name` field (not kpi_name)
export function valFromKpis(kpis, kpiKey) {
  if (!kpis) return null;
  const entry = kpis.find((k) => k.name === kpiKey);
  return entry?.value ?? null;
}

// ─── EXTRACT RAG STATUS FROM team_metrics API responses ─────────────────
export function ragFromKpis(kpis, kpiKey) {
  if (!kpis) return null;
  const entry = kpis.find((k) => k.name === kpiKey);
  return entry?.rag ?? null;
}

// ─── RAG → COLOR (uses backend-computed RAG directly) ───────────────────
const RAG_COLORS = { green: '#10b981', amber: '#f59e0b', red: '#ef4444' };

export function ragColor(rag) {
  return RAG_COLORS[rag] ?? '#64748b';
}
