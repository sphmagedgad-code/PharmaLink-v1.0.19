# PharmaLink OS v1.0.15 — import/index stability patch

- WhatsApp message and parsed-entity imports now batch search-index writes into one IndexedDB transaction per import chunk instead of opening one transaction per entity.
- Archive/export controls are blocked while an import is running to avoid overlapping database mutations.
- No database reset or schema deletion is performed. Existing medicines, contacts, deals, and statistics are not explicitly modified by this patch.

## Validation
- Source-level checks and ZIP integrity checks were run.
- A full browser test against the user's real IndexedDB data was not possible here; back up the app data before using archive/delete.
