import type { SessionStore, SessionData } from '@flue/sdk/client';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

let ready: Promise<void> | null = null;
async function ensureTable() {
    if (!ready) {
        ready = pool
            .query(
                `CREATE TABLE IF NOT EXISTS flue_sessions (
           id         text PRIMARY KEY,
           data       jsonb NOT NULL,
           updated_at timestamptz NOT NULL DEFAULT now()
         )`,
            )
            .then(() => undefined);
        // Reset on failure so the next call can retry instead of replaying
        // the original rejection forever.
        ready.catch(() => {
            ready = null;
        });
    }
    await ready;
}

export const sessionStore: SessionStore = {
    async save(id, data) {
        await ensureTable();
        await pool.query(
            `INSERT INTO flue_sessions (id, data, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
            [id, JSON.stringify(data)],
        );
    },
    async load(id) {
        await ensureTable();
        const { rows } = await pool.query<{ data: SessionData }>(
            `SELECT data FROM flue_sessions WHERE id = $1`,
            [id],
        );
        return rows[0]?.data ?? null;
    },
    async delete(id) {
        await ensureTable();
        await pool.query(`DELETE FROM flue_sessions WHERE id = $1`, [id]);
    },
};