# Mini POS

Backend POS berjalan terpisah pada port 3011 (`npm run pos`, atau otomatis melalui `npm run dev`). Dashboard menjadi frontend; API admin memproksikan request kasir dengan token internal. API key pembayaran tidak dikirim ke browser.

Service menghitung harga katalog, memanggil `/v1/payments` melalui HTTP, mengambil QR dengan API key, serta memanggil status/cancel/simulator API. Order dan receipt webhook tersimpan pada database SQLite sendiri, default `data/mini-pos/orders.db`.

Webhook `/api/webhooks/rizpay` memverifikasi signature raw body, timestamp ±5 menit, event ID header/body, order dan nominal. Penerimaan tersimpan atomik dan deduplikasi berdasarkan event ID. Polling tetap tersedia jika webhook terlambat.

Konfigurasi ada di `.env.example`. Bootstrap lokal menggunakan secret internal API/POS; consumer eksternal menggunakan API key/webhook secret sendiri. `MINI_POS_API_KEY` dan `MINI_POS_WEBHOOK_SECRET` dapat diisi untuk konfigurasi consumer eksplisit. Production mematikan simulator.
