import Loader from './Loader';
import ErrorBox from './ErrorBox';

/**
 * Standardized loading/error state handler for TanStack Query hooks.
 *
 * Usage:
 *   <QueryGuard query={dashboardQuery}>
 *     {(data) => <Dashboard data={data} />}
 *   </QueryGuard>
 */
export default function QueryGuard({ query, children, loadingFallback }) {
  if (query.isLoading) {
    return loadingFallback || <Loader />;
  }
  if (query.isError) {
    return <ErrorBox message={query.error?.message || 'An error occurred'} />;
  }
  if (!query.data) {
    return null;
  }
  return children(query.data);
}
