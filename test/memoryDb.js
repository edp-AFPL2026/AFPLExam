/**
 * Tiny in-memory stand-in for the parts of Firestore / Storage this project uses.
 * Used ONLY by `npm test` (USE_MEMORY_DB=1). Never used in production.
 */
const store = new Map(); // collection -> Map(id -> data)
const col = (name) => {
  if (!store.has(name)) store.set(name, new Map());
  return store.get(name);
};
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
let counter = 0;
const newId = () => `m${(counter += 1).toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function deepMerge(target, src) {
  const out = { ...target };
  for (const [k, v] of Object.entries(src)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? deepMerge(out[k], v) : clone(v);
  }
  return out;
}

function docRef(colName, id) {
  const ref = {
    id,
    get: async () => {
      const data = col(colName).get(id);
      return { id, exists: data !== undefined, data: () => clone(data), ref };
    },
    set: async (data, opts) => {
      const prev = col(colName).get(id);
      col(colName).set(id, opts && opts.merge && prev ? deepMerge(prev, data) : clone(data));
    },
    update: async (data) => {
      const prev = col(colName).get(id);
      if (prev === undefined) throw new Error(`No document to update: ${colName}/${id}`);
      col(colName).set(id, { ...prev, ...clone(data) });
    },
    delete: async () => {
      col(colName).delete(id);
    },
  };
  return ref;
}

function query(colName, filters = []) {
  return {
    where: (field, op, value) => {
      if (op !== '==') throw new Error('memoryDb supports only == filters');
      return query(colName, [...filters, [field, value]]);
    },
    get: async () => {
      const docs = [];
      for (const [id, data] of col(colName)) {
        if (filters.every(([f, v]) => data[f] === v)) docs.push({ id, data: () => clone(data), exists: true, ref: docRef(colName, id) });
      }
      return { docs, size: docs.length, empty: docs.length === 0 };
    },
  };
}

const db = {
  collection: (name) => ({ ...query(name), doc: (id) => docRef(name, id || newId()) }),
  batch: () => {
    const ops = [];
    return {
      set: (ref, data, opts) => ops.push(() => ref.set(data, opts)),
      update: (ref, data) => ops.push(() => ref.update(data)),
      delete: (ref) => ops.push(() => ref.delete()),
      commit: async () => {
        for (const op of ops) await op();
      },
    };
  },
  runTransaction: async (fn) => {
    const writes = [];
    const t = {
      get: (ref) => ref.get(),
      set: (ref, data, opts) => writes.push(() => ref.set(data, opts)),
      update: (ref, data) => writes.push(() => ref.update(data)),
    };
    const result = await fn(t);
    for (const w of writes) await w();
    return result;
  },
  settings: () => {},
};

const bucket = {
  name: 'memory-bucket',
  file: () => ({ save: async () => {} }),
};

module.exports = { db, bucket };
