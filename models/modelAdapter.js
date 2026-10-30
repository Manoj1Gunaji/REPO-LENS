const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const inMemoryStores = new Map();
const STORE_FILE = path.join(__dirname, '..', 'data', 'model-store.json');
let persistenceQueue = Promise.resolve();

try {
  const persistedStores = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  for (const [collectionName, documents] of Object.entries(persistedStores)) {
    if (Array.isArray(documents)) inMemoryStores.set(collectionName, documents);
  }
} catch (error) {
  if (error.code !== 'ENOENT') {
    console.warn(`[ModelAdapter] Could not load local data: ${error.message}`);
  }
}

const persistStores = () => {
  const snapshot = JSON.stringify(Object.fromEntries(inMemoryStores));
  persistenceQueue = persistenceQueue.catch(() => {}).then(async () => {
    await fs.promises.mkdir(path.dirname(STORE_FILE), { recursive: true });
    const temporaryFile = `${STORE_FILE}.tmp`;
    await fs.promises.writeFile(temporaryFile, snapshot, 'utf8');
    await fs.promises.rename(temporaryFile, STORE_FILE);
  });
  return persistenceQueue;
};

const matchesQuery = (item, query = {}) => {
  if (!query || Object.keys(query).length === 0) return true;
  for (const [key, val] of Object.entries(query)) {
    if (key === '$or' && Array.isArray(val)) {
      const matchAny = val.some((subQuery) => matchesQuery(item, subQuery));
      if (!matchAny) return false;
      continue;
    }
    if (key === '$and' && Array.isArray(val)) {
      const matchAll = val.every((subQuery) => matchesQuery(item, subQuery));
      if (!matchAll) return false;
      continue;
    }
    const itemVal = item[key];
    if (val && typeof val === 'object' && !(val instanceof RegExp) && !(val instanceof Date)) {
      if (val.$in && Array.isArray(val.$in)) {
        if (!val.$in.map(String).includes(String(itemVal))) return false;
      } else if (val.$regex) {
        const regex = new RegExp(val.$regex, val.$options || '');
        if (!regex.test(String(itemVal || ''))) return false;
      } else if (val.$ne !== undefined) {
        if (String(itemVal) === String(val.$ne)) return false;
      } else if (val.$gt !== undefined) {
        if (itemVal <= val.$gt) return false;
      } else if (val.$gte !== undefined) {
        if (itemVal < val.$gte) return false;
      }
    } else if (val instanceof RegExp) {
      if (!val.test(String(itemVal || ''))) return false;
    } else if (String(itemVal) !== String(val)) {
      return false;
    }
  }
  return true;
};

const wrapDoc = (item, collectionName) => {
  if (!item) return null;
  const doc = { ...item };
  doc.save = async function () {
    const store = inMemoryStores.get(collectionName) || [];
    const idx = store.findIndex((x) => String(x._id) === String(this._id));
    this.updatedAt = new Date();
    const clean = { ...this };
    delete clean.save;
    if (idx !== -1) {
      store[idx] = clean;
    } else {
      store.push(clean);
    }
    await persistStores();
    return this;
  };
  return doc;
};

class InMemoryQuery {
  constructor(collectionName, query, isSingleDoc = false) {
    this.collectionName = collectionName;
    this.query = query;
    this.isSingleDoc = isSingleDoc;
    this._skip = 0;
    this._limit = Infinity;
    this._sort = null;
    this._select = null;
    this._lean = false;
  }

  skip(n) {
    this._skip = n;
    return this;
  }

  limit(n) {
    this._limit = n;
    return this;
  }

  sort(sortCriteria) {
    this._sort = sortCriteria;
    return this;
  }

  select(selectFields) {
    this._select = selectFields;
    return this;
  }

  populate() {
    return this;
  }

  lean() {
    this._lean = true;
    return this;
  }

  async exec() {
    const list = inMemoryStores.get(this.collectionName) || [];
    let results = list.filter((item) => matchesQuery(item, this.query));

    if (this._sort) {
      const [field, direction] =
        typeof this._sort === 'string'
          ? [this._sort.replace(/^-/, ''), this._sort.startsWith('-') ? -1 : 1]
          : Object.entries(this._sort)[0] || ['_id', 1];
      results.sort((a, b) => {
        const va = a[field];
        const vb = b[field];
        if (va < vb) return -1 * direction;
        if (va > vb) return 1 * direction;
        return 0;
      });
    }

    if (this._skip) results = results.slice(this._skip);
    if (this._limit !== Infinity) results = results.slice(0, this._limit);

    if (this.isSingleDoc) {
      if (results.length === 0) return null;
      return this._lean
        ? JSON.parse(JSON.stringify(results[0]))
        : wrapDoc(results[0], this.collectionName);
    }

    return this._lean
      ? JSON.parse(JSON.stringify(results))
      : results.map((r) => wrapDoc(r, this.collectionName));
  }

