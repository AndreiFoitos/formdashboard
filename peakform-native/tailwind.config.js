const { colors, fontSize } = require('./theme/tokens')

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
    './features/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors,
      fontSize,
      borderRadius: { md: '8px', xl: '16px' },
    },
  },
  plugins: [],
}
