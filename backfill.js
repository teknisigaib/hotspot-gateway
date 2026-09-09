const ftp = require("basic-ftp");
const fs = require("fs");
const csv = require("csv-parser");
const { Pool } = require("pg");
const { eachDayOfInterval, format } = require("date-fns");

// --- 1. KONFIGURASI DATABASE ---
const pool = new Pool({
  host: "151.242.116.162", // Karena script jalan di CT yang sama dengan DB
  port: 5432,
  user: "admin",
  password: "Administrator96607",
  database: "db_hotspot",
});

// --- 2. KONFIGURASI FTP ---
const ftpConfig = {
  host: "202.90.199.64", // GANTI DENGAN IP FTP ASLI
  user: "96633", // GANTI DENGAN USER FTP ASLI
  password: "H3!Kv9Q6T$", // GANTI DENGAN PASS FTP ASLI
};

// Fungsi utama
async function runBackfill() {
  const client = new ftp.Client();
  client.ftp.verbose = false; // Set true kalau mau liat log FTP-nya

  try {
    console.log("Menghubungkan ke Database...");
    await pool.connect();
    console.log("Database Terhubung!");

    console.log("Menghubungkan ke FTP...");
    await client.access(ftpConfig);
    console.log("FTP Terhubung!");

    // Generate list tanggal dari 1 Jan 2026 s/d hari ini
    const dates = eachDayOfInterval({
      start: new Date(2026, 0, 1), // Bulan dimulai dari 0 (0 = Jan)
      end: new Date(), 
    });

    console.log(`Mulai memproses ${dates.length} hari...`);

    // Looping per tanggal
    for (const dateObj of dates) {
      const year = format(dateObj, "yyyy");
      const month = format(dateObj, "MM");
      const day = format(dateObj, "dd");
      const dateStr = `${year}${month}${day}`;
      const dbDate = `${year}-${month}-${day}`;

      const ftpPath = `/himawari6/Hotspot/data/${year}/${month}/${day}/Hotspot_${dateStr}.txt`;
      const tempFile = `temp_${dateStr}.txt`;

      try {
        // Coba download file dari FTP
        await client.downloadTo(tempFile, ftpPath);
        
        // Kalau berhasil download, kita proses filenya
        await processFile(tempFile, dbDate);
        
        // Hapus file temp setelah selesai diproses biar storage nggak penuh
        fs.unlinkSync(tempFile);
      } catch (err) {
        // Error biasanya karena file di tanggal tersebut memang nggak ada di server FTP
        console.log(`[SKIP] Data tanggal ${dbDate} tidak ditemukan di FTP.`);
      }
    }

    console.log("=== BACKFILL SELESAI ===");
  } catch (err) {
    console.error("Gagal menjalankan script:", err);
  } finally {
    client.close();
    await pool.end();
  }
}

// Fungsi untuk baca TXT dan insert ke Database
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
            waktu: data["WAKTU(WIB)"] || data["WAKTU"], // Antisipasi beda header
          });
        }
      })
      .on("end", async () => {
        console.log(`[PROSES] ${dbDate}: Ditemukan ${results.length} hotspot di Kaltim.`);
        
        // Insert ke database satu per satu
        for (const item of results) {
          const query = `
            INSERT INTO hotspot_kaltim (bujur, lintang, kepercayaan, kabupaten, kecamatan, satelit, tanggal, waktu)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (bujur, lintang, tanggal, waktu, satelit) DO NOTHING;
          `;
          const values = [
            item.bujur, item.lintang, item.kepercayaan, item.kabupaten, 
            item.kecamatan, item.satelit, dbDate, item.waktu
          ];

          try {
            await pool.query(query, values);
          } catch (dbErr) {
            console.error("Error insert DB:", dbErr.message);
          }
        }
        resolve();
      })
      .on("error", (error) => reject(error));
  });
}

// Jalankan script
runBackfill();