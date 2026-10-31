/** Oracle DDL + INSERT generation from shared/schema.ts (used by scripts and the admin export route). */
import { TABLES, type ColumnDef, type TableDef } from '../../../shared/schema';
import type { Row } from './Db';

/** Words Oracle reserves (subset that matters for column names) - tests assert the schema avoids them. */
export const ORACLE_RESERVED = new Set([
  'ACCESS', 'ADD', 'ALL', 'ALTER', 'AND', 'ANY', 'AS', 'ASC', 'AUDIT', 'BETWEEN', 'BY', 'CHAR', 'CHECK', 'CLUSTER', 'COLUMN', 'COMMENT', 'COMPRESS',
  'CONNECT', 'CREATE', 'CURRENT', 'DATE', 'DECIMAL', 'DEFAULT', 'DELETE', 'DESC', 'DISTINCT', 'DROP', 'ELSE', 'EXCLUSIVE', 'EXISTS', 'FILE', 'FLOAT',
  'FOR', 'FROM', 'GRANT', 'GROUP', 'HAVING', 'IDENTIFIED', 'IMMEDIATE', 'IN', 'INCREMENT', 'INDEX', 'INITIAL', 'INSERT', 'INTEGER', 'INTERSECT',
  'INTO', 'IS', 'LEVEL', 'LIKE', 'LOCK', 'LONG', 'MAXEXTENTS', 'MINUS', 'MLSLABEL', 'MODE', 'MODIFY', 'NOAUDIT', 'NOCOMPRESS', 'NOT', 'NOWAIT',
  'NULL', 'NUMBER', 'OF', 'OFFLINE', 'ON', 'ONLINE', 'OPTION', 'OR', 'ORDER', 'PCTFREE', 'PRIOR', 'PUBLIC', 'RAW', 'RENAME', 'RESOURCE', 'REVOKE',
  'ROW', 'ROWID', 'ROWNUM', 'ROWS', 'SELECT', 'SESSION', 'SET', 'SHARE', 'SIZE', 'SMALLINT', 'START', 'SUCCESSFUL', 'SYNONYM', 'SYSDATE', 'TABLE',
  'THEN', 'TO', 'TRIGGER', 'UID', 'UNION', 'UNIQUE', 'UPDATE', 'USER', 'VALIDATE', 'VALUES', 'VARCHAR', 'VARCHAR2', 'VIEW', 'WHENEVER', 'WHERE', 'WITH',
  'TYPE', 'TIMESTAMP',
]);

