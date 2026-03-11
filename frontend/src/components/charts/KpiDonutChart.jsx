import { PieChart, Pie, Cell } from 'recharts';

export default function KpiDonutChart({ value, total, color, size = 90 }) {
  const filled = Math.max(0, Math.min(value ?? 0, total));
  const remainder = Math.max(0, total - filled);
  const data = [
    { name: 'filled', value: filled },
    { name: 'rest', value: remainder || 0 },
  ];

  if (!total) return null;

  const innerRadius = size * 0.34;
  const outerRadius = size * 0.46;
  const pct = total > 0 ? Math.round((filled / total) * 100) : 0;

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size }}>
      <PieChart width={size} height={size}>
        <Pie
          data={data}
          cx={size / 2}
          cy={size / 2}
          innerRadius={innerRadius}
          outerRadius={outerRadius}
          startAngle={90}
          endAngle={-270}
          dataKey="value"
          stroke="none"
          animationDuration={600}
        >
          <Cell fill={color} />
          <Cell fill="rgba(107,114,128,0.08)" />
        </Pie>
      </PieChart>
      <span style={{ position: 'absolute', fontSize: 14, fontWeight: 800, color, fontFamily: 'var(--font-mono)' }}>
        {pct}%
      </span>
    </div>
  );
}
