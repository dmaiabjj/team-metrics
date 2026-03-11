import { createContext, useContext, useState, useMemo } from 'react';

const PeriodContext = createContext(null);

function defaultStart() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}
function defaultEnd() {
  return new Date().toISOString().slice(0, 10);
}

export function PeriodProvider({ children }) {
  const [periodStart, setPeriodStart] = useState(defaultStart);
  const [periodEnd, setPeriodEnd] = useState(defaultEnd);

  const value = useMemo(
    () => ({ periodStart, periodEnd, setPeriod: (s, e) => { setPeriodStart(s); setPeriodEnd(e); } }),
    [periodStart, periodEnd],
  );

  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>;
}

export function usePeriod() {
  const ctx = useContext(PeriodContext);
  if (!ctx) throw new Error('usePeriod must be inside PeriodProvider');
  return ctx;
}
