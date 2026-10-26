# PharmaLink Ready 2 v1.0.17 — Search and Opportunity Recovery

- Adds a read-only fallback search for medicines when searchIndex rows are missing or incomplete.
- Adds a read-only fallback search for parsed buy/sell posts from the last 30 days.
- Opportunity analysis can recover missing medicine/contact links in memory and match recent offers by exact normalized medicine name when indexed medicine links are absent.
- Bumps the service-worker cache version so the new files are fetched.

## Data safety
No database is deleted, reset, migrated, or rewritten by these fallbacks. Medicines, contacts, deals, and statistics are not deleted. Old WhatsApp-derived posts remain stored; only operational search/opportunity results are limited to the last 30 days.

## Verification
This package is checked for JavaScript syntax and ZIP integrity. It still requires testing in the target browser with the user's existing IndexedDB data and real WhatsApp exports; no honest 100%/120% guarantee is possible without that test.
