require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const XLSX = require('xlsx');
const PDFDocument = require('pdfkit');
const { query, setupTables, nextSr, getShiftAndEnd, istNow } = require('./db');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Warehouse config
const WAREHOUSES = {
  WH1: {
    label: 'Warehouse 1',
    pin: process.env.PIN_WH1,
    registers: [
      { type: 'outward', label: 'Outward Dispatch', icon: '🚛' },
      { type: 'returns', label: 'Returns', icon: '↩️' },
    ],
  },
  WH2: {
    label: 'Warehouse 2',
    pin: process.env.PIN_WH2,
    registers: [
      { type: 'inward', label: 'Inward Receiving', icon: '📦' },
      { type: 'outward_local', label: 'Outward Local', icon: '🚐' },
      { type: 'outward_outstation', label: 'Outward Outstation', icon: '🚛' },
      { type: 'material', label: 'Material Register', icon: '🗃️' },
    ],
  },
  NORTH: {
    label: 'North Warehouse',
    pin: null,
    registers: [],
    comingSoon: true,
  },
};

// Auth middleware for mutating routes
function requireAuth(req, res, next) {
  const { warehouse } = req.body || req.query;
  const token = req.headers['x-wh-token'];
  if (!warehouse || !WAREHOUSES[warehouse]) return res.status(400).json({ error: 'Invalid warehouse' });
  const wh = WAREHOUSES[warehouse];
  if (wh.comingSoon) return res.status(403).json({ error: 'Coming soon' });
  if (!token || token !== wh.pin) return res.status(401).json({ error: 'Invalid PIN' });
  next();
}

// GET /api/warehouses
app.get('/api/warehouses', (req, res) => {
  const result = Object.entries(WAREHOUSES).map(([id, wh]) => ({
    id,
    label: wh.label,
    registers: wh.registers,
    comingSoon: wh.comingSoon || false,
  }));
  res.json(result);
});

// POST /api/auth
app.post('/api/auth', (req, res) => {
  const { warehouse, pin } = req.body;
  if (!warehouse || !WAREHOUSES[warehouse]) return res.status(400).json({ error: 'Invalid warehouse' });
  const wh = WAREHOUSES[warehouse];
  if (wh.comingSoon) return res.status(403).json({ error: 'Coming soon' });
  if (!pin || pin !== wh.pin) return res.status(401).json({ error: 'Wrong PIN' });
  res.json({ ok: true, warehouse, token: wh.pin });
});

// GET /api/entries
app.get('/api/entries', async (req, res) => {
  const { warehouse, register_type, date, from, to } = req.query;
  if (!warehouse || !register_type) return res.status(400).json({ error: 'warehouse and register_type required' });

  let sql, params;
  if (date) {
    sql = `SELECT * FROM entries WHERE warehouse=$1 AND register_type=$2 AND date=$3 ORDER BY sr_no ASC`;
    params = [warehouse, register_type, date];
  } else if (from && to) {
    sql = `SELECT * FROM entries WHERE warehouse=$1 AND register_type=$2 AND date BETWEEN $3 AND $4 ORDER BY date ASC, sr_no ASC`;
    params = [warehouse, register_type, from, to];
  } else {
    return res.status(400).json({ error: 'date or from+to required' });
  }

  try {
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/entries
app.post('/api/entries', requireAuth, async (req, res) => {
  const { warehouse, register_type, in_time, out_time, data } = req.body;
  if (!warehouse || !register_type) return res.status(400).json({ error: 'Missing required fields' });

  try {
    const { shift, shiftEnd } = getShiftAndEnd();
    const now = istNow();
    const date = now.toISOString().split('T')[0];
    const sr_no = await nextSr(warehouse, register_type);

    const result = await query(
      `INSERT INTO entries (warehouse, register_type, sr_no, date, in_time, out_time, shift, shift_end, data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [warehouse, register_type, sr_no, date, in_time || null, out_time || null, shift, shiftEnd.toISOString(), data || {}]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/entries/:id
app.put('/api/entries/:id', async (req, res) => {
  const { id } = req.params;
  const { warehouse, in_time, out_time, data } = req.body;
  const token = req.headers['x-wh-token'];

  if (!warehouse || !WAREHOUSES[warehouse]) return res.status(400).json({ error: 'Invalid warehouse' });
  if (!token || token !== WAREHOUSES[warehouse].pin) return res.status(401).json({ error: 'Invalid PIN' });

  try {
    const existing = await query('SELECT * FROM entries WHERE id=$1', [id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Entry not found' });

    const entry = existing.rows[0];
    const now = new Date();
    if (now > new Date(entry.shift_end)) {
      return res.status(403).json({ error: 'Entry locked — shift has ended' });
    }

    const result = await query(
      `UPDATE entries SET in_time=$1, out_time=$2, data=$3, updated_at=NOW() WHERE id=$4 RETURNING *`,
      [in_time || entry.in_time, out_time || entry.out_time, data || entry.data, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/entries/export
app.get('/api/entries/export', async (req, res) => {
  const { warehouse, register_type, from, to, format } = req.query;
  if (!warehouse || !register_type || !from || !to) return res.status(400).json({ error: 'Missing params' });

  try {
    const result = await query(
      `SELECT * FROM entries WHERE warehouse=$1 AND register_type=$2 AND date BETWEEN $3 AND $4 ORDER BY date ASC, sr_no ASC`,
      [warehouse, register_type, from, to]
    );
    const rows = result.rows;

    if (format === 'xlsx') {
      const sheetData = rows.map(r => ({
        'SR No': r.sr_no,
        Date: r.date,
        'IN Time': r.in_time || '',
        'OUT Time': r.out_time || '',
        Shift: r.shift,
        ...r.data,
      }));
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(sheetData);
      XLSX.utils.book_append_sheet(wb, ws, register_type);
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${warehouse}_${register_type}_${from}_${to}.xlsx"`,
      });
      res.send(buf);
    } else if (format === 'pdf') {
      const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${warehouse}_${register_type}_${from}_${to}.pdf"`,
      });
      doc.pipe(res);
      doc.fontSize(14).text(`${warehouse} — ${register_type} Register`, { align: 'center' });
      doc.fontSize(10).text(`Period: ${from} to ${to}`, { align: 'center' });
      doc.moveDown();

      rows.forEach(r => {
        const line = `SR#${r.sr_no} | ${r.date} | IN:${r.in_time || '-'} OUT:${r.out_time || '-'} | ${JSON.stringify(r.data)}`;
        doc.fontSize(9).text(line);
      });
      doc.end();
    } else {
      res.status(400).json({ error: 'format must be xlsx or pdf' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;

setupTables().then(() => {
  app.listen(PORT, () => console.log(`WH Register server running on http://localhost:${PORT}`));
}).catch(err => {
  console.error('DB setup failed:', err.message);
  process.exit(1);
});
