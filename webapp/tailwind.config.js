/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'qrl': {
          'primary': '#00a3ff',
          'secondary': '#0066cc',
          'dark': '#0a1628',
          'darker': '#060d18',
          'accent': '#00ff88',
        }
      }
    },
  },
  plugins: [],
}
