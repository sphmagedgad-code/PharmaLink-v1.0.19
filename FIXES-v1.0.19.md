# PharmaLink Ready 2 v1.0.19 — Search display stability

- Fixed a race condition where a slower search could append stale cards after a newer search started; each asynchronous card render now checks that it is still the active search.
- Urgent BUY requests are prioritized at the top of search results, followed by recent operational posts. Opportunity ranking already prioritizes urgent requests.
- Kept existing IndexedDB stores and data untouched; no reset, clear, delete, or schema migration was added.
- Kept the v1.0.18 import/contact-cache and WhatsApp-link changes.

## Verification scope
- JavaScript syntax checks and ZIP integrity are run before delivery.
- This environment does not contain the user's live browser profile, IndexedDB contents, or WhatsApp export files, so real-data persistence/import speed cannot be certified here. Do not clear site data to test.
