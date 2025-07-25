import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'build/**',
        'tests/**',
        '**/*.d.ts',
        '**/*.config.*',
        '**/index.ts'
      ],
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