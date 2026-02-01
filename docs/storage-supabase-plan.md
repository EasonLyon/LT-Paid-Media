# Supabase Storage Migration Plan

## Goals
- Make Supabase Storage the primary backend for project JSON and artifacts.
- Keep R2 as a manual, on-demand backup path (disaster recovery).
- Preserve existing app API contracts and UI behavior as much as possible.
- Provide a one-time migration path from current storage (R2 or local output) to Supabase.

## Current Storage Summary
- Storage abstraction lives in `lib/storage/project-files.ts`.
- R2 is used when `R2_*` env vars are present; otherwise local `output/<projectId>`.
- UI and API routes depend on `list/read/write/delete` helpers in that module.

## Proposed Design
- Add a Supabase Storage backend to `lib/storage/project-files.ts`.
- Storage selection order: Supabase -> R2 -> local.
- Keep the same file path convention (`<projectId>/<filename>`).
- Add an API endpoint to trigger Supabase -> R2 backup for a project.
- Add a UI button in Output Manager to trigger the backup.

## Configuration Required
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET` (server-side)
- `SUPABASE_STORAGE_BUCKET` (new)
- Optional legacy: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`

## Migration Steps
1) Create the Supabase Storage bucket (or set `SUPABASE_STORAGE_BUCKET` to an existing bucket).
2) Run the migration script:
   - `node scripts/migrate-to-supabase.mjs --source auto`
   - Use `--source r2` or `--source local` explicitly if needed.
3) Verify using the Output Manager UI and `/api/sem/project-files` endpoints.

## R2 Backup Strategy (Effectiveness)
- Manual backup on-demand is effective for disaster recovery if:
  - Backups are triggered after significant workflow steps.
  - R2 credentials and bucket are kept valid.
  - Periodic spot checks confirm restore paths work.
- If you want stronger guarantees, we can add:
  - Automated scheduled backups (cron or queue).
  - A checksum table to track last backup per project.

## Implementation Checklist
- [x] Add Supabase storage helper (`lib/storage/supabase.ts`).
- [x] Update Supabase client env parsing to support `SUPABASE_SECRET`.
- [x] Make `project-files` supabase-first with R2 fallback.
- [x] Add Supabase -> R2 sync helper.
- [x] Add API route to trigger R2 backup.
- [x] Add UI backup button in Output Manager.
- [x] Add migration script (`scripts/migrate-to-supabase.mjs`).
- [ ] Run migration once `SUPABASE_STORAGE_BUCKET` is set.

## Verification Checklist
- Create a project via `/sem` and ensure files appear in Supabase Storage.
- Use Output Manager to preview, delete, and backup.
- Confirm R2 contains the same files after a backup.

## Open Questions
- Should we store backup timestamps or checksums in a Supabase table?
- Do you want scheduled backups or manual-only?
