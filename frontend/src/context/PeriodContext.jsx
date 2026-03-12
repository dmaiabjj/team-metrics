import { createContext, useContext, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';

const PeriodContext = createContext(null);

function defaultStart() {
  const d = new Date();
  d.setDate(d.getDate() - 8);
  return d.toISOString().slice(0, 10);
}
function defaultEnd() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * PeriodProvider stores start/end dates in URL search params so that:
 * - URLs are shareable and bookmarkable
 * - Page refresh preserves the selected period
 * - Browser back/forward navigates through period changes
 *
 * Falls back to last-30-days if no URL params are present.
 */
export function PeriodProvider({ children }) {
  const [searchParams, setSearchParams] = useSearchParams();

  const periodStart = searchParams.get('start') || defaultStart();
  const periodEnd = searchParams.get('end') || defaultEnd();

  const setPeriod = useCallback(
    (start, end) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('start', start);
          next.set('end', end);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const value = useMemo(
    () => ({ periodStart, periodEnd, setPeriod }),
    [periodStart, periodEnd, setPeriod],
  );

  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>;
}

export function usePeriod() {
  const ctx = useContext(PeriodContext);
  if (!ctx) throw new Error('usePeriod must be inside PeriodProvider');
  return ctx;
}
