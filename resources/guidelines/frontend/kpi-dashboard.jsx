import { useState, useEffect } from "react";

const BASE_URL = "http://localhost:8000";
const TEAMS = ["domain-tooling-services","game-services","payment-services","player-engagement-services","rules-engine"];
const TEAM_LABELS = {"domain-tooling-services":"Domain Tooling","game-services":"Game Services","payment-services":"Payment Services","player-engagement-services":"Player Engagement","rules-engine":"Rules Engine"};
const TEAM_COLORS = {"domain-tooling-services":"#6366f1","game-services":"#10b981","payment-services":"#f59e0b","player-engagement-services":"#ec4899","rules-engine":"#3b82f6"};
const TEAM_ICONS = {"domain-tooling-services":"⚙️","game-services":"🎮","payment-services":"💳","player-engagement-services":"🎯","rules-engine":"⚡"};

const KPI_META = {
  rework_rate:{ label:"Rework Rate", icon:"↩", unit:"%", desc:"Tasks returned from QA", formula:"tasks_with_rework / tasks_in_qa", lower_better:true, thresholds:{good:0.1,warn:0.2} },
  delivery_predictability:{ label:"Delivery Predictability", icon:"🎯", unit:"%", desc:"Delivered vs committed", formula:"delivered / committed", lower_better:false, thresholds:{good:0.85,warn:0.7} },
  wip_discipline:{ label:"WIP Discipline", icon:"⏳", unit:"%", desc:"Time within WIP limits", formula:"compliant_hours / total_hours", lower_better:false, thresholds:{good:0.8,warn:0.6} },
  flow_hygiene:{ label:"Flow Hygiene", icon:"🌊", unit:"×", desc:"Queue load vs limit", formula:"avg_items / limit", lower_better:true, thresholds:{good:0.7,warn:1.0} },
  tech_debt_ratio:{ label:"Tech Debt Ratio", icon:"🏚", unit:"%", desc:"Tech debt vs total delivered", formula:"tech_debt_deployed / total_deployed", lower_better:true, thresholds:{good:0.15,warn:0.3} },
  spillover:{ label:"Spillover", icon:"📤", unit:"%", desc:"Items carried to next period", formula:"spillover_count / total_items", lower_better:true, thresholds:{good:0.1,warn:0.25} },
  deployment_frequency:{ label:"Deploy Frequency", icon:"🚀", unit:"/day", desc:"Production deployments per day", formula:"total_deployments / period_days", lower_better:false, thresholds:{good:0.5,warn:0.2} },
  lead_time:{ label:"Lead Time", icon:"⏱", unit:"h", desc:"Avg time active → production", formula:"avg(active_entered → prod_deploy)", lower_better:true, thresholds:{good:48,warn:96} },
};

// ─── MOCK DATA ────────────────────────────────────────────────────────────────
let USE_MOCK = true;

const MOCK_DEVELOPERS = ["Alice Chen","Bob Martinez","Clara Singh","David Kim","Emma Johansson","Faisal Al-Amin","Grace Lee","Hiro Tanaka"];
const MOCK_QA = ["Priya Nair","Sam Osei","Tomás Reyes","Yuki Mori"];
const ITEM_TYPES = ["User Story","Bug","Task","User Story","User Story","Bug"];
const STATUSES_START = ["Active","Backlog","Active","Backlog","Active"];
const MOCK_EPICS = ["Player Onboarding V2","Core Platform Stability","Tech Debt Reduction Q1","Authentication Overhaul","Analytics Pipeline","Performance Improvements"];
const MOCK_FEATURES = ["User Authentication","Payment Flow","Dashboard UI","Event System","Search Engine","Notification Service","Data Export","API Gateway"];
const MOCK_COMMENTS = [
  "Reviewed PR, needs minor adjustments to error handling.",
  "Blocked on external dependency — waiting for infra team.",
  "QA found edge case with empty arrays. Returning to dev.",
  "Merged and deployed to staging. Awaiting sign-off.",
  "Performance regressed slightly. Added caching layer.",
  "Design clarification needed before proceeding.",
];
const MOCK_TITLES = [
  "Implement OAuth2 token refresh flow","Fix race condition in payment processor","Add retry logic to event publisher",
  "Migrate legacy config to env vars","Improve error messages in API responses","Add pagination to work items endpoint",
  "Refactor auth middleware","Fix memory leak in worker pool","Add feature flag for new checkout UI",
  "Update dependency versions","Improve CI pipeline speed","Write integration tests for billing module",
  "Add monitoring dashboards for new services","Fix timezone handling in reports","Implement bulk import endpoint",
  "Add rate limiting to public API","Fix flaky test in user service","Improve search indexing performance",
  "Migrate DB schema for user preferences","Add webhook support for order events","Fix 500 error on empty cart checkout",
  "Implement dark mode toggle","Add CSV export to analytics page","Refactor game state machine","Fix leaderboard ranking bug",
  "Add push notification support","Improve onboarding flow","Fix login redirect loop","Add audit logging",
  "Implement GDPR data export","Fix broken pagination in admin panel","Add A/B test for new pricing page",
];

const rand = (min, max) => Math.random() * (max - min) + min;
const randInt = (min, max) => Math.floor(rand(min, max + 1));
const pick = (arr) => arr[randInt(0, arr.length - 1)];
const seed = (str) => { let h = 0; for (const c of str) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0; return Math.abs(h); };
const seededRand = (s, min, max) => { const x = Math.sin(s) * 10000; return min + (x - Math.floor(x)) * (max - min); };

const TEAM_PROFILES = {
  "domain-tooling-services": { rework:0.08, predict:0.91, wip:0.87, flow:0.55, debt:0.12, spill:0.09, deploy:0.71, lead:38 },
  "game-services":            { rework:0.19, predict:0.74, wip:0.62, flow:0.98, debt:0.28, spill:0.22, deploy:0.32, lead:82 },
  "payment-services":         { rework:0.06, predict:0.95, wip:0.92, flow:0.42, debt:0.09, spill:0.07, deploy:0.88, lead:28 },
  "player-engagement-services":{ rework:0.24, predict:0.67, wip:0.55, flow:1.18, debt:0.35, spill:0.30, deploy:0.18, lead:110 },
  "rules-engine":             { rework:0.13, predict:0.82, wip:0.76, flow:0.72, debt:0.20, spill:0.16, deploy:0.55, lead:52 },
};

const jitter = (val, pct = 0.08) => Math.max(0, val + val * (Math.random() * pct * 2 - pct));

function makeSummary(team) {
  const p = TEAM_PROFILES[team] || TEAM_PROFILES["game-services"];
  const committed = randInt(18, 32);
  const delivered = Math.round(committed * jitter(p.predict, 0.05));
  const totalItems = randInt(25, 45);
  const spillCount = Math.round(totalItems * jitter(p.spill, 0.1));
  const inQA = randInt(8, 18);
  const reworkCount = Math.round(inQA * jitter(p.rework, 0.1));
  const totalDeployed = delivered;
  const debtCount = Math.round(totalDeployed * jitter(p.debt, 0.1));
  return {
    team_project: team,
    rework_rate: { rate: reworkCount / Math.max(inQA, 1), tasks_with_rework: reworkCount, tasks_in_qa: inQA },
    delivery_predictability: { rate: delivered / Math.max(committed, 1), delivered, committed },
    wip_discipline: { compliance_rate: jitter(p.wip, 0.06) },
    flow_hygiene: { overall_ratio: jitter(p.flow, 0.08) },
    tech_debt_ratio: { ratio: debtCount / Math.max(totalDeployed, 1), tech_debt_count: debtCount, total_deployed: totalDeployed },
    spillover: { rate: spillCount / Math.max(totalItems, 1), spillover_count: spillCount, total_items: totalItems },
    deployment_frequency: { deployments_per_day: jitter(p.deploy, 0.1), total_deployments: randInt(3, 18), period_days: 14 },
    lead_time: { avg_hours: jitter(p.lead, 0.12), median_hours: jitter(p.lead * 0.9, 0.1), p90_hours: jitter(p.lead * 1.5, 0.1), sample_size: delivered },
  };
}

// Build a stable work item given team + index (seeded so same ID always same data)
function makeWorkItem(team, i) {
  const p = TEAM_PROFILES[team] || TEAM_PROFILES["game-services"];
  const s = seed(`${team}-wi-${i}`);
  const isDelivered = seededRand(s, 0, 1) > 0.35;
  const isSpill = seededRand(s + 1, 0, 1) < p.spill;
  const hasRework = seededRand(s + 2, 0, 1) < p.rework;
  const isDebt = seededRand(s + 3, 0, 1) < p.debt;
  const statusEnd = isDelivered ? "Done" : ["Active","InQA","Blocked","Active","InQA"][i % 5];
  const type = ITEM_TYPES[i % ITEM_TYPES.length];
  const dev = MOCK_DEVELOPERS[i % MOCK_DEVELOPERS.length];
  const qa = MOCK_QA[i % MOCK_QA.length];
  const leadHours = isDelivered ? jitter(p.lead, 0.4) : null;
  const epicTitle = isDebt ? "Tech Debt Reduction Q1" : MOCK_EPICS[i % MOCK_EPICS.length];
  const featureTitle = MOCK_FEATURES[i % MOCK_FEATURES.length];
  const epicId = 5000 + (i % 10) * 100;
  const featureId = 6000 + (i % 8) * 100;
  // Parent points to another real work item in the same pool (only for non-top-level items)
  const hasParent = i % 3 !== 0; // every 3rd item is a top-level item with no parent
  const parentIdx = (i + 7) % 30;
  const parentId = hasParent ? (10000 + seed(`${team}-${parentIdx}`) % 90000) : null;
  const createdAt = new Date(Date.now() - (30 + i * 2) * 86400000).toISOString();
  const activatedAt = new Date(Date.now() - (20 + i) * 86400000).toISOString();
  const closedAt = isDelivered ? new Date(Date.now() - i * 86400000 * 0.5).toISOString() : null;
  // Rework history
  const reworkDetails = hasRework ? Array.from({ length: randInt(1, 3) }, (_, ri) => ({
    bounced_at: new Date(Date.now() - (15 + ri * 3) * 86400000).toISOString(),
    from_status: "In QA",
    to_status: "Active",
    comment: MOCK_COMMENTS[ri % MOCK_COMMENTS.length],
  })) : [];
  // Linked bugs (for rework items or bugs) — fully enriched so they can be navigated to
  const BUG_TITLES = ["Null pointer in handler","Incorrect response code","Memory leak under load","Race condition","Off-by-one error","Missing validation","Timeout on large payloads","Stale cache after update","UI breaks on mobile Safari","Duplicate events on retry"];
  const linkedBugs = (type === "Bug" || hasRework) ? Array.from({ length: randInt(1,3) }, (_, bi) => {
    const bugId = 20000 + seed(`${team}-bug-${i}-${bi}`) % 10000;
    const bugDev = MOCK_DEVELOPERS[(i + bi + 2) % MOCK_DEVELOPERS.length];
    const bugQa  = MOCK_QA[(i + bi) % MOCK_QA.length];
    const bugStatus = bi === 0 ? "Done" : bi === 1 ? "Active" : "InQA";
    const bugCreated = new Date(Date.now() - (25 + bi * 4) * 86400000).toISOString();
    const bugClosed  = bugStatus === "Done" ? new Date(Date.now() - (5 + bi) * 86400000).toISOString() : null;
    return {
      id: bugId,
      title: `Bug: ${BUG_TITLES[(i + bi) % BUG_TITLES.length]}`,
      description: `This bug was introduced during the implementation of "${MOCK_TITLES[i % MOCK_TITLES.length]}". It manifests when the system is under load or receives unexpected input. Reproduction steps: trigger the ${featureTitle} flow with edge-case data.`,
      work_item_type: "Bug",
      canonical_status: bugStatus,
      canonical_status_end: bugStatus,
      canonical_status_start: "Active",
      native_status_end: bugStatus === "Done" ? "Closed" : bugStatus,
      developer: bugDev,
      qa_engineer: bugQa,
      release_manager: MOCK_DEVELOPERS[(i + bi + 5) % MOCK_DEVELOPERS.length],
      is_delivered: bugStatus === "Done",
      is_spillover: false,
      has_rework: false,
      is_tech_debt: false,
      priority: ["Critical","High","Medium"][bi % 3],
      story_points: [1, 2, 1][bi % 3],
      tags: ["bug"],
      epic_id: epicId,
      epic_title: epicTitle,
      feature_id: featureId,
      feature_title: featureTitle,
      parent_id: 10000 + seed(`${team}-${i}`) % 90000,  // points back to the parent task
      parent_title: MOCK_TITLES[i % MOCK_TITLES.length],
      parent_type: type,
      created_at: bugCreated,
      activated_at: bugCreated,
      closed_at: bugClosed,
      lead_time_hours: bugStatus === "Done" ? jitter(12, 0.5) : null,
      rework_details: [],
      linked_bugs: [],
    };
  }) : [];

  return {
    id: 10000 + seed(`${team}-${i}`) % 90000,
    title: MOCK_TITLES[i % MOCK_TITLES.length],
    description: `This work item addresses ${MOCK_TITLES[i % MOCK_TITLES.length].toLowerCase()}. It was identified during sprint planning as a priority item. The implementation requires changes to the ${featureTitle} module and coordination with the ${dev.split(" ")[0]} team.`,
    work_item_type: type,
    canonical_status_start: STATUSES_START[i % STATUSES_START.length],
    canonical_status_end: statusEnd,
    native_status_end: statusEnd === "Done" ? "Closed" : statusEnd === "InQA" ? "In QA" : statusEnd,
    developer: dev,
    qa_engineer: qa,
    release_manager: MOCK_DEVELOPERS[(i + 3) % MOCK_DEVELOPERS.length],
    is_delivered: isDelivered,
    is_spillover: isSpill,
    has_rework: hasRework,
    is_tech_debt: isDebt,
    lead_time_hours: leadHours,
    epic_id: epicId,
    epic_title: epicTitle,
    feature_id: featureId,
    feature_title: featureTitle,
    parent_id: parentId,
    parent_title: hasParent ? MOCK_TITLES[parentIdx % MOCK_TITLES.length] : null,
    parent_type: hasParent ? ITEM_TYPES[parentIdx % ITEM_TYPES.length] : null,
    created_at: createdAt,
    activated_at: activatedAt,
    closed_at: closedAt,
    story_points: [1, 2, 3, 5, 8][i % 5],
    priority: ["Critical","High","Medium","Low"][i % 4],
    tags: isDebt ? ["tech-debt","backend"] : [["frontend","api","database","testing","infra"][i % 5]],
    rework_details: reworkDetails,
    linked_bugs: linkedBugs,
  };
}

function makeWorkItems(team, count = 30) {
  return Array.from({ length: count }, (_, i) => makeWorkItem(team, i));
}

// Build a single work item by ID — searches main items and their linked bugs
function makeWorkItemById(id, team) {
  // Search main items first
  const items = makeWorkItems(team, 50);
  const found = items.find(i => i.id === id);
  if (found) return found;
  // Search linked bugs of all items
  for (const wi of items) {
    const bug = (wi.linked_bugs || []).find(b => b.id === id);
    if (bug) return bug;
  }
  // Try other teams too (bug IDs are global)
  for (const t of ["domain-tooling-services","game-services","payment-services","player-engagement-services","rules-engine"]) {
    if (t === team) continue;
    const tItems = makeWorkItems(t, 50);
    for (const wi of tItems) {
      const bug = (wi.linked_bugs || []).find(b => b.id === id);
      if (bug) return bug;
    }
  }
  return items[0];
}

function makeKpiDetail(kpiKey, team) {
  const summary = makeSummary(team);
  const items = makeWorkItems(team, 20);
  if (kpiKey === "rework_rate") return { ...summary.rework_rate, items: items.filter(i => i.has_rework) };
  if (kpiKey === "delivery_predictability") return { ...summary.delivery_predictability, items: items.filter(i => i.is_delivered) };
  if (kpiKey === "wip_discipline") {
    const wipLimit = 3;
    const devBreakdown = MOCK_DEVELOPERS.slice(0, 6).map((dev, di) => {
      const devItems = items.filter((_, idx) => idx % MOCK_DEVELOPERS.length === di % MOCK_DEVELOPERS.length);
      const activeItems = devItems.filter(i => ["Active","InQA"].includes(i.canonical_status_end));
      // Generate per-status WIP snapshots for this developer
      const wipStatuses = [
        { native_status: "Active",         limit: wipLimit, current_count: Math.max(0, randInt(0, 5)), compliant_hours: randInt(40, 80), total_hours: 80 },
        { native_status: "Code Review",    limit: wipLimit, current_count: Math.max(0, randInt(0, 4)), compliant_hours: randInt(30, 80), total_hours: 80 },
        { native_status: "Code Completed", limit: wipLimit, current_count: Math.max(0, randInt(0, 3)), compliant_hours: randInt(50, 80), total_hours: 80 },
      ];
      const totalCompliant = wipStatuses.reduce((a, s) => a + s.compliant_hours, 0);
      const totalHours = wipStatuses.reduce((a, s) => a + s.total_hours, 0);
      const complianceRate = totalCompliant / totalHours;
      return {
        developer: dev,
        compliance_rate: complianceRate,
        compliant_hours: totalCompliant,
        total_hours: totalHours,
        wip_statuses: wipStatuses,
        items: activeItems,
      };
    });
    const teamCompliance = devBreakdown.reduce((a, d) => a + d.compliance_rate, 0) / devBreakdown.length;
    return {
      compliance_rate: teamCompliance,
      developer_breakdown: devBreakdown,
      total_developers: devBreakdown.length,
      compliant_developers: devBreakdown.filter(d => d.compliance_rate >= 0.8).length,
      items: items.filter(i => ["Active","InQA"].includes(i.canonical_status_end)),
    };
  }
  if (kpiKey === "flow_hygiene") return { ...summary.flow_hygiene, items: items.filter(i => i.canonical_status_end === "InQA") };
  if (kpiKey === "tech_debt_ratio") return { ...summary.tech_debt_ratio, items: items.filter(i => i.is_tech_debt) };
  if (kpiKey === "spillover") return { ...summary.spillover, items: items.filter(i => i.is_spillover) };
  if (kpiKey === "deployment_frequency") return { ...summary.deployment_frequency, deployments: Array.from({length:randInt(3,12)}, (_,i) => ({ id:i+1, pipeline_name:`${TEAM_LABELS[team]} Production Deploy`, run_at:new Date(Date.now()-i*86400000*1.5).toISOString(), status:"succeeded" })) };
  if (kpiKey === "lead_time") return { ...summary.lead_time, items: items.filter(i => i.is_delivered).map(i => ({ ...i, work_item_id:i.id, active_entered_at:new Date(Date.now()-(i.lead_time_hours||48)*3600000*2).toISOString(), deployed_at:new Date(Date.now()-(i.lead_time_hours||48)*3600000).toISOString() })) };
  return {};
}

