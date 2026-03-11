const AVATAR_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
  '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#06b6d4', '#3b82f6',
];

function seed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export default function Avatar({ name, size = 32 }) {
  if (!name) return null;
  const initials = name.split(/[\s.]+/).map(w => w[0]?.toUpperCase()).filter(Boolean).slice(0, 2).join('');
  const bg = AVATAR_COLORS[seed(name) % AVATAR_COLORS.length];

  return (
    <div
      style={{
        width: size, height: size, borderRadius: '50%',
        background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontWeight: 700, fontSize: size * 0.38, flexShrink: 0,
      }}
    >
      {initials}
    </div>
  );
}
