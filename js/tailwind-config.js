const cssColor = name => `rgb(var(--${name}) / <alpha-value>)`;

tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace']
      },
      colors: {
        ocean: {
          950: cssColor('ocean-950'),
          900: cssColor('ocean-900'),
          850: cssColor('ocean-850'),
          800: cssColor('ocean-800'),
          700: cssColor('ocean-700'),
          600: cssColor('ocean-600'),
          500: cssColor('ocean-500'),
          400: cssColor('ocean-400')
        },
        slate: {
          100: cssColor('slate-100'),
          200: cssColor('slate-200'),
          300: cssColor('slate-300'),
          400: cssColor('slate-400'),
          500: cssColor('slate-500'),
          600: cssColor('slate-600')
        },
        cyan: {
          300: cssColor('cyan-300'),
          400: cssColor('cyan-400'),
          500: cssColor('cyan-500'),
          600: cssColor('cyan-600')
        },
        blue: {
          600: cssColor('blue-600')
        },
        indigo: {
          300: cssColor('indigo-300'),
          400: cssColor('indigo-400'),
          700: cssColor('indigo-700'),
          800: cssColor('indigo-800'),
          950: cssColor('indigo-950')
        },
        emerald: {
          300: cssColor('emerald-300'),
          400: cssColor('emerald-400'),
          800: cssColor('emerald-800'),
          950: cssColor('emerald-950')
        },
        amber: {
          200: cssColor('amber-200'),
          300: cssColor('amber-300'),
          400: cssColor('amber-400'),
          500: cssColor('amber-500'),
          950: cssColor('amber-950')
        },
        rose: {
          300: cssColor('rose-300'),
          400: cssColor('rose-400'),
          500: cssColor('rose-500')
        }
      }
    }
  }
};
