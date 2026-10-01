# API Rizpay v1

## Operasional admin

Endpoint berikut menggunakan cookie login admin. Viewer dapat membaca health dan transaksi.

- `GET /api/admin/health`: kesehatan API/database/Redis/worker/browser/session/collector/queue, waktu sync/transaksi dan backlog webhook. Status collector stale/gagal dibedakan dari sesi CONNECTED.
- `GET /api/admin/transactions?page=1&query=referensi&status=ALL`: pencarian reference, filter ALL/UNMATCHED/MATCHED/AMBIGUOUS/LATE_PAYMENT, 25 item per halaman. Respons `{items,total,page,pageSize}`.
- `GET /api/admin/transactions/:id`: source/merchant, nominal, timestamp, status provider, match/payment/application, serta audit terkait. Data tidak ditemukan menghasilkan `TRANSACTION_NOT_FOUND` (404).

Detail transaksi memuat bukti sukses yang sudah dinormalisasi oleh adapter. Trace/batch/payment method belum dikumpulkan pada adapter native; tidak diisi dengan data rekaan.

## Authentication

Buat application dan test key melalui menu Applications. Kirim `Authorization: Bearer rz_test_...`. Key hanya muncul sekali. Admin endpoints menggunakan session cookie, bukan consumer API key.

## Create payment

```http
POST /v1/payments
Authorization: Bearer rz_test_...
Idempotency-Key: ORDER-10001
Content-Type: application/json

{"reference_id":"ORDER-10001","amount":50000,"description":"Pembelian POS"}
```

Optional `payment_source_id` memilih source ACTIVE tertentu. Tanpa field ini digunakan source ACTIVE tertua. Nominal merupakan integer Rupiah. Key dan reference terisolasi per application.

```json
{
  "payment_id": "PAY_...",
  "reference_id": "ORDER-10001",
  "amount": 50000,
  "unique_code": 1,
  "pay_amount": 50001,
  "status": "PENDING",
  "qris": {"payload": "...", "image_url": "/v1/payments/PAY_.../qris"},
  "expires_at": "2026-10-01T07:30:00.000Z",
  "paid_at": null,
  "provider_reference": null
}
```

Timestamp menggunakan ISO UTC; dashboard menampilkan Asia/Jakarta. `image_url` membutuhkan Authorization header dan hanya aktif ketika payment masih PENDING sebelum expiry. Frontend consumer sebaiknya fetch sebagai blob atau render QR dari payload, sehingga API key tetap berada di backend consumer.

## Status dan QR

```http
GET /v1/payments/:payment_id
GET /v1/payments/:payment_id/qris
GET /v1/payments/:payment_id/qris?format=svg
```

Default QR format PNG. Status: PENDING, PAID, EXPIRED, CANCELLED, AMBIGUOUS. QR yang tidak aktif mengembalikan 410. Aplikasi lain tidak dapat membaca payment/QR milik aplikasi Anda.

## Errors

```json
{"error":{"code":"PAYMENT_SOURCE_UNAVAILABLE","message":"Aktifkan payment source terlebih dahulu."}}
```

Status utama: 400 validation, 401 authentication, 403 authorization, 404 missing resource, 409 conflict, 410 inactive QR, 503 allocation engine unavailable.

## Webhook

Konfigurasikan URL HTTPS publik dan secret minimal 32 karakter melalui Applications → Webhook. Worker MySQL menggunakan Redis; worker SQLite lokal mengirim outbox langsung. Local mock flow tetap membuat event walaupun worker belum berjalan; tidak menganggap event terkirim.

```json
{
  "event": "payment.paid",
  "event_id": "EVT_...",
  "data": {
    "payment_id": "PAY_...",
    "reference_id": "ORDER-10001",
    "amount": 50000,
    "unique_code": 1,
    "paid_amount": 50001,
    "provider": "MOCK",
    "provider_reference": "MOCK_PAY_...",
    "paid_at": "2026-10-01T07:15:00.000Z"
  }
}
```

Headers: `X-Rizpay-Event-ID`, `X-Rizpay-Timestamp`, `X-Rizpay-Signature`. Signature merupakan hex `HMAC-SHA256(secret, timestamp + "." + raw_body)`. Receiver memverifikasi exact raw body dengan constant-time comparison, membatasi timestamp (contoh ±5 menit), memastikan event ID body/header sama, dan menyimpan event ID sebelum memproses perubahan invoice. Balas 2xx setelah perubahan durable berhasil.

Retry: initial attempt, +1 menit, +5 menit, +15 menit, +1 jam dari attempt sebelumnya. Response selain 2xx, timeout, atau transport error akan diulang sampai 5 attempts. Redirect tidak diikuti. Pengiriman bisa duplikat setelah crash; receiver harus idempotent.

## Mini POS

`GET /api/pos/products`, `POST /api/pos/checkout`, `GET /api/pos/payments/:id`, `POST /api/pos/payments/:id/cancel` memerlukan admin session pada milestone ini. Harga checkout dihitung backend dari product IDs dan quantity. `POST /api/pos/payments/:id/simulate` hanya tersedia jika NODE_ENV=test dan MOCK_PROVIDER_ENABLED=true. Simulasi selalu tersimpan sebagai provider MOCK.

## Pembatalan consumer

POST /v1/payments/:id/cancel memakai API key aplikasi pemilik. Hanya PENDING dapat dibatalkan; reservasi nominal tetap dipertahankan. POST /v1/payments/:id/simulate hanya tersedia pada development/test, MOCK_PROVIDER_ENABLED=true dan API key test.

## Admin additions

- GET/POST /api/admin/settings: expiry, range kode, cooldown, batas nominal dan interval collector.
- GET /api/admin/payments?page=1&query=ORDER&status=ALL: pagination 25 item; GET /api/admin/payments/:id: detail, match, versi, audit dan webhook.
- GET/POST /api/admin/sources/:id/versions: riwayat dan penggantian QRIS. POST memakai payload/filename dari hasil verify upload. Merchant berbeda harus source baru; versi baru perlu uji ulang.
- POST /api/admin/applications/:id/settings: payment_source_id dan expiry_minutes, null mengikuti default sistem.
- POST /api/admin/applications/:id/status: ACTIVE atau DISABLED. Pembuatan API key menerima expires_at ISO UTC opsional.
- GET /api/admin/webhooks/:id: detail delivery history.
- GET/POST /api/admin/users: Super Admin saja; pembuatan user memerlukan email, password minimal 12 karakter dan role.

Mini POS terpisah tersedia ketika MINI_POS_URL dikonfigurasi; API admin meneruskan request kasir dengan autentikasi internal. Endpoint webhook POS menyimpan receipt pada database POS sendiri.

Alur LIVE dan referensi integrasi aplikasi lain: [consumer integration](consumer-integration.md). Mini POS normal menggunakan API key live, source merchant yang terikat pada collector, serta pemeriksaan sync. Simulator ditolak di development dan production.
