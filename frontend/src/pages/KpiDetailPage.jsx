import { useParams, useNavigate } from 'react-router';
import { useKpiDetail } from '../api/hooks/useKpiDetail';
import { usePeriod } from '../context/PeriodContext';
import { TEAM_LABELS, KPI_META, SLUG_TO_KPI } from '../lib/constants';
import { fmt, fmtDate, kpiColor, kpiStatus } from '../lib/formatters';
import Loader from '../components/shared/Loader';
import ErrorBox from '../components/shared/ErrorBox';
import Breadcrumb from '../components/shared/Breadcrumb';
import StatBox from '../components/shared/StatBox';
import WorkItemsTable from '../components/tables/WorkItemsTable';
import ReworkTable from '../components/tables/ReworkTable';
import ReleaseHistory from '../components/shared/ReleaseHistory';
import LeadTimeTable from '../components/tables/LeadTimeTable';
import WipDevCard from '../components/wip/WipDevCard';
import KpiDonutChart from '../components/charts/KpiDonutChart';

export default function KpiDetailPage() {
  const { teamId, kpiName: kpiSlug } = useParams();
  const navigate = useNavigate();
  const { periodStart, periodEnd } = usePeriod();

  const kpiKey = SLUG_TO_KPI[kpiSlug] || kpiSlug;
  const { data, isLoading, error } = useKpiDetail(teamId, kpiSlug, periodStart, periodEnd);
  const m = KPI_META[kpiKey];

  const mainVal = data?.kpi?.value ?? null;
  const color = kpiColor(kpiKey, mainVal);
  const status = kpiStatus(kpiKey, mainVal);
  const kpi = data?.kpi || {};
  const getItems = () => data?.items || data?.deployments || [];

  return (
    <div style={{ padding: 32 }} className="animate-fade-in">
      <Breadcrumb items={[
        { label: 'Overview', to: '/' },
        { label: TEAM_LABELS[teamId] || teamId, to: `/teams/${teamId}` },
        { label: m?.label || kpiSlug },
      ]} />

      {isLoading && <Loader />}
      {error && <ErrorBox message={error.message} />}

      {data && !isLoading && (
        <>
          {/* ── KPI Hero Card ───────────────────────────────────────── */}
          <div className="kpi-hero" style={{ borderLeftColor: color }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginBottom: 6 }}>
                {m?.icon} {m?.label}
              </div>
              <div style={{ fontSize: 56, fontWeight: 800, color, fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
                {fmt(kpiKey, mainVal)}
              </div>
              <span className={`badge badge-${status === 'unknown' ? 'neutral' : status}`}
                style={{ marginTop: 10, display: 'inline-block' }}>
                {status === 'unknown' ? 'no data' : status}
              </span>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{TEAM_LABELS[teamId]}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{m?.formula}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginTop: 6 }}>
                {fmtDate(periodStart)} — {fmtDate(periodEnd)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                {m?.lower_better ? 'lower is better' : 'higher is better'} · target{' '}
                {m?.lower_better
                  ? `≤${(m.thresholds.good * 100).toFixed(0)}${m.unit}`
                  : `≥${(m.thresholds.good * 100).toFixed(0)}${m.unit}`}
              </div>
            </div>
          </div>

          {/* ── WIP DISCIPLINE: developer breakdown ─────────────────── */}
          {kpiKey === 'wip_discipline' && kpi.persons && (
            <>
              <div className="stat-row" style={{ marginBottom: 20 }}>
                <StatBox value={kpi.total_developers ?? 0} label="Developers" />
                <StatBox value={kpi.developers_compliant ?? 0} label="Compliant ≥80%" color="#10b981" />
                <StatBox
                  value={(kpi.total_developers ?? 0) - (kpi.developers_compliant ?? 0)}
                  label="Over WIP Limit" color="#ef4444"
                />
                <StatBox value={kpi.dev_wip_limit ?? 0} label="WIP Limit / Dev" color={color} />
                {kpi.total_qas > 0 && (
                  <>
                    <StatBox value={kpi.total_qas ?? 0} label="QAs" />
                    <StatBox value={kpi.qas_compliant ?? 0} label="QAs Compliant" color="#10b981" />
                    <StatBox value={kpi.qa_wip_limit ?? 0} label="QA WIP Limit" color={color} />
                  </>
                )}
              </div>
              <div className="section-head">
                <div>
                  <div className="section-title">Developer WIP Breakdown</div>
                  <div className="section-sub">{kpi.persons.length} persons · click to expand work items</div>
                </div>
              </div>
              <div className="wip-dev-grid">
                {kpi.persons.map((person) => (
                  <WipDevCard
                    key={person.person}
                    person={person}
                    onWorkItemClick={(id) => navigate(`/teams/${teamId}/work-items/${id}`)}
                  />
                ))}
              </div>
            </>
          )}

          {/* ── FLOW HYGIENE: per-status breakdown ──────────────────── */}
          {kpiKey === 'flow_hygiene' && kpi.states && (
            <div className="stat-row" style={{ marginBottom: 20 }}>
              {kpi.states.map((s) => (
                <StatBox
                  key={s.state}
                  value={`${s.avg_items?.toFixed(1) ?? '—'}/${s.wip_limit}`}
                  label={s.state}
                  color={s.queue_load > 1 ? '#ef4444' : '#10b981'}
                />
              ))}
            </div>
          )}

          {/* ── ALL OTHER KPIs: stat boxes + donut + items table ────── */}
          {kpiKey !== 'wip_discipline' && (
            <>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24, alignItems: 'flex-start' }}>
                <div className="stat-row" style={{ flex: 1 }}>
                  {kpiKey === 'rework_rate' && (
                    <>
                      <StatBox value={kpi.items_with_rework ?? 0} label="With Rework" color="#ef4444" />
                      <StatBox value={kpi.items_reached_qa ?? 0} label="Reached QA" />
                      <StatBox value={kpi.items_bounced_back ?? 0} label="QA Bounces" color="#f59e0b" />
                      <StatBox value={kpi.total_bugs ?? 0} label="Bugs" color="#ef4444" />
                    </>
                  )}
                  {kpiKey === 'delivery_predictability' && (
                    <>
                      <StatBox value={kpi.items_deployed ?? 0} label="Delivered" />
                      <StatBox value={kpi.items_committed ?? 0} label="Committed" />
                      <StatBox value={kpi.items_started_in_period ?? 0} label="Started in Period" />
                      <StatBox value={kpi.items_spillover ?? 0} label="Spillovers" color="#f59e0b" />
                    </>
                  )}
                  {kpiKey === 'tech_debt_ratio' && (
                    <>
                      <StatBox value={kpi.tech_debt_count ?? 0} label="Tech Debt Items" />
                      <StatBox value={kpi.total_deployed ?? 0} label="Total Deployed" />
                    </>
                  )}
                  {kpiKey === 'initiative_delivery' && (
                    <>
                      <StatBox value={kpi.initiatives_committed ?? 0} label="Initiatives Committed" />
                      <StatBox value={kpi.initiatives_delivered ?? 0} label="Initiatives Delivered" />
                    </>
                  )}
                  {kpiKey === 'reliability_action_delivery' && (
                    <>
                      <StatBox value={kpi.reliability_actions_delivered ?? 0} label="Actions Delivered" />
                      <StatBox value={kpi.reliability_actions_sla_met ?? 0} label="SLA Met" color="#10b981" />
                    </>
                  )}
                  {kpiKey === 'lead_time' && (
                    <>
                      <StatBox value={kpi.lead_time_days != null ? `${kpi.lead_time_days.toFixed(1)}d` : '—'} label="Avg Lead Time" />
                      <StatBox value={kpi.median_lead_time_days != null ? `${kpi.median_lead_time_days.toFixed(1)}d` : '—'} label="Median" />
                      <StatBox value={kpi.p90_lead_time_days != null ? `${kpi.p90_lead_time_days.toFixed(1)}d` : '—'} label="P90" />
                      <StatBox value={kpi.sample_size ?? 0} label="Sample Size" />
                    </>
                  )}
                  {kpiKey === 'deploy_frequency' && (
                    <>
                      <StatBox value={kpi.deployment_count ?? 0} label="Total Deploys" />
                      <StatBox value={kpi.period_days ?? 0} label="Period Days" />
                    </>
                  )}
                </div>
                {/* Donut chart for ratio-based KPIs */}
                {['rework_rate', 'delivery_predictability', 'tech_debt_ratio', 'initiative_delivery', 'reliability_action_delivery'].includes(kpiKey) && (
                  <KpiDonutChart
                    value={
                      kpiKey === 'rework_rate' ? (kpi.items_with_rework ?? 0) :
                      kpiKey === 'delivery_predictability' ? (kpi.items_deployed ?? 0) :
                      kpiKey === 'tech_debt_ratio' ? (kpi.tech_debt_count ?? 0) :
                      kpiKey === 'initiative_delivery' ? (kpi.initiatives_delivered ?? 0) :
                      (kpi.reliability_actions_sla_met ?? 0)
                    }
                    total={
                      kpiKey === 'rework_rate' ? (kpi.items_reached_qa ?? 1) :
                      kpiKey === 'delivery_predictability' ? (kpi.items_committed ?? 1) :
                      kpiKey === 'tech_debt_ratio' ? (kpi.total_deployed ?? 1) :
                      kpiKey === 'initiative_delivery' ? (kpi.initiatives_committed ?? 1) :
                      (kpi.reliability_actions_delivered ?? 1)
                    }
                    color={color}
                  />
                )}
              </div>

              {kpiKey === 'deploy_frequency' && (data?.deployments?.length ?? 0) > 0 && (
                <div style={{ marginTop: 24 }}>
                  <ReleaseHistory deployments={data?.deployments} total={kpi.deployment_count} />
                </div>
              )}
              {kpiKey !== 'deploy_frequency' && getItems().length > 0 && (
                <>
                  <div className="section-head">
                    <div>
                      <div className="section-title">Work Items</div>
                      <div className="section-sub">{getItems().length} items</div>
                    </div>
                  </div>
                  {kpiKey === 'lead_time' ? (
                    <LeadTimeTable items={getItems()} onWorkItemClick={(id) => navigate(`/teams/${teamId}/work-items/${id}`)} />
                  ) : kpiKey === 'rework_rate' ? (
                    <ReworkTable items={getItems()} onWorkItemClick={(id) => navigate(`/teams/${teamId}/work-items/${id}`)} />
                  ) : (
                    <WorkItemsTable items={getItems()} onWorkItemClick={(id) => navigate(`/teams/${teamId}/work-items/${id}`)} />
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
