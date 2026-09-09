require('dotenv').config(); // Panggil dotenv di baris paling atas!
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const port = process.env.API_PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Konfigurasi Database
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
});


// ==========================================
// ENDPOINT 1: AMBIL DATA TITIK HOTSPOT (MULTI FILTER)
// ==========================================
app.get('/api/hotspots', async (req, res) => {
  try {
    const { tanggal, start_date, end_date, kabupaten, kecamatan, min_kepercayaan } = req.query;

    let query = 'SELECT * FROM hotspot_kaltim WHERE 1=1';
    let params = [];
    let paramIndex = 1;

    // Filter Tanggal Spesifik ATAU Rentang Waktu
    if (start_date && end_date) {
      query += ` AND tanggal BETWEEN $${paramIndex} AND $${paramIndex + 1}`;
      params.push(start_date, end_date);
      paramIndex += 2;
    } else if (tanggal) {
      query += ` AND tanggal = $${paramIndex}`;
      params.push(tanggal);
      paramIndex++;
    } else {
      query += ` AND tanggal = CURRENT_DATE`; // Default hari ini
    }

    // Filter Kabupaten
    if (kabupaten) {
      query += ` AND kabupaten ILIKE $${paramIndex}`;
      params.push(`%${kabupaten}%`);
      paramIndex++;
    }

    // Filter Kecamatan
    if (kecamatan) {
      query += ` AND kecamatan ILIKE $${paramIndex}`;
      params.push(`%${kecamatan}%`);
      paramIndex++;
    }

    // Filter Tingkat Kepercayaan Minimal
    if (min_kepercayaan) {
      query += ` AND kepercayaan >= $${paramIndex}`;
      params.push(min_kepercayaan);
      paramIndex++;
    }

    query += ' ORDER BY waktu DESC';

    const result = await pool.query(query, params);
    
    res.json({
      sukses: true,
      total_data: result.rowCount,
      data: result.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ sukses: false, pesan: 'Terjadi kesalahan di server' });
  }
});

// ==========================================
// ENDPOINT 2: DATA KHUSUS FORMAT GEOJSON (UNTUK PETA LEAFLET/MAPBOX)
// ==========================================
app.get('/api/hotspots/geojson', async (req, res) => {
  try {
    // Kita panggil endpoint utama pakai logika yang sama (bisa panggil fungsi terpisah sebenarnya, 
    // tapi biar simpel kita bikin query standar untuk hari ini/parameter tertentu)
    const { tanggal } = req.query;
    
    let query = 'SELECT * FROM hotspot_kaltim WHERE 1=1';
    let params = [];
    
    if (tanggal) {
      query += ` AND tanggal = $1`;
      params.push(tanggal);
    } else {
      query += ` AND tanggal = CURRENT_DATE`;
    }

    const result = await pool.query(query, params);
    
    // Transformasi JSON biasa ke format GeoJSON
    const geojson = {
      type: "FeatureCollection",
      features: result.rows.map(row => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [parseFloat(row.bujur), parseFloat(row.lintang)] // Mapbox/Leaflet butuh format [Lng, Lat]
        },
        properties: {
          id: row.id,
          kepercayaan: row.kepercayaan,
          kabupaten: row.kabupaten,
          kecamatan: row.kecamatan,
          satelit: row.satelit,
          tanggal: row.tanggal,
          waktu: row.waktu
        }
      }))
    };

    res.json(geojson);

  } catch (err) {
    console.error(err);
    res.status(500).json({ sukses: false, pesan: 'Terjadi kesalahan di server' });
  }
});

// ==========================================
// ENDPOINT 3: RINGKASAN STATISTIK (CHART)
// ==========================================
app.get('/api/hotspots/summary', async (req, res) => {
  try {
    const { tanggal } = req.query;
    
    let query = `
      SELECT kabupaten, COUNT(*) as total_hotspot 
      FROM hotspot_kaltim 
      WHERE 1=1
    `;
    let params = [];

    if (tanggal) {
      query += ` AND tanggal = $1`;
      params.push(tanggal);
    } else {
      query += ` AND tanggal = CURRENT_DATE`;
    }

    query += ` GROUP BY kabupaten ORDER BY total_hotspot DESC`;

    const result = await pool.query(query, params);
    
    res.json({
      sukses: true,
      data: result.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ sukses: false, pesan: 'Terjadi kesalahan di server' });
  }
});

// Jalankan Server
app.listen(port, () => {
  console.log(`🚀 API Server Hotspot Kaltim jalan di http://localhost:${port}`);
});

// ==========================================
// ENDPOINT 4: AMBIL DAFTAR KABUPATEN UNTUK DROPDOWN
// ==========================================
app.get('/api/locations/kabupaten', async (req, res) => {
  try {
    // Ambil daftar kabupaten yang unik (DISTINCT), kecualikan yang kosong
    const query = `
      SELECT DISTINCT kabupaten 
      FROM hotspot_kaltim 
      WHERE kabupaten IS NOT NULL AND kabupaten != ''
      ORDER BY kabupaten ASC
    `;
    const result = await pool.query(query);
    
    // Ubah format agar gampang dibaca frontend: ["BERAU", "KOTA BALIKPAPAN", ...]
    const listKabupaten = result.rows.map(row => row.kabupaten);
    
    res.json({ sukses: true, data: listKabupaten });
  } catch (err) {
    console.error(err);
    res.status(500).json({ sukses: false, pesan: 'Terjadi kesalahan server' });
  }
});

// ==========================================
// ENDPOINT 5: AMBIL DAFTAR KECAMATAN BERDASARKAN KABUPATEN
// ==========================================
app.get('/api/locations/kecamatan', async (req, res) => {
  try {
    const { kabupaten } = req.query;
    
    if (!kabupaten) {
      return res.status(400).json({ sukses: false, pesan: 'Parameter kabupaten wajib diisi' });
    }

    // Ambil kecamatan berdasarkan kabupaten yang dipilih
    const query = `
      SELECT DISTINCT kecamatan 
      FROM hotspot_kaltim 
      WHERE kabupaten ILIKE $1 
        AND kecamatan IS NOT NULL 
        AND kecamatan != ''
      ORDER BY kecamatan ASC
    `;
    const result = await pool.query(query, [`%${kabupaten}%`]);
    
    const listKecamatan = result.rows.map(row => row.kecamatan);
    
    res.json({ sukses: true, data: listKecamatan });
  } catch (err) {
    console.error(err);
    res.status(500).json({ sukses: false, pesan: 'Terjadi kesalahan server' });
  }
});