async function mockApi(path) {
  await new Promise(r => setTimeout(r, 180 + Math.random() * 250));
  const url = new URL("http://x" + path);
  const team = url.searchParams.get("team_project") || "";
  // Single work item
  const wiMatch = url.pathname.match(/\/work-items\/(\d+)/);
  if (wiMatch) return makeWorkItemById(parseInt(wiMatch[1]), team);
  if (url.pathname.includes("/kpi/summary")) return makeSummary(team);
  if (url.pathname.includes("/work-items/")) return { items: makeWorkItems(team, 30), total: 30 };
  const kpiSlugMap = {
    "rework-rate":"rework_rate","delivery-predictability":"delivery_predictability",
    "wip-discipline":"wip_discipline","flow-hygiene":"flow_hygiene",
    "tech-debt-ratio":"tech_debt_ratio","spillover":"spillover",
    "deployment-frequency":"deployment_frequency","lead-time":"lead_time",
  };
  for (const [slug, key] of Object.entries(kpiSlugMap)) {
    if (url.pathname.includes(slug)) return makeKpiDetail(key, team);
  }
  throw new Error("Mock: endpoint not found");
}

const api = async (path) => {
  if (USE_MOCK) return mockApi(path);
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const kpiColor = (key, value) => {
  const m = KPI_META[key];
  if (!m || value == null) return "#64748b";
  const { good, warn } = m.thresholds;
  if (m.lower_better) { if (value<=good) return "#10b981"; if (value<=warn) return "#f59e0b"; return "#ef4444"; }
  else { if (value>=good) return "#10b981"; if (value>=warn) return "#f59e0b"; return "#ef4444"; }
};
const kpiStatus = (key, value) => {
  const m = KPI_META[key];
  if (!m || value == null) return "unknown";
  const { good, warn } = m.thresholds;
  if (m.lower_better) { if (value<=good) return "good"; if (value<=warn) return "warn"; return "bad"; }
  else { if (value>=good) return "good"; if (value>=warn) return "warn"; return "bad"; }
};
const fmt = (key, value) => {
  if (value == null) return "—";
  const m = KPI_META[key];
  if (!m) return String(value);
  if (m.unit==="%") return `${(value*100).toFixed(1)}%`;
  if (m.unit==="×") return `${value.toFixed(2)}×`;
  if (m.unit==="h") return `${Math.round(value)}h`;
  if (m.unit==="/day") return `${value.toFixed(2)}/d`;
  return String(value);
};
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"2-digit"}) : "—";
const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-GB",{day:"numeric",month:"short",year:"2-digit",hour:"2-digit",minute:"2-digit"}) : "—";

const ALL_KPI_KEYS = ["rework_rate","delivery_predictability","wip_discipline","flow_hygiene","tech_debt_ratio","spillover","deployment_frequency","lead_time"];
const KPI_KEYS  = ["rework_rate","delivery_predictability","wip_discipline","flow_hygiene","tech_debt_ratio","spillover"];
const DORA_KEYS = ["deployment_frequency","lead_time"];

const KPI_CATEGORIES = [
  {
    id: "quality",
    label: "System Quality & Stability",
    icon: "🔬",
    color: "#ef4444",
    bg: "#fee2e2",
    keys: ["rework_rate"],
  },
  {
    id: "delivery",
    label: "Flow & Delivery Health",
    icon: "🚦",
    color: "#6366f1",
    bg: "#e0e7ff",
    keys: ["delivery_predictability","wip_discipline","flow_hygiene","spillover"],
  },
  {
    id: "strategic",
    label: "Strategic Investment & Alignment",
    icon: "🏛",
    color: "#f59e0b",
    bg: "#fef3c7",
    keys: ["tech_debt_ratio"],
  },
];

// DORA performance levels per the DORA research benchmarks
const DORA_LEVELS = {
  deployment_frequency: [
    { label:"Elite",  min:1.0,   color:"#10b981", desc:"Multiple deploys per day" },
    { label:"High",   min:0.14,  color:"#6366f1", desc:"Between once per day and once per week" },
    { label:"Medium", min:0.033, color:"#f59e0b", desc:"Between once per week and once per month" },
    { label:"Low",    min:0,     color:"#ef4444", desc:"Less than once per month" },
  ],
  lead_time: [
    { label:"Elite",  max:1,    color:"#10b981", desc:"Less than one hour" },
    { label:"High",   max:24,   color:"#6366f1", desc:"Between one hour and one day" },
    { label:"Medium", max:168,  color:"#f59e0b", desc:"Between one day and one week" },
    { label:"Low",    max:99999,color:"#ef4444", desc:"More than one week" },
  ],
};

function doraLevel(kpiKey, value) {
  if (value == null) return null;
  const levels = DORA_LEVELS[kpiKey];
  if (!levels) return null;
  if (kpiKey === "deployment_frequency") {
    for (const l of levels) { if (value >= l.min) return l; }
    return levels[levels.length - 1];
  }
  if (kpiKey === "lead_time") {
    for (const l of levels) { if (value <= l.max) return l; }
    return levels[levels.length - 1];
  }
  return null;
}
const valFromSummary = (summary, k) => {
  if (!summary || summary.error) return null;
  if (k==="rework_rate") return summary.rework_rate?.rate;
  if (k==="delivery_predictability") return summary.delivery_predictability?.rate;
  if (k==="wip_discipline") return summary.wip_discipline?.compliance_rate;
  if (k==="flow_hygiene") return summary.flow_hygiene?.overall_ratio;
  if (k==="tech_debt_ratio") return summary.tech_debt_ratio?.ratio;
  if (k==="spillover") return summary.spillover?.rate;
  if (k==="deployment_frequency") return summary.deployment_frequency?.deployments_per_day;
  if (k==="lead_time") return summary.lead_time?.avg_hours;
  return null;
};
const KPI_SLUG = {
  rework_rate:"rework-rate", delivery_predictability:"delivery-predictability",
  wip_discipline:"wip-discipline", flow_hygiene:"flow-hygiene",
  tech_debt_ratio:"tech-debt-ratio", spillover:"spillover",
  deployment_frequency:"dora/deployment-frequency", lead_time:"dora/lead-time",
};

// ─── HOOKS ────────────────────────────────────────────────────────────────────
function useKpiSummary(team, start, end) {
  const [data,setData]=useState(null); const [loading,setLoading]=useState(false); const [error,setError]=useState(null);
  useEffect(()=>{ if(!team||!start||!end) return; setLoading(true); setError(null); setData(null);
    api(`/api/v1/kpi/summary?team_project=${team}&period_start=${start}&period_end=${end}`)
      .then(setData).catch(e=>setError(e.message)).finally(()=>setLoading(false));
  },[team,start,end]);
  return {data,loading,error};
}
function useWorkItems(team, start, end, extra={}) {
  const [data,setData]=useState(null); const [loading,setLoading]=useState(false); const [error,setError]=useState(null);
  const extraStr=JSON.stringify(extra);
  useEffect(()=>{ if(!team||!start||!end) return; setLoading(true); setError(null); setData(null);
    const q=new URLSearchParams({team_project:team,period_start:start,period_end:end,page:1,page_size:100,...extra});
    api(`/api/v1/work-items/?${q}`).then(setData).catch(e=>setError(e.message)).finally(()=>setLoading(false));
  },[team,start,end,extraStr]);
  return {data,loading,error};
}
function useWorkItemDetail(id, team, start, end) {
  const [data,setData]=useState(null); const [loading,setLoading]=useState(false); const [error,setError]=useState(null);
  useEffect(()=>{ if(!id||!team) return; setLoading(true); setError(null); setData(null);
    api(`/api/v1/work-items/${id}?team_project=${team}&period_start=${start}&period_end=${end}`)
      .then(setData).catch(e=>setError(e.message)).finally(()=>setLoading(false));
  },[id,team,start,end]);
  return {data,loading,error};
}
function useKpiDetail(kpiKey, team, start, end) {
  const [data,setData]=useState(null); const [loading,setLoading]=useState(false); const [error,setError]=useState(null);
  useEffect(()=>{ if(!kpiKey||!team||!start||!end) return; setLoading(true); setError(null); setData(null);
    const slug=KPI_SLUG[kpiKey]||kpiKey;
    // WIP discipline needs developer breakdown
    const extra = kpiKey==="wip_discipline" ? "&include_developer_breakdown=true&include_items=true" : "&include_items=true";
    api(`/api/v1/kpi/${slug}?team_project=${team}&period_start=${start}&period_end=${end}${extra}`)
      .then(setData).catch(e=>setError(e.message)).finally(()=>setLoading(false));
  },[kpiKey,team,start,end]);
  return {data,loading,error};
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,400;0,500;1,400&family=Outfit:wght@300;400;500;600;700;800;900&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
:root{
  --bg:#f0eff4;
  --surface:#ffffff;
  --surface2:#f7f6fb;
  --surface3:#ede9f7;
  --border:#e8e4f0;
  --border2:#d4cee8;
  --text:#1a1630;
  --text2:#4a4568;
  --muted:#9490b0;
  --accent:#7c6af7;
  --accent2:#a89af8;
  --accent-soft:#ede9ff;
  --good:#10b981;
  --good-soft:#d1fae5;
  --warn:#f59e0b;
  --warn-soft:#fef3c7;
  --bad:#ef4444;
  --bad-soft:#fee2e2;
  --sidebar:#1e1b2e;
  --sidebar-text:#9490b0;
  --sidebar-active:#ffffff;
  --grad-start:#ff6b8a;
  --grad-end:#ff9472;
  --font-head:'Outfit',sans-serif;
  --font-mono:'DM Mono',monospace;
  --shadow-sm:0 1px 4px rgba(60,40,120,0.07);
  --shadow-md:0 4px 16px rgba(60,40,120,0.10);
  --shadow-lg:0 8px 32px rgba(60,40,120,0.14);
  --radius:16px;
  --radius-sm:10px;
}
body{background:var(--bg);color:var(--text);font-family:var(--font-head);min-height:100vh;overflow-x:hidden;}
::-webkit-scrollbar{width:4px;height:4px;}
::-webkit-scrollbar-track{background:transparent;}
::-webkit-scrollbar-thumb{background:var(--border2);border-radius:4px;}

/* ── SHELL ── */
.shell{display:flex;min-height:100vh;}

/* ── SIDEBAR ── */
.sidebar{
  width:64px;min-height:100vh;background:var(--sidebar);
  display:flex;flex-direction:column;align-items:center;
  padding:16px 0;position:sticky;top:0;height:100vh;
  overflow:hidden;flex-shrink:0;gap:4px;z-index:30;
  transition:width 0.25s cubic-bezier(0.4,0,0.2,1);
}
.sidebar.expanded{width:220px;align-items:stretch;}
.sidebar-logo{
  width:36px;height:36px;border-radius:10px;
  background:var(--accent);display:flex;align-items:center;justify-content:center;
  font-size:16px;font-weight:900;color:#fff;flex-shrink:0;
  box-shadow:0 4px 12px rgba(124,106,247,0.45);
  transition:all 0.25s;
}
.sidebar-logo-wrap{
  display:flex;align-items:center;gap:10px;
  padding:0 14px;margin-bottom:16px;overflow:hidden;
  flex-shrink:0;
}
.sidebar.expanded .sidebar-logo-wrap{padding:0 14px;}
.sidebar:not(.expanded) .sidebar-logo-wrap{padding:0;justify-content:center;}
.sidebar-brand{
  font-size:15px;font-weight:900;color:#fff;letter-spacing:0.04em;
  white-space:nowrap;opacity:0;transition:opacity 0.15s;pointer-events:none;
}
.sidebar.expanded .sidebar-brand{opacity:1;}
.sidebar-sep{
  height:1px;background:#ffffff12;margin:6px 0;flex-shrink:0;
  transition:all 0.25s;
}
.sidebar.expanded .sidebar-sep{margin:6px 14px;}
.sidebar:not(.expanded) .sidebar-sep{width:28px;}
.sidebar-section{
  font-size:9px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;
  color:#ffffff30;padding:8px 18px 4px;white-space:nowrap;
  opacity:0;height:0;overflow:hidden;transition:opacity 0.15s,height 0.2s;
}
.sidebar.expanded .sidebar-section{opacity:1;height:auto;}
.nav-icon{
  display:flex;align-items:center;gap:10px;
  border-radius:10px;cursor:pointer;color:var(--sidebar-text);
  transition:all 0.15s;flex-shrink:0;position:relative;
  white-space:nowrap;overflow:hidden;
}
.sidebar:not(.expanded) .nav-icon{
  width:40px;height:40px;justify-content:center;
  margin:0 auto;padding:0;
}
.sidebar.expanded .nav-icon{
  padding:9px 14px;margin:0 8px;
  width:auto;height:auto;
}
.nav-icon:hover{background:#ffffff12;color:#fff;}
.nav-icon.active{background:var(--accent);color:#fff;box-shadow:0 4px 12px rgba(124,106,247,0.4);}
.nav-icon-symbol{font-size:16px;line-height:1;flex-shrink:0;}
.nav-icon-label{
  font-size:12px;font-weight:600;opacity:0;
  transition:opacity 0.1s;pointer-events:none;flex:1;min-width:0;
  overflow:hidden;text-overflow:ellipsis;
}
.sidebar.expanded .nav-icon-label{opacity:1;}
.nav-icon .tooltip{
  position:absolute;left:calc(100% + 10px);top:50%;transform:translateY(-50%);
  background:var(--sidebar);color:#fff;font-size:11px;font-weight:600;
  padding:4px 10px;border-radius:6px;white-space:nowrap;pointer-events:none;
  opacity:0;transition:opacity 0.15s;z-index:100;font-family:var(--font-head);
  border:1px solid #ffffff18;
}
.sidebar:not(.expanded) .nav-icon:hover .tooltip{opacity:1;}
.nav-dot-sm{width:6px;height:6px;border-radius:50%;position:absolute;top:8px;right:8px;flex-shrink:0;}
.sidebar.expanded .nav-dot-sm{position:static;margin-left:auto;}
.sidebar-toggle{
  margin-top:auto;padding:10px 0 4px;flex-shrink:0;
  display:flex;justify-content:center;
  transition:all 0.25s;
}
.sidebar.expanded .sidebar-toggle{justify-content:flex-end;padding-right:14px;}
.sidebar-toggle-btn{
  width:32px;height:32px;border-radius:9px;border:none;
  background:#ffffff10;color:var(--sidebar-text);
  display:flex;align-items:center;justify-content:center;
  cursor:pointer;font-size:14px;transition:all 0.15s;flex-shrink:0;
}
.sidebar-toggle-btn:hover{background:#ffffff20;color:#fff;}

/* ── MAIN ── */
.main{flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden;}

/* ── TOPBAR ── */
.topbar{
  height:64px;background:var(--surface);border-bottom:1px solid var(--border);
  display:flex;align-items:center;gap:16px;padding:0 28px;
  position:sticky;top:0;z-index:20;flex-shrink:0;
  box-shadow:var(--shadow-sm);
}
.topbar-title{font-size:20px;font-weight:800;color:var(--text);letter-spacing:-0.02em;}
.topbar-divider{width:1px;height:22px;background:var(--border);margin:0 4px;}
.topbar-team-btn{
  display:flex;align-items:center;gap:7px;padding:6px 14px;
  border-radius:20px;border:1px solid var(--border);
  font-size:12px;font-weight:600;color:var(--text2);cursor:pointer;
  background:var(--surface2);transition:all 0.13s;
}
.topbar-team-btn:hover{border-color:var(--accent);color:var(--accent);}
.topbar-search{
  flex:1;max-width:240px;height:36px;
  background:var(--surface2);border:1px solid var(--border);
  border-radius:20px;display:flex;align-items:center;gap:8px;
  padding:0 14px;color:var(--muted);font-size:12px;cursor:text;
  transition:all 0.13s;margin-left:auto;
}
.topbar-search:hover{border-color:var(--border2);}
.topbar-action{
  background:var(--text);color:#fff;border:none;
  padding:8px 18px;border-radius:20px;font-family:var(--font-head);
  font-size:12px;font-weight:700;cursor:pointer;
  transition:opacity 0.13s;white-space:nowrap;
}
.topbar-action:hover{opacity:0.85;}
.topbar-icon-btn{
  width:36px;height:36px;border-radius:10px;border:1px solid var(--border);
  background:var(--surface2);display:flex;align-items:center;justify-content:center;
  cursor:pointer;color:var(--muted);font-size:14px;transition:all 0.13s;
}
.topbar-icon-btn:hover{border-color:var(--accent);color:var(--accent);}
.period-picker{display:flex;align-items:center;gap:8px;}
.period-label{font-size:11px;color:var(--muted);font-family:var(--font-mono);}
.date-input{
  background:var(--surface2);border:1px solid var(--border);color:var(--text);
  font-family:var(--font-mono);font-size:11px;padding:6px 10px;border-radius:8px;
  outline:none;cursor:pointer;transition:border-color 0.13s;
}
.date-input:focus{border-color:var(--accent);}
.btn{
  background:var(--accent);color:#fff;border:none;padding:7px 16px;
  border-radius:8px;font-family:var(--font-head);font-size:12px;font-weight:700;
  cursor:pointer;transition:all 0.13s;
}
.btn:hover{background:var(--accent2);}
.btn-ghost{
  background:transparent;color:var(--text2);
  border:1px solid var(--border2);
}
.btn-ghost:hover{color:var(--accent);border-color:var(--accent);background:var(--accent-soft);}
.mock-toggle{
  display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:8px;
  font-family:var(--font-mono);font-size:11px;font-weight:700;cursor:pointer;
  transition:all 0.2s;border:1px solid;
}

/* ── PAGE ── */
.page{padding:24px 28px;flex:1;overflow-y:auto;min-height:0;}

/* ── CARDS ── */
.card{
  background:var(--surface);border:1px solid var(--border);
  border-radius:var(--radius);padding:20px;box-shadow:var(--shadow-sm);
}
.card-title{font-size:13px;font-weight:700;color:var(--text);margin-bottom:4px;}
.card-sub{font-size:11px;color:var(--muted);}

/* ── HERO GRADIENT CARD ── */
.hero-card{
  border-radius:var(--radius);padding:24px;
  background:linear-gradient(135deg,var(--grad-start) 0%,var(--grad-end) 100%);
  color:#fff;position:relative;overflow:hidden;box-shadow:0 8px 28px rgba(255,107,138,0.35);
}
.hero-card::before{
  content:'';position:absolute;top:-30px;right:-30px;
  width:140px;height:140px;border-radius:50%;
  background:rgba(255,255,255,0.12);
}
.hero-card::after{
  content:'';position:absolute;bottom:-40px;left:-10px;
  width:100px;height:100px;border-radius:50%;
  background:rgba(255,255,255,0.08);
}
.hero-label{font-size:12px;font-weight:600;opacity:0.85;margin-bottom:10px;}
.hero-value{font-size:36px;font-weight:800;letter-spacing:-0.03em;margin-bottom:16px;line-height:1;}
.hero-sub-row{display:flex;gap:20px;position:relative;z-index:1;}
.hero-sub-item{display:flex;flex-direction:column;gap:2px;}
.hero-sub-label{font-size:10px;opacity:0.7;text-transform:uppercase;letter-spacing:0.08em;}
.hero-sub-val{font-size:14px;font-weight:700;}
.hero-wave{position:absolute;bottom:0;left:0;right:0;opacity:0.2;}

/* ── STAT MINI CARDS (right column) ── */
.mini-stat{
  display:flex;align-items:center;gap:14px;
  background:var(--surface);border:1px solid var(--border);
  border-radius:var(--radius);padding:16px 18px;
  box-shadow:var(--shadow-sm);transition:box-shadow 0.13s;
}
.mini-stat:hover{box-shadow:var(--shadow-md);}
.mini-stat-icon{
  width:44px;height:44px;border-radius:12px;
  display:flex;align-items:center;justify-content:center;
  font-size:18px;flex-shrink:0;
}
.mini-stat-body{flex:1;}
.mini-stat-val{font-size:20px;font-weight:800;letter-spacing:-0.02em;color:var(--text);}
.mini-stat-label{font-size:12px;color:var(--muted);font-weight:500;margin-bottom:6px;}
.mini-stat-bar{height:4px;border-radius:2px;background:var(--border);overflow:hidden;}
.mini-stat-fill{height:100%;border-radius:2px;}

/* ── DASHBOARD GRID ── */
.dash-grid{display:grid;grid-template-columns:1fr 1fr 300px;gap:16px;align-items:start;}
.dash-left{display:flex;flex-direction:column;gap:16px;}
.dash-mid{display:flex;flex-direction:column;gap:16px;}
.dash-right{display:flex;flex-direction:column;gap:14px;}

/* ── KPI CHIPS (small inline version) ── */
.kpi-chip{
  display:flex;flex-direction:column;gap:5px;padding:14px 16px;
  background:var(--surface2);border:1px solid var(--border);
  border-radius:var(--radius-sm);cursor:pointer;transition:all 0.15s;
  border-left:3px solid transparent;
}
.kpi-chip:hover{border-color:var(--border2);box-shadow:var(--shadow-sm);background:var(--surface);}
.kpi-chip-label{font-size:11px;color:var(--muted);font-weight:600;letter-spacing:0.04em;}
.kpi-chip-value{font-size:18px;font-weight:800;letter-spacing:-0.02em;}

/* ── GRIDS ── */
.grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;}
.grid-3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;}
.grid-2{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;}
.grid-teams{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;}

/* ── TEAM CARDS ── */
.team-card{
  background:var(--surface);border:1px solid var(--border);
  border-radius:var(--radius);padding:22px;cursor:pointer;
  transition:all 0.15s;position:relative;overflow:hidden;
  box-shadow:var(--shadow-sm);
}
.team-card:hover{box-shadow:var(--shadow-md);transform:translateY(-2px);border-color:var(--border2);}
.team-card-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;}
.team-card-icon{font-size:24px;margin-bottom:6px;}
.team-card-name{font-size:14px;font-weight:700;color:var(--text);}
.team-card-slug{font-size:10px;color:var(--muted);font-family:var(--font-mono);margin-top:2px;}
.health-count{font-size:22px;font-weight:800;letter-spacing:-0.02em;}
.health-label{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;}
.health-strip{display:flex;gap:3px;margin-top:12px;}
.health-cell{flex:1;height:4px;border-radius:2px;}
.team-kpis-row{display:flex;gap:10px;margin-bottom:8px;}
.team-kpi-mini{flex:1;text-align:center;}
.team-kpi-mini-val{font-size:14px;font-weight:800;}
.team-kpi-mini-label{font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;margin-top:1px;}

/* ── KPI HERO (detail page) ── */
.kpi-hero{
  background:var(--surface);border:1px solid var(--border);
  border-radius:var(--radius);padding:24px 28px;margin-bottom:20px;
  display:flex;justify-content:space-between;align-items:flex-start;
  box-shadow:var(--shadow-sm);
}
.kpi-hero-val{font-size:42px;font-weight:800;letter-spacing:-0.03em;line-height:1;}
.kpi-hero-label{font-size:13px;font-weight:700;color:var(--text2);}
.kpi-hero-formula{font-size:11px;color:var(--muted);font-family:var(--font-mono);margin-top:4px;}

/* ── STAT ROW ── */
.stat-row{display:flex;gap:12px;flex-wrap:wrap;}
.stat-box{
  background:var(--surface);border:1px solid var(--border);
  border-radius:var(--radius-sm);padding:16px 20px;flex:1;min-width:100px;
  box-shadow:var(--shadow-sm);
}
.stat-box.clickable{cursor:pointer;transition:all 0.13s;}
.stat-box.clickable:hover{border-color:var(--accent);background:var(--accent-soft);box-shadow:var(--shadow-md);}
.stat-box-val{font-size:22px;font-weight:800;letter-spacing:-0.02em;}
.stat-box-label{font-size:11px;color:var(--muted);margin-top:3px;font-weight:500;}

/* ── SECTION HEAD ── */
.section-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;}
.section-title{font-size:14px;font-weight:700;color:var(--text);}
.section-sub{font-size:11px;color:var(--muted);}

