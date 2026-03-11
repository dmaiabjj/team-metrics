// PageShell is now a pass-through — the shell layout (Sidebar + Topbar)
// lives in App.jsx. This wrapper exists for backward compatibility with
// pages that haven't been rewritten yet.
export default function PageShell({ children }) {
  return <>{children}</>;
}
