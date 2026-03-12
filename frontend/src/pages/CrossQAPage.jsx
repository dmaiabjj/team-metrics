import CrossPersonAnalysisPage from './CrossPersonAnalysisPage';

export default function CrossQAPage() {
  return (
    <CrossPersonAnalysisPage
      personField="qa"
      pageTitle="Cross-Team QA Analysis"
      pageSubtitle="Compare QA engineer throughput across all teams"
      personLabel="QA Engineer"
      breadcrumbLabel="Cross QA"
      metricKeys={['throughput']}
    />
  );
}
