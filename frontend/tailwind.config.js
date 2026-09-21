/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter Variable", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      /* Accent palette backed by CSS variables so the user can recolor the
         UI at runtime (settings → accent color). Defaults = emerald. */
      colors: {
        accent: {
          50: "rgb(var(--ka-accent-50) / <alpha-value>)",
          100: "rgb(var(--ka-accent-100) / <alpha-value>)",
          200: "rgb(var(--ka-accent-200) / <alpha-value>)",
          300: "rgb(var(--ka-accent-300) / <alpha-value>)",
          400: "rgb(var(--ka-accent-400) / <alpha-value>)",
          500: "rgb(var(--ka-accent-500) / <alpha-value>)",
          600: "rgb(var(--ka-accent-600) / <alpha-value>)",
          700: "rgb(var(--ka-accent-700) / <alpha-value>)",
          800: "rgb(var(--ka-accent-800) / <alpha-value>)",
          900: "rgb(var(--ka-accent-900) / <alpha-value>)",
        },
      },
    },
  },
  plugins: [],
};
