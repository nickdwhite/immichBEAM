import forms from "@tailwindcss/forms";

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Primary accent — the logo's blue (#0088ff).
        brand: {
          50: '#eef7ff',
          100: '#d9edff',
          200: '#b6dcff',
          300: '#84c4ff',
          400: '#48a6fb',
          500: '#1a90f5',
          600: '#0a78dd',
          700: '#0c60b4',
          800: '#104e90',
          900: '#134173',
          950: '#0c294b',
        },
        // Warm accent / alerts — the logo's orange (#f08000). Kept under the
        // `immich` key so existing usages re-theme without edits.
        immich: {
          50: '#fff6ed',
          100: '#ffe9d2',
          200: '#fed0a6',
          300: '#fdb06d',
          400: '#fb8b34',
          500: '#f5800c',
          600: '#e06b08',
          700: '#b95208',
          800: '#93420f',
          900: '#773810',
          950: '#401906',
        },
        // The logo's dark navy (#0d111b) + container slate, for dark surfaces.
        navy: {
          50: '#f2f5fa',
          100: '#e3e8f1',
          200: '#c8d1e3',
          300: '#9fadc8',
          400: '#6f80a4',
          500: '#4c5d80',
          600: '#394968',
          700: '#2b3850',
          800: '#1d2740',
          900: '#131b30',
          950: '#0d111b',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['SF Mono', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [forms],
}
