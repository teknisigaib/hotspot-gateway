require('dotenv').config();
const ftp = require("basic-ftp");
const fs = require("fs");
const csv = require("csv-parser");
const { Pool } = require("pg");
const { format } = require("date-fns");

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
});

const ftpConfig = {
  host: process.env.FTP_HOST,
  user: process.env.FTP_USER,
  password: process.env.FTP_PASS,
};

async function runSync() {
  const today = new Date();
  const year = format(today, "yyyy");
  const month = format(today, "MM");
  const day = format(today, "dd");
  const dateStr = `${year}${month}${day}`;
  const dbDate = `${year}-${month}-${day}`;

  const client = new ftp.Client();
  client.ftp.verbose = false;

  try {
    await pool.connect();
    await client.access(ftpConfig);

    const ftpPath = `/himawari6/Hotspot/data/${year}/${month}/${day}/Hotspot_${dateStr}.txt`;
    const tempFile = `temp_sync_${dateStr}.txt`;

    console.log(`[${new Date().toISOString()}] Mencoba sinkronisasi data: ${dbDate}...`);

    try {
      await client.downloadTo(tempFile, ftpPath);
      await processFile(tempFile, dbDate);
      fs.unlinkSync(tempFile);
      
      // ==========================================================
      // Kalau berhasil, catat tanggal hari ini di file pengingat
      // ==========================================================
      console.log(`[SUKSES] Data hotspot ${dbDate} berhasil diupdate! (Flag diset)`);

    } catch (err) {
      console.log(`[TUNDA] Folder/File tanggal ${dbDate} belum ada di FTP. Akan dicoba lagi jam berikutnya.`);
    }

  } catch (err) {
    console.error("Gagal sinkronisasi (Koneksi error):", err.message);
  } finally {
    client.close();
    await pool.end();
  }
}

function processFile(filePath, dbDate) {
  return new Promise((resolve, reject) => {
    const results = [];

    fs.createReadStream(filePath)
      .pipe(csv({ separator: "\t" }))
      .on("data", (data) => {
        const provinsi = data.PROVINSI ? data.PROVINSI.trim().toUpperCase() : "";
        if (provinsi === "KALIMANTAN TIMUR") {
          results.push({
            bujur: parseFloat(data.BUJUR),
            lintang: parseFloat(data.LINTANG),
            kepercayaan: parseInt(data.KEPERCAYAAN) || 0,
            kabupaten: data.KABUPATEN,
            kecamatan: data.KECAMATAN,
            satelit: data.SATELIT,
            waktu: data["WAKTU(WIB)"] || data["WAKTU"],
          });
        }
      })
      .on("end", async () => {
        for (const item of results) {
          const query = `
            INSERT INTO hotspot_kaltim (bujur, lintang, kepercayaan, kabupaten, kecamatan, satelit, tanggal, waktu)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (bujur, lintang, tanggal, waktu, satelit) DO NOTHING;
          `;
          const values = [item.bujur, item.lintang, item.kepercayaan, item.kabupaten, item.kecamatan, item.satelit, dbDate, item.waktu];
          try { await pool.query(query, values); } catch (e) {}
        }
        resolve();
      })
      .on("error", reject);
  });
}

runSync();