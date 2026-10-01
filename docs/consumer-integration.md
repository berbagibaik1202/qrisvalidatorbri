# Alur API consumer — Mini POS sebagai referensi

Mini POS adalah backend consumer terpisah. Database order/receipt milik POS; database payment hanya diakses Rizpay. Browser memakai session kasir ke proxy admin dan tidak menerima API key. Permintaan pembayaran berikut dilakukan backend POS melalui HTTP.

| Langkah | Permintaan consumer | Hasil |
|---|---|---|
| Checkout | POST /v1/payments + Bearer API key + Idempotency-Key | payment_id, nominal akhir, QR payload/URL, expiry, PENDING |
| QR | GET /v1/payments/:id/qris + Bearer API key | PNG atau SVG; 410 saat QR tidak aktif |
| Status | GET /v1/payments/:id + Bearer API key | PENDING, PAID, EXPIRED, CANCELLED atau AMBIGUOUS |
| Batal | POST /v1/payments/:id/cancel + Bearer API key | Hanya PENDING; reservasi nominal tetap bertahan |
| Konfirmasi | Rizpay POST payment.paid ke URL webhook consumer | Verifikasi raw body/HMAC/timestamp/event ID; simpan receipt secara atomik; balas 2xx |

## Pembayaran langsung

Mini POS normal memakai LIVE, termasuk saat server berjalan dalam mode development. Bootstrap internal mengeluarkan API key live untuk POS; aplikasi lain membuat API key sendiri melalui Applications. Simulator hanya tersedia dalam NODE_ENV=test dan MOCK_PROVIDER_ENABLED=true, untuk database pengujian terisolasi.

Checkout LIVE memeriksa collector CONNECTED/READY, source ACTIVE yang sesuai merchant collector, dan sync maksimum dua menit. QR memakai source merchant yang terikat pada collector. Setelah customer membayar persis nominal akhir, collector memverifikasi struk Sales Success, nominal, merchant, reference dan timestamp; matcher mengubah payment ke PAID. Worker mengirim payment.paid bertanda tangan ke POS. Polling dua detik tetap bekerja bila webhook terlambat.

PENDING tidak berubah karena QR ditampilkan, tombol diklik atau timer habis. Transaksi belum terkonfirmasi tidak membuat PAID. Pembayaran terlambat/ambigu mengikuti rekonsiliasi PRD.

## Implementasi referensi

- `apps/mini-pos/server.ts`: checkout HTTP, QR fetch, status/cancel, database order/receipt dan receiver webhook.
- `apps/mini-pos/webhook.ts`: verifikasi signature raw body dan replay window.
- `apps/dashboard/src/MiniPOS.tsx`: checkout, polling, countdown dan pemulihan invoice setelah refresh.
- `tests/e2e.ts`: kontrak LIVE memakai fixture provider pada database sementara; tidak melakukan pembayaran bank nyata.

Untuk aplikasi lain, ganti katalog/order dan URL/secret webhook sesuai aplikasi tersebut. Internal bootstrap/readiness khusus deployment Mini POS; kontrak pembayaran consumer tetap `/v1/payments` dengan API key aplikasinya sendiri. URL webhook consumer eksternal wajib HTTPS publik.

## Acceptance bank

Pengujian otomatis membuktikan kontrak API, QR, matching dan webhook menggunakan fixture. Pembayaran bank baru dianggap terbukti hanya setelah user membayar QR merchant nyata dan hasil collector, PAID serta delivery webhook diverifikasi. Integrasi billing ditunda sesuai instruksi pengguna.
