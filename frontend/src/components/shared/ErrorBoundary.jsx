import { Component } from 'react';
import ErrorBox from './ErrorBox';

/**
 * Route-level error boundary. Catches render errors and displays
 * a friendly fallback instead of crashing the entire app.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] Uncaught render error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 32 }}>
          <ErrorBox
            message={this.state.error?.message || 'Something went wrong rendering this page.'}
          />
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              marginTop: 16,
              padding: '8px 20px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              cursor: 'pointer',
              fontSize: 13,
              fontFamily: 'var(--font-mono)',
            }}
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