/* ── TABLE ── */
.tbl{width:100%;border-collapse:collapse;font-size:12px;}
.tbl th{text-align:left;padding:10px 14px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);border-bottom:1px solid var(--border);white-space:nowrap;}
.tbl td{padding:10px 14px;border-bottom:1px solid var(--border);vertical-align:middle;color:var(--text);}
.tbl tr:last-child td{border-bottom:none;}
.tbl tr:hover td{background:var(--surface2);}
.tbl-link{cursor:pointer;color:var(--accent) !important;font-weight:700;}
.tbl-link:hover{text-decoration:underline;}

/* ── BADGES ── */
.badge{display:inline-flex;align-items:center;padding:3px 9px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:0.04em;white-space:nowrap;}
.badge-good{background:var(--good-soft);color:var(--good);}
.badge-warn{background:var(--warn-soft);color:#b45309;}
.badge-bad{background:var(--bad-soft);color:#dc2626;}
.badge-neutral{background:var(--surface2);color:var(--text2);border:1px solid var(--border);}

/* ── BREADCRUMB ── */
.breadcrumb{display:flex;align-items:center;gap:7px;font-size:12px;margin-bottom:20px;color:var(--muted);}
.breadcrumb span{color:var(--muted);}
.breadcrumb span:last-child{color:var(--text);font-weight:600;}

/* ── LOADING ── */
.loading{display:flex;align-items:center;gap:10px;padding:40px;color:var(--muted);font-family:var(--font-mono);font-size:13px;}
.spinner{width:20px;height:20px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin 0.7s linear infinite;}
@keyframes spin{to{transform:rotate(360deg);}}
.error-box{background:var(--bad-soft);border:1px solid #fca5a5;border-radius:var(--radius-sm);padding:14px 18px;color:#dc2626;font-size:13px;font-weight:600;}

/* ── FILTER BAR ── */
.filter-bar{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:center;}
.filter-input{background:var(--surface2);border:1px solid var(--border);color:var(--text);font-family:var(--font-mono);font-size:12px;padding:7px 12px;border-radius:8px;outline:none;min-width:200px;transition:border-color 0.13s;}
.filter-input:focus{border-color:var(--accent);}
.filter-select{background:var(--surface2);border:1px solid var(--border);color:var(--text);font-family:var(--font-mono);font-size:12px;padding:7px 12px;border-radius:8px;outline:none;cursor:pointer;}
.parent-cell{display:flex;flex-direction:column;gap:3px;}
.parent-epic{font-size:10px;color:var(--muted);font-family:var(--font-mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:190px;display:block;}
.parent-link{font-size:12px;color:var(--accent);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:190px;display:block;line-height:1.4;}
.parent-link:hover{text-decoration:underline;color:var(--accent2);}
.parent-none{font-size:12px;color:var(--muted);}

/* ── WORK ITEM DETAIL ── */
.wi-header{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:26px 30px;margin-bottom:20px;box-shadow:var(--shadow-sm);}
.wi-title{font-size:20px;font-weight:800;line-height:1.3;margin-bottom:12px;color:var(--text);}
.wi-meta-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;}
.wi-field{background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px 16px;}
.wi-field-label{font-size:10px;color:var(--muted);font-family:var(--font-mono);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:4px;}
.wi-field-val{font-size:13px;font-weight:600;}
.wi-section{margin-bottom:20px;}
.wi-section-title{font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--muted);font-family:var(--font-mono);margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--border);}
.wi-description{font-size:13px;line-height:1.7;color:var(--text2);background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:16px 18px;}
.rework-item{background:var(--bad-soft);border:1px solid #fca5a540;border-left:3px solid var(--bad);border-radius:var(--radius-sm);padding:12px 16px;margin-bottom:8px;}
.rework-time{font-size:11px;color:var(--muted);font-family:var(--font-mono);margin-bottom:4px;}
.rework-transition{font-size:12px;font-weight:700;margin-bottom:4px;color:var(--text);}
.rework-comment{font-size:12px;color:var(--text2);font-style:italic;}
.hierarchy-chain{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
.hierarchy-node{background:var(--surface2);border:1px solid var(--border);border-radius:7px;padding:6px 12px;font-size:12px;color:var(--text);}
.hierarchy-sep{color:var(--muted);font-size:14px;}
.tag-pill{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;background:var(--accent-soft);color:var(--accent);font-family:var(--font-mono);margin-right:4px;font-weight:600;}
.priority-critical{color:#dc2626;}
.priority-high{color:#d97706;}
.priority-medium{color:var(--good);}
.priority-low{color:var(--muted);}
.timeline-row{display:flex;gap:0;margin-bottom:10px;position:relative;}
.timeline-row::before{content:'';position:absolute;left:5px;top:20px;bottom:-10px;width:1px;background:var(--border);}
.timeline-row:last-child::before{display:none;}
.timeline-dot{width:11px;height:11px;border-radius:50%;border:2px solid var(--border2);background:var(--surface2);flex-shrink:0;margin-top:5px;margin-right:12px;position:relative;z-index:1;}
.timeline-dot.done{background:var(--good);border-color:var(--good);}
.timeline-dot.active{background:var(--accent);border-color:var(--accent);}
.timeline-content{flex:1;}
.timeline-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;font-family:var(--font-mono);margin-bottom:1px;color:var(--text2);}
.timeline-time{font-size:11px;color:var(--muted);font-family:var(--font-mono);}

/* ── DORA ── */
.dora-panel{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:24px 28px;margin-bottom:24px;box-shadow:var(--shadow-sm);}
.dora-panel-header{display:flex;align-items:center;gap:10px;margin-bottom:20px;}
.dora-badge{display:inline-flex;align-items:center;gap:5px;background:var(--accent-soft);border:1px solid #c4b8fd;border-radius:20px;padding:3px 10px;font-size:10px;font-weight:700;color:var(--accent);font-family:var(--font-mono);letter-spacing:0.1em;}
.dora-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
.dora-card{background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:20px 22px;position:relative;overflow:hidden;}
.dora-card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;}
.dora-level-pill{display:inline-flex;align-items:center;gap:6px;border-radius:20px;padding:4px 12px;font-size:11px;font-weight:800;font-family:var(--font-mono);letter-spacing:0.08em;margin-bottom:12px;}
.dora-metric-val{font-size:44px;font-weight:800;font-family:var(--font-mono);line-height:1;margin-bottom:6px;}
.dora-metric-label{font-size:12px;color:var(--muted);margin-bottom:14px;}
.dora-level-bar{display:flex;gap:3px;height:5px;border-radius:3px;overflow:visible;margin-top:14px;}
.dora-level-seg{flex:1;border-radius:2px;opacity:0.25;}
.dora-level-seg.active{opacity:1;}
.dora-desc{font-size:11px;color:var(--muted);font-family:var(--font-mono);line-height:1.5;margin-top:10px;padding-top:10px;border-top:1px solid var(--border);}
.dora-team-row{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);}
.dora-team-row:last-child{border-bottom:none;}
.dora-team-name{font-size:12px;font-weight:600;width:160px;flex-shrink:0;color:var(--text);}
.dora-team-val{font-size:13px;font-weight:800;font-family:var(--font-mono);width:70px;flex-shrink:0;}
.dora-team-level{width:64px;flex-shrink:0;}
.dora-team-bar-wrap{flex:1;}
.dora-team-bar-bg{height:5px;background:var(--border);border-radius:3px;overflow:hidden;}
.dora-team-bar-fill{height:100%;border-radius:3px;transition:width 0.4s ease;}

/* ── WIP ── */
.wip-dev-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;margin-bottom:24px;}
.wip-dev-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:18px 20px;box-shadow:var(--shadow-sm);}
.wip-dev-header{display:flex;align-items:center;gap:10px;margin-bottom:14px;}
.wip-dev-avatar{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0;}
.wip-dev-name{font-size:13px;font-weight:700;color:var(--text);}
.wip-dev-rate{font-size:11px;font-family:var(--font-mono);margin-top:1px;}
.wip-status-row{display:flex;align-items:center;gap:8px;margin-bottom:7px;}
.wip-status-label{font-size:11px;color:var(--muted);font-family:var(--font-mono);width:120px;flex-shrink:0;}
.wip-bar-bg{flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden;}
.wip-bar-fill{height:100%;border-radius:3px;transition:width 0.4s ease;}
.wip-count-badge{font-size:10px;font-family:var(--font-mono);font-weight:700;width:52px;text-align:right;flex-shrink:0;}
.wip-compliance-bar{height:4px;border-radius:2px;margin-top:12px;background:var(--border);overflow:hidden;}
.wip-compliance-fill{height:100%;border-radius:2px;transition:width 0.4s ease;}
.wip-summary-row{display:flex;gap:12px;margin-bottom:20px;}

/* ── BUGS ── */
.bug-expand-btn{background:none;border:none;cursor:pointer;color:var(--muted);font-size:11px;font-family:var(--font-mono);padding:2px 6px;border-radius:4px;transition:all 0.13s;display:inline-flex;align-items:center;gap:4px;}
.bug-expand-btn:hover{color:var(--bad);background:var(--bad-soft);}
.bug-expand-btn.open{color:var(--bad);background:var(--bad-soft);}
.bug-panel-inner{padding:14px 20px 14px 48px;background:var(--surface2);}
.bug-panel-title{font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--bad);font-family:var(--font-mono);margin-bottom:10px;}
.bug-row{display:flex;align-items:center;gap:0;padding:7px 0;border-bottom:1px solid var(--border);}
.bug-row:last-child{border-bottom:none;}
.bug-row-id{font-family:var(--font-mono);font-size:11px;color:var(--muted);width:72px;flex-shrink:0;}
.bug-row-title{flex:1;font-size:13px;cursor:pointer;color:var(--text);}
.bug-row-title:hover{color:var(--accent);text-decoration:underline;}
.bug-row-meta{display:flex;align-items:center;gap:8px;flex-shrink:0;}
.parent-back-link{display:inline-flex;align-items:center;gap:6px;background:var(--bad-soft);border:1px solid #fca5a5;border-radius:8px;padding:8px 14px;font-size:12px;cursor:pointer;color:#dc2626;font-family:var(--font-mono);transition:all 0.13s;margin-bottom:16px;}
.parent-back-link:hover{background:#fecaca;}

@media(max-width:1100px){.dash-grid{grid-template-columns:1fr 1fr;} .dash-right{display:none;}}
@media(max-width:900px){.grid-4{grid-template-columns:repeat(2,1fr);}.grid-3{grid-template-columns:repeat(2,1fr);}}
`;

// ─── SHARED COMPONENTS

// ─── SHARED COMPONENTS ────────────────────────────────────────────────────────
function Loader({msg="Loading…"}) { return <div className="loading"><div className="spinner"/><span>{msg}</span></div>; }
function Err({msg}) { return <div className="error-box">⚠ {msg}</div>; }

function StatusBadge({status}) {
  const cls = status==="Done"?"good":status==="Blocked"?"bad":"warn";
  return <span className={`badge badge-${cls}`}>{status}</span>;
}

function WorkItemRow({ wi, onWorkItemClick }) {
  const [bugsOpen, setBugsOpen] = useState(false);
  const hasBugs = wi.linked_bugs && wi.linked_bugs.length > 0;
  const id = wi.id || wi.work_item_id;
  const status = wi.canonical_status_end || (wi.is_delivered ? "Done" : "Active");
  return (
    <>
      <tr style={bugsOpen ? {background:"var(--surface2)"} : {}}>
        <td className="tbl-link" style={{fontFamily:"var(--font-mono)",fontSize:12}} onClick={()=>onWorkItemClick(id)}>#{id}</td>
        <td style={{maxWidth:220,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{wi.title}</td>
        <td><span className="badge badge-neutral">{wi.work_item_type||"—"}</span></td>
        <td style={{fontSize:12,color:"var(--muted)"}}>{wi.developer||"—"}</td>
        <td><StatusBadge status={status}/></td>
        <td style={{fontSize:11}}>
          {wi.is_delivered&&<span className="badge badge-good" style={{marginRight:3}}>✓</span>}
          {wi.is_spillover&&<span className="badge badge-warn" style={{marginRight:3}}>Spill</span>}
          {wi.has_rework&&<span className="badge badge-bad" style={{marginRight:3}}>Rework</span>}
          {wi.is_tech_debt&&<span className="badge badge-warn">Debt</span>}
          {hasBugs&&(
            <button className={`bug-expand-btn${bugsOpen?" open":""}`} onClick={e=>{e.stopPropagation();setBugsOpen(o=>!o);}}>
              🐛 {wi.linked_bugs.length}{bugsOpen?" ▲":" ▼"}
            </button>
          )}
        </td>
      </tr>
      {bugsOpen && hasBugs && (
        <tr>
          <td colSpan={6} style={{padding:0,background:"#13101a",borderBottom:"2px solid #ef444430"}}>
            <div className="bug-panel-inner">
              <div className="bug-panel-title">🐛 Linked Bugs ({wi.linked_bugs.length})</div>
              {wi.linked_bugs.map((bug,bi)=>(
                <div key={bug.id||bi} className="bug-row">
                  <div className="bug-row-id">#{bug.id}</div>
                  <div className="bug-row-title" onClick={()=>onWorkItemClick(bug.id)}>{bug.title}</div>
                  <div className="bug-row-meta">
                    <span className="badge badge-neutral" style={{fontSize:10}}>{bug.priority||"—"}</span>
                    <StatusBadge status={bug.canonical_status_end||bug.canonical_status||"Active"}/>
                    {bug.developer&&<span style={{fontSize:11,color:"var(--muted)"}}>{bug.developer}</span>}
                  </div>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function WorkItemsTable({ items, onWorkItemClick, extra }) {
  return (
    <div className="card" style={{padding:0,overflow:"hidden"}}>
      <table className="tbl">
        <thead><tr>
          <th>ID</th><th>Title</th><th>Type</th><th>Developer</th><th>Status</th><th>Bugs / Flags</th>
          {extra}
        </tr></thead>
        <tbody>
          {items.length===0
            ? <tr><td colSpan={6} style={{textAlign:"center",color:"var(--muted)",padding:48,fontFamily:"var(--font-mono)",fontSize:13}}>No items found</td></tr>
            : items.map((wi,i)=><WorkItemRow key={wi.id||wi.work_item_id||i} wi={wi} onWorkItemClick={onWorkItemClick}/>)
          }
        </tbody>
      </table>
    </div>
  );
}

function KpiChip({ kpiKey, value, onClick }) {
  const m = KPI_META[kpiKey]; if (!m) return null;
  const color = kpiColor(kpiKey, value);
  const status = kpiStatus(kpiKey, value);
  return (
    <div className="kpi-chip" style={{borderLeftColor:color}} onClick={onClick}>
      <div className="kpi-chip-label">{m.icon} {m.label}</div>
      <div className="kpi-chip-value" style={{color}}>{fmt(kpiKey,value)}</div>
      <div><span className={`badge badge-${status}`}>{status==="unknown"?"no data":status}</span></div>
    </div>
  );
}

// Compact DORA chip for use inside the team card
function DoraChip({ kpiKey, value, onClick }) {
  const m = KPI_META[kpiKey]; if (!m) return null;
  const level = doraLevel(kpiKey, value);
  const color = level?.color ?? "#64748b";
  return (
    <div className="kpi-chip" style={{borderLeftColor:color,background:"var(--accent-soft)"}} onClick={onClick}>
      <div className="kpi-chip-label" style={{color:"var(--accent)"}}>{m.icon} {m.label}</div>
      <div className="kpi-chip-value" style={{color,fontSize:20}}>{fmt(kpiKey,value)}</div>
      <div style={{display:"flex",alignItems:"center",gap:6}}>
        {level && <span style={{display:"inline-block",padding:"2px 8px",borderRadius:20,fontSize:10,fontWeight:800,fontFamily:"var(--font-mono)",background:color+"22",color}}>{level.label}</span>}
      </div>
    </div>
  );
}

function KpiGrid({ summary, onKpiClick, onDoraClick }) {
  return (
    <>
      <div className="grid-3" style={{marginBottom:24}}>
        {KPI_KEYS.map(k=>(
          <KpiChip key={k} kpiKey={k} value={valFromSummary(summary,k)} onClick={()=>onKpiClick?.(k)}/>
        ))}
      </div>
      <div style={{marginBottom:10,display:"flex",alignItems:"center",gap:10}}>
        <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.14em",textTransform:"uppercase",color:"var(--accent)",fontFamily:"var(--font-mono)"}}>⬡ DORA Metrics</div>
        <div style={{flex:1,height:1,background:"var(--border)"}}/>
        {onDoraClick && <button onClick={onDoraClick} style={{background:"var(--accent-soft)",border:"1px solid #c4b8fd",borderRadius:6,color:"var(--accent)",fontSize:10,fontFamily:"var(--font-mono)",fontWeight:700,padding:"3px 10px",cursor:"pointer",letterSpacing:"0.08em"}}>Health Check →</button>}
      </div>
      <div className="grid-2">
        {DORA_KEYS.map(k=>(
          <DoraChip key={k} kpiKey={k} value={valFromSummary(summary,k)} onClick={()=>onKpiClick?.(k)}/>
        ))}
      </div>
    </>
  );
}

// ─── PAGE: OVERVIEW ───────────────────────────────────────────────────────────
function OverviewPage({ periodStart, periodEnd, onTeamClick }) {
  const [summaries,setSummaries]=useState({});
  const [loadStates,setLoadStates]=useState({});
  useEffect(()=>{ setSummaries({});
    TEAMS.forEach(async team=>{
      setLoadStates(p=>({...p,[team]:true}));
      try { const d=await api(`/api/v1/kpi/summary?team_project=${team}&period_start=${periodStart}&period_end=${periodEnd}`); setSummaries(p=>({...p,[team]:d})); }
      catch(e) { setSummaries(p=>({...p,[team]:{_error:e.message}})); }
      setLoadStates(p=>({...p,[team]:false}));
    });
  },[periodStart,periodEnd]);

  const avgKpis={};
  ALL_KPI_KEYS.forEach(k=>{ const vals=TEAMS.map(t=>valFromSummary(summaries[t],k)).filter(v=>v!=null); avgKpis[k]=vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null; });

  const allStatuses = TEAMS.flatMap(t=>KPI_KEYS.map(k=>kpiStatus(k,valFromSummary(summaries[t],k))));
  const fleetGood  = allStatuses.filter(s=>s==="good").length;
  const fleetWarn  = allStatuses.filter(s=>s==="warn").length;
  const fleetBad   = allStatuses.filter(s=>s==="bad").length;
  const totalKPIs  = TEAMS.length * KPI_KEYS.length;
  const fleetScore = totalKPIs>0 ? Math.round((fleetGood/totalKPIs)*100) : null;
  const fleetColor = fleetScore==null?"#94a3b8":fleetScore>=70?"#10b981":fleetScore>=45?"#f59e0b":"#ef4444";

  const Divider = ({label}) => (
    <div style={{display:"flex",alignItems:"center",gap:12,margin:"28px 0 16px"}}>
      <div style={{width:3,height:18,background:"var(--accent)",borderRadius:2,flexShrink:0}}/>
      <span style={{fontSize:14,fontWeight:800,color:"var(--text)"}}>{label}</span>
      <div style={{flex:1,height:1,background:"var(--border)"}}/>
    </div>
  );

  return (
    <div className="page" style={{display:"flex",flexDirection:"column",gap:0}}>

      {/* ── FLEET HEALTH BANNER ── */}
      <div style={{
        display:"grid",gridTemplateColumns:"1fr auto",gap:20,
        background:"var(--surface)",border:"1px solid var(--border)",
        borderRadius:20,padding:"24px 28px",marginBottom:4,
        boxShadow:"var(--shadow-sm)",overflow:"hidden",position:"relative",
      }}>
        <div style={{
          position:"absolute",right:230,top:"50%",transform:"translateY(-50%)",
          fontSize:120,fontWeight:900,color:fleetColor,opacity:0.05,
          fontFamily:"var(--font-head)",lineHeight:1,pointerEvents:"none",userSelect:"none",
        }}>{fleetScore!=null?`${fleetScore}%`:"?"}</div>

        <div>
          <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"var(--muted)",marginBottom:8}}>
            Organisation Health · {fmtDate(periodStart)} — {fmtDate(periodEnd)}
          </div>
          <div style={{fontSize:30,fontWeight:900,letterSpacing:"-0.03em",color:"var(--text)",marginBottom:4}}>
            {fleetScore!=null?<><span style={{color:fleetColor}}>{fleetScore}%</span>{" KPIs on target"}</>:"Loading…"}
          </div>
          <div style={{fontSize:13,color:"var(--text2)",marginBottom:18}}>
            Across {TEAMS.length} teams · {totalKPIs} KPI checks this period
          </div>
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            {[
              {label:"On Target",count:fleetGood,color:"#10b981",bg:"#d1fae5"},
              {label:"At Risk",count:fleetWarn,color:"#f59e0b",bg:"#fef3c7"},
              {label:"Off Target",count:fleetBad,color:"#ef4444",bg:"#fee2e2"},
            ].map(({label,count,color:c,bg})=>(
              <div key={label} style={{display:"flex",alignItems:"center",gap:7,background:bg,border:`1px solid ${c}30`,borderRadius:20,padding:"6px 14px"}}>
                <div style={{width:8,height:8,borderRadius:"50%",background:c,flexShrink:0}}/>
                <span style={{fontSize:12,fontWeight:700,color:c}}>{count}</span>
                <span style={{fontSize:11,color:c,fontWeight:500}}>{label}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:6,minWidth:260}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"var(--muted)",marginBottom:4}}>Cross-team avg per KPI</div>
          {KPI_KEYS.map(k=>{
            const v=avgKpis[k];
            const c=kpiColor(k,v);
            const pct=v!=null?Math.min(100,Math.round(
              k==="flow_hygiene"?Math.max(0,(1-v/2)*100):
              KPI_META[k].lower_better?Math.max(0,(1-v)*100):v*100
            )):0;
            return (
              <div key={k} style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{width:110,fontSize:10,color:"var(--muted)",fontWeight:600,flexShrink:0,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{KPI_META[k].label}</div>
                <div style={{flex:1,height:5,background:"var(--border)",borderRadius:3,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${pct}%`,background:c,borderRadius:3,transition:"width 0.5s ease"}}/>
                </div>
                <div style={{width:38,textAlign:"right",fontFamily:"var(--font-mono)",fontSize:11,fontWeight:700,color:c,flexShrink:0}}>{fmt(k,v)}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── DORA FLEET ── */}
      <Divider label="⬡ DORA Fleet Overview"/>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:4}}>
        {DORA_KEYS.map(k=>{
          const avgVal=avgKpis[k];
          const avgLv=doraLevel(k,avgVal);
          const avgColor=avgLv?.color??"#94a3b8";
          const allLevels=DORA_LEVELS[k]||[];
          const activeIdx=allLevels.findIndex(l=>l.label===avgLv?.label);
          return (
            <div key={k} style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:16,padding:"20px 22px",boxShadow:"var(--shadow-sm)",position:"relative",overflow:"hidden"}}>
              <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:`linear-gradient(90deg,${avgColor},${avgColor}60)`}}/>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
                <div>
                  <div style={{fontSize:10,color:"var(--accent)",fontWeight:700,fontFamily:"var(--font-mono)",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:4}}>
                    {KPI_META[k].icon} {KPI_META[k].label} · Fleet Avg
                  </div>
                  <div style={{fontSize:32,fontWeight:900,color:avgColor,letterSpacing:"-0.03em",lineHeight:1}}>{fmt(k,avgVal)}</div>
                </div>
                {avgLv&&<div style={{background:avgColor+"18",border:`1px solid ${avgColor}40`,borderRadius:20,padding:"4px 12px",fontSize:11,fontWeight:800,color:avgColor,fontFamily:"var(--font-mono)"}}>{avgLv.label}</div>}
              </div>
              <div style={{display:"flex",gap:3,height:4,borderRadius:3,overflow:"hidden",marginBottom:14}}>
                {allLevels.map((l,li)=>(
                  <div key={li} style={{flex:1,background:l.color,opacity:activeIdx===li?1:0.2,borderRadius:2}}/>
                ))}
              </div>
              {TEAMS.map(t=>{
                const v=valFromSummary(summaries[t],k);
                const lv=doraLevel(k,v);
                const max=k==="deployment_frequency"?2:168;
                const pct=k==="deployment_frequency"?Math.min(100,(v??0)/max*100):Math.min(100,(1-(v??max)/(max*1.2))*100);
                return (
                  <div key={t} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid var(--border)"}}>
                    <div style={{width:8,height:8,borderRadius:"50%",background:TEAM_COLORS[t],flexShrink:0}}/>
                    <div style={{width:130,fontSize:11,fontWeight:600,color:"var(--text)",flexShrink:0}}>{TEAM_LABELS[t]}</div>
                    <div style={{flex:1,height:5,background:"var(--border)",borderRadius:3,overflow:"hidden"}}>
                      <div style={{height:"100%",width:`${Math.max(3,pct)}%`,background:lv?.color??"#94a3b8",borderRadius:3,transition:"width 0.4s"}}/>
                    </div>
                    <div style={{width:44,textAlign:"right",fontFamily:"var(--font-mono)",fontSize:11,fontWeight:700,color:lv?.color??"var(--muted)",flexShrink:0}}>{fmt(k,v)}</div>
                    {lv&&<div style={{width:52,flexShrink:0}}><span style={{fontSize:9,fontWeight:800,color:lv.color,background:lv.color+"18",padding:"1px 7px",borderRadius:20,fontFamily:"var(--font-mono)"}}>{lv.label}</span></div>}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* ── TEAM CARDS ── */}
      <Divider label="Teams"/>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:14}}>
        {TEAMS.map(team=>{
          const summary=summaries[team];
          const isLoading=loadStates[team];
          const color=TEAM_COLORS[team];
          const goodCount=summary&&!summary._error?KPI_KEYS.filter(k=>kpiStatus(k,valFromSummary(summary,k))==="good").length:0;
          return (
            <div key={team} onClick={()=>onTeamClick(team)} style={{
              background:"var(--surface)",border:"1px solid var(--border)",
              borderRadius:18,padding:"20px 22px",cursor:"pointer",
              transition:"all 0.15s",position:"relative",overflow:"hidden",
              boxShadow:"var(--shadow-sm)",
            }}
              onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-3px)";e.currentTarget.style.boxShadow=`0 8px 24px ${color}25`;e.currentTarget.style.borderColor=color+"60";}}
              onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="var(--shadow-sm)";e.currentTarget.style.borderColor="var(--border)";}}
            >
              <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:color,borderRadius:"18px 18px 0 0"}}/>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{width:38,height:38,borderRadius:12,background:color+"20",border:`1px solid ${color}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>{TEAM_ICONS[team]}</div>
                  <div>
                    <div style={{fontSize:13,fontWeight:800,color:"var(--text)"}}>{TEAM_LABELS[team]}</div>
                    <div style={{fontSize:10,color:"var(--muted)",fontFamily:"var(--font-mono)",marginTop:1}}>{team}</div>
                  </div>
                </div>
                {summary&&!summary._error&&(
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:22,fontWeight:900,color,letterSpacing:"-0.02em",lineHeight:1}}>{goodCount}/{KPI_KEYS.length}</div>
                    <div style={{fontSize:10,color:"var(--muted)",textTransform:"uppercase",letterSpacing:"0.08em"}}>healthy</div>
                  </div>
                )}
              </div>
              {isLoading&&<div style={{fontSize:11,color:"var(--muted)",fontFamily:"var(--font-mono)"}}>Loading…</div>}
              {summary?._error&&<div style={{fontSize:11,color:"var(--bad)"}}>⚠ {summary._error}</div>}
              {summary&&!summary._error&&!isLoading&&(<>
                <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
                  {KPI_KEYS.map(k=>{
                    const v=valFromSummary(summary,k);
                    const c=kpiColor(k,v);
                    const s=kpiStatus(k,v);
                    return (
                      <div key={k} style={{display:"flex",alignItems:"center",gap:4,padding:"3px 9px",borderRadius:20,background:s==="good"?"#d1fae5":s==="warn"?"#fef3c7":s==="bad"?"#fee2e2":"var(--surface2)",border:`1px solid ${c}30`}}>
                        <div style={{width:6,height:6,borderRadius:"50%",background:c,flexShrink:0}}/>
                        <span style={{fontSize:10,fontWeight:700,color:c}}>{fmt(k,v)}</span>
                        <span style={{fontSize:9,color:c,opacity:0.8}}>{KPI_META[k].label.split(" ").slice(-1)[0]}</span>
                      </div>
                    );
                  })}
                </div>
                <div style={{display:"flex",gap:2,height:5,borderRadius:4,overflow:"hidden",marginBottom:10}}>
                  {KPI_KEYS.map(k=>(
                    <div key={k} style={{flex:1,background:kpiColor(k,valFromSummary(summary,k)),borderRadius:1}} title={KPI_META[k].label}/>
                  ))}
                </div>
                <div style={{display:"flex",gap:8}}>
                  {DORA_KEYS.map(k=>{
                    const v=valFromSummary(summary,k);
                    const lv=doraLevel(k,v);
                    return (
                      <div key={k} style={{flex:1,background:"var(--accent-soft)",border:"1px solid #c4b8fd",borderRadius:9,padding:"6px 10px"}}>
                        <div style={{fontSize:9,color:"var(--accent)",fontWeight:700,fontFamily:"var(--font-mono)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:2}}>⬡ {KPI_META[k].label}</div>
                        <div style={{display:"flex",alignItems:"baseline",gap:6}}>
                          <span style={{fontSize:15,fontWeight:900,color:lv?.color??"var(--muted)",fontFamily:"var(--font-mono)"}}>{fmt(k,v)}</span>
                          {lv&&<span style={{fontSize:9,fontWeight:700,color:lv.color}}>{lv.label}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
// ─── KPI HERO CARD (compact, light theme) ────────────────────────────────────
function KpiHeroCard({ kpiKey, value, onClick }) {
  const m = KPI_META[kpiKey];
  if (!m) return null;
  const color  = kpiColor(kpiKey, value);
  const status = kpiStatus(kpiKey, value);
  const statusBg = {good:"#d1fae5",warn:"#fef3c7",bad:"#fee2e2",unknown:"var(--surface3)"}[status]??"var(--surface3)";

  // Normalised bar width
  const pct = value==null ? 0 : Math.min(100, Math.round(
    kpiKey==="flow_hygiene" ? Math.max(0,(1-value/2)*100) :
    m.lower_better ? Math.max(0,(1-value)*100) : value*100
  ));

  return (
    <div onClick={onClick} style={{
      flex:1, minWidth:0, background:"var(--surface)",
      border:`1px solid ${color}30`, borderRadius:14,
      padding:"16px 18px", cursor:"pointer",
      transition:"all 0.15s", position:"relative", overflow:"hidden",
      boxShadow:`0 2px 8px ${color}12`,
    }}
      onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow=`0 6px 18px ${color}25`;e.currentTarget.style.borderColor=color+"60";}}
      onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow=`0 2px 8px ${color}12`;e.currentTarget.style.borderColor=color+"30";}}
    >
      {/* Left accent bar */}
      <div style={{position:"absolute",top:0,left:0,bottom:0,width:3,background:color,borderRadius:"14px 0 0 14px"}}/>
      <div style={{paddingLeft:6}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
          <div style={{fontSize:11,fontWeight:700,color:"var(--text2)",letterSpacing:"0.02em"}}>{m.icon} {m.label}</div>
          <div style={{
            fontSize:9,fontWeight:800,letterSpacing:"0.06em",textTransform:"uppercase",
            padding:"2px 8px",borderRadius:20,background:statusBg,color,
          }}>{status==="unknown"?"—":status}</div>
        </div>
        <div style={{fontSize:28,fontWeight:900,color,letterSpacing:"-0.03em",lineHeight:1,marginBottom:8}}>{fmt(kpiKey,value)}</div>
        {/* Progress bar */}
        <div style={{height:4,background:"var(--border)",borderRadius:2,overflow:"hidden",marginBottom:6}}>
          <div style={{height:"100%",width:`${pct}%`,background:color,borderRadius:2,transition:"width 0.5s ease"}}/>
        </div>
        <div style={{fontSize:9,color:"var(--muted)",fontFamily:"var(--font-mono)"}}>
          {m.lower_better?`target ≤ ${(m.thresholds.good*100).toFixed(0)}%`:`target ≥ ${(m.thresholds.good*100).toFixed(0)}%`}
        </div>
      </div>
    </div>
  );
}

// ─── PAGE: TEAM ───────────────────────────────────────────────────────────────
function TeamPage({ team, periodStart, periodEnd, onKpiClick, onWorkItemsClick, onWorkItemClick, onSnapshotClick, onDoraClick }) {
  const {data:summary,loading,error}=useKpiSummary(team,periodStart,periodEnd);
  const {data:wiData,loading:wiLoading}=useWorkItems(team,periodStart,periodEnd,{page_size:8});
  const color = TEAM_COLORS[team];

  const delivered  = summary?.delivery_predictability?.delivered ?? "—";
  const committed  = summary?.delivery_predictability?.committed ?? "—";
  const spillCount = summary?.spillover?.spillover_count ?? "—";
  const reworkCount= summary?.rework_rate?.tasks_with_rework ?? "—";
  const debtCount  = summary?.tech_debt_ratio?.tech_debt_count ?? "—";

  // Overall team health score
  const goodCount = summary ? KPI_KEYS.filter(k=>kpiStatus(k,valFromSummary(summary,k))==="good").length : 0;
  const warnCount = summary ? KPI_KEYS.filter(k=>kpiStatus(k,valFromSummary(summary,k))==="warn").length : 0;
  const badCount  = summary ? KPI_KEYS.filter(k=>kpiStatus(k,valFromSummary(summary,k))==="bad").length : 0;
  const healthPct = KPI_KEYS.length>0 ? Math.round((goodCount/KPI_KEYS.length)*100) : null;
  const healthColor= healthPct==null?"#94a3b8":healthPct>=70?"#10b981":healthPct>=45?"#f59e0b":"#ef4444";

  const SecHeader = ({icon,title,sub,action}) => (
    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14,paddingBottom:12,borderBottom:"1px solid var(--border)"}}>
      {icon&&<div style={{width:30,height:30,borderRadius:9,background:"var(--surface2)",border:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexShrink:0}}>{icon}</div>}
      <div style={{flex:1}}>
        <div style={{fontSize:14,fontWeight:800,color:"var(--text)"}}>{title}</div>
        {sub&&<div style={{fontSize:11,color:"var(--muted)",marginTop:1}}>{sub}</div>}
      </div>
      {action}
    </div>
  );

  return (
    <div className="page" style={{display:"flex",flexDirection:"column",gap:24}}>

      {/* ── TEAM HEADER BANNER ── */}
      <div style={{
        background:"var(--surface)",border:"1px solid var(--border)",
        borderRadius:20,overflow:"hidden",boxShadow:"var(--shadow-sm)",
      }}>
        {/* Row 1: team name + health ring */}
        <div style={{display:"flex",alignItems:"stretch"}}>
          <div style={{width:6,background:color,flexShrink:0}}/>
          <div style={{flex:1,padding:"20px 24px 20px 18px",display:"flex",alignItems:"center",gap:20,flexWrap:"wrap"}}>
            {/* Team icon + name */}
            <div style={{display:"flex",alignItems:"center",gap:14}}>
              <div style={{
                width:52,height:52,borderRadius:16,
                background:color+"20",border:`2px solid ${color}40`,
                display:"flex",alignItems:"center",justifyContent:"center",
                fontSize:26,flexShrink:0,
              }}>{TEAM_ICONS[team]}</div>
              <div>
                <div style={{fontSize:22,fontWeight:900,letterSpacing:"-0.02em",color:"var(--text)"}}>{TEAM_LABELS[team]}</div>
                <div style={{fontSize:11,color:"var(--muted)",fontFamily:"var(--font-mono)",marginTop:2}}>{team} · {fmtDate(periodStart)} — {fmtDate(periodEnd)}</div>
              </div>
            </div>

            {/* Health ring + legend */}
            {summary&&!loading&&healthPct!=null&&(
              <div style={{display:"flex",alignItems:"center",gap:12,marginLeft:"auto"}}>
                <div style={{position:"relative",width:56,height:56,flexShrink:0}}>
                  <svg width={56} height={56} style={{position:"absolute",top:0,left:0}}>
                    <circle cx={28} cy={28} r={22} fill="none" stroke="var(--border)" strokeWidth={5}/>
                    <circle cx={28} cy={28} r={22} fill="none" stroke={healthColor} strokeWidth={5}
                      strokeDasharray={`${2*Math.PI*22*healthPct/100} ${2*Math.PI*22}`}
                      strokeLinecap="round" transform="rotate(-90 28 28)"
                      style={{transition:"stroke-dasharray 0.6s ease"}}/>
                  </svg>
                  <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <span style={{fontSize:11,fontWeight:900,color:healthColor}}>{healthPct}%</span>
                  </div>
                </div>
                <div>
                  <div style={{fontSize:11,color:"var(--muted)",fontWeight:600,marginBottom:4}}>KPI Health</div>
                  <div style={{display:"flex",gap:8}}>
                    {[{c:"#10b981",n:goodCount,l:"good"},{c:"#f59e0b",n:warnCount,l:"warn"},{c:"#ef4444",n:badCount,l:"bad"}].map(({c,n,l})=>(
                      <div key={l} style={{display:"flex",alignItems:"center",gap:3}}>
                        <div style={{width:6,height:6,borderRadius:"50%",background:c}}/>
                        <span style={{fontSize:10,fontWeight:700,color:c}}>{n}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Row 2: KPI Status Strip */}
        {summary&&!loading&&(
          <div style={{
            padding:"12px 22px 16px 28px",
            borderTop:"1px solid var(--border)",
            background:"var(--surface2)",
          }}>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--muted)",marginBottom:8}}>
              KPI Status Strip
            </div>
            <div style={{display:"flex",gap:4,height:10,borderRadius:6,overflow:"hidden",marginBottom:6}}>
              {KPI_KEYS.map(k=>(
                <div key={k} title={KPI_META[k].label}
                  style={{flex:1,background:kpiColor(k,valFromSummary(summary,k)),borderRadius:2}}/>
              ))}
            </div>
            <div style={{display:"flex",gap:4}}>
              {KPI_KEYS.map(k=>{
                const v=valFromSummary(summary,k);
                const c=kpiColor(k,v);
                return (
                  <div key={k} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
                    <span style={{fontSize:9,color:"var(--muted)",textAlign:"center",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:"100%"}}>
                      {KPI_META[k].label.split(" ")[0]}
                    </span>
                    <span style={{fontSize:10,fontWeight:800,color:c,fontFamily:"var(--font-mono)"}}>{fmt(k,v)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {loading&&<Loader/>} {error&&<Err msg={error}/>}

      {summary&&!loading&&(<>

        {/* ══ KPIs ══════════════════════════════════════════════════════════════ */}
        <div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:18,padding:"20px 22px",boxShadow:"var(--shadow-sm)"}}>
          <SecHeader icon="📊" title="KPIs" sub="click any card to drill down"/>
          <div style={{display:"flex",flexDirection:"column",gap:18}}>
            {KPI_CATEGORIES.map(cat=>(
              <div key={cat.id}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                  <div style={{width:22,height:22,borderRadius:6,background:cat.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,flexShrink:0}}>{cat.icon}</div>
                  <span style={{fontSize:11,fontWeight:800,letterSpacing:"0.06em",textTransform:"uppercase",color:cat.color}}>{cat.label}</span>
                  <div style={{flex:1,height:1,background:cat.color+"20"}}/>
                  <span style={{fontSize:9,fontWeight:700,color:cat.color,background:cat.bg,borderRadius:20,padding:"1px 8px",fontFamily:"var(--font-mono)"}}>{cat.keys.length}×</span>
                </div>
                <div style={{display:"flex",gap:10}}>
                  {cat.keys.map(k=>(
                    <KpiHeroCard key={k} kpiKey={k} value={valFromSummary(summary,k)} onClick={()=>onKpiClick(k)}/>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ══ DORA ══════════════════════════════════════════════════════════════ */}
        <div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:18,padding:"20px 22px",boxShadow:"var(--shadow-sm)"}}>
          <SecHeader
            icon="⬡"
            title="DORA Engineering Health"
            sub="DevOps Research & Assessment benchmarks"
            action={<button onClick={onDoraClick} style={{background:"var(--accent-soft)",border:"1px solid #c4b8fd",borderRadius:8,color:"var(--accent)",fontSize:11,fontWeight:700,padding:"5px 14px",cursor:"pointer",fontFamily:"var(--font-head)",whiteSpace:"nowrap"}}>Full Health Check →</button>}
          />
          <div style={{display:"flex",gap:12}}>
            {DORA_KEYS.map(k=>{
              const value=valFromSummary(summary,k);
              const level=doraLevel(k,value);
              const lc=level?.color??"#94a3b8";
              const m=KPI_META[k];
              const allLevels=DORA_LEVELS[k]||[];
              const activeIdx=allLevels.findIndex(l=>l.label===level?.label);
              return (
                <div key={k} onClick={()=>onKpiClick(k)} style={{
                  flex:1,border:`1px solid ${lc}30`,borderRadius:14,
                  padding:"18px 20px",cursor:"pointer",position:"relative",overflow:"hidden",
                  background:`linear-gradient(135deg,${lc}08 0%,var(--surface2) 100%)`,
                  transition:"all 0.15s",
                }}
                  onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow=`0 6px 18px ${lc}20`;}}
                  onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="";}}
                >
                  <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:`linear-gradient(90deg,${lc},${lc}60)`}}/>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                    <div style={{fontSize:10,color:"var(--accent)",fontWeight:700,fontFamily:"var(--font-mono)",textTransform:"uppercase",letterSpacing:"0.1em"}}>
                      ⬡ {m.label}
                    </div>
                    {level&&<div style={{background:lc+"18",border:`1px solid ${lc}40`,borderRadius:20,padding:"3px 10px",fontSize:10,fontWeight:800,color:lc,fontFamily:"var(--font-mono)"}}>{level.label}</div>}
                  </div>
                  <div style={{fontSize:32,fontWeight:900,color:lc,letterSpacing:"-0.03em",lineHeight:1,marginBottom:6}}>{fmt(k,value)}</div>
                  {level&&<div style={{fontSize:11,color:"var(--text2)",fontStyle:"italic",marginBottom:12}}>"{level.desc}"</div>}
                  <div style={{display:"flex",gap:3,height:4,overflow:"hidden",borderRadius:3}}>
                    {allLevels.map((l,li)=>(
                      <div key={li} style={{flex:1,background:l.color,opacity:activeIdx===li?1:0.2,borderRadius:2}}/>
                    ))}
                  </div>
                  <div style={{display:"flex",marginTop:4}}>
                    {allLevels.map((l,li)=>(
                      <div key={li} style={{flex:1,textAlign:"center",fontSize:9,fontFamily:"var(--font-mono)",color:activeIdx===li?l.color:"var(--muted)",fontWeight:activeIdx===li?800:400}}>{l.label}</div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ══ DELIVERY SNAPSHOT ════════════════════════════════════════════════ */}
        <div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:18,padding:"20px 22px",boxShadow:"var(--shadow-sm)"}}>
          <SecHeader icon="📦" title="Delivery Snapshot" sub="click a stat to filter work items"/>
          <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
            {[
              {label:"Delivered",    val:delivered,   filter:"delivered", color:"#10b981",bg:"#d1fae5",icon:"✓"},
              {label:"Committed",    val:committed,   filter:"committed", color:"#6366f1",bg:"#e0e7ff",icon:"🎯"},
              {label:"Spillovers",   val:spillCount,  filter:"spillover", color:"#f59e0b",bg:"#fef3c7",icon:"📤"},
              {label:"Rework Items", val:reworkCount, filter:"rework",    color:"#ef4444",bg:"#fee2e2",icon:"↩"},
              {label:"Tech Debt",    val:debtCount,   filter:"techdebt",  color:"#8b5cf6",bg:"#ede9fe",icon:"🏚"},
            ].map(({label,val,filter,color:c,bg,icon})=>(
              <div key={filter} onClick={()=>onSnapshotClick(filter)} style={{
                flex:"1 1 120px",background:"var(--surface2)",border:"1px solid var(--border)",
                borderRadius:14,padding:"16px 18px",cursor:"pointer",transition:"all 0.15s",position:"relative",
              }}
                onMouseEnter={e=>{e.currentTarget.style.background=bg;e.currentTarget.style.borderColor=c+"60";e.currentTarget.style.transform="translateY(-2px)";}}
                onMouseLeave={e=>{e.currentTarget.style.background="var(--surface2)";e.currentTarget.style.borderColor="var(--border)";e.currentTarget.style.transform="";}}
              >
                <div style={{position:"absolute",top:12,right:14,width:28,height:28,borderRadius:8,background:bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>{icon}</div>
                <div style={{fontSize:26,fontWeight:900,color:c,letterSpacing:"-0.03em",lineHeight:1}}>{val}</div>
                <div style={{fontSize:11,color:"var(--muted)",marginTop:6,fontWeight:600}}>{label}</div>
                <div style={{fontSize:9,color:c,marginTop:3,fontFamily:"var(--font-mono)"}}>↗ view</div>
              </div>
            ))}
          </div>
        </div>

        {/* ══ RECENT WORK ITEMS ════════════════════════════════════════════════ */}
        <div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:18,overflow:"hidden",boxShadow:"var(--shadow-sm)"}}>
          <div style={{padding:"20px 22px 0"}}>
            <SecHeader icon="📋" title="Recent Work Items"
              action={<button className="btn btn-ghost" style={{fontSize:11,padding:"5px 12px"}} onClick={onWorkItemsClick}>View All →</button>}/>
          </div>
          {wiLoading&&<div style={{padding:"0 22px 20px"}}><Loader/></div>}
          {wiData?.items&&wiData.items.length>0&&(
            <table className="tbl">
              <thead><tr><th>ID</th><th>Title</th><th>Type</th><th>Parent / Epic</th><th>Status</th><th>Developer</th><th>Bugs / Flags</th></tr></thead>
              <tbody>
                {wiData.items.slice(0,6).map(wi=>(
                  <WorkItemsPageRow key={wi.id} wi={wi} onWorkItemClick={onWorkItemClick}/>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </>)}
    </div>
  );
}
// ─── WIP DEVELOPER CARD ───────────────────────────────────────────────────────
function WipDevCard({ dev, onWorkItemClick }) {
  const [expanded, setExpanded] = useState(false);
  const compliance = dev.compliance_rate ?? 0;
  const compColor = compliance >= 0.8 ? "#10b981" : compliance >= 0.6 ? "#f59e0b" : "#ef4444";
  const compStatus = compliance >= 0.8 ? "good" : compliance >= 0.6 ? "warn" : "bad";
  const avatarColor = `hsl(${seed(dev.developer||"x")%360},38%,38%)`;

  return (
    <div className="wip-dev-card" style={{borderColor: expanded ? compColor+"40" : "var(--border)"}}>
      <div className="wip-dev-header">
        <div className="wip-dev-avatar" style={{background:avatarColor}}>
          {(dev.developer||"?")[0]}
        </div>
        <div style={{flex:1}}>
          <div className="wip-dev-name">{dev.developer}</div>
          <div className="wip-dev-rate" style={{color:compColor}}>{(compliance*100).toFixed(0)}% compliant</div>
        </div>
        <span className={`badge badge-${compStatus}`}>{compStatus}</span>
        {dev.items?.length > 0 && (
          <button
            onClick={()=>setExpanded(e=>!e)}
            style={{background:"none",border:"1px solid var(--border2)",borderRadius:6,color:"var(--muted)",
              fontSize:11,fontFamily:"var(--font-mono)",padding:"3px 8px",cursor:"pointer",marginLeft:4}}
          >
            {dev.items.length} items {expanded?"▲":"▼"}
          </button>
        )}
      </div>

      {/* Per-status WIP bars */}
      {(dev.wip_statuses||[]).map(s => {
        const pct = Math.min(1, s.current_count / Math.max(s.limit, 1));
        const barColor = pct <= 0.7 ? "#10b981" : pct <= 1.0 ? "#f59e0b" : "#ef4444";
        const overLimit = s.current_count > s.limit;
        return (
          <div key={s.native_status} className="wip-status-row">
            <div className="wip-status-label">{s.native_status}</div>
            <div className="wip-bar-bg">
              <div className="wip-bar-fill" style={{width:`${Math.min(100, pct*100)}%`, background:barColor}}/>
            </div>
            <div className="wip-count-badge" style={{color: overLimit ? "#ef4444" : "var(--muted)"}}>
              {s.current_count}/{s.limit}{overLimit?" ⚠":""}
            </div>
          </div>
        );
      })}

      {/* Overall compliance bar */}
      <div className="wip-compliance-bar">
        <div className="wip-compliance-fill" style={{width:`${compliance*100}%`, background:compColor}}/>
      </div>

      {/* Expanded work items */}
      {expanded && dev.items?.length > 0 && (
        <div style={{marginTop:14,borderTop:"1px solid var(--border)",paddingTop:12}}>
          <div style={{fontSize:10,color:"var(--muted)",fontFamily:"var(--font-mono)",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:8}}>
            Active Work Items
          </div>
          {dev.items.map(wi=>(
            <div key={wi.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:"1px solid var(--border)"}}>
              <span
                style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--accent)",cursor:"pointer",flexShrink:0}}
                onClick={()=>onWorkItemClick(wi.id)}
              >#{wi.id}</span>
              <span style={{fontSize:12,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{wi.title}</span>
              <StatusBadge status={wi.canonical_status_end}/>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── PAGE: KPI DETAIL ─────────────────────────────────────────────────────────
function KpiDetailPage({ kpiKey, team, periodStart, periodEnd, onWorkItemClick }) {
  const {data,loading,error}=useKpiDetail(kpiKey,team,periodStart,periodEnd);
  const m=KPI_META[kpiKey];
  const getMainVal=()=>{ if(!data) return null;
    if(kpiKey==="rework_rate") return data.rate; if(kpiKey==="delivery_predictability") return data.rate;
    if(kpiKey==="wip_discipline") return data.compliance_rate; if(kpiKey==="flow_hygiene") return data.overall_ratio;
    if(kpiKey==="tech_debt_ratio") return data.ratio; if(kpiKey==="spillover") return data.rate;
    if(kpiKey==="deployment_frequency") return data.deployments_per_day; if(kpiKey==="lead_time") return data.avg_hours;
    return null; };
  const mainVal=getMainVal(); const color=kpiColor(kpiKey,mainVal); const status=kpiStatus(kpiKey,mainVal);
  const getItems=()=>{ if(!data) return []; return data.items||data.deployments||[]; };

  return (
    <div className="page">
      <div className="breadcrumb">
        <span style={{color:"var(--muted)"}}>Overview</span><span>/</span>
        <span style={{color:"var(--muted)"}}>{TEAM_LABELS[team]}</span><span>/</span>
        <span>{m?.label}</span>
      </div>
      {loading&&<Loader/>} {error&&<Err msg={error}/>}
      {data&&!loading&&<>
        <div className="kpi-hero" style={{borderColor:color+"30",background:`linear-gradient(135deg,var(--surface) 0%,${color}08 100%)`}}>
          <div>
            <div style={{fontSize:12,color:"var(--muted)",fontFamily:"var(--font-mono)",marginBottom:8}}>{m?.icon} {m?.label}</div>
            <div className="kpi-hero-val" style={{color}}>{fmt(kpiKey,mainVal)}</div>
            <span className={`badge badge-${status}`} style={{marginTop:12,display:"inline-block"}}>{status}</span>
          </div>
          <div style={{textAlign:"right"}}>
            <div className="kpi-hero-label">{TEAM_LABELS[team]}</div>
            <div className="kpi-hero-formula">{m?.formula}</div>
            <div style={{fontSize:11,color:"var(--muted)",marginTop:8,fontFamily:"var(--font-mono)"}}>{fmtDate(periodStart)} — {fmtDate(periodEnd)}</div>
            <div style={{fontSize:11,color:"var(--muted)",marginTop:4,fontFamily:"var(--font-mono)"}}>{m?.lower_better?"lower is better":"higher is better"} · target {m?.lower_better?`≤${(m.thresholds.good*100).toFixed(0)}${m.unit}`:`≥${(m.thresholds.good*100).toFixed(0)}${m.unit}`}</div>
          </div>
        </div>

        {/* ── WIP DISCIPLINE: developer breakdown ───────────────────────── */}
        {kpiKey==="wip_discipline" && data.developer_breakdown && <>
          <div className="stat-row" style={{marginBottom:24}}>
            <div className="stat-box">
              <div className="stat-box-val">{data.total_developers??0}</div>
              <div className="stat-box-label">Developers</div>
            </div>
            <div className="stat-box">
              <div className="stat-box-val" style={{color:"#10b981"}}>{data.compliant_developers??0}</div>
              <div className="stat-box-label">Compliant ≥80%</div>
            </div>
            <div className="stat-box">
              <div className="stat-box-val" style={{color:"#ef4444"}}>{(data.total_developers??0)-(data.compliant_developers??0)}</div>
              <div className="stat-box-label">Over WIP Limit</div>
            </div>
            <div className="stat-box">
              <div className="stat-box-val" style={{color}}>3</div>
              <div className="stat-box-label">WIP Limit / Status</div>
            </div>
          </div>
          <div className="section-head">
            <div className="section-title">Developer WIP Breakdown</div>
            <div className="section-sub">{data.developer_breakdown.length} developers · click to expand work items</div>
          </div>
          <div className="wip-dev-grid">
            {data.developer_breakdown.map(dev=>(
              <WipDevCard key={dev.developer} dev={dev} onWorkItemClick={onWorkItemClick}/>
            ))}
          </div>
        </>}

        {/* ── ALL OTHER KPIs: stat boxes + items table ─────────────────── */}
        {kpiKey!=="wip_discipline" && <>
          <div className="stat-row" style={{marginBottom:28}}>
            {kpiKey==="rework_rate"&&<><div className="stat-box"><div className="stat-box-val">{data.tasks_with_rework??0}</div><div className="stat-box-label">With Rework</div></div><div className="stat-box"><div className="stat-box-val">{data.tasks_in_qa??0}</div><div className="stat-box-label">In QA Total</div></div></>}
            {kpiKey==="delivery_predictability"&&<><div className="stat-box"><div className="stat-box-val">{data.delivered??0}</div><div className="stat-box-label">Delivered</div></div><div className="stat-box"><div className="stat-box-val">{data.committed??0}</div><div className="stat-box-label">Committed</div></div></>}
            {kpiKey==="spillover"&&<><div className="stat-box"><div className="stat-box-val">{data.spillover_count??0}</div><div className="stat-box-label">Spillovers</div></div><div className="stat-box"><div className="stat-box-val">{data.total_items??0}</div><div className="stat-box-label">Total Items</div></div></>}
            {kpiKey==="tech_debt_ratio"&&<><div className="stat-box"><div className="stat-box-val">{data.tech_debt_count??0}</div><div className="stat-box-label">Tech Debt Items</div></div><div className="stat-box"><div className="stat-box-val">{data.total_deployed??0}</div><div className="stat-box-label">Total Deployed</div></div></>}
            {kpiKey==="lead_time"&&<><div className="stat-box"><div className="stat-box-val">{data.avg_hours!=null?`${Math.round(data.avg_hours)}h`:"—"}</div><div className="stat-box-label">Avg</div></div><div className="stat-box"><div className="stat-box-val">{data.median_hours!=null?`${Math.round(data.median_hours)}h`:"—"}</div><div className="stat-box-label">Median</div></div><div className="stat-box"><div className="stat-box-val">{data.p90_hours!=null?`${Math.round(data.p90_hours)}h`:"—"}</div><div className="stat-box-label">P90</div></div><div className="stat-box"><div className="stat-box-val">{data.sample_size??0}</div><div className="stat-box-label">Sample Size</div></div></>}
          </div>
          {getItems().length>0&&<>
            <div className="section-head"><div className="section-title">Work Items</div><div className="section-sub">{getItems().length} items</div></div>
            <WorkItemsTable items={getItems()} onWorkItemClick={onWorkItemClick}/>
          </>}
        </>}
      </>}
    </div>
  );
}

// ─── WORK ITEMS PAGE ROW (with parent + inline bug expand) ──────────────────
function WorkItemsPageRow({ wi, onWorkItemClick }) {
  const [bugsOpen, setBugsOpen] = useState(false);
  const hasBugs = wi.linked_bugs && wi.linked_bugs.length > 0;
  return (
    <>
      <tr style={bugsOpen ? {background:"var(--surface2)"} : {}}>
        <td className="tbl-link" style={{fontFamily:"var(--font-mono)",fontSize:12}} onClick={()=>onWorkItemClick(wi.id)}>#{wi.id}</td>
        <td style={{maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{wi.title}</td>
        <td><span className="badge badge-neutral">{wi.work_item_type}</span></td>
        <td style={{minWidth:160,maxWidth:200}}>
          <div className="parent-cell">
            {wi.epic_title&&(
              <span className="parent-epic" title={wi.epic_title}>
                📦 {wi.epic_title}
              </span>
            )}
            {wi.feature_title&&(
              <span className="parent-epic" title={`Feature: ${wi.feature_title}`} style={{color:"#7c9af7"}}>
                🔷 {wi.feature_title}
              </span>
            )}
            {wi.parent_id&&wi.parent_title&&(
              <span
                className="parent-link"
                title={`${wi.parent_type||"Item"} #${wi.parent_id}: ${wi.parent_title}`}
                onClick={e=>{e.stopPropagation();onWorkItemClick(wi.parent_id);}}
              >
                ↖ <span style={{fontFamily:"var(--font-mono)",fontSize:10}}>#{wi.parent_id}</span>{" "}{wi.parent_title}
              </span>
            )}
            {!wi.epic_title&&!wi.feature_title&&!wi.parent_id&&(
              <span className="parent-none">—</span>
            )}
          </div>
        </td>
        <td><StatusBadge status={wi.canonical_status_end}/></td>
        <td style={{fontSize:12,color:"var(--muted)"}}>{wi.developer||"—"}</td>
        <td style={{fontSize:12,color:"var(--muted)"}}>{wi.qa_engineer||"—"}</td>
        <td style={{fontSize:11,whiteSpace:"nowrap"}}>
          {wi.is_delivered&&<span className="badge badge-good" style={{marginRight:3}}>✓</span>}
          {wi.is_spillover&&<span className="badge badge-warn" style={{marginRight:3}}>Spill</span>}
          {wi.has_rework&&<span className="badge badge-bad" style={{marginRight:3}}>Rework</span>}
          {wi.is_tech_debt&&<span className="badge badge-warn" style={{marginRight:3}}>Debt</span>}
          {hasBugs&&(
            <button className={`bug-expand-btn${bugsOpen?" open":""}`} onClick={e=>{e.stopPropagation();setBugsOpen(o=>!o);}}>
              🐛 {wi.linked_bugs.length}{bugsOpen?" ▲":" ▼"}
            </button>
          )}
        </td>
      </tr>
      {bugsOpen&&hasBugs&&(
        <tr>
          <td colSpan={8} style={{padding:0,background:"#13101a",borderBottom:"2px solid #ef444430"}}>
            <div className="bug-panel-inner">
              <div className="bug-panel-title">🐛 Linked Bugs ({wi.linked_bugs.length})</div>
              {wi.linked_bugs.map((bug,bi)=>(
                <div key={bug.id||bi} className="bug-row">
                  <div className="bug-row-id">#{bug.id}</div>
                  <div className="bug-row-title" onClick={()=>onWorkItemClick(bug.id)}>{bug.title}</div>
                  <div className="bug-row-meta">
                    <span className="badge badge-neutral" style={{fontSize:10}}>{bug.priority||"—"}</span>
                    <StatusBadge status={bug.canonical_status_end||bug.canonical_status||"Active"}/>
                    {bug.developer&&<span style={{fontSize:11,color:"var(--muted)"}}>{bug.developer}</span>}
                  </div>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── PAGE: WORK ITEMS LIST ────────────────────────────────────────────────────
function WorkItemsPage({ team, periodStart, periodEnd, onWorkItemClick, initialFilter }) {
  const [search,setSearch]=useState("");
  const [statusFilter,setStatusFilter]=useState("");
  const [typeFilter,setTypeFilter]=useState("");
  const [activeFlag,setActiveFlag]=useState(initialFilter||"");

  useEffect(()=>{ setActiveFlag(initialFilter||""); },[initialFilter]);

  const extra={};
  if(statusFilter) extra.canonical_status=statusFilter;
  if(typeFilter) extra.work_item_type=typeFilter;
  if(activeFlag==="spillover") extra.is_spillover="true";
  if(activeFlag==="rework") extra.has_rework="true";
  if(activeFlag==="techdebt") extra.is_tech_debt="true";
  if(activeFlag==="delivered") extra.is_delivered="true";

  const {data,loading,error}=useWorkItems(team,periodStart,periodEnd,extra);
  const items=(data?.items||[]).filter(wi=>{
    if(!search) return true;
    return wi.title?.toLowerCase().includes(search.toLowerCase())||String(wi.id).includes(search);
  });

  const FLAG_LABELS={"":"All Items","delivered":"Delivered","spillover":"Spillover","rework":"With Rework","techdebt":"Tech Debt","committed":"Committed"};

  return (
    <div className="page">
      <div className="breadcrumb">
        <span style={{color:"var(--muted)"}}>Overview</span><span>/</span>
        <span style={{color:"var(--muted)"}}>{TEAM_LABELS[team]}</span><span>/</span>
        <span>Work Items{activeFlag?` — ${FLAG_LABELS[activeFlag]}`:""}</span>
      </div>
      <div className="section-head">
        <div><div className="section-title" style={{fontSize:16}}>Work Items</div>
        <div className="section-sub">{TEAM_LABELS[team]} · {fmtDate(periodStart)} — {fmtDate(periodEnd)}</div></div>
        {data&&<div style={{fontSize:12,color:"var(--muted)",fontFamily:"var(--font-mono)"}}>{items.length} items</div>}
      </div>
      <div className="filter-bar">
        <input className="filter-input" placeholder="Search title or ID…" value={search} onChange={e=>setSearch(e.target.value)}/>
        <select className="filter-select" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
          <option value="">All Statuses</option>
          <option value="Backlog">Backlog</option><option value="Active">Active</option>
          <option value="InQA">InQA</option><option value="Blocked">Blocked</option><option value="Done">Done</option>
        </select>
        <select className="filter-select" value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}>
          <option value="">All Types</option>
          <option value="User Story">User Story</option><option value="Bug">Bug</option>
          <option value="Task">Task</option><option value="Feature">Feature</option>
        </select>
        {["","delivered","spillover","rework","techdebt"].map(flag=>(
          <button key={flag} onClick={()=>setActiveFlag(flag)} style={{
            padding:"5px 12px",borderRadius:7,fontSize:11,fontFamily:"var(--font-mono)",fontWeight:600,cursor:"pointer",
            background:activeFlag===flag?"var(--accent)":"var(--surface2)",
            color:activeFlag===flag?"#fff":"var(--muted)",
            border:`1px solid ${activeFlag===flag?"var(--accent)":"var(--border2)"}`,
            transition:"all 0.13s"
          }}>{FLAG_LABELS[flag]||"All"}</button>
        ))}
      </div>
      {loading&&<Loader/>} {error&&<Err msg={error}/>}
      {data&&!loading&&(
        <div className="card" style={{padding:0,overflow:"hidden"}}>
          <table className="tbl">
            <thead><tr><th>ID</th><th>Title</th><th>Type</th><th>Parent / Epic</th><th>Status</th><th>Developer</th><th>QA</th><th>Bugs / Flags</th></tr></thead>
            <tbody>
              {items.map(wi=>(
                <WorkItemsPageRow key={wi.id} wi={wi} onWorkItemClick={onWorkItemClick}/>
              ))}
              {items.length===0&&<tr><td colSpan={8} style={{textAlign:"center",color:"var(--muted)",padding:48,fontFamily:"var(--font-mono)",fontSize:13}}>No items found</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── PAGE: WORK ITEM DETAIL ───────────────────────────────────────────────────
function WorkItemDetailPage({ workItemId, team, periodStart, periodEnd, onWorkItemClick }) {
  const {data:wi,loading,error}=useWorkItemDetail(workItemId,team,periodStart,periodEnd);

  const priorityClass = (p) => ({Critical:"priority-critical",High:"priority-high",Medium:"priority-medium",Low:"priority-low"})[p]||"";

  return (
    <div className="page">
      <div className="breadcrumb">
        <span style={{color:"var(--muted)"}}>Overview</span><span>/</span>
        <span style={{color:"var(--muted)"}}>{TEAM_LABELS[team]}</span><span>/</span>
        <span style={{color:"var(--muted)"}}>Work Items</span><span>/</span>
        <span>#{workItemId}</span>
      </div>
      {loading&&<Loader/>} {error&&<Err msg={error}/>}
      {wi&&!loading&&wi.parent_id&&wi.work_item_type==="Bug"&&(
        <div className="parent-back-link" onClick={()=>onWorkItemClick(wi.parent_id)}>
          ← Back to parent {wi.parent_type||"Task"}: <strong>#{wi.parent_id}</strong> {wi.parent_title&&`— ${wi.parent_title}`}
        </div>
      )}
      {wi&&!loading&&(
        <div style={{display:"grid",gridTemplateColumns:"1fr 320px",gap:20,alignItems:"start"}}>
          {/* Main column */}
          <div>
            <div className="wi-header">
              <div className="wi-meta-row" style={{marginBottom:12}}>
                <span className="badge badge-neutral">{wi.work_item_type}</span>
                <span className={`badge badge-neutral ${priorityClass(wi.priority)}`} style={{fontWeight:700}}>{wi.priority}</span>
                <StatusBadge status={wi.canonical_status_end}/>
                {wi.is_delivered&&<span className="badge badge-good">✓ Delivered</span>}
                {wi.is_spillover&&<span className="badge badge-warn">📤 Spillover</span>}
                {wi.has_rework&&<span className="badge badge-bad">↩ Rework</span>}
                {wi.is_tech_debt&&<span className="badge badge-warn">🏚 Tech Debt</span>}
              </div>
              <div className="wi-title">{wi.title}</div>
              <div className="wi-meta-row">
                <div style={{fontSize:11,fontFamily:"var(--font-mono)",color:"var(--muted)"}}>#{wi.id}</div>
                <div style={{fontSize:11,fontFamily:"var(--font-mono)",color:"var(--muted)"}}>·</div>
                <div style={{fontSize:11,fontFamily:"var(--font-mono)",color:"var(--muted)"}}>{wi.story_points} pts</div>
                {wi.tags?.map(t=><span key={t} className="tag-pill">{t}</span>)}
              </div>
            </div>

            {/* Description */}
            <div className="wi-section">
              <div className="wi-section-title">Description</div>
              <div className="wi-description">{wi.description}</div>
            </div>

            {/* Hierarchy */}
            <div className="wi-section">
              <div className="wi-section-title">Hierarchy</div>
              <div className="hierarchy-chain">
                {wi.epic_title&&<><div className="hierarchy-node"><span style={{fontSize:10,color:"var(--muted)",display:"block",marginBottom:1}}>Epic</span>{wi.epic_title}</div><span className="hierarchy-sep">›</span></>}
                {wi.feature_title&&<><div className="hierarchy-node"><span style={{fontSize:10,color:"var(--muted)",display:"block",marginBottom:1}}>Feature</span>{wi.feature_title}</div><span className="hierarchy-sep">›</span></>}
                {wi.parent_title&&<><div className="hierarchy-node"><span style={{fontSize:10,color:"var(--muted)",display:"block",marginBottom:1}}>Parent</span>{wi.parent_title}</div><span className="hierarchy-sep">›</span></>}
                <div className="hierarchy-node" style={{background:"#7c6af718",borderColor:"#7c6af740"}}>
                  <span style={{fontSize:10,color:"var(--accent)",display:"block",marginBottom:1}}>This Item</span>{wi.title}
                </div>
              </div>
            </div>

            {/* Rework History */}
            {wi.has_rework&&wi.rework_details?.length>0&&(
              <div className="wi-section">
                <div className="wi-section-title">Rework History ({wi.rework_details.length} bounces)</div>
                {wi.rework_details.map((r,i)=>(
                  <div key={i} className="rework-item">
                    <div className="rework-time">{fmtDateTime(r.bounced_at)}</div>
                    <div className="rework-transition">{r.from_status} → {r.to_status}</div>
                    {r.comment&&<div className="rework-comment">"{r.comment}"</div>}
                  </div>
                ))}
              </div>
            )}

            {/* Linked Bugs */}
            {wi.linked_bugs?.length>0&&(
              <div className="wi-section">
                <div className="wi-section-title">Linked Bugs ({wi.linked_bugs.length}) — click ID to open</div>
                <div className="card" style={{padding:0,overflow:"hidden"}}>
                  <table className="tbl">
                    <thead><tr><th>ID</th><th>Title</th><th>Priority</th><th>Developer</th><th>Status</th><th>Lead Time</th></tr></thead>
                    <tbody>
                      {wi.linked_bugs.map((bug,bi)=>(
                        <tr key={bug.id||bi}>
                          <td className="tbl-link" style={{fontFamily:"var(--font-mono)",fontSize:12,color:"var(--bad)"}} onClick={()=>onWorkItemClick(bug.id)}>#{bug.id}</td>
                          <td style={{maxWidth:260,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{bug.title}</td>
                          <td><span className={`badge badge-${bug.priority==="Critical"?"bad":bug.priority==="High"?"warn":"neutral"}`}>{bug.priority||"—"}</span></td>
                          <td style={{fontSize:12,color:"var(--muted)"}}>{bug.developer||"—"}</td>
                          <td><StatusBadge status={bug.canonical_status_end||bug.canonical_status||"Active"}/></td>
                          <td style={{fontFamily:"var(--font-mono)",fontSize:12,color:bug.lead_time_hours?kpiColor("lead_time",bug.lead_time_hours):"var(--muted)"}}>{bug.lead_time_hours?`${Math.round(bug.lead_time_hours)}h`:"—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            {/* People */}
            <div className="card">
              <div className="wi-section-title" style={{marginBottom:14}}>People</div>
              {[["Developer",wi.developer],["QA Engineer",wi.qa_engineer],["Release Manager",wi.release_manager]].map(([label,val])=>(
                val&&<div key={label} style={{marginBottom:12}}>
                  <div style={{fontSize:10,color:"var(--muted)",fontFamily:"var(--font-mono)",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:3}}>{label}</div>
                  <div style={{fontSize:13,fontWeight:600,display:"flex",alignItems:"center",gap:8}}>
                    <div style={{width:28,height:28,borderRadius:"50%",background:`hsl(${seed(val||"")%360},40%,40%)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"#fff",flexShrink:0}}>{(val||"?")[0]}</div>
                    {val}
                  </div>
                </div>
              ))}
            </div>

            {/* Timeline */}
            <div className="card">
              <div className="wi-section-title" style={{marginBottom:14}}>Timeline</div>
              {[
                {label:"Created",time:wi.created_at,done:true},
                {label:"Activated",time:wi.activated_at,done:!!wi.activated_at},
                {label:"Closed",time:wi.closed_at,done:!!wi.closed_at,active:!wi.closed_at},
              ].map((t,i)=>(
                <div key={i} className="timeline-row">
                  <div className={`timeline-dot ${t.done?"done":t.active?"active":""}`}/>
                  <div className="timeline-content">
                    <div className="timeline-label">{t.label}</div>
                    <div className="timeline-time">{t.time?fmtDateTime(t.time):"Pending"}</div>
                  </div>
                </div>
              ))}
              {wi.lead_time_hours!=null&&(
                <div style={{marginTop:12,padding:"10px 0 0",borderTop:"1px solid var(--border)"}}>
                  <div style={{fontSize:10,color:"var(--muted)",fontFamily:"var(--font-mono)",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:4}}>Lead Time</div>
                  <div style={{fontSize:18,fontWeight:800,fontFamily:"var(--font-mono)",color:kpiColor("lead_time",wi.lead_time_hours)}}>{Math.round(wi.lead_time_hours)}h</div>
                </div>
              )}
            </div>

            {/* Status Info */}
            <div className="card">
              <div className="wi-section-title" style={{marginBottom:14}}>Status</div>
              <div style={{marginBottom:10}}>
                <div style={{fontSize:10,color:"var(--muted)",fontFamily:"var(--font-mono)",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:4}}>Period Start</div>
                <span className="badge badge-neutral">{wi.canonical_status_start}</span>
              </div>
              <div>
                <div style={{fontSize:10,color:"var(--muted)",fontFamily:"var(--font-mono)",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:4}}>Period End</div>
                <StatusBadge status={wi.canonical_status_end}/>
              </div>
              {wi.native_status_end&&<div style={{marginTop:10}}>
                <div style={{fontSize:10,color:"var(--muted)",fontFamily:"var(--font-mono)",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:4}}>Native Status</div>
                <div style={{fontSize:12,fontFamily:"var(--font-mono)"}}>{wi.native_status_end}</div>
              </div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ─── PAGE: DORA HEALTH ────────────────────────────────────────────────────────
function DoraHealthPage({ team, periodStart, periodEnd, onKpiClick }) {
  const {data:summary,loading,error}=useKpiSummary(team,periodStart,periodEnd);
  const [allSummaries,setAllSummaries]=useState({});
  useEffect(()=>{
    TEAMS.forEach(async t=>{
      try{const d=await api(`/api/v1/kpi/summary?team_project=${t}&period_start=${periodStart}&period_end=${periodEnd}`);setAllSummaries(p=>({...p,[t]:d}));}
      catch(e){}
    });
  },[periodStart,periodEnd]);

  const deployVal = valFromSummary(summary,"deployment_frequency");
  const leadVal   = valFromSummary(summary,"lead_time");
  const deployLv  = doraLevel("deployment_frequency",deployVal);
  const leadLv    = doraLevel("lead_time",leadVal);

  // Overall DORA grade: best of the two levels (Elite > High > Medium > Low)
  const LEVEL_RANK = {Elite:3,High:2,Medium:1,Low:0};
  const overallRank = Math.min(LEVEL_RANK[deployLv?.label]??0, LEVEL_RANK[leadLv?.label]??0);
  const overallLabel = ["Low","Medium","High","Elite"][overallRank];
  const overallColor = {Elite:"#10b981",High:"#6366f1",Medium:"#f59e0b",Low:"#ef4444"}[overallLabel]??"#94a3b8";

  // SVG gauge helper
  const Gauge = ({value, max, color, size=120}) => {
    const r = size*0.38; const cx = size/2; const cy = size/2;
    const circ = 2*Math.PI*r;
    const pct = Math.min(1, (value??0)/max);
    const dash = circ * 0.75 * pct;
    const totalArc = circ * 0.75;
    return (
      <svg width={size} height={size*0.72} style={{overflow:"visible"}}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--border)" strokeWidth={size*0.095}
          strokeDasharray={`${totalArc} ${circ}`} strokeLinecap="round"
          transform={`rotate(135 ${cx} ${cx})`}/>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth={size*0.095}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          transform={`rotate(135 ${cx} ${cx})`}
          style={{transition:"stroke-dasharray 0.8s ease"}}/>
        <text x={cx} y={cx+4} textAnchor="middle" fill={color} fontSize={size*0.16} fontWeight={900} fontFamily="var(--font-head)">{value!=null?fmt("deployment_frequency",value==="lead"?leadVal:value):"—"}</text>
      </svg>
    );
  };

  return (
    <div className="page" style={{display:"flex",flexDirection:"column",gap:24}}>

      {/* ── BREADCRUMB ── */}
      <div className="breadcrumb">
        <span>Overview</span><span>/</span>
        <span style={{color:"var(--muted)"}}>{TEAM_LABELS[team]}</span><span>/</span>
        <span style={{color:"var(--text)",fontWeight:700}}>DORA Health</span>
      </div>

      {loading&&<Loader/>} {error&&<Err msg={error}/>}

      {summary&&!loading&&(<>

        {/* ── HERO BANNER ── */}
        <div style={{
          background:`linear-gradient(135deg, ${overallColor}18 0%, ${overallColor}08 100%)`,
          border:`1px solid ${overallColor}30`,
          borderRadius:20, padding:"28px 32px",
          display:"flex", alignItems:"center", gap:32,
          position:"relative", overflow:"hidden",
        }}>
          {/* Large decorative background letter */}
          <div style={{
            position:"absolute",right:20,top:"50%",transform:"translateY(-50%)",
            fontSize:160,fontWeight:900,color:overallColor,opacity:0.05,
            fontFamily:"var(--font-head)",lineHeight:1,pointerEvents:"none",userSelect:"none",
          }}>{overallLabel[0]}</div>

          {/* Grade circle */}
          <div style={{
            width:100,height:100,borderRadius:"50%",flexShrink:0,
            background:`linear-gradient(135deg,${overallColor} 0%,${overallColor}99 100%)`,
            display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
            boxShadow:`0 8px 28px ${overallColor}45`,
          }}>
            <div style={{fontSize:32,fontWeight:900,color:"#fff",lineHeight:1}}>{overallLabel[0]}</div>
            <div style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,0.8)",letterSpacing:"0.1em",textTransform:"uppercase"}}>{overallLabel}</div>
          </div>

          <div style={{flex:1}}>
            <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",color:overallColor,fontFamily:"var(--font-mono)",marginBottom:6}}>
              ⬡ DORA Performance — {TEAM_LABELS[team]}
            </div>
            <div style={{fontSize:26,fontWeight:900,color:"var(--text)",letterSpacing:"-0.02em",marginBottom:6}}>
              {overallLabel} Performer
            </div>
            <div style={{fontSize:13,color:"var(--text2)",lineHeight:1.6,maxWidth:520}}>
              Based on Deployment Frequency and Lead Time for Changes benchmarks from the DORA State of DevOps research.
              {overallLabel==="Elite"&&" This team is in the top tier — shipping fast and reliably."}
              {overallLabel==="High"&&" Strong delivery cadence with room to push toward elite."}
              {overallLabel==="Medium"&&" Solid foundation — focus on reducing batch size and cycle time."}
              {overallLabel==="Low"&&" Significant improvement opportunity in delivery throughput."}
            </div>
          </div>

          <div style={{display:"flex",gap:10,flexShrink:0}}>
            {DORA_KEYS.map(k=>{
              const val = valFromSummary(summary,k);
              const lv  = doraLevel(k,val);
              return (
                <div key={k} style={{
                  background:"var(--surface)",borderRadius:14,padding:"16px 20px",
                  border:`1px solid ${lv?.color??"#94a3b8"}30`,
                  textAlign:"center",minWidth:110,cursor:"pointer",
                  transition:"all 0.15s",
                }}
                  onClick={()=>onKpiClick(k)}
                  onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow=`0 6px 18px ${lv?.color??"#94a3b8"}25`;}}
                  onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="";}}
                >
                  <div style={{fontSize:10,color:"var(--accent)",fontWeight:700,fontFamily:"var(--font-mono)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>
                    {KPI_META[k].icon} {KPI_META[k].label}
                  </div>
                  <div style={{fontSize:28,fontWeight:900,color:lv?.color??"var(--muted)",letterSpacing:"-0.02em",lineHeight:1,marginBottom:6}}>{fmt(k,val)}</div>
                  {lv&&<div style={{
                    display:"inline-block",padding:"3px 10px",borderRadius:20,
                    fontSize:10,fontWeight:800,color:lv.color,
                    background:lv.color+"18",fontFamily:"var(--font-mono)",
                  }}>{lv.label}</div>}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── TWO METRIC DEEP DIVES ── */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          {DORA_KEYS.map(k=>{
            const value   = valFromSummary(summary,k);
            const m       = KPI_META[k];
            const level   = doraLevel(k,value);
            const color   = level?.color??"#94a3b8";
            const allLevels = DORA_LEVELS[k]||[];
            const activeIdx = allLevels.findIndex(l=>l.label===level?.label);

            // Gauge: deploy freq max = 2/day, lead time inverted (lower=better, max 240h)
            const gaugeMax  = k==="deployment_frequency" ? 2 : 240;
            const gaugePct  = k==="deployment_frequency"
              ? Math.min(1,(value??0)/gaugeMax)
              : Math.min(1, 1 - (value??gaugeMax)/gaugeMax);
            const gaugeR = 52; const gaugeCX = 80; const gaugeCY = 80;
            const gaugeCirc = 2*Math.PI*gaugeR;
            const gaugeDash = gaugeCirc * 0.75 * gaugePct;
            const gaugeTotalArc = gaugeCirc * 0.75;

            return (
              <div key={k} style={{
                background:"var(--surface)",border:`1px solid var(--border)`,
                borderRadius:18,overflow:"hidden",cursor:"pointer",
                transition:"box-shadow 0.15s",
              }}
                onClick={()=>onKpiClick(k)}
                onMouseEnter={e=>e.currentTarget.style.boxShadow=`0 6px 24px ${color}20`}
                onMouseLeave={e=>e.currentTarget.style.boxShadow=""}
              >
                {/* Top colour bar */}
                <div style={{height:4,background:`linear-gradient(90deg,${color},${color}60)`}}/>
                <div style={{padding:"22px 24px"}}>
                  {/* Header */}
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
                    <div>
                      <div style={{fontSize:10,color:"var(--accent)",fontWeight:700,fontFamily:"var(--font-mono)",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:4}}>
                        ⬡ {m.label}
                      </div>
                      <div style={{fontSize:13,color:"var(--text2)",fontWeight:500}}>{m.desc}</div>
                    </div>
                    {level&&(
                      <div style={{
                        background:color+"18",border:`1px solid ${color}40`,
                        borderRadius:20,padding:"5px 14px",
                        fontSize:11,fontWeight:800,color,fontFamily:"var(--font-mono)",
                        display:"flex",alignItems:"center",gap:6,flexShrink:0,
                      }}>
                        <div style={{width:7,height:7,borderRadius:"50%",background:color}}/>
                        {level.label}
                      </div>
                    )}
                  </div>

                  {/* Gauge + value */}
                  <div style={{display:"flex",alignItems:"center",gap:24,marginBottom:20}}>
                    <div style={{position:"relative",flexShrink:0}}>
                      <svg width={160} height={116} style={{overflow:"visible"}}>
                        <circle cx={gaugeCX} cy={gaugeCX} r={gaugeR} fill="none" stroke="var(--border)" strokeWidth={12}
                          strokeDasharray={`${gaugeTotalArc} ${gaugeCirc}`} strokeLinecap="round"
                          transform={`rotate(135 ${gaugeCX} ${gaugeCX})`}/>
                        <circle cx={gaugeCX} cy={gaugeCX} r={gaugeR} fill="none" stroke={color} strokeWidth={12}
                          strokeDasharray={`${gaugeDash} ${gaugeCirc}`} strokeLinecap="round"
                          transform={`rotate(135 ${gaugeCX} ${gaugeCX})`}
                          style={{transition:"stroke-dasharray 0.9s ease"}}/>
                        <text x={gaugeCX} y={gaugeCX+2} textAnchor="middle" fill={color}
                          fontSize={22} fontWeight={900} fontFamily="var(--font-head)">{fmt(k,value)}</text>
                        <text x={gaugeCX} y={gaugeCX+18} textAnchor="middle" fill="var(--muted)"
                          fontSize={10} fontFamily="var(--font-head)">{m.unit}</text>
                      </svg>
                    </div>
                    <div style={{flex:1}}>
                      {level&&<div style={{fontSize:13,color:"var(--text2)",fontStyle:"italic",marginBottom:12,lineHeight:1.5}}>
                        "{level.desc}"
                      </div>}
                      <div style={{fontSize:11,color:"var(--muted)",fontFamily:"var(--font-mono)"}}>
                        formula: {m.formula}
                      </div>
                    </div>
                  </div>

                  {/* Level ladder */}
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {allLevels.map((l,li)=>{
                      const isThis = activeIdx===li;
                      return (
                        <div key={li} style={{
                          display:"flex",alignItems:"center",gap:10,
                          padding:"8px 12px",borderRadius:9,
                          background:isThis?l.color+"12":"var(--surface2)",
                          border:`1px solid ${isThis?l.color+"40":"var(--border)"}`,
                          transition:"all 0.2s",
                        }}>
                          <div style={{
                            width:10,height:10,borderRadius:"50%",background:l.color,
                            flexShrink:0,boxShadow:isThis?`0 0 8px ${l.color}`:"none",
                          }}/>
                          <div style={{flex:1,fontSize:11,fontWeight:isThis?800:500,color:isThis?l.color:"var(--text2)"}}>{l.label}</div>
                          <div style={{fontSize:11,color:isThis?"var(--text2)":"var(--muted)"}}>{l.desc}</div>
                          {isThis&&<div style={{fontSize:10,fontWeight:700,color:l.color,fontFamily:"var(--font-mono)",background:l.color+"18",padding:"1px 7px",borderRadius:20}}>you</div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── CROSS-TEAM BENCHMARK TABLE ── */}
        <div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
            <div style={{width:3,height:18,background:"var(--accent)",borderRadius:2}}/>
            <span style={{fontSize:14,fontWeight:800}}>Cross-Team Benchmark</span>
            <span style={{fontSize:11,color:"var(--muted)",marginLeft:4}}>all teams this period</span>
          </div>
          <div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:16,overflow:"hidden"}}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Team</th>
                  {DORA_KEYS.map(k=><th key={k}>{KPI_META[k].icon} {KPI_META[k].label}</th>)}
                  <th>Level</th>
                  <th>vs This Team</th>
                </tr>
              </thead>
              <tbody>
                {TEAMS.map(t=>{
                  const s = allSummaries[t];
                  const dv = valFromSummary(s,"deployment_frequency");
                  const lv = valFromSummary(s,"lead_time");
                  const dlv = doraLevel("deployment_frequency",dv);
                  const llv = doraLevel("lead_time",lv);
                  const rank = Math.min(LEVEL_RANK[dlv?.label]??0,LEVEL_RANK[llv?.label]??0);
                  const teamLabel = ["Low","Medium","High","Elite"][rank];
                  const teamColor = {Elite:"#10b981",High:"#6366f1",Medium:"#f59e0b",Low:"#ef4444"}[teamLabel]??"#94a3b8";
                  const isCurrentTeam = t===team;

                  const deployDiff = (dv!=null&&deployVal!=null) ? dv - deployVal : null;
                  const leadDiff   = (lv!=null&&leadVal!=null)   ? lv - leadVal   : null;

                  return (
                    <tr key={t} style={{
                      background:isCurrentTeam?"var(--accent-soft)":"",
                      fontWeight:isCurrentTeam?700:400,
                    }}>
                      <td>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <div style={{width:8,height:8,borderRadius:"50%",background:TEAM_COLORS[t],flexShrink:0}}/>
                          <span style={{color:isCurrentTeam?"var(--accent)":"var(--text)"}}>{TEAM_LABELS[t]}</span>
                          {isCurrentTeam&&<span style={{fontSize:9,fontWeight:700,color:"var(--accent)",background:"var(--accent-soft)",border:"1px solid #c4b8fd",borderRadius:20,padding:"1px 7px",fontFamily:"var(--font-mono)"}}>you</span>}
                        </div>
                      </td>
                      <td style={{fontFamily:"var(--font-mono)",fontWeight:700,color:dlv?.color??"var(--muted)"}}>
                        {fmt("deployment_frequency",dv)}
                      </td>
                      <td style={{fontFamily:"var(--font-mono)",fontWeight:700,color:llv?.color??"var(--muted)"}}>
                        {fmt("lead_time",lv)}
                      </td>
                      <td>
                        <span style={{
                          display:"inline-block",padding:"3px 10px",borderRadius:20,
                          fontSize:10,fontWeight:800,color:teamColor,
                          background:teamColor+"18",fontFamily:"var(--font-mono)",
                        }}>{teamLabel}</span>
                      </td>
                      <td>
                        {!isCurrentTeam&&deployDiff!=null&&(
                          <div style={{display:"flex",gap:8,fontSize:11,fontFamily:"var(--font-mono)"}}>
                            <span style={{color:deployDiff>0?"#10b981":"#ef4444",fontWeight:700}}>
                              {deployDiff>0?"↑":"↓"} {Math.abs(deployDiff).toFixed(2)}/d
                            </span>
                            {leadDiff!=null&&<span style={{color:leadDiff<0?"#10b981":"#ef4444",fontWeight:700}}>
                              {leadDiff<0?"↓":"↑"} {Math.abs(Math.round(leadDiff))}h
                            </span>}
                          </div>
                        )}
                        {isCurrentTeam&&<span style={{fontSize:11,color:"var(--accent)",fontFamily:"var(--font-mono)"}}>baseline</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── ABOUT DORA ── */}
        <div style={{
          background:"var(--surface2)",border:"1px solid var(--border)",
          borderRadius:14,padding:"18px 22px",
          display:"flex",gap:20,alignItems:"flex-start",
        }}>
          <div style={{
            width:40,height:40,borderRadius:12,background:"var(--accent-soft)",
            display:"flex",alignItems:"center",justifyContent:"center",
            fontSize:20,flexShrink:0,
          }}>⬡</div>
          <div>
            <div style={{fontSize:12,fontWeight:800,color:"var(--accent)",letterSpacing:"0.08em",textTransform:"uppercase",fontFamily:"var(--font-mono)",marginBottom:6}}>About DORA</div>
            <div style={{fontSize:12,color:"var(--text2)",lineHeight:1.7}}>
              The <strong style={{color:"var(--text)"}}>DORA</strong> (DevOps Research and Assessment) programme has studied thousands of engineering teams since 2014.
              Elite performers deploy on demand — multiple times per day — with lead times under one hour.
              This dashboard tracks two of the four core metrics: <strong style={{color:"var(--text)"}}>Deployment Frequency</strong> and <strong style={{color:"var(--text)"}}>Lead Time for Changes</strong>.
            </div>
          </div>
        </div>

      </>)}
    </div>
  );
}

// ─── SIDEBAR ──────────────────────────────────────────────────────────────────
function Sidebar({ currentTeam, activePage, onNavigate }) {
  const [expanded, setExpanded] = useState(false);

  const NAV = [
    { id:"overview", icon:"⊞", label:"Overview", section:"General" },
    ...TEAMS.map(t=>({ id:"team-"+t, team:t, icon:TEAM_ICONS[t], label:TEAM_LABELS[t], type:"team", section:"Teams" })),
    { id:"sep" },
    ...TEAMS.map(t=>({ id:"dora-"+t, team:t, icon:"⬡", label:TEAM_LABELS[t], type:"dora", section:"DORA" })),
  ];

  const isActive = (item) => {
    if (item.id==="overview") return activePage==="overview";
    if (item.type==="team") return activePage==="team" && currentTeam===item.team;
    if (item.type==="dora") return activePage==="dora" && currentTeam===item.team;
    return false;
  };

  let lastSection = null;

  return (
    <nav className={`sidebar${expanded?" expanded":""}`}>
      {/* Logo */}
      <div className="sidebar-logo-wrap">
        <div className="sidebar-logo">K</div>
        <span className="sidebar-brand">KPI Insights</span>
      </div>

      {/* Nav items */}
      {NAV.map((item, i) => {
        if (item.id==="sep") return <div key={i} className="sidebar-sep"/>;

        // Section label (only in expanded mode)
        let sectionEl = null;
        if (expanded && item.section && item.section !== lastSection) {
          lastSection = item.section;
          sectionEl = <div key={"sec-"+item.section} className="sidebar-section">{item.section}</div>;
        }

        const dot = item.team ? TEAM_COLORS[item.team] : null;
        const active = isActive(item);

        const navEl = (
          <div
            key={item.id}
            className={`nav-icon${active?" active":""}`}
            onClick={()=>{
              if(item.type==="team") onNavigate("team",item.team);
              else if(item.type==="dora") onNavigate("dora",item.team);
              else onNavigate("overview",null);
            }}
          >
            <span className="nav-icon-symbol" style={{fontSize:item.type==="dora"?13:16}}>{item.icon}</span>
            <span className="nav-icon-label">{item.label}</span>
            {dot && !active && <div className="nav-dot-sm" style={{background:dot}}/>}
            {!expanded && <span className="tooltip">{item.section ? `${item.section} · ` : ""}{item.label}</span>}
          </div>
        );

        return sectionEl ? [sectionEl, navEl] : navEl;
      })}

      {/* Collapse toggle */}
      <div className="sidebar-toggle">
        <button className="sidebar-toggle-btn" onClick={()=>setExpanded(e=>!e)} title={expanded?"Collapse":"Expand"}>
          {expanded ? "◀" : "▶"}
        </button>
      </div>
    </nav>
  );
}

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [periodStart,setPeriodStart]=useState("2026-02-17");
  const [periodEnd,setPeriodEnd]=useState("2026-03-02");
  const [pendingStart,setPendingStart]=useState("2026-02-17");
  const [pendingEnd,setPendingEnd]=useState("2026-03-02");
  const [page,setPage]=useState("overview");
  const [team,setTeam]=useState(TEAMS[0]);
  const [kpiKey,setKpiKey]=useState(null);
  const [workItemId,setWorkItemId]=useState(null);
  const [workItemsFilter,setWorkItemsFilter]=useState("");
  const [isMock,setIsMock]=useState(true);

  const toggleMock=()=>{ USE_MOCK=!isMock; setIsMock(m=>!m); };

  const navigate=(pg,t)=>{ setPage(pg); if(t) setTeam(t); };
  // Also handle dora page in navigate (team set above)

  const openWorkItem=(id)=>{ setWorkItemId(id); setPage("workitem"); };

  const openSnapshotWorkItems=(filter)=>{ setWorkItemsFilter(filter); setPage("workitems"); };

  const pageTitles={overview:"Overview",team:TEAM_LABELS[team]||team,kpi:KPI_META[kpiKey]?.label||"KPI",workitems:"Work Items",workitem:`#${workItemId}`,dora:"DORA Health"};

  return (
    <>
      <style>{CSS}</style>
      <div className="shell">
        <Sidebar currentTeam={team} activePage={page} onNavigate={navigate}/>
        <div className="main">
          <div className="topbar">
            <div className="topbar-title">{pageTitles[page]}</div>
            <div className="topbar-divider"/>
            {/* Team selector */}
            {(page==="team"||page==="kpi"||page==="workitems"||page==="workitem"||page==="dora")&&(
              <div className="topbar-team-btn">
                <div style={{width:8,height:8,borderRadius:"50%",background:TEAM_COLORS[team]}}/>
                {TEAM_LABELS[team]}
                <span style={{fontSize:10,color:"var(--muted)"}}>▾</span>
              </div>
            )}
            {/* Search */}
            <div className="topbar-search">
              <span style={{fontSize:13}}>⌕</span>
              <span>Search…</span>
            </div>
            {/* Period picker */}
            <div className="period-picker">
              <input type="date" className="date-input" value={pendingStart} onChange={e=>setPendingStart(e.target.value)}/>
              <span className="period-label">→</span>
              <input type="date" className="date-input" value={pendingEnd} onChange={e=>setPendingEnd(e.target.value)}/>
              <button className="btn" onClick={()=>{setPeriodStart(pendingStart);setPeriodEnd(pendingEnd);}}>Apply</button>
            </div>
            <button onClick={toggleMock} className="mock-toggle" style={{
              background:isMock?"#fef3c7":"var(--good-soft)",
              color:isMock?"#b45309":"var(--good)",
              borderColor:isMock?"#fde68a":"#a7f3d0",
            }}>{isMock?"⚡ Mock":"🔌 Live"}</button>
            <div className="topbar-icon-btn">⚙</div>
          </div>

          {page==="overview"&&<OverviewPage periodStart={periodStart} periodEnd={periodEnd} onTeamClick={t=>navigate("team",t)}/>}
          {page==="team"&&<TeamPage team={team} periodStart={periodStart} periodEnd={periodEnd}
            onKpiClick={k=>{setKpiKey(k);setPage("kpi");}}
            onWorkItemsClick={()=>{setWorkItemsFilter("");setPage("workitems");}}
            onWorkItemClick={openWorkItem}
            onSnapshotClick={openSnapshotWorkItems}
            onDoraClick={()=>setPage("dora")}/>}
          {page==="dora"&&<DoraHealthPage team={team} periodStart={periodStart} periodEnd={periodEnd} onKpiClick={k=>{setKpiKey(k);setPage("kpi");}}/>}
          {page==="kpi"&&<KpiDetailPage kpiKey={kpiKey} team={team} periodStart={periodStart} periodEnd={periodEnd} onWorkItemClick={openWorkItem}/>}
          {page==="workitems"&&<WorkItemsPage team={team} periodStart={periodStart} periodEnd={periodEnd} onWorkItemClick={openWorkItem} initialFilter={workItemsFilter}/>}
          {page==="workitem"&&<WorkItemDetailPage workItemId={workItemId} team={team} periodStart={periodStart} periodEnd={periodEnd} onWorkItemClick={openWorkItem}/>}
        </div>
      </div>
    </>
  );
}
