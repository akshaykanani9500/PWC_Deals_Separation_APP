/** Writes db/oracle/schema.sql from shared/schema.ts. */
import fs from 'node:fs';
import path from 'node:path';
import { generateDdl } from '../server/src/db/oracle';

const out = path.resolve('db/oracle/schema.sql');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, generateDdl());
console.log(`[oracle] Wrote ${out}`);
