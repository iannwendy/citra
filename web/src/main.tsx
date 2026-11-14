import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { CitraMotionProvider } from './components/ui/motion-primitives';
import { VerificationProgressProvider } from './contexts/VerificationProgressContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { queryClient } from '@/lib/queryClient';
import './i18n';
import './index.css';

// Error Fallback Component
function GlobalErrorFallback(): JSX.Element {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 px-4">
      <div className="max-w-md w-full text-center">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
          <svg className="w-8 h-8 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-2">
          Something went wrong
        </h1>
        <p className="text-slate-600 dark:text-slate-400 mb-6">
          An unexpected error occurred. Please try refreshing the page.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors"
        >
          Refresh Page
        </button>
      </div>
    </div>
  );
}

const rootElement = document.getElementById('root')!;
const globalWithRoot = window as unknown as { __citraReactRoot?: ReactDOM.Root };
if (!globalWithRoot.__citraReactRoot) {
  globalWithRoot.__citraReactRoot = ReactDOM.createRoot(rootElement);
}

globalWithRoot.__citraReactRoot.render(
  <React.StrictMode>
    <ErrorBoundary fallback={<GlobalErrorFallback />}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <CitraMotionProvider>
            <ToastProvider position="bottom-right" maxToasts={5}>
              <AuthProvider>
                <VerificationProgressProvider
                  onNavigate={(path) => {
                    void router.navigate(path);
                  }}
                >
                  <RouterProvider router={router} future={{ v7_startTransition: true }} />
                </VerificationProgressProvider>
              </AuthProvider>
            </ToastProvider>
          </CitraMotionProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
