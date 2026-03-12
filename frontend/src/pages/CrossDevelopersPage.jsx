import CrossPersonAnalysisPage from './CrossPersonAnalysisPage';

export default function CrossDevelopersPage() {
  return (
    <CrossPersonAnalysisPage
      personField="developer"
      pageTitle="Cross-Team Developer Analysis"
      pageSubtitle="Compare developer performance across all teams"
      personLabel="Developer"
      breadcrumbLabel="Cross Developers"
      metricKeys={['throughput', 'avgCycleTime', 'reworkRate', 'bugsCount', 'deliveryRate']}
    />
  );
}
