/**
 * Database interface. Implemented by:
 *   - adapters/LocalJsonAdapter.ts  (DB_DRIVER=local, JSON files in DATA_DIR)
 *   - adapters/SheetsAdapter.ts     (DB_DRIVER=sheets, Google Sheets via service account)
 *   - (v3) adapters/OracleAdapter.ts
 * Routes and AI code must ONLY talk to this interface, never to a driver directly.
 */
import type { TableName } from '../../../shared/schema';

export type Row = Record<string, any>;

export interface Db {
  readonly driver: 'local' | 'sheets' | 'oracle';
  /** Load data / create tabs if missing. Called once at startup. */
  init(): Promise<void>;
  /** All non-deleted rows (pass includeDeleted to get soft-deleted ones too). */
  all<T extends Row = Row>(table: TableName, opts?: { includeDeleted?: boolean }): Promise<T[]>;
  /** Rows matching a predicate (non-deleted). */
  find<T extends Row = Row>(table: TableName, predicate: (row: T) => boolean): Promise<T[]>;
  get<T extends Row = Row>(table: TableName, id: string): Promise<T | undefined>;
  /** Fills primary key (e.g. PRJ-0042), created_at, created_by, is_deleted='N' when missing. */
  insert<T extends Row = Row>(table: TableName, row: Partial<T>, actorId?: string): Promise<T>;
  insertMany<T extends Row = Row>(table: TableName, rows: Partial<T>[], actorId?: string): Promise<T[]>;
  /** Merges the patch, sets updated_at/updated_by. Throws if not found. */
  update<T extends Row = Row>(table: TableName, id: string, patch: Partial<T>, actorId?: string): Promise<T>;
  /** Sets is_deleted='Y'. */
  softDelete(table: TableName, id: string, actorId?: string): Promise<void>;
  /** Row counts per table (admin page). */
  counts(): Promise<Record<string, number>>;
  /** Re-read from the source (Sheets edited by hand). No-op for local. */
  reload(): Promise<void>;
}
