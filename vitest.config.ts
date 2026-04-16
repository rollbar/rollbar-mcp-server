import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    dir: './tests',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['**/index.ts', '**/*.d.ts', '**/*.config.*'],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 90,
        lines: 80
      }
    }
  },
  resolve: {
    extensions: ['.ts', '.js'],
    alias: {
      '@/': new URL('./src/', import.meta.url).pathname
    }
  }
});