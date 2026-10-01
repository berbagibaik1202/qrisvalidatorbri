# Status PRD — 1 Oktober 2026

Dokumen ini membedakan implementasi, bukti pengujian, dan acceptance yang belum dijalankan. Tidak mengganti persyaratan `prd.md`.

| Fase | Implementasi | Acceptance |
|---|---|---|
| 1 QRIS Core + POS Mock | Login, upload/decode/TLV/CRC, source, nominal unik, Payment API, POS dan simulator | Lulus integration dan browser pada database sementara |
| 2 BRI Collector | Persistent browser, kartu/struk, verifikasi merchant/success, dedup, matcher, polling/cursor | Empat transaksi nyata pernah tersimpan; pembayaran POS baru melalui BRI masih perlu diuji |
| 3 Production Core | API key, idempotency, expiry/cooldown snapshot, webhook/signature/retry, reconciliation, audit, migration MySQL | Receiver HTTP terpisah dan retry diuji lokal; runtime MySQL/Redis dan HTTPS eksternal belum diverifikasi |
| 4 Admin Dashboard | Payment dan transaksi pagination/detail, webhook history, QR replacement/history/retest, aplikasi aktif/nonaktif, test/live key, per-app defaults, settings, pengguna dan role, monitoring layanan | Alur utama diuji browser; CRUD akun lanjutan dan hardening deployment masih terbuka |
| 5 ISP Billing | Ditunda sesuai instruksi pengguna; fokus Mini POS consumer API | Di luar scope pengerjaan saat ini |

## Tambahan pada pengerjaan lanjutan

- Mini POS service terpisah memakai HTTP Payment API dan database order/receipt sendiri.
- Webhook POS memverifikasi raw signature, replay window, event ID, nominal/order dan menyimpan penerimaan secara atomik.
- Worker lokal mengirim durable event tanpa Redis; deployment MySQL tetap BullMQ/Redis.
- Global settings berlaku untuk invoice baru. Cooldown tersimpan dalam audit pembuatan invoice agar perubahan setting tidak mengubah pencocokan invoice lama.
- Penggantian QRIS mengarsipkan versi sebelumnya, mempertahankan snapshot invoice lama, dan memerlukan uji ulang. Merchant berbeda harus menjadi source baru.
- Aplikasi dapat memilih source/expiry default, API key test/live dan status aplikasi.
- Viewer dibatasi ke dashboard/payment/transaction/log dan dapat logout. Super Admin dapat membuat pengguna.
- Migration MySQL dan override Compose production tersedia. Simulator mati pada production.

## Masih terbuka

1. Acceptance pembayaran bank baru: POS → bayar → BRI → PAID → webhook → POS sukses.
2. Runtime MySQL/Redis, concurrency beberapa instance, restart worker, HTTPS consumer dan backup/restore. Docker/MySQL/Redis tidak tersedia di komputer pengerjaan saat ini.
3. Integrasi ISP Billing ditunda sesuai instruksi pengguna.
4. Collector native memakai filter tujuh hari. Cursor lebih tua ditolak, bukan diloloskan dengan data terpotong; date range lebih panjang belum diimplementasikan.
5. Deployment HTTPS, rotasi credential serta pengelolaan akun/CRUD lanjutan. Monitoring layanan sudah tersedia; deployment Linux tetap memerlukan verifikasi runtime.

Definition of Done MVP belum dinyatakan selesai sebelum acceptance nyata dan verifikasi deployment lulus.

## Hasil verifikasi terakhir

- Typecheck dan build dashboard lulus.
- 16 unit test dan 58 integration checks lulus pada database sementara.
- Browser test lulus dengan backend POS terpisah, monitoring, settings, detail payment/transaksi dan riwayat versi.
- Sembilan BRI browser fixture checks dan tujuh native portal fixture checks lulus. Login otomatis diuji dengan fixture dan memakai selector form yang diinspeksi dari portal nyata.
- Audit dependency production: nol kerentanan terlapor.
- Layanan API/database/webhook worker sehat. Sesi BRI dipulihkan memakai profil login sebelumnya: CONNECTED, collector READY; sync terakhir terverifikasi 1 Oktober 2026 pukul 16:51 WIB.
- Target uji MySQL/Redis multi-process tersedia melalui docker-compose.test.yml, tetapi belum dijalankan.

