import { defineConfig } from 'vitest/config';

// The domain layer is deliberately platform-free: no React, no React Native, no
// Expo. That is what lets it run under plain Vitest here and unchanged inside
// the app — and it is the part that must never silently drift, because it is
// money math.
export default defineConfig({
  test: {
    include: ['src/domain/**/*.test.ts'],
    environment: 'node',
    /*
     * The suite runs in UTC, on every machine.
     *
     * Cycle boundaries are local-time by design — a person's month starts at
     * midnight where they are, not in Greenwich — so a fixture holding
     * absolute timestamps lands on a different side of a local-time boundary
     * depending on where the tests run. The real backup contains a 13.50
     * purchase at 05:12 UTC on 14 August, and a baseline declared at 08:00
     * local: that purchase is before the baseline in UTC and after it in Gulf
     * time, so the same correct implementation produced 300 here and 313.50 on
     * the owner's machine.
     *
     * Both answers were right. What was wrong is a money test whose expected
     * figure moves with the machine's clock settings. Pinning the frame of
     * reference is what makes the suite mean the same thing everywhere.
     */
    env: { TZ: 'UTC' },
  },
});
