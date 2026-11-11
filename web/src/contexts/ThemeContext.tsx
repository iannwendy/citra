/**
 * Theme Context
 * Manages light/dark/system theme with persistence
 */
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Moon, Sun, Monitor } from 'lucide-react';

// ============================================================
// Types
// ============================================================

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

// ============================================================
// Constants
// ============================================================

const STORAGE_KEY = 'theme';

// ============================================================
// Provider Component
// ============================================================

interface ThemeProviderProps {
  children: ReactNode;
  /** Default theme if none stored (default: 'system') */
  defaultTheme?: Theme;
}

export function ThemeProvider({
  children,
  defaultTheme = 'system',
}: ThemeProviderProps): ReactNode {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === 'undefined') return defaultTheme;
    return (localStorage.getItem(STORAGE_KEY) as Theme) || defaultTheme;
  });

  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light');

  // Resolve actual theme based on theme setting and system preference
  useEffect(() => {
    const root = document.documentElement;

    const applyTheme = (resolved: ResolvedTheme): void => {
      root.classList.remove('light', 'dark');
      root.classList.add(resolved);
      setResolvedTheme(resolved);
    };

    const getSystemTheme = (): ResolvedTheme => {
      if (typeof window === 'undefined') return 'light';
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    };

    if (theme === 'system') {
      applyTheme(getSystemTheme());

      // Listen for system theme changes
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = (e: MediaQueryListEvent) => {
        if (theme === 'system') {
          applyTheme(e.matches ? 'dark' : 'light');
        }
      };

      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    } else {
      applyTheme(theme);
    }
  }, [theme]);

  // Set theme and persist
  const setTheme = useCallback((newTheme: Theme): void => {
    localStorage.setItem(STORAGE_KEY, newTheme);
    setThemeState(newTheme);
  }, []);

  // Toggle theme (light -> dark -> system -> light)
  const toggleTheme = useCallback((): void => {
    const nextTheme: Record<Theme, Theme> = {
      light: 'dark',
      dark: 'system',
      system: 'light',
    };
    setTheme(nextTheme[theme]);
  }, [theme, setTheme]);

  const value: ThemeContextValue = {
    theme,
    resolvedTheme,
    setTheme,
    toggleTheme,
    isDark: resolvedTheme === 'dark',
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

// ============================================================
// Hook
// ============================================================

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

// ============================================================
// Theme Toggle Component
// ============================================================

interface ThemeToggleProps {
  /** Show label next to icon */
  showLabel?: boolean;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Additional CSS classes */
  className?: string;
}

export function ThemeToggle({
  showLabel = false,
  size = 'md',
  className = '',
}: ThemeToggleProps): ReactNode {
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();

  const sizeClasses = {
    sm: 'p-1.5',
    md: 'p-2',
    lg: 'p-3',
  };

  const iconSizes = {
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-6 h-6',
  };

  const labelSizes = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base',
  };

  const themeIcons: Record<Theme, ReactNode> = {
    light: <Sun className={`${iconSizes[size]} text-amber-500`} />,
    dark: <Moon className={`${iconSizes[size]} text-indigo-400`} />,
    system: <Monitor className={`${iconSizes[size]} text-slate-500`} />,
  };

  const themeLabels: Record<Theme, string> = {
    light: 'Light',
    dark: 'Dark',
    system: 'System',
  };

  const translatedLabels: Record<Theme, string> = {
    light: t('settings.themeLight'),
    dark: t('settings.themeDark'),
    system: t('settings.themeSystem'),
  };

  return (
    <button
      onClick={() => {
        const nextTheme: Record<Theme, Theme> = {
          light: 'dark',
          dark: 'system',
          system: 'light',
        };
        setTheme(nextTheme[theme]);
      }}
      className={`
        inline-flex items-center gap-2 rounded-lg
        text-slate-600 dark:text-slate-400
        hover:bg-slate-100 dark:hover:bg-slate-800
        hover:text-slate-900 dark:hover:text-slate-100
        transition-colors duration-200
        ${sizeClasses[size]}
        ${className}
      `}
      title={`Theme: ${themeLabels[theme]}`}
      aria-label={`Current theme: ${themeLabels[theme]}. Click to change.`}
    >
      <span className="inline-grid place-items-center">
        {(['light', 'dark', 'system'] as const).map((mode) => {
          const isCurrent = theme === mode;
          return (
            <span
              key={mode}
              aria-hidden={!isCurrent}
              style={{
                gridArea: '1 / 1',
                opacity: isCurrent ? 1 : 0,
                filter: isCurrent ? 'blur(0px)' : 'blur(var(--icon-swap-blur, 2px))',
                transform: isCurrent ? 'scale(1)' : 'scale(var(--icon-swap-start-scale, 0.25))',
                transition:
                  'opacity var(--icon-swap-dur, 250ms) var(--icon-swap-ease, ease-in-out), filter var(--icon-swap-dur, 250ms) var(--icon-swap-ease, ease-in-out), transform var(--icon-swap-dur, 250ms) var(--icon-swap-ease, ease-in-out)',
              }}
              className="inline-flex items-center justify-center"
            >
              {themeIcons[mode]}
            </span>
          );
        })}
      </span>
      {showLabel && (
        <span className={`${labelSizes[size]} font-medium`}>
          {translatedLabels[theme]}
        </span>
      )}
    </button>
  );
}

// ============================================================
// Dark Mode Utility Hook
// ============================================================

/**
 * Hook to check if dark mode is active
 * Use this in components that need to conditionally render
 */
export function useDarkMode(): boolean {
  const { isDark } = useTheme();
  return isDark;
}

// ============================================================
// CSS Class Helper
// ============================================================

/**
 * Returns classes for dark mode variants
 * @example
 * const classes = darkLight('bg-white', 'bg-slate-900');
 * // Returns 'bg-white dark:bg-slate-900'
 */
export function darkLight(lightClass: string, darkClass: string): string {
  return `${lightClass} dark:${darkClass}`;
}

export default ThemeProvider;
