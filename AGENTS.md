# Repository Guidelines

## Project Structure & Module Organization
- Next.js App Router under `app/`; `app/page.tsx` is the landing view and `app/sem/page.tsx` drives the SEM workflow UI. API routes for each SEM step are in `app/api/sem/*/route.ts`.
- Domain logic is in `lib/`: SEM orchestration (`lib/sem/*`), external clients (`lib/dataforseo`, `lib/openai`), Supabase utilities (`lib/supabase/client.ts`), and project file helpers (`lib/storage/project-files.ts` writing to `output/<projectId>`).
- Shared types sit in `types/`; global styles in `app/globals.css`; public assets in `public/`. Keep generated artifacts out of version control unless explicitly needed.

## Build, Test, and Development Commands
- `npm run dev` — start the Next.js dev server on port 3000.
- `npm run lint` — run ESLint with the Next.js/TypeScript config; fix style issues before committing.
- `npm run build` — production build; use before deploying to verify compilation.
- `npm start` — run the built app locally (expects a prior `npm run build`).

## Coding Style & Naming Conventions
- TypeScript is strict; prefer typed props, return types, and narrowing over `any`.
- ESLint (see `eslint.config.mjs`) enforces Next.js + TypeScript rules; follow existing formatting (2-space indent, double quotes in TSX).
- Use PascalCase for React components and file names under `app/` (e.g., `MySection.tsx`), camelCase for functions/variables, and kebab-case for route folders.
- Use the `@/*` path alias from `tsconfig.json` for intra-repo imports.

## Testing Guidelines
- No dedicated automated test suite yet. Rely on `npm run lint` and manual verification of the SEM flow: run each API step via `/sem`, check console logs, and inspect generated JSON under `output/<projectId>`.
- When adding tests, colocate them near the code (e.g., `lib/sem/__tests__/foo.test.ts`) and keep fixtures small.

## Commit & Pull Request Guidelines
- Write concise, imperative commit subjects (e.g., `feat: add serp expansion polling`, `fix: guard missing projectId`).
- PRs should include: a short summary, linked issue or task ID, screenshots/GIFs for UI changes, and the commands you ran (`npm run lint`, `npm run build` if applicable).
- Mention configuration changes (new env vars, migrations) prominently in the PR description.

## Security & Configuration Tips
- Required secrets: `OPENAI_API_KEY`, `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_ANON_KEY`). Store them in `.env.local`; never commit them.
- Generated project files under `output/` may contain partner data—keep them out of commits unless explicitly reviewed.
- Avoid logging secrets; prefer descriptive errors and server-side validation inside `app/api/sem/*`.
