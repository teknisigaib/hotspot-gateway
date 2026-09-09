=======================================================================
DOKUMENTASI API & DATABASE - SISTEM PEMANTAUAN HOTSPOT KALTIM
Update Terakhir: September 2026
=======================================================================

-----------------------------------------------------------------------
BAGIAN 1: STRUKTUR DATABASE (PostgreSQL)
-----------------------------------------------------------------------
Nama Tabel  : hotspot_kaltim
Deskripsi   : Menyimpan data titik api (hotspot) khusus wilayah Kalimantan Timur.

| Kolom       | Tipe Data      | Deskripsi                                      |
|-------------|----------------|------------------------------------------------|
| id          | SERIAL (PK)    | ID Unik / Primary Key (Auto Increment)         |
| bujur       | DECIMAL(11,8)  | Titik koordinat Longitude (X)                  |
| lintang     | DECIMAL(10,8)  | Titik koordinat Latitude (Y)                   |
| kepercayaan | INT            | Tingkat akurasi / confidence level (contoh: 8) |
| kabupaten   | VARCHAR(100)   | Nama Kabupaten / Kota                          |
| kecamatan   | VARCHAR(100)   | Nama Kecamatan                                 |
| satelit     | VARCHAR(50)    | Nama satelit pemantau (SNPP, NOAA20, dll)      |
| tanggal     | DATE           | Tanggal pantauan (Format: YYYY-MM-DD)          |
| waktu       | TIME           | Waktu pantauan WIB (Format: HH:MM:SS)          |

Catatan: Terdapat constraint UNIQUE(bujur, lintang, tanggal, waktu, satelit) 
         untuk mencegah duplikasi data saat sinkronisasi harian.


-----------------------------------------------------------------------
BAGIAN 2: DOKUMENTASI API ENDPOINT
-----------------------------------------------------------------------
Base URL: http://<IP_SERVER_ATAU_DOMAIN>:3000

Semua respon API mengembalikan format JSON (Content-Type: application/json).

1. AMBIL DATA DATA TITIK HOTSPOT
--------------------------------
Method : GET
URL    : /api/hotspots
Fungsi : Mengambil daftar titik hotspot dalam bentuk Array JSON standar.

[Query Parameters] (Semua Opsional)
- tanggal         : (String) Format YYYY-MM-DD. Default: Hari ini.
- start_date      : (String) Format YYYY-MM-DD. Harus berpasangan dengan end_date.
- end_date        : (String) Format YYYY-MM-DD. Harus berpasangan dengan start_date.
- kabupaten       : (String) Pencarian nama kabupaten (case-insensitive).
- kecamatan       : (String) Pencarian nama kecamatan (case-insensitive).
- min_kepercayaan : (Integer) Filter batas minimal tingkat kepercayaan.

[Contoh Request]
GET /api/hotspots?start_date=2026-09-01&end_date=2026-09-08&kabupaten=KUTAI&min_kepercayaan=8

[Contoh Response Sukses]
{
  "sukses": true,
  "total_data": 2,
  "data": [
    {
      "id": 1,
      "bujur": "116.48372",
      "lintang": "-0.54321",
      "kepercayaan": 8,
      "kabupaten": "KUTAI KARTANEGARA",
      "kecamatan": "SAMBOJA",
      "satelit": "SNPP",
      "tanggal": "2026-09-08T00:00:00.000Z",
      "waktu": "14:12:00"
    },
    ...
  ]
}


2. AMBIL DATA HOTSPOT (FORMAT GEOJSON UNTUK PETA)
-------------------------------------------------
Method : GET
URL    : /api/hotspots/geojson
Fungsi : Mengambil data titik hotspot dalam format spesifik GeoJSON untuk 
         dirender langsung oleh Leaflet.js atau Mapbox.

[Query Parameters] (Opsional)
- tanggal : (String) Format YYYY-MM-DD. Default: Hari ini.

[Contoh Response Sukses]
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "Point",
        "coordinates": [116.48372, -0.54321]
      },
      "properties": {
        "id": 1,
        "kepercayaan": 8,
        "kabupaten": "KUTAI KARTANEGARA",
        "kecamatan": "SAMBOJA",
        "satelit": "SNPP",
        "tanggal": "2026-09-08T00:00:00.000Z",
        "waktu": "14:12:00"
      }
    }
  ]
}


3. AMBIL RINGKASAN STATISTIK (UNTUK CHART/GRAFIK)
-------------------------------------------------
Method : GET
URL    : /api/hotspots/summary
Fungsi : Mengambil rekapitulasi jumlah hotspot dikelompokkan per kabupaten.

[Query Parameters] (Opsional)
- tanggal : (String) Format YYYY-MM-DD. Default: Hari ini.

[Contoh Response Sukses]
{
  "sukses": true,
  "data": [
    {
      "kabupaten": "KUTAI TIMUR",
      "total_hotspot": "45"
    },
    {
      "kabupaten": "BERAU",
      "total_hotspot": "12"
    }
  ]
}


4. AMBIL DAFTAR KABUPATEN (UNTUK DROPDOWN FILTER)
-------------------------------------------------
Method : GET
URL    : /api/locations/kabupaten
Fungsi : Mengambil daftar nama kabupaten/kota unik yang ada di database.

[Contoh Response Sukses]
{
  "sukses": true,
  "data": [
    "BERAU",
    "KABUPATEN KUTAI KARTANEGARA",
    "KOTA BALIKPAPAN",
    "KOTA SAMARINDA"
  ]
}


5. AMBIL DAFTAR KECAMATAN BERDASARKAN KABUPATEN
-----------------------------------------------
Method : GET
URL    : /api/locations/kecamatan
Fungsi : Mengambil daftar kecamatan unik berdasarkan filter kabupaten.

[Query Parameters] (Wajib)
- kabupaten : (String) Nama kabupaten (case-insensitive).

[Contoh Request]
GET /api/locations/kecamatan?kabupaten=BERAU

[Contoh Response Sukses]
{
  "sukses": true,
  "data": [
    "KELAY",
    "SEGAH",
    "PULAU DERAWAN"
  ]
}
=======================================================================