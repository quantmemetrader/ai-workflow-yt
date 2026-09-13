# Setup & credentials guide

Every external account, API key, and non-technical input the full build
needs, pulled from `01_Build-Spec 2.pdf`. Nothing here is wired into code
yet — this is the checklist to work through so provisioning isn't a
surprise mid-module. Log the arrival date of each client-supplied item in
writing (the spec's own instruction — the 8-week clock starts once they're
all in).

**Hosting model:** a dedicated server (Cherry Servers), not a serverless
platform. Two of this system's own pieces — OpenFGA and the FFmpeg render
worker — need a long-running process, not a function with a time limit, so
the app, OpenFGA, the job workers, and Redis all run together on one box
and talk to each other over localhost. Only the two stores that need
someone else's backup guarantees (Postgres, object storage) live off that
box, as managed services.

| # | Item | Needed for | Who gets it |
|---|------|------------|-------------|
| 1 | Cherry dedicated server | Hosting — the whole app | You — Cherry Servers, EPYC 7443P, ~US$223/mo |
| 2 | Postgres | Step 1 (now) | You — Neon, ~US$130/mo |
| 3 | OpenFGA | Step 1 (now) | You — self-hosted on the Cherry box, no separate account |
| 4 | Redis | Step 3 (job queue) | You — self-hosted on the Cherry box, no account |
| 5 | Object storage | Video/Publish modules | You — Cloudflare R2 |
| 6 | OpenRouter account + key | Assistant agent (§5) | **Client** — their account, their billing |
| 7 | Vertex AI (Veo 3.1) | Video generation | You provision under client's GCP, or client's own project |
| 8 | ElevenLabs (Music + Voice) | Video Edit audio | **Client** — voice clones must live under their account |
| 9 | Azure Speech | zh-HK voice + transcription | You or client, either can hold the Azure account |
| 10 | OpenAI (gpt-transcribe) | Transcription | You |
| 11 | YouTube Data API | Research + Publish | You (Google Cloud project) |
| 12 | Google Trends access | Research | **Open question — see §8 below** |
| 13 | Meta (Instagram/Facebook) app | Publish | You build the app; **client** owns the Page/Business account |
| 14 | LinkedIn Developer app | Publish | You |
| 15 | WeChat Official Account | Publish | **Client** — needs a China-registered entity |
| 16 | TikTok for Developers | Publish | You; **client** completes the compliance audit |
| 17 | X Developer account | Publish | **Client** — explicit contract dependency (§11) |
| 18 | Client's OIDC IdP | Auth | **Client**, if one exists — otherwise skip, we ship email+TOTP |
| 19 | Chart of accounts, templates, policies, employee list, brand assets | Accounting/Finance/Legal/HR/knowledge area | **Client** — see §12 |

---

## 1. Hosting — the Cherry dedicated server

Everything compute-shaped lives here: the Next.js app, OpenFGA, Redis, and
the job workers (including FFmpeg). Nothing but the app itself is ever
reachable from outside.

