import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// App unit tests (pure helpers in lib/). Engine tests live in packages/engine.
export default defineConfig({
  resolve: {
    alias: {
      '@credrail/engine': fileURLToPath(new URL('./packages/engine/src/index.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: { include: ['lib/**/*.test.ts'] },
})
