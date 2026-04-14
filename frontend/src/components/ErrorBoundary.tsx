import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCcw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error("Uncaught error", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-md rounded-xl border border-red-500/30 bg-red-500/5 p-6 text-center">
          <AlertTriangle
            size={36}
            className="mx-auto mb-3 text-red-600 dark:text-red-400"
          />
          <h1 className="mb-1 text-lg font-semibold text-foreground">
            Something went wrong
          </h1>
          <p className="mb-4 text-sm text-muted-foreground">
            {this.state.error.message || "Unknown error"}
          </p>
          <button
            onClick={() => {
              this.setState({ error: null });
              window.location.reload();
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <RefreshCcw size={14} /> Reload
          </button>
        </div>
      </div>
    );
  }
}
