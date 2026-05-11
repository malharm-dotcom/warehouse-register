require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function query(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

async function setupTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS entries (
      id            SERIAL PRIMARY KEY,
      warehouse     TEXT NOT NULL,
      register_type TEXT NOT NULL,
      sr_no         INTEGER NOT NULL,
      date          DATE NOT NULL,
      in_time       TIME,
      out_time      TIME,
      shift         TEXT NOT NULL,
      shift_end     TIMESTAMPTZ NOT NULL,
      data          JSONB NOT NULL DEFAULT '{}',
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS sr_counters (
      warehouse     TEXT NOT NULL,
      register_type TEXT NOT NULL,
      last_sr       INTEGER DEFAULT 0,
      PRIMARY KEY (warehouse, register_type)
    )
  `);
}

// Atomically increment and return the next SR number
async function nextSr(warehouse, register_type) {
  const res = await query(`
    INSERT INTO sr_counters (warehouse, register_type, last_sr)
    VALUES ($1, $2, 1)
    ON CONFLICT (warehouse, register_type)
    DO UPDATE SET last_sr = sr_counters.last_sr + 1
    RETURNING last_sr
  `, [warehouse, register_type]);
  return res.rows[0].last_sr;
}

// IST offset +5:30
function istNow() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000);
}

function getShiftAndEnd() {
  const now = istNow();
  const hour = now.getUTCHours(); // already shifted to IST
  // day shift: 09:00-21:00 IST
  const isDay = hour >= 9 && hour < 21;
  const shift = isDay ? 'day' : 'night';

  // Compute shift_end in UTC
  const shiftEnd = new Date(now);
  if (isDay) {
    // end = today 21:00 IST = today 15:30 UTC
    shiftEnd.setUTCHours(15, 30, 0, 0);
  } else {
    // end = next 09:00 IST
    if (hour < 9) {
      // already past midnight UTC, end is today 03:30 UTC
      shiftEnd.setUTCHours(3, 30, 0, 0);
    } else {
      // evening, end is tomorrow 03:30 UTC
      shiftEnd.setUTCDate(shiftEnd.getUTCDate() + 1);
      shiftEnd.setUTCHours(3, 30, 0, 0);
    }
  }
  return { shift, shiftEnd };
}

module.exports = { query, setupTables, nextSr, getShiftAndEnd, istNow };
