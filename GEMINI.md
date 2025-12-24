# GEMINI.md - Context & Instructions for AI Agents

## Project Overview

**Name:** LT Paid Media (lt-paid-media)
**Type:** Next.js Web Application
**Purpose:** Automates an SEM (Search Engine Marketing) keyword research and campaign planning pipeline. It orchestrates a multi-step workflow involving AI-generated keywords, search volume data enrichment, SERP analysis, and competitor keyword extraction to produce scored and categorized keywords for Google Ads and SEO.

## Core Technology Stack

-   **Framework:** Next.js 16 (App Router)
-   **Language:** TypeScript
-   **Styling:** Tailwind CSS
-   **State/Data:** Local filesystem for intermediate artifacts (`output/`), Supabase for persistence.
-   **External APIs:**
    -   **OpenAI:** Keyword generation, campaign planning.
    -   **DataForSEO:** Search volume, SERP analysis, keyword data.
-   **Storage:** Cloudflare R2 (implied by `lib/storage/r2.ts`).

## Directory Structure & Key Files

### Root
-   `app/`: Next.js App Router pages and API routes.
    -   `app/sem/page.tsx`: Main UI for the SEM workflow.
    -   `app/api/sem/*/route.ts`: API endpoints corresponding to each step of the pipeline.
-   `lib/`: Shared business logic and API clients.
    -   `lib/sem/`: Core domain logic for each pipeline step (enrichment, scoring, clustering).
    -   `lib/dataforseo/`: Client and helpers for DataForSEO API.
    -   `lib/openai/`: Client and prompts for OpenAI.
    -   `lib/storage/`: Utilities for file system and R2 storage.
-   `output/`: **Crucial.** Local storage for generated project data.
    -   Structure: `output/<projectId>/<step-index>-<description>.json`
    -   Example: `output/20251202-14-001/01-initial-keywords.json`
-   `docs/`: Documentation.
    -   `docs/sem-keyword-pipeline-spec.md`: **The canonical specification** for the SEM pipeline logic. **Read this before modifying logic.**
-   `types/`: TypeScript definitions.
    -   `types/sem.ts`: Core data models (Keyword records, API responses, Scored records).

## SEM Keyword Pipeline (Workflow)

The application follows a strict linear pipeline defined in `docs/sem-keyword-pipeline-spec.md`. Accessing the project requires a `projectId` (format: `YYYYMMDD-HH-XXX`).

1.  **Initialization:** User provides website, goal, location. OpenAI generates initial keyword clusters.
    -   Artifact: `01-...json`
2.  **Enrichment:** Fetch search volume from DataForSEO for initial keywords.
    -   Artifacts: `02-...json` (raw), `03-...json` (enriched), `04-...json` (filtered > 100 vol).
3.  **SERP Expansion:** specific "Core" and "Segment" keywords trigger SERP analysis to find "People Also Ask" keywords and top organic URLs.
    -   Artifact: `05-...json`
4.  **Competitor Keywords:** Extract keywords from the top organic domains found in Step 3.
    -   Artifact: `06-...json`
5.  **Combine & Dedupe:** Merge all keyword sources (Initial, SERP, Competitor) and deduplicate (case-insensitive).
    -   Artifact: `07-...json`
6.  **Scoring:** Calculate scores (0-1) for Volume, Cost (CPC), and Difficulty. Assign Tiers (A/B/C) and flags (Paid/SEO).
    -   Artifact: `08-...json`
7.  **Campaign Structure:** Group keywords into campaigns and ad groups.

## Development Guidelines

### Commands
-   **Dev Server:** `npm run dev`
-   **Build:** `npm run build`
-   **Start:** `npm start`
-   **Lint:** `npm run lint`

### Conventions
-   **Build Verification:** Always run `npm run build` after modifying any code to ensure there are no compilation errors.
-   **Strict Types:** Use specific types from `types/sem.ts` (e.g., `EnrichedKeywordRecord`, `ScoredKeywordRecord`). Avoid `any`.
-   **File Naming:**
    -   React Components: PascalCase (e.g., `CampaignTable.tsx`).
    -   Functions/Logic: camelCase (e.g., `calculateScores.ts`).
    -   Routes: kebab-case folders (e.g., `app/api/sem/keyword-scoring/`).
-   **Artifact Management:** The pipeline relies heavily on reading/writing specific JSON files in the `output/` directory. Ensure file naming matches the spec exactly.
-   **Environment Variables:**
    -   `OPENAI_API_KEY`
    -   `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`
    -   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

### Critical Reference
**Always consult `docs/sem-keyword-pipeline-spec.md`** before changing any logic related to keyword processing, scoring formulas, or file output formats. It is the source of truth.
