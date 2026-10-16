import { defineConfig } from 'vitest/config'

// Unit tests only (no Haxall needed). Integration tests against a live Haxall are in tools/ (make test).
export default defineConfig({ test: { projects: ['packages/haystack', 'ui'] } })
