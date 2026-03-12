// ─── TEAMS ──────────────────────────────────────────────────────────────────
export const TEAMS = [
  'domain-tooling-services',
  'game-services',
  'payment-services',
  'player-engagement-services',
  'rules-engine',
];

export const TEAM_LABELS = {
  'domain-tooling-services': 'Domain Tooling',
  'game-services': 'Game Services',
  'payment-services': 'Payment Services',
  'player-engagement-services': 'Player Engagement',
  'rules-engine': 'Rules Engine',
};

export const TEAM_COLORS = {
  'domain-tooling-services': '#f472b6',
  'game-services': '#a78bfa',
  'payment-services': '#34d399',
  'player-engagement-services': '#fbbf24',
  'rules-engine': '#60a5fa',
};

export const TEAM_ICONS = {
  'domain-tooling-services': '🔧',
  'game-services': '🎮',
  'payment-services': '💳',
  'player-engagement-services': '👥',
  'rules-engine': '⚙️',
};

// ─── KPI METADATA ──────────────────────────────────────────────────────────
export const KPI_META = {
  rework_rate: {
    label: 'Rework Rate',
    icon: '↩',
    formula: 'items_with_rework / items_reached_qa',
    desc: 'Percentage of QA items bounced back to development',
    unit: '%',
    lower_better: true,
    thresholds: { good: 0.10, warn: 0.15 },
  },
  delivery_predictability: {
    label: 'Delivery Predictability',
    icon: '🎯',
    formula: 'items_deployed / items_committed',
    desc: 'Ratio of delivered items to committed items',
    unit: '%',
    lower_better: false,
    thresholds: { good: 0.85, warn: 0.70 },
  },
  tech_debt_ratio: {
    label: 'Tech Debt Investment',
    icon: '🏚',
    formula: 'tech_debt_count / total_deployed',
    desc: 'Percentage of deployed items that address technical debt',
    unit: '%',
    lower_better: false,
    thresholds: { good: 0.20, warn: 0.10 },
  },
  wip_discipline: {
    label: 'WIP Discipline',
    icon: '📊',
    formula: 'compliant_hours / total_hours',
    desc: 'Per-developer time-weighted WIP compliance',
    unit: '%',
    lower_better: false,
    thresholds: { good: 0.80, warn: 0.60 },
  },
  flow_hygiene: {
    label: 'Flow Hygiene',
    icon: '🌊',
    formula: 'avg_items / limit (per status)',
    desc: 'Queue load relative to limits — >1.0 means bottleneck',
    unit: '',
    lower_better: true,
    thresholds: { good: 1.0, warn: 1.2 },
  },
  initiative_delivery: {
    label: 'Initiative Delivery',
    icon: '🚩',
    formula: 'initiatives_delivered / initiatives_committed',
    desc: 'Percentage of committed initiatives (Epics/Features) delivered',
    unit: '%',
    lower_better: false,
    thresholds: { good: 0.85, warn: 0.70 },
  },
  reliability_action_delivery: {
    label: 'Reliability Actions',
    icon: '🛡',
    formula: 'reliability_actions_sla_met / reliability_actions_delivered',
    desc: 'Post-mortem action items delivered within SLA',
    unit: '%',
    lower_better: false,
    thresholds: { good: 0.85, warn: 0.70 },
  },
  deploy_frequency: {
    label: 'Deploy Frequency',
    icon: '🚀',
    formula: 'total_deployments / period_days',
    desc: 'Production deployments per day',
    unit: '/d',
    lower_better: false,
    thresholds: { good: 1.0, warn: 0.25 },
  },
  lead_time: {
    label: 'Lead Time',
    icon: '⏱',
    formula: 'avg(active_entered -> prod_deploy)',
    desc: 'Avg time active → production',
    unit: 'd',
    displayUnit: 'h', // show hours in DORA UI to match kpi_report
    lower_better: true,
    thresholds: { good: 7, warn: 14 },
  },
};

export const KPI_KEYS = [
  'rework_rate',
  'delivery_predictability',
  'tech_debt_ratio',
  'wip_discipline',
  'flow_hygiene',
  'initiative_delivery',
  'reliability_action_delivery',
];
export const DORA_KEYS = ['deploy_frequency', 'lead_time'];
export const ALL_KPI_KEYS = [...KPI_KEYS, ...DORA_KEYS];

// KPI name → URL slug (hyphens)
export const KPI_SLUG = {
  rework_rate: 'rework-rate',
  delivery_predictability: 'delivery-predictability',
  tech_debt_ratio: 'tech-debt-ratio',
  wip_discipline: 'wip-discipline',
  flow_hygiene: 'flow-hygiene',
  initiative_delivery: 'initiative-delivery',
  reliability_action_delivery: 'reliability-action-delivery',
  deploy_frequency: 'deploy-frequency',
  lead_time: 'lead-time',
};

// Reverse: slug → kpi name
export const SLUG_TO_KPI = Object.fromEntries(
  Object.entries(KPI_SLUG).map(([k, v]) => [v, k])
);

export const DORA_LEVELS = {
  deploy_frequency: [
    { label: 'Elite', color: '#10b981', min: 1.0, desc: 'Multiple deploys per day' },
    { label: 'High', color: '#34d399', min: 0.14, desc: 'Between once per day and once per week' },
    { label: 'Medium', color: '#f59e0b', min: 0.033, desc: 'Between once per week and once per month' },
    { label: 'Low', color: '#ef4444', min: 0, desc: 'Less than once per month' },
  ],
  lead_time: [
    { label: 'Elite', color: '#10b981', max: 1, desc: 'Less than one hour' },
    { label: 'High', color: '#34d399', max: 24, desc: 'Between one hour and one day' },
    { label: 'Medium', color: '#f59e0b', max: 168, desc: 'Between one day and one week' },
    { label: 'Low', color: '#ef4444', max: Infinity, desc: 'More than one week' },
  ],
};