  then(resolve, reject) {
    return this.exec().then(resolve, reject);
  }

  catch(reject) {
    return this.exec().catch(reject);
  }
}

let isConnected = false;

const setDbConnected = (val) => {
  isConnected = val;
};

const isDbConnected = () => isConnected;

const createModel = (name, schema) => {
  const MongooseModel = mongoose.models[name] || mongoose.model(name, schema);
  const collectionName = name.toLowerCase();

  if (!inMemoryStores.has(collectionName)) {
    inMemoryStores.set(collectionName, []);
  }

  const modelProxy = {
    get mongoose() {
      return MongooseModel;
    },

    async create(docOrDocs) {
      if (isConnected) {
        return await MongooseModel.create(docOrDocs);
      }
      const store = inMemoryStores.get(collectionName);
      const isArr = Array.isArray(docOrDocs);
      const items = (isArr ? docOrDocs : [docOrDocs]).map((doc) => {
        const id = doc._id ? String(doc._id) : new mongoose.Types.ObjectId().toString();
        const now = new Date();
        return {
          _id: id,
          id,
          createdAt: doc.createdAt || now,
          updatedAt: doc.updatedAt || now,
          ...doc
        };
      });
      store.push(...items);
      await persistStores();
      return isArr
        ? items.map((i) => wrapDoc(i, collectionName))
        : wrapDoc(items[0], collectionName);
    },

    async insertMany(docs) {
      return this.create(docs);
    },

    find(query = {}) {
      if (isConnected) {
        return MongooseModel.find(query);
      }
      return new InMemoryQuery(collectionName, query, false);
    },

    findOne(query = {}) {
      if (isConnected) {
        return MongooseModel.findOne(query);
      }
      return new InMemoryQuery(collectionName, query, true);
    },

    findById(id) {
      if (isConnected) {
        return MongooseModel.findById(id);
      }
      return new InMemoryQuery(collectionName, { _id: String(id) }, true);
    },

    async findByIdAndUpdate(id, update, options = {}) {
      return this.findOneAndUpdate({ _id: String(id) }, update, options);
    },

    async findOneAndUpdate(query, update, options = {}) {
      if (isConnected) {
        return await MongooseModel.findOneAndUpdate(query, update, options);
      }
      const store = inMemoryStores.get(collectionName);
      const index = store.findIndex((item) => matchesQuery(item, query));
      if (index === -1) return null;

      const existing = store[index];
      const payload = update.$set ? { ...existing, ...update.$set } : { ...existing, ...update };
      payload.updatedAt = new Date();
      store[index] = payload;
      await persistStores();
      return wrapDoc(payload, collectionName);
    },

    async updateOne(query, update) {
      return this.findOneAndUpdate(query, update);
    },

    async updateMany(query, update) {
      if (isConnected) {
        return await MongooseModel.updateMany(query, update);
      }
      const store = inMemoryStores.get(collectionName);
      let count = 0;
      store.forEach((item, idx) => {
        if (matchesQuery(item, query)) {
          const payload = update.$set ? { ...item, ...update.$set } : { ...item, ...update };
          payload.updatedAt = new Date();
          store[idx] = payload;
          count++;
        }
      });
      if (count > 0) await persistStores();
      return { modifiedCount: count };
    },

    async deleteOne(query) {
      if (isConnected) {
        return await MongooseModel.deleteOne(query);
      }
      const store = inMemoryStores.get(collectionName);
      const idx = store.findIndex((item) => matchesQuery(item, query));
      if (idx !== -1) {
        store.splice(idx, 1);
        await persistStores();
        return { deletedCount: 1 };
      }
      return { deletedCount: 0 };
    },

    async deleteMany(query) {
      if (isConnected) {
        return await MongooseModel.deleteMany(query);
      }
      const store = inMemoryStores.get(collectionName);
      const initial = store.length;
      const remaining = store.filter((item) => !matchesQuery(item, query));
      inMemoryStores.set(collectionName, remaining);
      if (initial !== remaining.length) await persistStores();
      return { deletedCount: initial - remaining.length };
    },

    async findByIdAndDelete(id) {
      const existing = await this.findById(id);
      if (existing) {
        await this.deleteOne({ _id: String(id) });
      }
      return existing;
    },

    async countDocuments(query = {}) {
      if (isConnected) {
        return await MongooseModel.countDocuments(query);
      }
      const store = inMemoryStores.get(collectionName);
      return store.filter((item) => matchesQuery(item, query)).length;
    }
  };

  return modelProxy;
};

module.exports = {
  createModel,
  setDbConnected,
  isDbConnected
};
