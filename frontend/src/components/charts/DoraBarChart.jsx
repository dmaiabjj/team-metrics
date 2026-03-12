import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ResponsiveContainer } from 'recharts';
import { KPI_META } from '../../lib/constants';
import { fmt, doraLevel } from '../../lib/formatters';

export default function DoraBarChart({ teams, values, kpiKey }) {
  const meta = KPI_META[kpiKey];
  if (!meta) return null;

  const data = teams.map((team, i) => {
    const val = values[i] ?? 0;
    const level = doraLevel(kpiKey, val);
    return {
      team,
      value: val,
      color: level?.color ?? '#64748b',
      display: fmt(kpiKey, val),
    };
  });

  return (
    <div className="w-full" role="img" aria-label={`${meta.label} DORA bar chart`}>
      <ResponsiveContainer width="100%" height={teams.length * 44 + 20}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 60, left: 0, bottom: 4 }}>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="team"
            width={130}
            tick={{ fill: '#7a7a94', fontSize: 11, fontFamily: 'var(--font-mono)' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={false}
            contentStyle={{
              background: '#ffffff',
              border: '1px solid #e8e6e1',
              borderRadius: 8,
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
              color: '#1a1a2e',
            }}
            formatter={(val) => [fmt(kpiKey, val), meta.label]}
          />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={20} animationDuration={500}>
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
