/**
 * PharmaLink OS - Search Index Repository
 * The central search engine (per the frozen "search is first-class"
 * decision). Every other repository calls indexEntity()/removeEntity()
 * on every create/update/delete so searchIndex is always in sync -
 * search itself never scans the source stores directly.
 *
 * Query strategy: the FIRST significant query token is looked up via
 * the `by_token` index using a prefix IDBKeyRange (bounded, indexed -
 * never a full-store scan). That narrows candidates to a small set of
 * entityRefs. Only that small candidate set is then checked in memory
 * against any remaining query tokens. This stays fast at 500k+ rows
 * because the expensive part (the index range scan) is bounded by the
 * prefix, not the store size.
 */

import { getDatabase } from '../connection.js';
import { requestToPromise, runAtomicTransaction } from './transactions.js';
import { validateSearchIndexRow } from '../schemaGuards.js';
import { generateId } from '../schema.js';
import { STORE_NAMES, SEARCH_RESULT_LIMIT } from '../../shared/constants.js';
import { tokenize } from '../../shared/searchTokens.js';
import { wrapAsync } from '../../shared/errorHandler.js';

const STORE = STORE_NAMES.SEARCH_INDEX;

/**
 * Replaces all searchIndex rows for one entity with a fresh set built
 * from `tokens`. Safe to call on create AND update (removes stale
 * rows first) - this is what keeps the index synchronized.
 */
export const indexEntity = wrapAsync('searchIndexRepo.indexEntity', async function indexEntity(entityType, entityId, tokens, snippet) {
  const db = await getDatabase();
  const entityRef = `${entityType}:${entityId}`;

  const existingTx = db.transaction([STORE], 'readonly');
  const existingIndex = existingTx.objectStore(STORE).index('by_entityRef');
  const existingRows = (await requestToPromise(existingIndex.getAll(entityRef))) || [];

  const newRows = Array.from(new Set(tokens)).map((token) => {
    const row = {
      id: generateId(),
      token,
      entityType,
      entityId,
      entityRef,
      snippet: snippet || '',
    };
    validateSearchIndexRow(row);
    return row;
  });

  await runAtomicTransaction(db, [STORE], 'readwrite', (tx) => {
    const store = tx.objectStore(STORE);
    for (const row of existingRows) {
      store.delete(row.id);
    }
    for (const row of newRows) {
      store.add(row);
    }
  });
});

/**
 * Inserts search-index rows for a batch of newly-created entities in one
 * short transaction. Import callers use this only for fresh IDs, so no
 * old rows need to be read/deleted. This avoids hundreds of tiny
 * IndexedDB transactions on mobile devices during WhatsApp imports.
 */
export const indexEntitiesBulk = wrapAsync('searchIndexRepo.indexEntitiesBulk', async function indexEntitiesBulk(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return;
  const db = await getDatabase();
  const rows = [];
  for (const entry of entries) {
    const entityRef = `${entry.entityType}:${entry.entityId}`;
    for (const token of Array.from(new Set(entry.tokens || []))) {
      const row = {
        id: generateId(),
        token,
        entityType: entry.entityType,
        entityId: entry.entityId,
        entityRef,
        snippet: entry.snippet || '',
      };
      validateSearchIndexRow(row);
      rows.push(row);
    }
  }
  if (!rows.length) return;
  await runAtomicTransaction(db, [STORE], 'readwrite', (tx) => {
    const store = tx.objectStore(STORE);
    for (const row of rows) store.add(row);
  });
});

/** Removes every searchIndex row for one entity (used on delete). */
export const removeEntity = wrapAsync('searchIndexRepo.removeEntity', async function removeEntity(entityType, entityId) {
  const db = await getDatabase();
  const entityRef = `${entityType}:${entityId}`;

  const tx = db.transaction([STORE], 'readonly');
  const index = tx.objectStore(STORE).index('by_entityRef');
  const rows = (await requestToPromise(index.getAll(entityRef))) || [];
  if (rows.length === 0) return;

  await runAtomicTransaction(db, [STORE], 'readwrite', (writeTx) => {
    const store = writeTx.objectStore(STORE);
    for (const row of rows) {
      store.delete(row.id);
    }
  });
});

/**
 * Runs a global search. Returns an array of unique { entityType,
 * entityId, snippet } matches, most-referenced-first, capped at
 * SEARCH_RESULT_LIMIT. `entityTypes` optionally restricts the result
 * to a subset (e.g. only 'contact').
 */
export const search = wrapAsync('searchIndexRepo.search', async function search(query, entityTypes = null) {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const db = await getDatabase();
  const tx = db.transaction([STORE], 'readonly');
  const tokenIndex = tx.objectStore(STORE).index('by_token');

  // Use the indexed prefix range for every query token. Each query word
  // may be a prefix of an indexed word (e.g. "mabth" -> "mabthera").
  // Intersect entity refs so multi-word searches do not return unrelated
  // records, while accumulating match quality for deterministic ranking.
  const tokenMatches = [];
  for (const queryToken of tokens) {
    const range = IDBKeyRange.bound(queryToken, queryToken + '\uffff');
    const rows = (await requestToPromise(tokenIndex.getAll(range))) || [];
    const refs = new Map();
    for (const row of rows) {
      if (entityTypes && !entityTypes.includes(row.entityType)) continue;
      const ref = row.entityRef;
      const current = refs.get(ref) || {
        entityType: row.entityType,
        entityId: row.entityId,
        snippet: row.snippet || '',
        exactMatches: 0,
        prefixMatches: 0,
      };
      if (row.token === queryToken) current.exactMatches += 1;
      else current.prefixMatches += 1;
      refs.set(ref, current);
    }
    tokenMatches.push(refs);
    if (refs.size === 0) return [];
  }

  // AND intersection across all query tokens.
  let results = Array.from(tokenMatches[0].values());
  for (let i = 1; i < tokenMatches.length; i += 1) {
    const refs = tokenMatches[i];
    results = results.filter((item) => refs.has(`${item.entityType}:${item.entityId}`));
    if (results.length === 0) return [];
    for (const item of results) {
      const match = refs.get(`${item.entityType}:${item.entityId}`);
      item.exactMatches += match.exactMatches;
      item.prefixMatches += match.prefixMatches;
      if (!item.snippet && match.snippet) item.snippet = match.snippet;
    }
  }

  // Exact token matches first, then prefix matches, then stable readable
  // ordering. Do not silently expose IndexedDB insertion order as relevance.
  results.sort((a, b) =>
    b.exactMatches - a.exactMatches ||
    b.prefixMatches - a.prefixMatches ||
    String(a.snippet).localeCompare(String(b.snippet), 'ar') ||
    String(a.entityId).localeCompare(String(b.entityId))
  );

  return results.slice(0, SEARCH_RESULT_LIMIT).map(({ entityType, entityId, snippet }) => ({ entityType, entityId, snippet }));
});
