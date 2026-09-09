# Video Agent Platform

Internal work platform for Aura Farmers, Inc. — an AI agent per employee,
eight modules (Market Research, Script, Video Edit, Publish, Accounting,
Finance, Legal, HR), a shared media/document database with per-file
permissions, and an admin panel for accounts, spend, and agent tuning.

**Source of truth: [`01_Build-Spec 2.pdf`](./01_Build-Spec%202.pdf) (v2.4,
15 Aug 2026).** Every module, permission rule, and acceptance criterion
should trace back to that document. If code and spec disagree, the spec
wins — raise a discrepancy rather than resolving it silently in code.

## Status

Scaffold stage. The route structure under `app/(workspace)/` mirrors the
shell and eleven surfaces described in the spec's Section 4, each as a stub page
with no auth, no database, and no agent behind it yet. Nothing here is
functional. See the spec's Section 10 Build order for the intended sequence
(auth/ReBAC → data model/files → job pipeline → assistant agent → modules).

## Stack (per spec Section 1)

Postgres 16 · Redis (job queue) · S3-compatible object storage · OpenFGA or
SpiceDB (ReBAC — content permissions are not a hand-rolled table) · pgvector
· Next.js / React front end. None of the backend pieces are wired up yet —
see `.env.example` for the shape.

## Running it

```bash
npm install
npm run dev          # http://localhost:3000
```

## Checks

```bash
npm run build
npx tsc --noEmit
npm run lint
```
