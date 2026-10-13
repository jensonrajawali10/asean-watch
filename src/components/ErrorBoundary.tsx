// Keeps one failing panel (for example the map) from blanking the whole dashboard.
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  /** Rendered instead of the children after an error. */
  fallback: (message: string) => ReactNode;
  /** Changing this value clears a previous error and retries the children. */
  resetKey?: unknown;
  children: ReactNode;
}

interface State {
  error: Error | null;
  resetKey: unknown;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('ASEAN Watch panel error:', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) return this.props.fallback(this.state.error.message || 'Unknown error');
    return this.props.children;
  }
}