1. Sign up at [cherryservers.com](https://www.cherryservers.com) →
   order a server. An EPYC 7443P plan (24 cores) is the reference point
   this guide costs against (~US$223/mo) — size up or down to the actual
   concurrent-render load once Video Edit exists.
2. Pick a region close to Hong Kong (Singapore if Cherry offers it there;
   otherwise the nearest APAC location they have).
3. Provision with Ubuntu LTS. SSH in and install Docker + the Docker
   Compose plugin.
4. Install [Caddy](https://caddyserver.com) (or run it as a container in
   the same Compose stack) as the reverse proxy — it gets automatic TLS
   from Let's Encrypt with essentially no configuration, which is the
   cheapest way to stop thinking about certificates.
5. Point the domain's A/AAAA record at the server's IP.
6. Deploy is a script (or a small CI runner) that SSHes in, `git pull`s,
   and runs `docker compose up -d --build` — no `git push`-and-done the
   way a platform-hosted deploy works; this is now ours to own.

## 2. Postgres (Neon)

Managed, not self-hosted — the spec's own non-functional requirement is
daily backups with 30-day retention and a **tested** restore before
handover (§8). Neon gives you that without building it yourself. It also
holds OpenFGA's tuple store (§3 below) as a second database in the same
project, so both come under the same backup story.

1. [neon.tech](https://neon.tech) → sign up → **New Project**.
2. Pick a region close to users — Singapore (`ap-southeast-1`) is the
   closest Neon region to Hong Kong.
3. Create two databases in the project: the app's own, and one for
   OpenFGA's datastore.
4. **Dashboard → Connection Details** → copy the **pooled** connection
   string for each: `postgres://<user>:<password>@<host>/<db>?sslmode=require`.
5. Set them as `DATABASE_URL` and `OPENFGA_DATABASE_URL` respectively.

## 3. OpenFGA

Self-hosted, as a service in the same Docker Compose stack as the app, on
the Cherry box — no external account. Bind it to the Docker-internal
network only; it should never have a public port. Point its `--datastore-engine postgres`
flag at `OPENFGA_DATABASE_URL` from §2 above, so its own data rides on
Neon's backups instead of needing its own.

## 4. Redis (step 3 — job pipeline)

Also self-hosted, also just another service in the Compose stack — no
account, no cost beyond the box it already runs on. It's a work queue, not
the system of record (the `jobs` table in Postgres is), so losing it on a
restart just means re-enqueueing from that table — an acceptable trade for
not paying for or depending on a managed Redis.

## 5. Object storage (Video Edit exports, Publish assets)

Spec requirement: "one interface, backend behind configuration" (§7.1) —
so the choice matters less than not scattering a provider SDK through
module code. **Cloudflare R2**: S3-compatible, no egress fees (media
egress adds up fast once Video Edit is live), and not tied to whatever
runs the app.

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **R2** → create a
   bucket.
2. **Manage R2 API Tokens** → create a token scoped to that bucket → note
   the Access Key ID, Secret Access Key, and the account-specific S3
   endpoint (`https://<account-id>.r2.cloudflarestorage.com`).
3. Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
   `R2_BUCKET`.

## 6. LLM access (§5) — client-owned account

This one is explicitly **not ours to provision**. Aura Farmers signs up
and holds the key so the contract's "client funds and manages their own
provider accounts" clause holds:
1. Client signs up at [openrouter.ai](https://openrouter.ai) under their
   own business.
2. Client adds billing (no minimum balance required, per §5).
3. Client generates an API key → we receive it as `OPENROUTER_API_KEY`,
   stored in the secret manager, never in the database.
4. Also get, for the direct-adapter fallback path: an Anthropic key if
   HK billing is confirmed workable, and/or Gemini/DeepSeek/Qwen/Kimi/GLM
   keys — Gemini serves HK natively, the others are reachable through
   OpenRouter regardless (§5 territory note).

## 7. Video, music, voice, transcription (§7)

- **Veo 3.1 Fast/Lite via Vertex** — a Google Cloud project with the
  Vertex AI API enabled, and a service account with the Vertex AI User
  role.
- **ElevenLabs Music** — account at elevenlabs.io, API key, confirm the
  commercial-use license tier covers the client's use.
- **ElevenLabs (voice, Mandarin/English)** — same account. Voice clones
  must be registered under the **client's own** ElevenLabs account, not
  held by us (§7 explicit).
- **Azure Speech (zh-HK Cantonese, and Cantonese transcription)** — Azure
  account → Cognitive Services → Speech resource → key + region.
- **OpenAI gpt-transcribe** — platform.openai.com API key. Same HK
  territory caveat as Anthropic; reachable via OpenRouter if direct
  signup is blocked.

## 8. Research & trends (§7)

- **GDELT** — public, no key, commercial use permitted.
- **YouTube Data API** (`mostPopular`, comments, video stats) — Google
  Cloud Console → enable "YouTube Data API v3" → API key (read-only
  endpoints) or OAuth client (if writing/moderating comments).
- **Google Trends API** — the spec names this as a default source, but
  there is no official public Google Trends API, and the spec explicitly
  bans scrapers including `pytrends` (§7). **Open item: confirm with the
  client what access they actually mean** (a paid/partner feed, BigQuery's
  public Trends dataset, or something else) before building against it —
  don't default to an unofficial library.

## 9. Publishing channels (§7, §11)

**See `02_Integration-Reference.md`** for the full research pass on this
(vendor pricing, exact API names, HK-entity eligibility per Chinese
platform) — this table is the short version.

**Aggregator decision:** build the seven Western channels against one
aggregator ([Ayrshare](https://www.ayrshare.com/)) rather than seven
direct integrations — flat pricing, real analytics + comment read on all
seven. No aggregator covers the Chinese platforms at all; those are
channel-by-channel, see below.

| Channel | What's needed | Notes |
|---|---|---|
| YouTube | Ayrshare, or Google Cloud OAuth client direct (reuse §8 above) | Ships in draft mode until client's compliance audit passes |
| Instagram + Facebook | Ayrshare, or Meta for Developers app direct | Client's Business/Page account, client completes verification |
| LinkedIn | Ayrshare, or LinkedIn Developer app direct | Marketing/Community Management API needs approval |
| WeChat Official Account | Tencent Open Platform account, **service account (服务号) only** | **Client dependency** — needs a China-registered entity; the one Chinese channel worth a direct integration, real draft/publish/media API exists |
| TikTok | Ayrshare, or TikTok for Developers app direct | Upload-to-inbox only until client's compliance audit passes; TikTok exposes **no comment API at all**, on any tier |
| X | Ayrshare, or X Developer account + keys direct | **Explicit client dependency (§11)**; reads are now pay-per-use (bash.005/read) — budget comment sync accordingly |
| Xiaohongshu, WeChat Channels, Bilibili | None — no official publish API exists for any entity, not just HK ones | Exported asset pack for manual posting instead; see `02_Integration-Reference.md` §2 for the closed-loop "mark as posted" pattern to build |
| Douyin | Mainland China entity required for enterprise features | Out of scope unless client sets one up |
| Weibo | — | Video doesn't work at all, confirmed — text+image via `statuses/share` is technically usable if ever wanted, but not pursued for this use case |

## 10. Auth (§8)

If Aura Farmers has an identity provider (Google Workspace, Microsoft
Entra ID, Okta, etc.), get the OIDC issuer URL, client ID, and client
secret from their IT admin. If not, step 1 ships the email + password +
TOTP fallback and needs nothing external — OIDC gets swapped in later
behind the same session interface.

## 11. Secrets management (§8)

Baseline, since there's no platform injecting these for us anymore: a
single `.env` file on the server, owned by the deploy user, `chmod 600`,
loaded into the Compose stack via `env_file` — never committed, never
logged. If the client wants formal secret rotation and audit trails later,
a proper secrets manager (self-hosted Infisical, Doppler, or HashiCorp
Vault) is the natural upgrade. Either way: keys referenced by ID, never
stored in the database in plaintext, never returned to the client.

## 12. Non-technical client dependencies (§11)

Not APIs, but they gate the contract's 8-week clock the same way a
missing key would — chase these in parallel with development, not after:

- Chart of accounts, budget templates, approval thresholds
- Contract templates and archive
- Leave policy, approval hierarchy, employee records
- Existing style guides and procedures for the knowledge-and-skills area
- Stock footage licences
- Brand assets, house style guidelines, approved past scripts
- Employee list with roles, module entitlements, and file groups
- A designated administrator and a designated publication approver

Platform developer registrations and audits (YouTube, TikTok, Meta, X)
take weeks — start those in parallel with development, per the spec's own
closing note.
