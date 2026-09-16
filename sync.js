require('dotenv').config(); // Load environment variables (termasuk .env.keys jika pakai dotenvx)
const ftp = require('basic-ftp');
const fs = require('fs');
const csv = require('csv-parser');
const { Pool } = require('pg');

// ==========================================
// 1. SETUP DATABASE POOL (DIET KONEKSI)
// ==========================================
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  max: 2, // Hemat slot koneksi, karena ini cuma script numpang lewat
  idleTimeoutMillis: 30000
});

// ==========================================
// 2. FUNGSI PARSING & INSERT KE DATABASE
// ==========================================
async function processFile(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    
    // Baca file teks yang dipisah dengan Tab (\t)
    fs.createReadStream(filePath)
      .pipe(csv({ separator: '\t' }))
      .on('data', (data) => {
        // Amankan dari spasi berlebih
        const provinsi = data.PROVINSI ? data.PROVINSI.trim().toUpperCase() : '';
        
        // Filter khusus Kalimantan Timur
        if (provinsi === 'KALIMANTAN TIMUR') {
          results.push(data);
        }
      })
      .on('end', async () => {
        console.log(`[PARSING] Ditemukan ${results.length} titik hotspot di Kaltim. Menyimpan ke DB...`);
        
        // Looping untuk insert ke DB
        for (const row of results) {
          try {
            // PENTING: Pakai ON CONFLICT DO NOTHING agar data duplikat tidak menyebabkan error
            await pool.query(
              `INSERT INTO hotspot_kaltim 
              (bujur, lintang, kepercayaan, kabupaten, kecamatan, satelit, tanggal, waktu) 
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
              ON CONFLICT (bujur, lintang, tanggal, waktu, satelit) DO NOTHING`,
              [
                row.BUJUR, 
                row.LINTANG, 
                row.KEPERCAYAAN, 
                row.KABUPATEN, 
                row.KECAMATAN, 
                row.SATELIT, 
                row['TANGGAL(WIB)'], 
                row['WAKTU(WIB)']
              ]
            );
          } catch (err) {
            console.error(`[DB ERROR] Gagal insert titik koordinat:`, err.message);
          }
        }
        console.log(`[DB SUKSES] Data Kaltim berhasil masuk ke database.`);
        resolve();
      })
      .on('error', (err) => reject(err));
  });
}

// ==========================================
// 3. FUNGSI UTAMA SINKRONISASI
// ==========================================
async function runSync() {
  // --- SHIFT WAKTU KE WIB (UTC +7 JAM) ---
  const now = new Date();
  const todayWIB = new Date(now.getTime() + (7 * 60 * 60 * 1000));
  
  // Ambil format YYYY, MM, DD dengan angka 0 di depan jika < 10 (contoh: 09)
  const year = todayWIB.getFullYear().toString();
  const month = String(todayWIB.getMonth() + 1).padStart(2, '0');
  const day = String(todayWIB.getDate()).padStart(2, '0');
  const dateStr = `${year}${month}${day}`;

  const ftpPath = `/himawari6/Hotspot/data/${year}/${month}/${day}/Hotspot_${dateStr}.txt`;
  const tempFile = `temp_sync_${dateStr}.txt`;

  console.log(`\n==============================================`);
  console.log(`[WAKTU EKSEKUSI] ${now.toISOString()} (Server)`);
  console.log(`[TARGET DATA] WIB: ${year}-${month}-${day} | Path: ${ftpPath}`);
  console.log(`==============================================`);

  const client = new ftp.Client();
  
  try {
    // Connect ke FTP Server
    await client.access({
      host: process.env.FTP_HOST,
      user: process.env.FTP_USER,
      password: process.env.FTP_PASS,
      secure: false 
    });

    // --- SISTEM AUTO-RETRY (MAKSIMAL 3X COBA) ---
    let maxRetries = 3;
    let success = false;

    for (let i = 1; i <= maxRetries; i++) {
      try {
        console.log(`-> [FTP] Percobaan ${i} download file dari server...`);
        await client.downloadTo(tempFile, ftpPath);
        
        console.log(`[FTP SUKSES] File ditemukan dan didownload! Memulai proses filter...`);
        await processFile(tempFile);
        
        // Cleanup: Hapus file TXT setelah data masuk DB
        fs.unlinkSync(tempFile);
        
        console.log(`[SELESAI] Seluruh rangkaian tugas sinkronisasi berhasil!`);
        success = true;
        break; // Keluar dari loop karena sukses
        
      } catch (err) {
        console.log(`   [FTP GAGAL] ${err.message}`);
        if (i < maxRetries) {
          console.log(`   Menunggu 3 detik sebelum mencoba lagi...`);
          await new Promise(res => setTimeout(res, 3000));
        }
      }
    }

    if (!success) {
      console.log(`[TUNDA] Menyerah setelah ${maxRetries}x percobaan. File kemungkinan belum diupload oleh pusat.`);
    }

  } catch (err) {
    console.error(`[FATAL] Gagal login ke server FTP:`, err.message);
  } finally {
    // PENTING: Selalu tutup koneksi agar program bisa berhenti (Exit)
    client.close();
    await pool.end(); 
    console.log(`[EXIT] Koneksi FTP & DB ditutup dengan aman.\n`);
  }
}

// Jalankan Fungsi
runSync();