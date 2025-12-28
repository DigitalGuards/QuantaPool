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
          'bg': '#0a0f1a',
          'dark': '#0d1320',
          'darker': '#070b12',
          'card': 'rgba(13, 19, 32, 0.8)',
          'orange': '#f7931a',
          'cyan': '#22d3ee',
          'cyan-hover': '#06b6d4',
          'text': '#ffffff',
          'muted': '#9ca3af',
          'border': 'rgba(255, 255, 255, 0.1)',
        }
      },
      borderRadius: {
        'xl': '12px',
      },
      backgroundImage: {
        'circuit-pattern': "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg stroke='%23f7931a' stroke-opacity='0.05' stroke-width='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
      },
    },
  },
  plugins: [],
}
