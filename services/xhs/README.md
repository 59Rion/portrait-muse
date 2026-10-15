# Portrait Muse private image importer

Single free Render Docker web service; no new database or disk. Reuses the existing Supabase owner-only tables and private bucket. Run one process only: upstream uses a singleton, and extraction is serialized. Request limits (3/minute, 20/hour per account) are process-local and reset on restart, not a durable quota.

Runtime config: `SUPABASE_URL`, public `SUPABASE_PUBLISHABLE_KEY`, `ALLOWED_ORIGIN=https://59rion.github.io`; `PORT` is assigned by Render. Never set service_role/secret keys. No global XHS Cookie, client-supplied Cookie, proxy or arbitrary source URL is accepted. Users authenticate using their existing access token, which is forwarded only to the fixed Supabase project and never persisted. Service code does not log request bodies or upstream errors. Public root/health contain no private data.

POST `/imports`: `{ "inspirationId": "existing-owned-uuid" }` with user's Bearer token. Returns downloaded count, skipped count and a message. Reads the owned source from Supabase; rejects unsupported source hosts, unsafe redirects, videos, oversized files and non-image bytes. Up to 12 images and 40 MB per note. Never overwrites a collection that already has pictures. Cookie-free public access is best effort, not guaranteed; link expiry and platform restrictions may prevent extraction. No CAPTCHA bypass is provided. Manual screenshots remain supported.

Cold starts can take about a minute on Render Free; frontend should allow a long timeout and show that waiting state. Photos are persisted to private Supabase Storage, not to the container disk. A connection interruption can leave an image row saved before the cover is updated; reload/open the detail gallery to recover. Full transactional download jobs and cross-instance durable limits are future improvements.

The image builds the unmodified [JoeanAmier/XHS-Downloader](https://github.com/JoeanAmier/XHS-Downloader) at commit `3261312721f0b37c705ba6515885bc7f34349f2f`, retaining its GNU GPL v3 license as `/opt/xhs/UPSTREAM-LICENSE`. Source is fetched at build time, not copied into this repository. Its official pinned direct requirements are used. Review and rebuild intentionally for upstream changes rather than tracking latest automatically.

Deployment is not verified by merely committing this directory. Confirm Render deploy is live, health is 200, anonymous import is 401, authenticated ownership checks hold, and a real shared note imports before calling the feature complete.
