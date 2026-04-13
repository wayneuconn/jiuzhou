/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        pitch:         '#0D1117',
        navy:          '#0F1923',
        'navy-light':  '#1A2535',
        surface:       '#1E2D3D',
        teal:          '#00C9A7',
        'teal-dark':   '#009E82',
        gold:          '#F0B429',
        'gold-dark':   '#C99B22',
        slate:         '#7A8FA6',
        muted:         '#3A4E63',
        'red-hot':     '#E53E3E',
        'team-a':      '#3B82F6',
        'team-b':      '#EF4444',
      },
      backgroundImage: {
        'hero-glow': 'radial-gradient(ellipse at top, rgba(0,201,167,0.15) 0%, transparent 70%)',
      },
    },
  },
  plugins: [],
}
