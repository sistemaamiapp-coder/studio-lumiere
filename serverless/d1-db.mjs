// Cliente de dados sobre Cloudflare D1 com a mesma API do banco local
// (db.from(t).select().eq().order().limit().insert().insertIfAbsent().update().delete()).

function ident(name) {
  const value = String(name || '');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`identificador inválido: ${value}`);
  return value;
}

function columns(cols) {
  if (!cols || cols === '*') return '*';
  return String(cols).split(',').map(part => ident(part.trim())).join(', ');
}

function bindValue(value) {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  return value;
}

export function createD1Db(d1) {
  class Query {
    constructor(name) {
      this.name = ident(name);
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

    eq(col, value) { this.filters.push([ident(col), value]); return this; }
    order(col, opts = {}) { this.orderBy = [ident(col), opts.ascending !== false]; return this; }
    limit(count) { this.max = count; return this; }
    insert(rows) { this.mode = { type: 'insert', rows: Array.isArray(rows) ? rows : [rows] }; return this; }
    insertIfAbsent(row, opts = {}) {
      this.mode = {
        type: 'insertIfAbsent',
        row,
        conflict: String(opts.onConflict || 'id').split(',').map(part => ident(part.trim()))
      };
      return this;
    }
    update(patch) { this.mode = { type: 'update', patch }; return this; }
    delete() { this.mode = { type: 'delete' }; return this; }

    whereClause() {
      if (!this.filters.length) return { sql: '', binds: [] };
      const sql = ' WHERE ' + this.filters.map(([col]) => `${col} = ?`).join(' AND ');
      return { sql, binds: this.filters.map(([, value]) => bindValue(value)) };
    }

    async run(sql, binds) {
      const statement = d1.prepare(sql);
      const bound = binds.length ? statement.bind(...binds) : statement;
      return bound.all();
    }

    async exec() {
      if (this.mode.type === 'insert') {
        const rows = this.mode.rows.filter(Boolean);
        if (!rows.length) return { data: null };
        const keys = Object.keys(rows[0]).map(ident);
        const placeholders = `(${keys.map(() => '?').join(', ')})`;
        const sql = `INSERT INTO ${this.name} (${keys.join(', ')}) VALUES ${rows.map(() => placeholders).join(', ')}`;
        const binds = rows.flatMap(row => keys.map(key => bindValue(row[key])));
        await this.run(sql, binds);
        return { data: null };
      }

      if (this.mode.type === 'insertIfAbsent') {
        const keys = Object.keys(this.mode.row).map(ident);
        const sql = `INSERT INTO ${this.name} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`
          + ` ON CONFLICT (${this.mode.conflict.join(', ')}) DO NOTHING`
          + ` RETURNING ${columns(this.mode.returning)}`;
        const result = await this.run(sql, keys.map(key => bindValue(this.mode.row[key])));
        return { data: result.results || [] };
      }

      if (this.mode.type === 'update') {
        const keys = Object.keys(this.mode.patch).map(ident);
        if (!keys.length) return { data: [] };
        const where = this.whereClause();
        if (!where.sql) throw new Error('update sem filtro');
        const returning = this.mode.returning ? ` RETURNING ${columns(this.mode.returning)}` : '';
        const sql = `UPDATE ${this.name} SET ${keys.map(key => `${key} = ?`).join(', ')}${where.sql}${returning}`;
        const result = await this.run(sql, [...keys.map(key => bindValue(this.mode.patch[key])), ...where.binds]);
        return { data: result.results || [] };
      }

      if (this.mode.type === 'delete') {
        const where = this.whereClause();
        if (!where.sql) throw new Error('delete sem filtro');
        const result = await this.run(`DELETE FROM ${this.name}${where.sql}`, where.binds);
        return { data: { removed: result.meta?.changes ?? 0 } };
      }

      const where = this.whereClause();
      let sql = `SELECT ${columns(this.mode.cols)} FROM ${this.name}${where.sql}`;
      if (this.orderBy) sql += ` ORDER BY ${this.orderBy[0]} ${this.orderBy[1] ? 'ASC' : 'DESC'}`;
      if (this.max != null) sql += ` LIMIT ${Math.max(0, Number(this.max) | 0)}`;
      const result = await this.run(sql, where.binds);
      return { data: result.results || [] };
    }

    then(resolve, reject) { return this.exec().then(resolve, reject); }
  }

  return {
    from(name) { return new Query(name); }
  };
}
