# Moving the database to Oracle (version 3 plan)

The Google Sheet and the local JSON files already follow Oracle-friendly rules (see `docs/DATA_MODEL.md`), so the move is
**generate SQL -> load it -> switch the driver**. No screen, route or AI code changes, because all of them use the `Db` interface.

## 1. Get the SQL

| File | What it is | How to (re)generate |
|---|---|---|
| `db/oracle/schema.sql` | `CREATE TABLE` for all 15 tables with primary keys, CHECK constraints (Y/N, enums, IS JSON), indexes and foreign keys | `npm run db:oracle-ddl` |
| `db/oracle/data.sql` | `INSERT` statements for every row, in foreign-key-safe order, with `TO_DATE` / `TO_TIMESTAMP` | `npm run db:export-oracle` (reads whichever database is configured: run it with `DB_DRIVER=sheets` to export the live Google Sheet) |

The Platform Admin persona can also download one combined file from **Data admin -> Export for Oracle** (`GET /api/admin/export/oracle`).

## 2. Run Oracle locally (free)

```bash
# Oracle Database 23ai Free in Docker (about 2 GB image)
docker run -d --name oracle-free -p 1521:1521 -e ORACLE_PWD=Welcome_123 container-registry.oracle.com/database/free:latest
# wait until `docker logs oracle-free` says DATABASE IS READY TO USE

# create an application user
docker exec -it oracle-free sqlplus sys/Welcome_123@FREEPDB1 as sysdba <<'SQL'
CREATE USER dsh IDENTIFIED BY dsh_pass QUOTA UNLIMITED ON USERS;
GRANT CREATE SESSION, CREATE TABLE, CREATE VIEW, CREATE SEQUENCE TO dsh;
SQL

# load schema and data
docker cp db/oracle/schema.sql oracle-free:/tmp/schema.sql
docker cp db/oracle/data.sql oracle-free:/tmp/data.sql
docker exec -it oracle-free sqlplus dsh/dsh_pass@FREEPDB1 @/tmp/schema.sql
docker exec -it oracle-free sqlplus dsh/dsh_pass@FREEPDB1 @/tmp/data.sql
```

Check: `SELECT code_name, status, percent_complete FROM projects;` should list the same projects as the app.

## 3. Switch the app to Oracle (to build in v3)

1. `npm install oracledb` (node-oracledb Thin mode: no Oracle Client install needed).
2. Finish `server/src/db/adapters/OracleAdapter.ts` - the file already documents the SQL for each method and the type mapping.
3. Register it in `server/src/db/index.ts` (`if (driver === 'oracle') ...`) and add to `.env`:
   ```
   DB_DRIVER=oracle
   ORACLE_USER=dsh
   ORACLE_PASSWORD=dsh_pass
   ORACLE_CONNECT_STRING=localhost:1521/FREEPDB1
   ```
4. Run `npm test` - the same API tests must pass against Oracle.

## Type mapping

| Schema type | Google Sheet / JSON | Oracle |
|---|---|---|
| id, string(n) | text | VARCHAR2(40) / VARCHAR2(n) |
| text | text | CLOB |
| json | text holding JSON | CLOB CHECK (col IS JSON) |
| int | number | NUMBER(10) |
| number | number | NUMBER |
| money | number | NUMBER(18,2) |
| bool | `Y` / `N` | CHAR(1) CHECK IN ('Y','N') |
| date | `YYYY-MM-DD` | DATE |
| datetime | ISO-8601 UTC | TIMESTAMP |

## Things to know
- `projects.current_stage_id` points at `stages`, which point back at `projects`. The export inserts projects with `current_stage_id = NULL` and sets it with `UPDATE` after stages are loaded.
- Constraint names are kept to 30 characters so the script also runs on older Oracle versions.
- Soft-deleted rows (`is_deleted = 'Y'`) are exported too, so the audit history stays complete.
