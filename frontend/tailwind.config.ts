import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,tsx}',
    './components/**/*.{js,ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        tossBlue: '#3182F6',
        tossBlueHover: '#1B64DA',
        tossBg: '#F2F5F8',
        tossCard: '#FFFFFF',
        tossText: '#101828',
      },
      borderRadius: {
        toss: '14px',
      },
      boxShadow: {
        toss: '0 4px 14px rgba(15, 23, 42, 0.06)',
      },
    },
  },
  plugins: [],
};

export default config;
