/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Instrument Serif', 'Georgia', 'serif'],
        body: ['Geist', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono', 'Fira Code', 'monospace'],
      },
      colors: {
        ink: {
          950: '#050809',
          900: '#0B0F10',
          800: '#0d1214',
          700: '#111827',
          600: '#161f2a',
          500: '#1F2937',
          400: '#2a3545',
          300: '#374151',
          200: '#6B7280',
          100: '#9CA3AF',
          50: '#E5E7EB',
        },
        gold: {
          600: '#0c5a54',
          500: '#0F766E',
          400: '#0F766E',
          300: '#14B8A6',
          200: '#2DD4BF',
          100: '#99f6e4',
        },
      },
      backgroundImage: {
        'gold-gradient': 'linear-gradient(90deg, #0F766E, #14B8A6)',
        'gold-gradient-v': 'linear-gradient(180deg, #14B8A6, #0F766E)',
      },
      boxShadow: {
        gold: '0 0 24px rgba(15,118,110,0.25)',
        'gold-lg': '0 8px 40px rgba(15,118,110,0.3)',
        glow: '0 0 50px rgba(20,184,166,0.12)',
      },
      animation: {
        'spin-slow': 'spin 3s linear infinite',
        'pulse-gold': 'pulseGold 2s ease-in-out infinite',
        'fade-up': 'fadeUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'slide-in': 'slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
      },
      keyframes: {
        pulseGold: {
          '0%, 100%': { boxShadow: '0 0 20px rgba(15,118,110,0.2)' },
          '50%': { boxShadow: '0 0 40px rgba(20,184,166,0.4)' },
        },
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        slideIn: {
          from: { opacity: '0', transform: 'translateX(-12px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
      },
    },
  },
  plugins: [],
};
