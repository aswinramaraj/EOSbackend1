/**
 * First-ever login for the new "canteen_cashier" role — a plain data
 * provisioning script, not a schema change, same convention as
 * create-canteen-admin-login.ts.
 *
 * Idempotent — checks for an existing `roles` row by name and an existing
 * `users` row by email before inserting either.
 * Run from EOSbackend1: npx tsx scripts/create-canteen-cashier-login.ts
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import { Pool } from 'pg';

const ROLE_NAME = 'canteen_cashier';
const ROLE_DESCRIPTION = 'Canteen Cashier';
const EMAIL = 'canteencashier@sece.ac.in';
const PASSWORD = 'EOS@test123';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const roleRow = await pool.query<{ id: number }>(
      `SELECT id FROM roles WHERE name = $1`,
      [ROLE_NAME],
    );
    let roleId: number;
    if (roleRow.rows.length > 0) {
      roleId = roleRow.rows[0].id;
      console.log(`Role "${ROLE_NAME}" already exists (id=${roleId})`);
    } else {
      const inserted = await pool.query<{ id: number }>(
        `INSERT INTO roles (name, description) VALUES ($1, $2) RETURNING id`,
        [ROLE_NAME, ROLE_DESCRIPTION],
      );
      roleId = inserted.rows[0].id;
      console.log(`Created role "${ROLE_NAME}" (id=${roleId})`);
    }

    const existingUser = await pool.query<{ id: number }>(
      `SELECT id FROM users WHERE email = $1`,
      [EMAIL],
    );
    if (existingUser.rows.length > 0) {
      console.log(
        `User ${EMAIL} already exists (id=${existingUser.rows[0].id}) — nothing to do`,
      );
      return;
    }

    const passwordHash = crypto
      .createHash('sha256')
      .update(PASSWORD)
      .digest('hex');
    const createdUser = await pool.query(
      `INSERT INTO users (email, password_hash, role_id, status)
       VALUES ($1, $2, $3, 'active')
       RETURNING id, email`,
      [EMAIL, passwordHash, roleId],
    );
    console.log('Created canteen_cashier login:', createdUser.rows[0]);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Failed to create canteen cashier login:', err);
  process.exitCode = 1;
});
