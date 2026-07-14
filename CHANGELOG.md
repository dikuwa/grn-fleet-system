# Changelog

## 2026-07-14 — Phase 0: Repository and verified foundation

### Added

- Git repository initialised
- Next.js 16.2.10 project scaffolded with TypeScript strict mode
- All core dependencies installed (pnpm 10.12.4, Node.js 22.16.0)
- Prettier configuration with Tailwind CSS plugin
- Vitest unit test configuration with jsdom environment
- Vitest integration test configuration
- Playwright E2E test configuration
- Drizzle ORM configuration (PostgreSQL dialect)
- Environment variable validation with Zod (`src/env.ts`)
- Environment template (`src/.env.example`)
- GitHub Actions CI workflow (`lint → typecheck → test → build`)
- Root layout with Onest font via `next/font/google`
- Global CSS with Tailwind v4 `@theme` design tokens (brand, status, spacing, radius)
- Landing page with hero, features grid, workflow steps and pilot section
- Providers wrapper (TanStack Query + Toast)
- Toast component (Radix UI-based with success/error/pending variants)
- Utility functions: `cn()`, `formatNumber()`, `formatCurrency()`, `formatDate()`, `formatDateTime()`, `generateId()`, `delay()`, `pluralize()`
- Application constants: status labels, trip scopes, page sizes, upload limits
- `next.config.ts` with security headers and image remote patterns
- `.gitignore` with project-specific entries
- Architecture.md updated with Implemented versions section
- Basic unit tests for utility functions (7 tests passing)

### Commands verified

- `pnpm typecheck` — passes
- `pnpm lint` — passes (0 errors, 0 warnings)
- `pnpm test` — passes (7 tests)
- `pnpm build` — passes

### Documentation

- All core and optional specification documents preserved
- Architecture.md version table appended
- PROJECT-STATUS.md updated to Phase 0 complete

### Implementation status

Phase 0 complete. Phase 1 ready to begin.
