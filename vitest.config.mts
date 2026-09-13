import { defineConfig } from 'vitest/config';

// The domain layer is deliberately platform-free: no React, no React Native, no
// Expo. That is what lets it run under plain Vitest here and unchanged inside
// the app — and it is the part that must never silently drift, because it is
// money math.
export default defineConfig({
  test: {
    include: ['src/domain/**/*.test.ts'],
    environment: 'node',
  },
});
