/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html","./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter','system-ui','sans-serif'], display: ['Space Grotesk','sans-serif'] },
      colors: {
        brand: { 50:'#f0fdf4', 400:'#4ade80', 500:'#22c55e', 600:'#16a34a', 900:'#14532d' },
        dark: { 900:'#0a0f0a', 800:'#111b11', 700:'#1a2a1a', 600:'#243324' }
      }
    }
  },
  plugins: []
}
