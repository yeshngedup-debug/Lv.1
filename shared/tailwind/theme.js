import { defineConfig } from 'tailwindcss';

export default defineConfig({
  content: [
    '../host-dashboard/src/**/*.{js,jsx}',
    '../participant-page/src/**/*.{js,jsx}'
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#0a0a0f',
          subtle: '#14141c',
          card: 'rgba(18, 18, 26, 0.92)',
          hover: 'rgba(24, 24, 34, 0.96)',
          elevated: '#1e1e2e',
        },
        accent: {
          violet: { DEFAULT: '#8b5cf6', light: '#a78bfa', soft: '#e9d8fd' },
          cyan: { DEFAULT: '#06b6d4', light: '#22d3ee', soft: '#e0f7fa' },
          magenta: { DEFAULT: '#d946ef', light: '#e879f9', soft: '#faf5ff' },
          green: { DEFAULT: '#10b981', light: '#34d399', soft: '#d1fae5' },
          amber: { DEFAULT: '#f59e0b', light: '#fbbf24', soft: '#fffbeb' },
          rose: { DEFAULT: '#f43f5e', light: '#fb7185', soft: '#fee2f2' },
        },
        text: {
          primary: '#f4f4f5',
          secondary: '#a1a1aa',
          tertiary: '#71717a',
          meta: '#52525b',
        }
      },
      fontFamily: {
        sans: ['Inter Variable', 'Inter', 'system-ui', 'sans-serif'],
        data: ['JetBrains Mono Variable', 'JetBrains Mono', 'monospace'],
        display: ['Space Grotesk Variable', 'Space Grotesk', 'sans-serif'],
        mono: ['JetBrains Mono Variable', 'JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        sm: '6px',
        md: '10px',
        lg: '14px',
        xl: '18px',
      },
      boxShadow: {
        'glow-sm': '0 0 0 1px rgba(139, 92, 246, 0.15), 0 2px 8px -2px rgba(139, 92, 246, 0.25)',
        'glow-md': '0 0 0 1px rgba(139, 92, 246, 0.15), 0 4px 20px -4px rgba(139, 92, 246, 0.35)',
        'glow-lg': '0 0 0 1px rgba(139, 92, 246, 0.2), 0 12px 40px -8px rgba(139, 92, 246, 0.45)',
        'glass': '0 8px 32px -4px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
        'glass-lg': '0 16px 48px -8px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.06)',
      },
      animation: {
        'pulse-ring': 'pulse-ring 1.8s ease-in-out infinite',
        'eq-breathe': 'eq-breathe var(--d, 1s) ease-in-out infinite var(--delay, 0s)',
        'eq-dance': 'eq-dance var(--d, 0.6s) ease-in-out infinite var(--delay, 0s)',
        'shimmer': 'shimmer 2s linear infinite',
        'float': 'float 6s ease-in-out infinite',
        'glow-pulse': 'glow-pulse 2s ease-in-out infinite',
        'slide-up': 'slide-up 0.3s ease-out',
        'slide-down': 'slide-down 0.3s ease-out',
        'fade-in': 'fade-in 0.2s ease-out',
        'scale-in': 'scale-in 0.2s ease-out',
        'spin-slow': 'spin 3s linear infinite',
      },
      keyframes: {
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 rgba(16, 185, 129, 0.55)' },
          '70%': { boxShadow: '0 0 0 6px rgba(16, 185, 129, 0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(16, 185, 129, 0)' },
        },
        'eq-breathe': {
          '0%, 100%': { height: '15%' },
          '50%': { height: 'var(--h, 80%)' },
        },
        'eq-dance': {
          '0%, 100%': { height: 'var(--h, 60%)' },
          '50%': { height: '12%' },
        },
        'shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        'glow-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-down': {
          '0%': { opacity: '0', transform: 'translateY(-8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
      backdropBlur: {
        xs: '2px',
      },
      spacing: {
        '4.5': '18px',
        '13': '52px',
        '15': '60px',
      },
      transitionDuration: {
        '250': '250ms',
        '350': '350ms',
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
});
