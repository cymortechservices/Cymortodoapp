/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: { 950: 'rgb(var(--c-bg) / <alpha-value>)', 900: 'rgb(var(--c-surface) / <alpha-value>)', 800: 'rgb(var(--c-raised) / <alpha-value>)', 700: 'rgb(var(--c-line) / <alpha-value>)' },
        fg: { DEFAULT: 'rgb(var(--c-fg) / <alpha-value>)', dim: 'rgb(var(--c-dim) / <alpha-value>)' },
        accent: { DEFAULT: 'rgb(var(--c-accent) / <alpha-value>)', 2: 'rgb(var(--c-accent2) / <alpha-value>)' },
        good: 'rgb(var(--c-good) / <alpha-value>)', warn: 'rgb(var(--c-warn) / <alpha-value>)', bad: 'rgb(var(--c-bad) / <alpha-value>)',
      },
      fontFamily: { display: ['"Outfit Variable"', 'Outfit', 'ui-sans-serif', 'system-ui', 'sans-serif'], sans: ['"Plus Jakarta Sans Variable"', '"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'], mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'] },
      fontSize: { xs: ['0.8125rem', { lineHeight: '1.3rem' }], sm: ['0.9375rem', { lineHeight: '1.55rem' }], base: ['1rem', { lineHeight: '1.7rem' }], lg: ['1.1875rem', { lineHeight: '1.8rem' }], xl: ['1.375rem', { lineHeight: '1.9rem' }], '2xl': ['1.75rem', { lineHeight: '2.2rem' }], '3xl': ['2.1rem', { lineHeight: '2.5rem' }] },
      backgroundImage: { gold: 'linear-gradient(135deg, #F5D76E 0%, #D4AF37 48%, #B8860B 100%)' },
    },
  },
  plugins: [],
};
