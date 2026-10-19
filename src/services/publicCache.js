// Tiny in-memory cache for the landing page data (company info, college and place lists).
// Every visitor loads these, and they almost never change, so a short cache saves a lot of database reads.
// The admin routes call clear() after any change, so edits show at once on this instance (other instances within TTL).
const TTL_MS = 30 * 1000;
const store = new Map();

async function cached(key, loader) {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = await loader();
  store.set(key, { at: Date.now(), value });
  return value;
}

const clear = () => store.clear();

module.exports = { cached, clear };
