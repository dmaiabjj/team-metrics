import WorkItemRow from './WorkItemRow';

export default function WorkItemsTable({ items, onWorkItemClick, showParent }) {
  if (!items?.length) {
    return <div style={{ textAlign: 'center', padding: '40px 0', fontSize: 13, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>No work items found</div>;
  }

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
      <table className="tbl">
        <thead>
          <tr>
            <th>ID</th>
            <th>Title</th>
            <th>Type</th>
            {showParent && <th>Parent / Epic</th>}
            <th>Status</th>
            <th>Developer</th>
            <th>Bugs / Flags</th>
          </tr>
        </thead>
        <tbody>
          {items.map(wi => (
            <WorkItemRow key={wi.id} wi={wi} onWorkItemClick={onWorkItemClick} showParent={showParent} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