function oracleType(c: ColumnDef): string {
  switch (c.type) {
    case 'id': return 'VARCHAR2(40)';
    case 'string': return `VARCHAR2(${c.length ?? 255})`;
    case 'text': case 'json': return 'CLOB';
    case 'int': return 'NUMBER(10)';
    case 'number': return 'NUMBER';
    case 'money': return 'NUMBER(18,2)';
    case 'bool': return 'CHAR(1)';
    case 'date': return 'DATE';
    case 'datetime': return 'TIMESTAMP';
  }
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const used = new Set<string>();
/** Oracle identifiers: keep <= 30 chars and unique (suffix _2, _3 ... on collision). */
function short(s: string): string {
  let base = s.slice(0, 30);
  let i = 2;
  while (used.has(base)) { const suf = `_${i++}`; base = s.slice(0, 30 - suf.length) + suf; }
  used.add(base);
  return base;
}

/** Tables in FK-safe order (parents first). */
export function orderedTables(): TableDef[] {
  const done = new Set<string>();
  const out: TableDef[] = [];
  const visit = (t: TableDef, stack: Set<string>) => {
    if (done.has(t.name) || stack.has(t.name)) return;
    stack.add(t.name);
    for (const c of t.columns) {
      const parent = c.ref?.split('.')[0];
      // projects.current_stage_id -> stages is a cycle; it is inserted NULL and set by an UPDATE afterwards
      if (t.name === 'projects' && c.name === 'current_stage_id') continue;
      if (parent && parent !== t.name) { const p = TABLES.find((x) => x.name === parent); if (p) visit(p, stack); }
    }
    done.add(t.name);
    out.push(t);
  };
  for (const t of TABLES) visit(t, new Set());
  return out;
}

export function generateDdl(): string {
  used.clear();
  const lines: string[] = [
    '-- Deals Separation Hub - Oracle schema (generated from shared/schema.ts by `npm run db:oracle-ddl`). Do not edit by hand.',
    '-- Tested shape: Oracle Database 19c+ / 23ai Free. Run as the application schema owner.',
    '',
  ];
  const fks: string[] = [];
  for (const t of orderedTables()) {
    lines.push(`-- ${t.description}`);
    lines.push(`CREATE TABLE ${t.name} (`);
    const cols = t.columns.map((c) => {
      let s = `  ${c.name.padEnd(28)} ${oracleType(c)}`;
      if (c.type === 'bool' && c.name === 'is_deleted') s += " DEFAULT 'N'";
      if (c.required || c.name === t.primaryKey) s += ' NOT NULL';
      return s;
    });
    const cons: string[] = [`  CONSTRAINT ${short(`pk_${t.name}`)} PRIMARY KEY (${t.primaryKey})`];
    for (const c of t.columns) {
      if (c.type === 'bool') cons.push(`  CONSTRAINT ${short(`ck_${t.name}_${c.name}`)} CHECK (${c.name} IN ('Y','N'))`);
      if (c.type === 'json') cons.push(`  CONSTRAINT ${short(`ck_${t.name}_${c.name}`)} CHECK (${c.name} IS JSON)`);
      if (c.enumValues) cons.push(`  CONSTRAINT ${short(`ck_${t.name}_${c.name}`)} CHECK (${c.name} IN (${c.enumValues.map(q).join(', ')}))`);
      if (c.ref) {
        const [pt, pc] = c.ref.split('.');
        fks.push(`ALTER TABLE ${t.name} ADD CONSTRAINT ${short(`fk_${t.name}_${c.name}`)} FOREIGN KEY (${c.name}) REFERENCES ${pt} (${pc});`);
      }
    }
    lines.push([...cols, ...cons].join(',\n'));
    lines.push(');');
    for (const c of t.columns) if (c.ref) lines.push(`CREATE INDEX ${short(`ix_${t.name}_${c.name}`)} ON ${t.name} (${c.name});`);
    lines.push('');
  }
  lines.push('-- Foreign keys (added after all tables exist)');
  lines.push(...fks, '');
  return lines.join('\n');
}

function lit(c: ColumnDef, v: unknown): string {
  if (v === null || v === undefined || v === '') return 'NULL';
  switch (c.type) {
    case 'int': case 'number': case 'money': { const n = Number(v); return Number.isFinite(n) ? String(n) : 'NULL'; }
    case 'date': return `TO_DATE(${q(String(v).slice(0, 10))}, 'YYYY-MM-DD')`;
    case 'datetime': {
      const s = String(v).replace('T', ' ').replace('Z', '').slice(0, 23);
      return `TO_TIMESTAMP(${q(s)}, 'YYYY-MM-DD HH24:MI:SS.FF3')`;
    }
    case 'text': case 'json': {
      const s = typeof v === 'string' ? v : JSON.stringify(v);
      // CLOB literals longer than 4000 chars must be concatenated in chunks
      const parts = s.match(/[\s\S]{1,3000}/g) || [''];
      return parts.length === 1 ? q(parts[0]) : parts.map((p) => `TO_CLOB(${q(p)})`).join(' || ');
    }
    default: return q(String(v));
  }
}

export function generateInserts(data: Record<string, Row[]>): string {
  const lines = [
    '-- Deals Separation Hub - data export (generated by `npm run db:export-oracle`).',
    "ALTER SESSION SET NLS_DATE_FORMAT = 'YYYY-MM-DD';",
    'SET DEFINE OFF',
    '',
  ];
  // FK order, but self/forward references (projects.current_stage_id -> stages) are inserted NULL then updated
  for (const t of orderedTables()) {
    const rows = data[t.name] || [];
    if (!rows.length) continue;
    lines.push(`-- ${t.name}: ${rows.length} rows`);
    for (const r of rows) {
      const cols = t.columns.map((c) => c.name);
      const vals = t.columns.map((c) => (t.name === 'projects' && c.name === 'current_stage_id' ? 'NULL' : lit(c, r[c.name])));
      lines.push(`INSERT INTO ${t.name} (${cols.join(', ')}) VALUES (${vals.join(', ')});`);
    }
    lines.push('');
  }
  const proj = data.projects || [];
  if (proj.length) {
    lines.push('-- projects.current_stage_id points at stages (inserted after projects)');
    for (const p of proj) if (p.current_stage_id) lines.push(`UPDATE projects SET current_stage_id = ${q(p.current_stage_id)} WHERE project_id = ${q(p.project_id)};`);
  }
  lines.push('', 'COMMIT;', '');
  return lines.join('\n');
}
