// repository 接口的内存实现。每个方法对应云数据库的一次调用，单文档更新是原子的。
// 探针用它统计调用量，并在任意一次调用前后注入崩溃。

export class Crash extends Error {}

export class MemoryDb {
  constructor({ clone = true } = {}) {
    this.collections = new Map();
    this.indexes = new Map();
    this.latest = new Map();
    this.clone = clone;
    this.calls = 0;
    this.reads = 0;
    this.writes = 0;
    this.hook = null;
  }

  coll(name) {
    if (!this.collections.has(name)) this.collections.set(name, new Map());
    return this.collections.get(name);
  }

  defineIndex(name, field) {
    this.indexes.set(`${name}.${field}`, new Map());
  }

  out(doc) {
    return this.clone ? structuredClone(doc) : doc;
  }

  addToIndexes(name, doc) {
    for (const [key, map] of this.indexes) {
      const [coll, field] = key.split('.');
      if (coll !== name) continue;
      const value = doc[field];
      if (!map.has(value)) map.set(value, new Set());
      map.get(value).add(doc.id);
    }
  }

  dropFromIndexes(name, doc) {
    for (const [key, map] of this.indexes) {
      const [coll, field] = key.split('.');
      if (coll === name) map.get(doc[field])?.delete(doc.id);
    }
  }

  async around(kind, op, fn) {
    this.calls++;
    if (kind === 'read') this.reads++;
    else this.writes++;
    if (this.hook) await this.hook('before', op);
    const result = fn();
    if (this.hook) await this.hook('after', op);
    return result;
  }

  get(name, id) {
    return this.around('read', `get:${name}`, () => {
      const doc = this.coll(name).get(id);
      return doc ? this.out(doc) : null;
    });
  }

  // 一次查询算一次调用，返回全部匹配的文档。
  findBy(name, field, value) {
    return this.around('read', `find:${name}`, () => {
      const ids = this.indexes.get(`${name}.${field}`)?.get(value);
      if (!ids) return [];
      const docs = [];
      for (const id of ids) docs.push(this.out(this.coll(name).get(id)));
      return docs;
    });
  }

  getMany(name, ids) {
    return this.around('read', `getMany:${name}`, () => {
      const docs = [];
      for (const id of ids) {
        const doc = this.coll(name).get(id);
        if (doc) docs.push(this.out(doc));
      }
      return docs;
    });
  }

  // 相当于 where 加 orderBy('seq', 'desc') 加 limit(1)。
  latestSeq(name, group) {
    return this.around('read', `latest:${name}`, () => {
      const id = this.latest.get(`${name}/${group}`);
      return id ? this.out(this.coll(name).get(id)) : null;
    });
  }

  // 编号已存在时失败，这是结算单提交的原子点。
  insert(name, doc, group = null) {
    return this.around('write', `insert:${name}`, () => {
      const docs = this.coll(name);
      if (docs.has(doc.id)) return false;
      const stored = this.clone ? structuredClone(doc) : doc;
      docs.set(doc.id, stored);
      this.addToIndexes(name, stored);
      if (group) this.latest.set(`${name}/${group}`, doc.id);
      return true;
    });
  }

  // where 加 update：条件和修改在单文档上原子完成。
  update(name, id, cond, mutate) {
    return this.around('write', `update:${name}`, () => {
      const doc = this.coll(name).get(id);
      if (!doc || !cond(doc)) return false;
      mutate(doc);
      return true;
    });
  }

  remove(name, id) {
    return this.around('write', `remove:${name}`, () => {
      const doc = this.coll(name).get(id);
      if (!doc) return false;
      this.dropFromIndexes(name, doc);
      this.coll(name).delete(id);
      return true;
    });
  }

  // 不计调用量，只给测试和初始化用。
  seed(name, doc) {
    this.coll(name).set(doc.id, doc);
    this.addToIndexes(name, doc);
  }

  peek(name, id) {
    return this.coll(name).get(id);
  }

  all(name) {
    return [...this.coll(name).values()];
  }
}
