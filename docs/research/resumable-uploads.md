# Research: Resumable / chunked uploads

**Status: blocked on server support. Not actionable client-side today.**

## The question

Can Immich Dock resume a large upload that was interrupted (network drop,
pause, crash) instead of restarting it from byte 0?

## Finding

**No — not with the current Immich API.** Resumable upload is fundamentally a
*server* capability: the server must accept a file in pieces, remember what it
has received (an upload session / offset), and let the client continue from
there. A client cannot "resume" against an endpoint that only accepts a whole
file in one request.

Immich v2.7.5 (our target, per `research/immich-openapi.json`) exposes exactly
one asset-upload path:

- `POST /api/assets` — a single `multipart/form-data` request containing the
  entire `assetData`.

There is **no** chunked, ranged, `tus`, or session-based upload endpoint. The
only upload-adjacent routes are `POST /api/assets/bulk-upload-check` (a
checksum dedup check, not an upload) and an admin DB-backup upload.

## Community status

Resumable/chunked upload is a long-standing, still-open feature request on the
Immich repo — not an implemented feature:

- Discussion #6524 — resumable chunked upload for large files (>100 MB).
- Discussion #22762 — chunked upload to bypass Cloudflare's 100 MB tunnel limit.
- Discussions #1674 / #23276, Issue #567 — upload large files in chunks.

The most-discussed implementation path is integrating **tus** (e.g.
`tus-node-server` in the Immich server, or a `tusd` sidecar). As of this
writing it has not shipped.

## What this means for Immich Dock

- We **cannot** implement true resume client-side. An interrupted upload of a
  7 GB file must restart from the beginning — which is already our behavior
  (the item is re-queued and retried).
- The Cloudflare-tunnel 100 MB limit that motivates much of the community
  request also can't be worked around client-side without server chunking.
- Our existing mitigations are the right ones for today: streaming uploads (low
  memory), pause-cancellation, retry/backoff, and not re-hashing/re-uploading
  files already confirmed on the server.

## Revisit criteria

Re-open this if **any** of the following land in Immich:

1. A `tus` endpoint (look for `/files` or an `Upload-Offset`/`Tus-Resumable`
   header contract), or
2. A documented chunked-upload endpoint that returns an upload-session id +
   expected chunk size and accepts ranged parts, or
3. The OpenAPI spec gains a resumable/chunk upload path.

When that happens, the work would be: implement the client side of that
protocol in `api/client.rs` (offset tracking, chunk loop, resume on retry) and
persist the in-flight offset in the queue so it survives restarts.

## References

- [Immich discussion #6524 — resumable chunked upload](https://github.com/immich-app/immich/discussions/6524)
- [Immich discussion #22762 — chunked upload vs Cloudflare 100 MB](https://github.com/immich-app/immich/discussions/22762)
- [Immich discussion #23276 — chunk large files on upload](https://github.com/immich-app/immich/discussions/23276)
- [Immich issue #567 — upload large files in chunks](https://github.com/immich-app/immich/issues/567)
