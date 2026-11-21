/**
 * ErrorBoundary Component
 * Catches React render errors and displays localized fallback UI
 */
import { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import i18n from '@/i18n';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
  /** Fallback title shown in default error UI */
  title?: string;
  /** If true, shows in page-level style (full height) */
  pageLevel?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    this.props.onReset?.();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <DefaultErrorFallback
          error={this.state.error}
          errorInfo={this.state.errorInfo}
          onReset={this.handleReset}
          title={this.props.title}
          pageLevel={this.props.pageLevel}
        />
      );
    }

    return this.props.children;
  }
}

interface DefaultErrorFallbackProps {
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  onReset: () => void;
  title?: string;
  pageLevel?: boolean;
}

function DefaultErrorFallback({
  error,
  errorInfo,
  onReset,
  title,
  pageLevel = false,
}: DefaultErrorFallbackProps): ReactNode {
  const isVi = Boolean(i18n.language?.startsWith('vi'));
  const resolvedTitle = title ?? (isVi ? 'Đã xảy ra sự cố' : 'Something went wrong');
  const errorMessage =
    error?.message ||
    (isVi ? 'Đã có lỗi ngoài ý muốn xảy ra.' : 'An unexpected error occurred');

  if (pageLevel) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FBFAF6] dark:bg-[#141310] px-4">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <AlertTriangle className="w-8 h-8 text-red-600 dark:text-red-400" />
          </div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-2">
            {resolvedTitle}
          </h1>
          <p className="text-slate-600 dark:text-slate-400 mb-6">
            {errorMessage}
          </p>
          <div className="flex gap-3 justify-center">
            <button
              type="button"
              onClick={onReset}
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              {isVi ? 'Thử lại' : 'Try Again'}
            </button>
            <a
              href="/"
              className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg font-medium transition-colors"
            >
              {isVi ? 'Về trang chủ' : 'Go Home'}
            </a>
          </div>

          {/* Error details for development */}
          {import.meta.env.DEV && errorInfo && (
            <details className="mt-8 text-left">
              <summary className="cursor-pointer text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-400">
                {isVi
                  ? 'Chi tiết lỗi (Chế độ phát triển)'
                  : 'Error Details (Development)'}
              </summary>
              <pre className="mt-2 p-4 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs overflow-auto max-h-48">
                <code>
                  {error?.stack || errorMessage}
                  {'\n\n'}
                  {errorInfo.componentStack}
                </code>
              </pre>
            </details>
          )}
        </div>
      </div>
    );
  }

  // Component-level fallback (inline card)
  return (
    <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-red-800 dark:text-red-200">
            {resolvedTitle}
          </h3>
          <p className="text-sm text-red-600 dark:text-red-300 mt-1">
            {errorMessage}
          </p>
          <button
            type="button"
            onClick={onReset}
            className="mt-2 text-sm font-medium text-red-700 dark:text-red-200 hover:text-red-800 dark:hover:text-red-100 flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" />
            {isVi ? 'Thử lại' : 'Try again'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * HOC to wrap a component with error boundary
 */
export function withErrorBoundary<P extends object>(
  WrappedTarget: React.ComponentType<P>,
  fallback?: ReactNode,
  errorBoundaryProps?: Partial<ErrorBoundaryProps>,
): React.ComponentType<P> {
  const displayName = WrappedTarget.displayName || WrappedTarget.name || 'Component';

  function WrappedComponent(props: P): ReactNode {
    return (
      <ErrorBoundary {...errorBoundaryProps} fallback={fallback}>
        <WrappedTarget {...props} />
      </ErrorBoundary>
    );
  }

  WrappedComponent.displayName = `withErrorBoundary(${displayName})`;
  return WrappedComponent;
}
