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
  // Server jalan di UTC, kita shift +7 Jam secara manual biar script pakai tanggal WIB
  const now = new Date();
  const todayWIB = new Date(now.getTime() + (7 * 60 * 60 * 1000));

  const year = format(todayWIB, "yyyy");
  const month = format(todayWIB, "MM");
  const day = format(todayWIB, "dd");
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

    // ==========================================
    // SISTEM AUTO-RETRY (MAKSIMAL 3 KALI COBA)
    // ==========================================
    let maxRetries = 3;
    let success = false;

    for (let i = 1; i <= maxRetries; i++) {
      try {
        console.log(`-> Percobaan ${i} download file dari FTP...`);
        await client.downloadTo(tempFile, ftpPath);
        
        await processFile(tempFile, dbDate);
        fs.unlinkSync(tempFile);
        
        // Kalau lu pake fitur flag, biarin aja baris di bawah ini
        // fs.writeFileSync(flagFile, dbDate); 
        
        console.log(`[SUKSES] Data hotspot ${dbDate} berhasil diupdate!`);
        success = true;
        break; // Keluar dari loop karena udah sukses
        
      } catch (err) {
        console.log(`   [ERROR DETAIL] ${err.message}`);
        if (i < maxRetries) {
          console.log(`   Menunggu 3 detik sebelum mencoba lagi...`);
          await new Promise(res => setTimeout(res, 3000)); // Jeda 3 detik
        }
      }
    }

    if (!success) {
      console.log(`[TUNDA] setelah ${maxRetries}x percobaan. Folder/File belum ada atau FTP sedang down.`);
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