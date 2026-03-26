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
          950: '#060608',
          900: '#0a0a0f',
          800: '#0f0f18',
          700: '#14141f',
          600: '#1a1a28',
          500: '#22223a',
          400: '#2d2d4a',
          300: '#3d3d60',
          200: '#5a5a80',
          100: '#8888aa',
          50: '#b0b0c8',
        },
        gold: {
          600: '#8b6914',
          500: '#c9930a',
          400: '#e8a820',
          300: '#f4c048',
          200: '#f8d470',
          100: '#fce9a8',
        },
      },
      backgroundImage: {
        'gold-gradient': 'linear-gradient(90deg, #8b6914, #e8a820)',
        'gold-gradient-v': 'linear-gradient(180deg, #f4c048, #c9930a)',
      },
      boxShadow: {
        gold: '0 0 30px rgba(232,168,32,0.2)',
        'gold-lg': '0 8px 40px rgba(232,168,32,0.3)',
        glow: '0 0 60px rgba(232,168,32,0.15)',
      },
      animation: {
        'spin-slow': 'spin 3s linear infinite',
        'pulse-gold': 'pulseGold 2s ease-in-out infinite',
        'fade-up': 'fadeUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'slide-in': 'slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
      },
      keyframes: {
        pulseGold: {
          '0%, 100%': { boxShadow: '0 0 20px rgba(232,168,32,0.2)' },
          '50%': { boxShadow: '0 0 40px rgba(232,168,32,0.5)' },
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
