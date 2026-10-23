# Free media import (2026-10-23)

## Research and implementation decision

- [JoeanAmier/XHS-Downloader](https://github.com/JoeanAmier/XHS-Downloader): full Python downloader; the existing Docker adapter requires a server. It is not running on GitHub Pages. The optional legacy service remains in `services/xhs` but is not the active deployment.
- [openmood/SyncToNotion](https://github.com/openmood/SyncToNotion): demonstrates Worker-based image/video parsing. The inspected root did not contain a LICENSE file. Its code was not copied; broad whole-page URL scanning can also pick unrelated images.
- [tamnd/xiaohongshu-cli](https://github.com/tamnd/xiaohongshu-cli): documents public SSR state and the importance of current share tokens; a Go CLI, not a drop-in Edge Function.
- [hqman/xhs-video](https://github.com/hqman/xhs-video): depends on an external KuKuTool parser and ffmpeg. Not chosen: uncontrolled third-party parser availability and privacy dependency.

The active implementation is original TypeScript, using public note HTML only. No request signing, account cookies, login bypass, browser installation, third-party paid API, Python runtime, Render service, or Cloudflare paid products are needed.

## Deployment

Frontend remains GitHub Pages. Supabase `media-import` Edge Function verifies the caller against Auth and uses that caller's JWT for every database/storage request. Gateway JWT verification is disabled only because the function itself verifies Auth before accessing records (matching the existing modern-key integration); this is not an anonymous importer.

Apply `supabase/media-import.sql` once to the existing cloud database, then deploy the function and `_shared/xhs.ts`. The frontend's downloader URL must match its own Supabase project's `/functions/v1/media-import` exactly. Never place service-role keys or XHS cookies in deployment.json.

Existing private image bucket stays unchanged. Videos use private `portrait-videos`, MP4 only, 40 MB per file. Existing `inspiration_images` metadata table gains `media_bucket`; its original owner RLS and composite parent-owner FK remain active. Galleries sign the appropriate private bucket. `claim_portrait_import` is security invoker and owner-scoped, with a per-account advisory lock and 150-second same-note cooldown. This is a basic anti-repeat safeguard, not a tamper-proof billing quota against malicious registered users.

## User flow and boundaries

Paste complete official share text → save owned source record → authenticate import → follow allowlisted redirects while preserving share parameters → match the exact target note ID → fetch allowed CDN media with limits and magic-byte checks → upload privately → save metadata → show real counts.

Images: up to 15 MB each. MP4: up to 40 MB. One request: at most 21 media entries and 60 MB, with bounded time. H.264 MP4 is selected for browser compatibility; DRM, HLS, transcoding, Live Photo pairing, unlimited batch downloads and original-camera quality are not supported. Only public accessible notes work; expired tokens, login pages or restrictions return explicit errors. No fallback to generated pictures, avatars, recommendation feeds or guessed download URLs. Partial imports can be retried, reusing deterministic IDs without duplicating existing imports. Original manual uploads are retained.

The free Supabase plan has storage, egress, function and runtime quotas. Exhaustion stops/fails imports; this change neither upgrades the plan nor guarantees unlimited free use. Download only content you are permitted to save; private storage does not grant redistribution rights.

## Verification

`npm run test:pages`, `tsc --noEmit`, `npm run build:pages`. `node scripts/test-media-import.mjs --live` fetches the two user-supplied public examples into memory (no cloud writes): 12 images / 3,319,715 bytes; 1 MP4 + 1 cover / 3,791,473 bytes at verification time. Fixtures cover authentication, source ownership, private image/video persistence calls, wrong-note rejection, script-not-executed parsing, CDN allowlists, redirects and content/size checks. These are not proof of authenticated production imports.

Production checks: deployed function returns 401 for missing/invalid user JWT; inspect private buckets and existing RLS after migration. Final production import must be performed from the user's signed-in website. Do not obtain their password or copy their session into a script to run the acceptance test.

