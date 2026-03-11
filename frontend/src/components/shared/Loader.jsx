export default function Loader({ message = 'Loading…' }) {
  return <div className="loading"><div className="spinner" /><span>{message}</span></div>;
}
