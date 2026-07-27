/** @type {import('tailwindcss').Config} */

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
    },
    extend: {
      colors: {
        // TRAE Design System — AI-native workspace aesthetic
        trae: {
          bg: '#080c14',
          'bg-elevated': '#0f172a',
          surface: '#111827',
          'surface-elevated': '#1e293b',
          border: 'rgba(255, 255, 255, 0.08)',
          'border-strong': 'rgba(255, 255, 255, 0.14)',
          text: '#f8fafc',
          muted: '#94a3b8',
          'muted-subtle': '#64748b',
          primary: '#3b82f6',
          'primary-light': '#60a5fa',
          'primary-glow': 'rgba(59, 130, 246, 0.35)',
          accent: '#06b6d4',
          'accent-glow': 'rgba(6, 182, 212, 0.35)',
          success: '#22c55e',
          warning: '#f59e0b',
          danger: '#ef4444',
          purple: '#8b5cf6',
        },
        // Legacy arena aliases mapped to TRAE palette
        arena: {
          bg: '#080c14',
          surface: '#111827',
          elevated: '#1e293b',
          border: 'rgba(255, 255, 255, 0.08)',
          gold: '#3b82f6',
          'gold-light': '#60a5fa',
          'gold-dark': '#2563eb',
          blue: '#1d4ed8',
          'blue-glow': '#3b82f6',
          red: '#dc2626',
          'red-glow': '#ef4444',
          text: '#f8fafc',
          muted: '#94a3b8',
        },
      },
      fontFamily: {
        sans: [
          '"Inter"',
          '"PingFang SC"',
          '"Microsoft YaHei"',
          'system-ui',
          'sans-serif',
        ],
        display: [
          '"Inter"',
          '"PingFang SC"',
          '"Microsoft YaHei"',
          'system-ui',
          'sans-serif',
        ],
        mono: [
          '"JetBrains Mono"',
          '"SF Mono"',
          '"Consolas"',
          'monospace',
        ],
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
        '4xl': '2rem',
      },
      boxShadow: {
        'glow-gold': '0 0 24px rgba(59, 130, 246, 0.25)',
        'glow-blue': '0 0 24px rgba(59, 130, 246, 0.3)',
        'glow-red': '0 0 24px rgba(239, 68, 68, 0.3)',
        'glow-accent': '0 0 32px rgba(6, 182, 212, 0.2)',
        'surface': '0 4px 24px rgba(0, 0, 0, 0.24)',
        'surface-lg': '0 12px 40px rgba(0, 0, 0, 0.35)',
      },
      animation: {
        pulseSlow: 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        float: 'float 3s ease-in-out infinite',
        shimmer: 'shimmer 2.5s linear infinite',
        'fade-in': 'fadeIn 0.4s ease-out',
        'slide-up': 'slideUp 0.4s ease-out',
        'scale-in': 'scaleIn 0.3s ease-out',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'trae-gradient': 'linear-gradient(135deg, #3b82f6 0%, #06b6d4 50%, #8b5cf6 100%)',
        'trae-hero': 'radial-gradient(ellipse 80% 60% at 50% -20%, rgba(59, 130, 246, 0.18), transparent), radial-gradient(ellipse 60% 50% at 80% 100%, rgba(139, 92, 246, 0.12), transparent)',
      },
    },
  },
  plugins: [],
};
