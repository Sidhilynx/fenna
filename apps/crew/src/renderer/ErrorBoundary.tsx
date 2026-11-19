// Keeps a crash in one screen from blanking the window: the person sees what
// happened and can go back to the overview. It resets when the route changes.

import { Component, type ReactNode } from "react";

interface Props {
  resetKey: string;
  onBack(): void;
  children: ReactNode;
}

export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <main className="main crash" role="alert">
        <div className="px-panel crash-panel">
          <p className="crash-title">This screen hit an error.</p>
          <p className="crash-detail ell" title={error.message}>
            {error.message}
          </p>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              this.setState({ error: null });
              this.props.onBack();
            }}
          >
            Back to Crew
          </button>
        </div>
      </main>
    );
  }
}
