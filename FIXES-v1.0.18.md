# PharmaLink Ready 2 v1.0.18 — Import speed, urgent ranking, WhatsApp, and search stability

- Import reuses contact records in memory within the current batch, reducing repeated IndexedDB lookups for repeated sender phone numbers while still promoting buyer/seller roles.
- Opportunities now rank urgent requests before non-urgent requests, then confirmed price and recency.
- Added WhatsApp deep-link actions beside phone-call actions on opportunity buyer/seller rows and parsed search results.
- Prevented stale, slower overlapping search requests from overwriting newer results.
- Bumped service-worker cache version.

## Data safety and limits
No database/store clearing, reset, or migration is performed. This release cannot recover data that the browser has already deleted; do not clear site storage. WhatsApp deep links require a valid international number; Egyptian 11-digit mobile numbers starting with 01 are converted to country code 20.

## Verification
Static syntax checks and ZIP integrity are required before delivery. Runtime tests against the user's real IndexedDB and export files are not available in this environment.
