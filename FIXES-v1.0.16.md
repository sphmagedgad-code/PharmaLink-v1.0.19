# PharmaLink Ready 2 v1.0.16 — import/index recovery patch

- Keeps selected WhatsApp TXT files staged after an import error so the operator can retry without selecting them again.
- Uses bulk search-index writes (from the prior v1.0.15 patch) to reduce IndexedDB transaction churn on mobile.
- Widens the candidate search window to 500 before the 30-day operational-post filter, reducing the chance that older indexed posts crowd out recent results.
- Displays recent WhatsApp-derived requests/offers before older reference-data matches, while retaining medicines, contacts, and deals.
- Keeps opportunities limited to the last 30 days and blocks archive/delete during active analysis.
- Bumps service-worker cache version to v1.0.16.

## Data safety
This patch does not intentionally delete medicines, contacts, deals, or statistics. It filters old WhatsApp-derived posts from active search/opportunities; it does not physically purge those old posts from storage. Back up/export important data before installing any new deployment.

## Verification status
JavaScript syntax and ZIP integrity are checked locally. This is not a substitute for testing in the target browser with the user's actual WhatsApp exports and existing IndexedDB database.
