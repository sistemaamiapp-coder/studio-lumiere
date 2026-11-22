// Banco em memória que imita o cliente de dados da plataforma (apenas para testes locais).
export function createFakeDb(seed = {}) {
  const tables = new Map();
  for (const [name, rows] of Object.entries(seed)) tables.set(name, rows.map(row => ({ ...row })));
  const table = name => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name);
  };

  class Query {
    constructor(name) {
      this.name = name;
      this.filters = [];
      this.orderBy = null;
      this.max = null;
      this.mode = { type: 'select', cols: null };
    }
    select(cols) {
      if (this.mode.type === 'select') this.mode.cols = cols;
      else this.mode.returning = cols;
      return this;
    }
    eq(col, value) { this.filters.push([col, value]); return this; }
    order(col, opts = {}) { this.orderBy = [col, opts.ascending !== false]; return this; }
    limit(n) { this.max = n; return this; }
    insert(rows) { this.mode = { type: 'insert', rows: Array.isArray(rows) ? rows : [rows] }; return this; }
    insertIfAbsent(row, opts = {}) {
      this.mode = { type: 'insertIfAbsent', row, conflict: String(opts.onConflict || 'id').split(',') };
      return this;
    }
    update(patch) { this.mode = { type: 'update', patch }; return this; }
    delete() { this.mode = { type: 'delete' }; return this; }

    matches(row) { return this.filters.every(([col, value]) => row[col] === value); }
    project(row) {
      const cols = this.mode.returning || this.mode.cols;
      if (!cols || cols === '*' || row == null) return row ? { ...row } : row;
      const keys = cols.split(',').map(key => key.trim());
      return Object.fromEntries(keys.filter(key => key in row).map(key => [key, row[key]]));
    }
    exec() {
      const rows = table(this.name);
      if (this.mode.type === 'insert') {
        this.mode.rows.forEach(row => rows.push({ ...row }));
        return { data: null };
      }
      if (this.mode.type === 'insertIfAbsent') {
        const conflict = this.mode.conflict;
        if (rows.some(row => conflict.every(col => row[col] === this.mode.row[col]))) return { data: [] };
        rows.push({ ...this.mode.row });
        return { data: [this.project(this.mode.row)] };
      }
      if (this.mode.type === 'update') {
        const updated = [];
        rows.forEach(row => {
          if (!this.matches(row)) return;
          Object.assign(row, this.mode.patch);
          updated.push({ ...row });
        });
        return { data: updated };
      }
      if (this.mode.type === 'delete') {
        const keep = rows.filter(row => !this.matches(row));
        const removed = rows.length - keep.length;
        tables.set(this.name, keep);
        return { data: { removed } };
      }
      let list = rows.filter(row => this.matches(row));
      if (this.orderBy) {
        const [col, ascending] = this.orderBy;
        list = list.slice().sort((a, b) => {
          const left = a[col] ?? '';
          const right = b[col] ?? '';
          const cmp = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right));
          return ascending ? cmp : -cmp;
        });
      }
      if (this.max != null) list = list.slice(0, this.max);
      return { data: list.map(row => this.project(row)) };
    }
    then(resolve, reject) {
      try { resolve(this.exec()); } catch (error) { reject(error); }
    }
  }

  return {
    from(name) { return new Query(name); },
    dump(name) { return table(name).map(row => ({ ...row })); }
  };
}
