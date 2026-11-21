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
      fontFamily: { display: ['"Playfair Display"', 'Georgia', 'serif'], sans: ['"Inter Variable"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'], mono: ['"Inter Variable"', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      backgroundImage: { gold: 'linear-gradient(135deg, #F5D76E 0%, #D4AF37 48%, #B8860B 100%)' },
    },
  },
  plugins: [],
};
