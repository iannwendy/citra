import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      /* Verdict Colors & Solva Warm Editorial Palette */
      colors: {
        slate: {
          50: '#FBFAF6',
          100: '#F4F2EC',
          200: '#E7E3D9',
          300: '#D6D0C4',
          400: '#8C887E',
          500: '#6E695F',
          600: '#56524A',
          700: '#3D3A33',
          800: '#26231D',
          900: '#1C1A15',
          950: '#141310',
        },
        indigo: {
          50: '#F4F2EC',
          100: '#ECE9E0',
          200: '#E7E3D9',
          300: '#D6D0C4',
          400: '#B8B1A4',
          500: '#56524A',
          600: '#1C1A15',
          700: '#2E2B23',
          800: '#3A352C',
          900: '#24211B',
          950: '#181612',
        },
        verdict: {
          verified: 'hsl(var(--verdict-verified))',
          'metadata-error': 'hsl(var(--verdict-metadata-error))',
          suspected: 'hsl(var(--verdict-suspected))',
          unresolved: 'hsl(var(--verdict-unresolved))',
        },
        mapping: {
          matched: 'hsl(var(--mapping-matched))',
          missing: 'hsl(var(--mapping-missing))',
          uncited: 'hsl(var(--mapping-uncited))',
          mismatch: 'hsl(var(--mapping-mismatch))',
          duplicate: 'hsl(var(--mapping-duplicate))',
          ambiguous: 'hsl(var(--mapping-ambiguous))',
          style: 'hsl(var(--mapping-style))',
          unresolved: 'hsl(var(--mapping-unresolved))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          hover: 'hsl(var(--primary-hover))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
      },

      /* Border Radius */
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        xl: 'calc(var(--radius) + 4px)',
      },

      /* Shadows */
      boxShadow: {
        sm: 'var(--shadow-sm)',
        DEFAULT: 'var(--shadow)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        xl: 'var(--shadow-xl)',
      },

      /* Font Family — Unified Solva Editorial System (Onest + Sentient) */
      fontFamily: {
        sans: ['Onest', 'Inter', 'system-ui', 'sans-serif'],
        serif: ['Sentient', 'Source Serif 4', 'Georgia', 'serif'],
        display: ['Sentient', 'Source Serif 4', 'Georgia', 'serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },

      /* Animation — 120fps GPU-Composited Spring & Editorial Curves */
      animation: {
        'fade-in': 'fadeIn 220ms cubic-bezier(0.22, 1, 0.36, 1)',
        'slide-up': 'slideUp 340ms cubic-bezier(0.22, 1, 0.36, 1)',
        'slide-down': 'slideDown 240ms cubic-bezier(0.22, 1, 0.36, 1)',
        'scale-in': 'scaleIn 260ms cubic-bezier(0.22, 1, 0.36, 1)',
        'dialog-overlay-in':
          'dialogOverlayIn var(--modal-open-dur, 250ms) var(--modal-ease, cubic-bezier(0.22, 1, 0.36, 1)) forwards',
        'dialog-overlay-out':
          'dialogOverlayOut var(--modal-close-dur, 150ms) var(--modal-ease, cubic-bezier(0.22, 1, 0.36, 1)) forwards',
        'dialog-content-in':
          'dialogContentIn var(--modal-open-dur, 250ms) var(--modal-ease, cubic-bezier(0.22, 1, 0.36, 1)) forwards',
        'dialog-content-out':
          'dialogContentOut var(--modal-close-dur, 150ms) var(--modal-ease, cubic-bezier(0.22, 1, 0.36, 1)) forwards',
        'dropdown-in':
          'dropdownIn var(--dropdown-open-dur, 250ms) var(--dropdown-ease, cubic-bezier(0.22, 1, 0.36, 1)) forwards',
        'dropdown-out':
          'dropdownOut var(--dropdown-close-dur, 150ms) var(--dropdown-ease, cubic-bezier(0.22, 1, 0.36, 1)) forwards',
        'pulse-soft': 'pulseSoft 2.2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'toast-enter': 'citraToastEnter 380ms cubic-bezier(0.22, 1, 0.36, 1) forwards',
        'toast-exit': 'citraToastExit 220ms cubic-bezier(0.4, 0, 1, 1) forwards',
        'shimmer-wave': 'citraShimmerWave 1.6s cubic-bezier(0.4, 0, 0.2, 1) infinite',
        'icon-pop': 'citraIconPop 420ms cubic-bezier(0.34, 1.56, 0.64, 1) both',
      },

      /* Keyframes — Pure transform3d & opacity for zero main-thread repaint */
      keyframes: {
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        dialogOverlayIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        dialogOverlayOut: {
          from: { opacity: '1' },
          to: { opacity: '0' },
        },
        dialogContentIn: {
          from: {
            opacity: '0',
            transform: 'translate3d(-50%, calc(-50% + 6px), 0) scale3d(0.96, 0.96, 1)',
          },
          to: {
            opacity: '1',
            transform: 'translate3d(-50%, -50%, 0) scale3d(1, 1, 1)',
          },
        },
        dialogContentOut: {
          from: {
            opacity: '1',
            transform: 'translate3d(-50%, -50%, 0) scale3d(1, 1, 1)',
          },
          to: {
            opacity: '0',
            transform: 'translate3d(-50%, calc(-50% + 4px), 0) scale3d(0.96, 0.96, 1)',
          },
        },
        dropdownIn: {
          from: {
            opacity: '0',
            transform: 'scale3d(0.97, 0.97, 1) translate3d(0, -4px, 0)',
          },
          to: {
            opacity: '1',
            transform: 'scale3d(1, 1, 1) translate3d(0, 0, 0)',
          },
        },
        dropdownOut: {
          from: {
            opacity: '1',
            transform: 'scale3d(1, 1, 1) translate3d(0, 0, 0)',
          },
          to: {
            opacity: '0',
            transform: 'scale3d(0.99, 0.99, 1) translate3d(0, -2px, 0)',
          },
        },
        slideUp: {
          from: { transform: 'translate3d(0, 18px, 0) scale3d(0.97, 0.97, 1)', opacity: '0' },
          to: { transform: 'translate3d(0, 0, 0) scale3d(1, 1, 1)', opacity: '1' },
        },
        slideDown: {
          from: { transform: 'translate3d(0, -10px, 0) scale3d(0.98, 0.98, 1)', opacity: '0' },
          to: { transform: 'translate3d(0, 0, 0) scale3d(1, 1, 1)', opacity: '1' },
        },
        scaleIn: {
          from: { transform: 'scale3d(0.95, 0.95, 1) translate3d(0, 6px, 0)', opacity: '0' },
          to: { transform: 'scale3d(1, 1, 1) translate3d(0, 0, 0)', opacity: '1' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1', transform: 'scale3d(1, 1, 1)' },
          '50%': { opacity: '0.68', transform: 'scale3d(0.985, 0.985, 1)' },
        },
        citraToastEnter: {
          '0%': {
            opacity: '0',
            transform: 'translate3d(0, 22px, 0) scale3d(0.92, 0.92, 1)',
          },
          '65%': {
            opacity: '1',
            transform: 'translate3d(0, -2px, 0) scale3d(1.008, 1.008, 1)',
          },
          '100%': {
            opacity: '1',
            transform: 'translate3d(0, 0, 0) scale3d(1, 1, 1)',
          },
        },
        citraToastExit: {
          '0%': {
            opacity: '1',
            transform: 'translate3d(0, 0, 0) scale3d(1, 1, 1)',
          },
          '100%': {
            opacity: '0',
            transform: 'translate3d(0, 12px, 0) scale3d(0.94, 0.94, 1)',
          },
        },
        citraShimmerWave: {
          '0%': { transform: 'translate3d(-100%, 0, 0)' },
          '100%': { transform: 'translate3d(100%, 0, 0)' },
        },
        citraIconPop: {
          '0%': { opacity: '0', transform: 'scale3d(0.5, 0.5, 1) rotate(-8deg)' },
          '65%': { opacity: '1', transform: 'scale3d(1.1, 1.1, 1) rotate(2deg)' },
          '100%': { opacity: '1', transform: 'scale3d(1, 1, 1) rotate(0deg)' },
        },
      },

      /* Spacing */
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
      },

      /* Container */
      container: {
        center: true,
        padding: '1.5rem',
        screens: {
          sm: '640px',
          md: '768px',
          lg: '1024px',
          xl: '1280px',
        },
      },
    },
  },
  plugins: [],
};

export default config;
