import fs from 'node:fs';
import type { TableName } from '../../../shared/schema';
import type { Db, Row } from './Db';
import { LocalJsonAdapter } from './adapters/LocalJsonAdapter';
import { SheetsAdapter } from './adapters/SheetsAdapter';
import { config as appConfig } from '../config';

export type SeedableDb = Db & { replaceTable(table: TableName, rows: Row[]): Promise<void>; truncateAll(): Promise<void>; markSeeded?(): Promise<void> };

export interface CreateDbOptions { driver?: 'local' | 'sheets'; dataDir?: string; sheetId?: string; keyFile?: string }

/**
 * Creates and initialises the configured database.
 * DB_DRIVER=sheets falls back to local (with a clear warning) when the sheet id / key file is missing or unreachable.
 */
export async function createDb(opts: CreateDbOptions = {}): Promise<SeedableDb> {
  const driver = opts.driver ?? appConfig.dbDriver;
  const dataDir = opts.dataDir ?? appConfig.dataDir;
  if (driver === 'sheets') {
    const sheetId = opts.sheetId ?? appConfig.googleSheetId;
    const keyFile = opts.keyFile ?? appConfig.googleCredentials;
    if (!sheetId) {
      console.warn('[db] DB_DRIVER=sheets but GOOGLE_SHEET_ID is empty -> using the LOCAL file database instead.');
    } else if (!fs.existsSync(keyFile)) {
      console.warn(`[db] DB_DRIVER=sheets but the key file "${keyFile}" was not found -> using the LOCAL file database instead.`);
    } else {
      try {
        const db = new SheetsAdapter(sheetId, keyFile);
        await db.init();
        console.log(`[db] Google Sheets connected (sheet ${sheetId}).`);
        return db;
      } catch (e: any) {
        console.warn(`[db] Could not open the Google Sheet (${e?.message || e}). Did you share it with the service-account email as Editor? -> using LOCAL database.`);
      }
    }
  }
  const db = new LocalJsonAdapter(dataDir);
  await db.init();
  console.log(`[db] Local file database in ${dataDir}`);
  return db;
}