## Alur pembayaran LIVE Mini POS

Mini POS normal memakai API key live, termasuk saat development. Simulator dan ingestion provider MOCK hanya diaktifkan pada NODE_ENV=test dengan flag pengujian. Readiness memvalidasi collector CONNECTED/READY, source merchant aktif yang terikat pada collector, dan sync terbaru maksimal dua menit.

Checkout/status/QR/cancel memakai HTTP consumer API. Merchant pada response berasal dari snapshot QR invoice. POS mendukung pemulihan QR setelah refresh serta membuka kembali order terbaru. Invoice tetap PENDING sampai transaksi sukses provider terverifikasi; worker mengirim webhook bertanda tangan ke database receipt POS.

Kontrak LIVE diuji memakai fixture terisolasi: merchant QR cocok, idempotency, simulator ditolak, konfirmasi BRI menjadi PAID, webhook diterima dan collector stale menolak checkout. Ini bukan bukti pembayaran bank nyata. Invoice LIVE merchant asli berhasil dibuat melalui POS pada 1 Oktober 2026, Rp3.001, status PENDING saat dibuat; hasil pembayaran user belum diverifikasi.

Panduan consumer: [alur API](consumer-integration.md).

Verifikasi sebelumnya alur LIVE: 52 integration checks dan browser refresh/resume lulus. Checkout nyata merchant Rp3.001 dibuat melalui API dengan simulator mati, kemudian EXPIRED tanpa transaksi bank terkonfirmasi. Uji transfer bank baru masih menunggu pembayaran user melalui checkout yang aktif.

## Lanjutan: monitoring, transaksi, dan Linux

- Dashboard memeriksa API/database/Redis/payment worker/browser/session/collector/webhook queue. Heartbeat lama, sync stale, dan collector ERROR dilaporkan tersendiri dari sesi CONNECTED. Viewer dapat membaca monitoring; data detail membutuhkan autentikasi admin.
- Halaman Transactions memakai endpoint pencarian/filter/pagination, bukan subset 100 transaksi dari overview. Detail memuat bukti provider, source/merchant, match, payment/application, dan audit terkait. Trace/batch/method masih belum disimpan.
- Mode lingkungan dan keterangan LIVE/MOCK berasal dari server. Last sync tidak lagi berupa placeholder.
- Login otomatis mendukung nomor handphone/password dari environment, pemulihan profil dan sesi expired, serta satu percobaan gagal sampai pemulihan manual. Kredensial tidak dikirim ke form dengan action domain asing. Pemulihan startup tidak mengubah sync historis menjadi bukti collector READY.
- Collector tidak bergantung pada animation frame browser; minimisasi tidak menghambat penantian rendering. Sinkronisasi nyata kembali CONNECTED/READY setelah perbaikan tersebut.
- Docker Chromium + Xvfb tersedia melalui `docker-compose.bri.yml`, dengan profil persisten, shared memory, user non-root, internal control port, restart policy dan graceful shutdown. Runtime Linux/MySQL/Redis belum diuji karena Docker tidak tersedia.

Billing tetap ditunda. DoD MVP masih menunggu acceptance pembayaran bank baru dan deployment production.

## Migrasi collector ke network

Worker aktif membaca JSON daftar/summary/detail BRI. Identitas merchant berasal dari inquiryUser dan metadata request resmi, bukan DOM kartu. Sukses memerlukan rc 00, status_trx sukses, status_desc_trx Sales Success dan type_trx Payment QR. Pagination memverifikasi total unik dan nominal summary, sementara detail SUCCESS dicache satu jam. Dua sync nyata CONNECTED/READY tanpa reload atau struk; enam transaksi berhasil diverifikasi lewat network. Enam checks fixture network dan build lulus. Adapter DOM lama tidak menjadi fallback worker.

Lihat [network collector](bri-network.md). Batas tujuh tanggal kalender dan acceptance pembayaran bank baru tetap terbuka.
