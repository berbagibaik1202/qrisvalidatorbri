# BRI network collector

Collector aktif membaca JSON API BRI dalam sesi browser yang telah login. DOM digunakan untuk form login dan pemeriksaan manual Browser Session, bukan pengambilan transaksi. Worker tidak memakai fallback kartu/struk atau `BRI_COLLECTOR_MAPPING`.

Endpoint yang diinspeksi dari network portal:

- `/api/wong/v1/inquiryUser`: MPAN dan identitas merchant.
- `/api/reporting/v3/inquiryListTransaction`: daftar, pagination, nominal, referensi, waktu, MPAN dan Store ID.
- `/api/reporting/v1/inquiryListSummaryTransactionTID`: total transaksi dan nominal untuk memverifikasi kelengkapan seluruh halaman.
- `/api/reporting/v1/inquiryDetailTransaction`: bukti pembayaran dan identitas transaksi.

Status daftar seperti Pencairan Diproses/Pencairan Berhasil adalah settlement. Payment hanya dapat dikonfirmasi jika detail memenuhi `rc=00`, `status_trx=sukses`, `status_desc_trx=Sales Success`, dan `type_trx=Payment QR`. Referensi, nominal, timestamp, MPAN, Store ID dan nama merchant juga harus cocok. MPAN 18/19 digit hanya dicocokkan dengan tambahan Luhn yang sudah diverifikasi pada merchant ini.

Browser membuka halaman transaksi saat bootstrap untuk memperoleh metadata request resmi. Polling berikutnya memakai fetch same-origin dengan cookie browser dan bearer/device header dalam memori. Browser tetap diperlukan sebagai pemilik sesi. Worker tidak me-reload halaman atau membuka struk per polling. HTTP 401/403 menjadi LOGIN_REQUIRED dan dapat dipulihkan dengan login otomatis. Schema berubah atau response bisnis gagal menghentikan batch.

Daftar dibaca 100 item per halaman, maksimal 5.000 transaksi. Total referensi unik dan jumlah nominal harus cocok dengan summary. Halaman berulang, identitas berbeda, atau data terpotong menghentikan collection tanpa memajukan cursor. Bukti SUCCESS dicache satu jam dengan fingerprint source/transaksi; fingerprint berubah memerlukan verifikasi ulang. UNCONFIRMED tidak dicache sebagai sukses.

Range request memakai tanggal WIB dari cursor minus lima menit, dengan awal 24 jam bila belum pernah sinkronisasi. Rentang maksimum masih tujuh tanggal kalender sampai range lebih panjang diverifikasi. Timestamp di luar window permintaan tidak diimpor. Deduplication dan cursor tetap diproses setelah seluruh batch tersimpan.

CPAN, rekening merchant, token response user, dan data pelanggan tidak disimpan ke database/log. API response tidak dicetak. `BRI_PAYMENT_SOURCE_ID` dan `BRI_EXPECTED_MPAN` tetap dapat mengikat source tertentu; tanpa source ID, hanya satu source ACTIVE dengan nama merchant dan MPAN yang cocok yang diterima.

Pengujian: `npm run test:bri:network`. Fixture menguji pagination, verifikasi detail, cache/no-reload, settlement/non-success, mismatch identitas/nominal/waktu, total tidak konsisten, halaman berulang, dan HTTP 401. Fixture tidak mengirim request ke BRI.

Verifikasi nyata: enam transaksi dibaca melalui endpoint detail; enam detail memenuhi bukti sukses. Pembacaan ulang menggunakan cache tanpa request detail tambahan. Dua sync worker berikutnya berstatus CONNECTED/READY, menghasilkan empat reporting request tanpa navigation request atau struk. Ini membuktikan sinkronisasi, bukan pembayaran bank baru pada saat pengujian tersebut.
