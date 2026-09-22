import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase,seedDatabase } from './helpers/database.mjs';
test('production schema installs on isolated PostgreSQL with five role fixtures',async()=>{
 const db=await createDatabase({changes:false});
 try { await seedDatabase(db); const r=await db.query('select count(distinct role)::int as count from st_users');assert.equal(r.rows[0].count,5); }
 finally { await db.close(); }
});
