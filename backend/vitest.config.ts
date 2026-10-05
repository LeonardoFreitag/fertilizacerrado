import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    // Valores fictícios para que src/config/env.ts valide sem depender de um .env.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'test-access-secret-with-at-least-32-chars',
      JWT_REFRESH_SECRET: 'test-refresh-secret-with-at-least-32-chars',
    },
  },
});
