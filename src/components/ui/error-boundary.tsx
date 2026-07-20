'use client';

import { Component, type ReactNode, type ErrorInfo } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  /** Optional label for the error boundary (useful for nested boundaries) */
  label?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * ErrorBoundary — catches render errors in its subtree and shows a
 * branded fallback UI instead of unmounting the whole tree.
 *
 * Usage:
 *   <ErrorBoundary label="Reports Page">
 *     <ReportsPage />
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.label ? `:${this.props.label}` : ''}]`, error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.props.fallback) return this.props.fallback;

    return (
      <div className="flex flex-col items-center justify-center rounded-[10px] border border-status-error-bg bg-status-error-bg px-6 py-12 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-white text-status-error-text">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h3 className="text-sm font-semibold text-status-error-text">
          {this.props.label || 'Something went wrong'}
        </h3>
        <p className="mt-1 max-w-sm text-sm text-status-error-text/80">
          {this.state.error?.message || 'An unexpected error occurred while rendering this section.'}
        </p>
        <button
          onClick={this.handleRetry}
          className="mt-4 inline-flex items-center gap-2 rounded-[8px] bg-white px-4 py-2 text-sm font-medium text-status-error-text shadow-sm transition-colors hover:bg-white/90"
        >
          <RefreshCw className="h-4 w-4" />
          Try Again
        </button>
      </div>
    );
  }
}
