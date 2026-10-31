/** @type {import('tailwindcss').Config} */
// Design tokens shared by every screen (agents: use these names, do not hard-code hex values in components).
export default {
  content: ['./client/index.html', './client/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#F6F4F1',      // page background (warm neutral)
        surface: '#FFFFFF',     // cards, panels
        sunken: '#EFECE7',      // table headers, inputs, tab bar
        line: '#E3DED6',        // borders
        ink: { DEFAULT: '#1D1B19', soft: '#4A4642', muted: '#7A746C' },
        brand: { DEFAULT: '#D04A02', dark: '#A83C02', soft: '#FCEBDD', ring: '#F4B07F' },
        rose: { DEFAULT: '#C8312A', soft: '#FBE4E1' },
        amber: { DEFAULT: '#C98A00', soft: '#FFF3D1' },
        green: { DEFAULT: '#2F7D4F', soft: '#E1F2E7' },
        blue: { DEFAULT: '#2C5F8A', soft: '#E3EDF6' },
        piku: { DEFAULT: '#5B3FD0', soft: '#ECE7FD' },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        display: ['"Fraunces"', 'Georgia', 'serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(29,27,25,0.06), 0 1px 1px rgba(29,27,25,0.04)',
        panel: '-12px 0 32px rgba(29,27,25,0.12)',
        pop: '0 12px 32px rgba(29,27,25,0.18)',
      },
      borderRadius: { xl: '14px' },
    },
  },
  plugins: [],
};
