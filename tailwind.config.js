/** @type {import('tailwindcss').Config} */
// Design tokens shared by every screen. Colours are CSS variables (see client/src/index.css) so the
// high-contrast accessibility mode can swap them at runtime. Use these names, never hard-coded hex values.
const v = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

export default {
  content: ['./client/index.html', './client/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: v('canvas'),          // page background (cool paper grey)
        surface: v('surface'),        // cards, panels, inputs
        sunken: v('sunken'),          // table headers, inactive tabs, tracks
        line: { DEFAULT: v('line'), strong: v('line-strong') },
        chrome: { DEFAULT: v('chrome'), soft: v('chrome-soft'), text: v('chrome-text'), muted: v('chrome-muted') }, // dark workspace bar
        ink: { DEFAULT: v('ink'), soft: v('ink-soft'), muted: v('ink-muted') },
        brand: { DEFAULT: v('brand'), dark: v('brand-dark'), bright: v('brand-bright'), soft: v('brand-soft'), ring: v('brand-ring') },
        link: { DEFAULT: v('link'), soft: v('link-soft') },
        rose: { DEFAULT: v('rose'), soft: v('rose-soft') },
        amber: { DEFAULT: v('amber'), soft: v('amber-soft') },
        green: { DEFAULT: v('green'), soft: v('green-soft') },
        blue: { DEFAULT: v('blue'), soft: v('blue-soft') },
        piku: { DEFAULT: v('piku'), soft: v('piku-soft') },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        display: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgb(22 25 29 / 0.06)',
        raise: '0 1px 2px rgb(22 25 29 / 0.08), 0 4px 12px rgb(22 25 29 / 0.08)',
        panel: '-12px 0 32px rgb(22 25 29 / 0.16)',
        pop: '0 12px 32px rgb(22 25 29 / 0.20)',
        tab: '0 -1px 0 0 rgb(var(--c-line)) inset',
      },
      borderRadius: { xl: '12px' },
    },
  },
  plugins: [],
};
