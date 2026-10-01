# Deployment

## Development lokal

`npm run dev` menjalankan API, dashboard, Mini POS terpisah, dan worker expiry/webhook. Jalankan `npm run bri:worker` secara terpisah agar browser login tetap dapat diakses operator. `.env` membutuhkan `MINI_POS_URL=http://127.0.0.1:3011` dan `RIZPAY_API_URL=http://127.0.0.1:3001`.

SQLite payment dan database order POS terpisah. Worker SQLite mengirim durable event langsung tanpa Redis; MySQL memakai BullMQ/Redis. Jangan memakai SQLite sebagai deployment multi-instance.

## MySQL / Redis

Development: `docker compose up --build`.

Production: `docker compose -f docker-compose.yml -f docker-compose.production.yml up --build -d`.

Production memakai migration Prisma dan mematikan simulator. Pasang reverse proxy HTTPS di depan dashboard port 8080; cookie admin production memerlukan HTTPS. Port database, Redis, API, dan POS tidak dipublikasikan oleh Compose. Isi kredensial `.env` sendiri dan simpan file ini di luar version control. Admin seed tidak mengganti password akun yang sudah ada.

Migration awal terdapat di `packages/database/prisma/migrations/20261001000000_initial`. Untuk database kosong gunakan `npm run db:migrate`. Untuk database MySQL lama yang sebelumnya dibuat memakai `db push`, backup terlebih dahulu, pastikan struktur cocok dengan migration awal, kemudian baseline dengan `npx prisma migrate resolve --applied 20261001000000_initial --schema packages/database/prisma/schema.prisma`; jangan menjalankan migration CREATE TABLE ke database yang sudah berisi tabel tersebut.

Collector BRI dapat dijalankan di Linux dengan Chromium dan display virtual Xvfb melalui override berikut:

```bash
docker compose -f docker-compose.yml -f docker-compose.production.yml -f docker-compose.bri.yml up --build -d
```

Isi `BRI_AUTO_LOGIN_ENABLED=true`, `BRI_USERNAME` (nomor handphone), dan `BRI_PASSWORD` dalam `.env` sebelum menjalankan stack. Browser berjalan tanpa jendela desktop pada display virtual dan memakai volume `bri-profile` untuk menyimpan sesi. Control port 3010 hanya tersedia di jaringan internal Compose. Worker memakai user `node`, shared memory 1 GB, restart policy `unless-stopped`, serta `tini` untuk meneruskan sinyal shutdown dan membersihkan proses anak.

`BRI_BROWSER_DISABLE_SANDBOX=true` khusus lingkungan container ini mengizinkan Chromium berjalan ketika sandbox Chrome tidak didukung oleh runtime container. Batas isolasi berasal dari container; jangan mengaktifkan opsi ini pada browser host tanpa kebutuhan. Mode display virtual memakai browser visible, bukan headless, karena portal pernah membatasi headless.

Konfigurasi container telah disiapkan, tetapi build/run Linux belum diuji di komputer ini karena Docker tidak tersedia. Xvfb tidak menyediakan akses interaktif operator: jika BRI meminta OTP/CAPTCHA, diperlukan akses desktop privat ke lingkungan browser atau pemulihan melalui worker host. Tidak ada bypass verifikasi portal.

Jika memakai worker host, konfigurasi `BRI_WORKER_URL` dengan alamat worker yang dapat dijangkau. Jangan menambahkan override `docker-compose.bri.yml` untuk setup tersebut.

## Monitoring

Dashboard menampilkan API, database, Redis, payment worker, browser, sesi BRI, collector, dan antrean webhook. Endpoint detail `GET /api/admin/health` memerlukan cookie admin; Viewer juga dapat membacanya. Redis diperiksa melalui PING pada MySQL; SQLite melaporkan Redis NOT_REQUIRED. Heartbeat worker dan sinkronisasi collector lebih dari dua menit ditandai offline/degraded. Sesi CONNECTED tidak menghilangkan error collector.

Respons mencantumkan jumlah webhook PENDING/PROCESSING/FAILED, waktu event tertua yang menunggu, serta waktu transaksi provider terakhir. Hasil dicache lima detik untuk membatasi beban pemeriksaan. Dashboard memperbarui otomatis setiap 20 detik. Endpoint `/health` tetap pemeriksaan dasar API/database sehingga stack dapat startup sebelum collector terhubung.

## Webhook Mini POS

Backend POS memakai API key hanya di server. Bootstrap internal membuat key dan secret POS; consumer eksternal menggunakan key yang dibuat admin. Endpoint webhook POS `/api/webhooks/rizpay` memverifikasi raw body, HMAC, timestamp ±5 menit, identitas event, nominal, dan order; event disimpan di database POS.

Endpoint `internal://mini-pos` hanya dapat dibuat oleh bootstrap Mini POS. Worker mengarahkannya ke alamat layanan dari konfigurasi operator. URL webhook aplikasi lain tetap wajib HTTPS publik dengan pemeriksaan DNS/IP. Konfigurasi ini tidak membuka URL HTTP privat untuk consumer umum.

## Acceptance yang masih memerlukan lingkungan nyata

- Jalankan stack MySQL/Redis, uji beberapa API secara bersamaan dan restart worker saat pengiriman.
- Checkout nominal kecil pada merchant asli, bayar melalui aplikasi pembayaran, periksa BRI → PAID → webhook DELIVERED → POS sukses.
- Uji endpoint HTTPS aplikasi consumer nyata dan retry saat endpoint gagal.
- Uji backup/restore database dan profil BRI pada lingkungan deployment.

Pengujian otomatis yang tersedia tidak menggantikan acceptance pembayaran bank atau runtime MySQL/Redis.

## Uji MySQL/Redis terisolasi

`docker compose -p rizpay-tests -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from tests`

Stack test memakai database `rizpay_test`, tanpa port publik atau volume production. Test menjalankan dua proses API, memeriksa alokasi nominal unik, idempotency lintas proses dan ingestion ganda. Script menolak database yang namanya tidak berakhiran `_test`. Kredensial di file test hanya untuk container test sekali pakai.

Target ini sudah disiapkan dan typechecked, tetapi belum dijalankan karena Docker tidak tersedia pada komputer ini.
