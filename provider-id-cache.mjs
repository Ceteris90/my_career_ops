// Values a provider resolves on one scan and reuses on the next — a board id
// that only a careers-page request reveals, for example.
//
// Providers never touch the disk. scan.mjs and scan-ats-full.mjs open the
// store, hand each provider its own slice as `ctx.idCache` (get / set /
// delete), and save once when the run ends. A run that does not open the
// store (verify-portals, tests) passes no `ctx.idCache`, and a provider then
// resolves the value the way it would without a cache.
//
// One JSON object per provider, `<dir>/<provider id>.json`. A file is read the
// first time its provider asks for its slice. save() writes only the slices
// this run changed: it reads each file again, applies this run's sets and
// deletes on top, and replaces the file through a temp file + rename, so two
// runs that overlap keep each other's entries.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { renameSyncWithRetry } from './tracker-utils.mjs';

export const PROVIDER_ID_CACHE_DIR = 'data/cache/provider-ids';

// Provider ids become file names, so only a plain id gets a slice.
const SAFE_PROVIDER_ID = /^[a-z0-9][a-z0-9_-]*$/i;
const DELETED = Symbol('deleted');

/** @param {string} file @returns {Record<string, unknown>} */
function readSlice(file) {
  if (!existsSync(file)) return {};
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    // An unreadable cache costs one extra lookup per key, never a failed scan.
    return {};
  }
}

/**
 * Open the store rooted at `dir`.
 *
 * @param {string} dir - Directory holding one `<provider id>.json` per provider.
 * @returns {{
 *   forProvider: (providerId: string) => ({ get: (key: string) => any, set: (key: string, value: any) => void, delete: (key: string) => void } | undefined),
 *   save: () => void,
 * }}
 */
export function openProviderIdCache(dir) {
  /** @type {Map<string, { file: string, values: Map<string, unknown>, changes: Map<string, unknown> }>} */
  const slices = new Map();

  function slice(providerId) {
    let s = slices.get(providerId);
    if (!s) {
      const file = path.join(dir, `${providerId}.json`);
      s = { file, values: new Map(Object.entries(readSlice(file))), changes: new Map() };
      slices.set(providerId, s);
    }
    return s;
  }

  return {
    forProvider(providerId) {
      if (typeof providerId !== 'string' || !SAFE_PROVIDER_ID.test(providerId)) return undefined;
      const s = slice(providerId);
      return {
        get: (key) => s.values.get(String(key)),
        set: (key, value) => {
          s.values.set(String(key), value);
          s.changes.set(String(key), value);
        },
        delete: (key) => {
          s.values.delete(String(key));
          s.changes.set(String(key), DELETED);
        },
      };
    },

    save() {
      for (const s of slices.values()) {
        if (s.changes.size === 0) continue;
        const merged = readSlice(s.file);
        for (const [key, value] of s.changes) {
          if (value === DELETED) delete merged[key];
          else merged[key] = value;
        }
        // Keys sorted so the file diffs cleanly between runs.
        const sorted = Object.fromEntries(Object.keys(merged).sort().map((key) => [key, merged[key]]));
        mkdirSync(path.dirname(s.file), { recursive: true });
        const tmp = `${s.file}.${process.pid}.tmp`;
        writeFileSync(tmp, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
        renameSyncWithRetry(tmp, s.file);
        s.changes.clear();
      }
    },
  };
}
