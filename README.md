# Rizpay

Implementasi awal PRD v2.1: admin workspace, QRIS core, payment engine, Mini POS, webhook/reconciliation, serta browser collector BRI. Sinkronisasi empat transaksi BRI nyata sudah diverifikasi melalui sesi login merchant.

## Jalankan lokal

Persyaratan: Node.js 22.12+ dan npm. Mode lokal memakai SQLite agar tidak memerlukan instalasi MySQL/Redis untuk alur QRIS dan POS.

```powershell
npm install
npm run setup
npm run dev
```

Buka **http://localhost:5173**. Login menggunakan `ADMIN_EMAIL` dan `ADMIN_PASSWORD` di `.env`. Setup membuat `.env` jika belum ada, mengisi secret acak, membuat database, dan seed admin serta aplikasi Mini POS. `.env` yang sudah ada tetap dipertahankan. Mengubah password di `.env` tidak mengganti akun yang telah dibuat; seed tidak menimpa password akun lama.

Alur pertama:

1. Payment Sources → Tambah source → unggah **QRIS statis merchant asli**.
2. Baca & verifikasi → periksa merchant dan CRC → simpan.
3. Generate Test QR Rp1.000 → periksa QR → tandai diuji → aktifkan.
4. Mini POS → tambah Kopi dua kali dan Roti sekali → total Rp16.000.
5. Jalankan `npm run bri:worker`, lalu hubungkan merchant melalui Browser Session atau konfigurasi login otomatis di [panduan BRI](docs/bri-merchant.md).
6. Bayar QRIS dari Mini POS menggunakan aplikasi pembayaran. Nominal final termasuk kode unik; payment tetap PENDING sampai transaksi sukses BRI terverifikasi.
7. Collector mencocokkan pembayaran menjadi PAID dan worker mengirim webhook ke Mini POS. Periksa monitoring bila konfirmasi tertunda.

Mini POS normal memakai pembayaran LIVE. Simulasi MOCK hanya tersedia pada lingkungan test terisolasi.

Jangan melakukan pembayaran nyata ke QR fixture pengujian. Pengujian menggunakan identitas merchant sintetis.

## Verifikasi

```powershell
npm run build
npm test
npm run test:e2e
npx playwright install chromium
npm run test:browser
npm audit
```

Integration dan browser test memakai database sementara terpisah; tidak mengubah database kerja. Browser test menjalankan server pada port 3003 dan 5174, mengunggah QR PNG, mengaktifkan source, melakukan checkout dan simulasi, lalu memeriksa tampilan mobile. Screenshot ada di `tests/artifacts/`.

## Docker / MySQL / Redis

Tambahkan `MYSQL_PASSWORD` dan `MYSQL_ROOT_PASSWORD` ke `.env` (gunakan karakter URL-safe untuk password koneksi), lalu:

```powershell
docker compose up --build
```

Dashboard tersedia di **http://localhost:8080**. Compose menyiapkan MySQL 8.4, Redis, API, worker BullMQ, dan Nginx/dashboard. Compose ini untuk development: schema menggunakan `db push`, bukan migration deployment. Docker belum diverifikasi pada lingkungan pengerjaan karena Docker tidak tersedia.

SQLite dan MySQL memakai schema yang sama; `npm run db:local` membuat salinan SQLite. Untuk MySQL tanpa Docker, atur `DATABASE_URL` ke URL MySQL dan jalankan `npm run db:generate`, `npm run db:push`, `npm run seed`. Jalankan Redis untuk distributed allocation lock dan `npm run worker` untuk pengiriman webhook. Jangan memakai client hasil generate SQLite untuk koneksi MySQL atau sebaliknya.

## Bagian proyek

| Lokasi | Fungsi |
| --- | --- |
| `apps/api` | Express API, admin session, API-key auth, POS backend |
| `apps/dashboard` | React/Vite workspace dan antarmuka Mini POS |
| `apps/worker` | Expiry, durable webhook dispatcher, retry BullMQ |
| `packages/qris` | Nested TLV, CRC, validator, QR generator dan image decoder |
| `packages/payment-core` | Reservasi nominal, idempotency, matching, reconciliation |
| `packages/database` | Prisma schema MySQL, mode SQLite, seed |
| `packages/provider-core` | Kontrak provider independen dari BRI |
| `providers/bri-merchant` | Persistent session/control dan collector dengan mapping terverifikasi |
| `docs/analysis.md` | Analisis PRD, cakupan hasil dan pekerjaan tersisa |
| `docs/api.md` | Kontrak API dan webhook |

## Status implementasi

Mini POS kini service terpisah (port 3011), memakai HTTP Payment API dan database order/receipt sendiri. npm run dev menjalankan API, dashboard, POS dan worker. Worker SQLite tidak membutuhkan Redis; deployment MySQL memakai BullMQ/Redis. Collector BRI tetap dijalankan terpisah melalui npm run bri:worker.

Dashboard menyediakan settings yang tersimpan, QRIS replacement/history/retest, payment pagination/detail, webhook delivery history, aplikasi aktif/nonaktif, API key test/live, per-app source/expiry dan pengguna/role.

MVP belum dinyatakan selesai: acceptance pembayaran bank baru, runtime MySQL/Redis dan HTTPS production masih perlu diverifikasi; integrasi billing ditunda. Lihat [status PRD](docs/status-prd.md) dan [deployment](docs/deployment.md).

## Pembayaran langsung dan kontrak consumer

Mini POS normal menggunakan mode LIVE dan API key live. Checkout memerlukan collector BRI siap dan source merchant yang sesuai. Simulator hanya aktif pada lingkungan test otomatis, bukan development kasir. Checkout, QR, status dan cancel memakai HTTP Payment API; webhook POS disimpan dalam database receipt sendiri.

Lihat [alur consumer API](docs/consumer-integration.md) untuk integrasi aplikasi lain. Integrasi billing ditunda. Pembayaran bank baru perlu diverifikasi dengan scan/bayar QR merchant asli; pengujian fixture bukan bukti transfer bank.
