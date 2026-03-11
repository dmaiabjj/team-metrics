export default function ErrorBox({ message = 'Something went wrong' }) {
  return <div className="error-box">⚠ {message}</div>;
}
