import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  // -------------------------------------------------------------------------
  // Vitest
  // -------------------------------------------------------------------------
  // `globals: true` so React Testing Library registers its automatic cleanup
  // (it hooks `afterEach`, which only exists when globals are on) and so test
  // files need no describe/it/expect imports.
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    css: false,
    // Only OUR tests. Without this, `vitest run` also walks node_modules and
    // the dist/ build output.
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    exclude: ['node_modules', 'dist', 'legacy'],
    restoreMocks: true,
  },
})
