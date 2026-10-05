import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Verde do Cerrado como cor da marca; laranja terroso para destaques.
        brand: {
          50: '#f1f8ec',
          100: '#dfeed5',
          200: '#c0deae',
          300: '#98c87d',
          400: '#72af54',
          500: '#549338',
          600: '#40752a',
          700: '#335a23',
          800: '#2b491f',
          900: '#263e1d',
        },
        earth: {
          500: '#c2651b',
          600: '#a24f12',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
