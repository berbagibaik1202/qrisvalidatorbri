PRODUCT REQUIREMENTS DOCUMENT (PRD)
RIZPAY — QRIS Payment Automation Platform
Versi: 2.1 MVP
Tanggal: 1 Oktober 2026
Status: Ready for Development
Produk: Rizpay
Reference/Test Application: Rizpay Mini POS
Provider MVP: BRI Merchant QRIS
Target berikutnya: Integrasi ISP Billing dan aplikasi pihak lain
1. Ringkasan Produk
Rizpay adalah platform payment orchestration yang menyediakan API pembayaran QRIS bagi aplikasi lain.
Rizpay dirancang agar aplikasi seperti:
- ISP Billing
- POS/kasir
- toko online
- aplikasi membership
- sistem invoice
- aplikasi SaaS
- aplikasi internal perusahaan
dapat membuat transaksi QRIS dan mengetahui pembayaran berhasil secara otomatis tanpa setiap aplikasi harus berintegrasi langsung dengan sistem merchant.
Pada MVP, Rizpay menggunakan QRIS statis merchant sebagai QR acuan. Admin cukup mengunggah gambar QRIS statis melalui dashboard.
Rizpay kemudian:
1. membaca QR dari gambar,
2. mengambil payload QRIS,
3. memvalidasi struktur EMV/QRIS dan CRC,
4. menyimpan konfigurasi merchant,
5. membuat QR amount-specific secara lokal,
6. mendeteksi transaksi yang masuk melalui BRI Merchant,
7. mencocokkan transaksi dengan payment,
8. mengubah payment menjadi PAID,
9. mengirim webhook kepada aplikasi pemanggil.
2. Hasil Proof of Concept
Sebelum PRD ini dibuat, konsep utama telah diuji menggunakan QRIS merchant BRI.
QRIS statis:
POI Method = 11
tidak mempunyai nominal transaksi

Kemudian secara lokal diubah menjadi:
POI Method = 12
Tag 54 = 1000
CRC dihitung ulang

QR hasil generator:
Rp1.000

berhasil:
Scan
  ↓
Merchant dikenali
  ↓
Nominal Rp1.000 dikenali
  ↓
Pembayaran berhasil
  ↓
Transaksi muncul di BRI Merchant

Transaksi hasil pengujian:
Merchant:
Nana Permana Jasa Umum

Amount:
Rp1.000

Status:
Sales Success

Ref No:
223074911478

Trace No:
850969

Hal ini menjadi dasar teknis MVP Rizpay.
3. Permasalahan yang Diselesaikan
Aplikasi biasanya membutuhkan payment gateway untuk:
Create Payment
       ↓
Tampilkan QR
       ↓
Customer Bayar
       ↓
Konfirmasi Pembayaran

Namun integrasi API resmi provider dapat membutuhkan proses onboarding dan persyaratan tertentu.
Rizpay MVP menggunakan pendekatan:
QRIS Merchant
      +
Local QR Generator
      +
Merchant Transaction Collector
      +
Payment Matcher
      +
Webhook

Aplikasi consumer tidak perlu mengetahui implementasi provider tersebut.
4. Tujuan Produk
Rizpay harus menyediakan interface sederhana:
POST /payments
GET /payments/:id
Webhook payment.paid

Consumer cukup meminta:
Bayarkan invoice X sebesar Rp50.000

Rizpay menangani:
Payment creation
Unique amount
QR generation
Payment detection
Transaction matching
Payment confirmation
Webhook

5. Prinsip Utama Arsitektur
Rizpay bukan bagian dari ISP Billing.
Rizpay merupakan service terpisah.
                  RIZPAY
            Payment Platform
                  │
       ┌──────────┼──────────┐
       │          │          │
       ▼          ▼          ▼
   Mini POS   ISP Billing   App Lain

Dengan demikian satu instalasi Rizpay dapat digunakan oleh banyak aplikasi.
6. Scope MVP
MVP meliputi:
Admin Dashboard
Application Management
API Key Management

Payment Source Management
Upload QRIS Statis
QR Image Decoder
EMV QRIS Parser
QRIS Validator
QRIS Generator

Payment API
Unique Amount Engine
Payment Expiration

BRI Merchant Session Worker
Transaction Collector
Transaction Normalizer

Payment Matcher
Reconciliation

Webhook Engine
Audit Log

Mini POS

Belum menjadi target MVP:
BRIVA
Credit Card
Payout
Disbursement
Automatic Refund
Automatic Settlement
Multi-currency

7. High-Level Architecture
┌────────────────────────────────────┐
│         CLIENT APPLICATION         │
│                                    │
│ Mini POS / ISP Billing / Other App │
└─────────────────┬──────────────────┘
                  │
                  │ REST API
                  ▼
┌────────────────────────────────────┐
│            RIZPAY API              │
│                                    │
│ Authentication                     │
│ Applications                       │
│ Payments                           │
│ Payment Sources                    │
│ Webhooks                           │
└─────────────────┬──────────────────┘
                  │
                  ▼
┌────────────────────────────────────┐
│          PAYMENT ENGINE            │
│                                    │
│ Payment Creation                   │
│ Unique Amount Allocation           │
│ Expiration                         │
│ Idempotency                        │
│ Matching                           │
└──────────────┬───────────┬─────────┘
               │           │
               ▼           ▼
        QRIS Generator   Transaction
                          Collector
               │           ▲
               ▼           │
          Customer QR      │
               │           │
               ▼           │
          QRIS Network     │
               │           │
               ▼           │
              BRI ─────────┘

8. Technology Stack
Backend
Node.js
Express
TypeScript

Frontend
React
Vite
TypeScript

Database
MySQL 8+

Queue / Cache
Redis
BullMQ

Digunakan untuk:
collector jobs
webhook queue
webhook retry
payment expiration
unique amount reservation
distributed lock

Browser Automation
Puppeteer
Chromium

Deployment
Docker
Docker Compose
Nginx

9. User Role
MVP mempunyai:
Super Admin
Mengelola seluruh sistem.
Admin
Mengelola:
Applications
Payment Sources
Payments
Transactions
Reconciliation
Webhooks
Settings

Viewer
Hanya melihat:
Dashboard
Payments
Transactions
Logs

10. Admin Dashboard
Menu utama:
Dashboard

Payments
Transactions

Applications
Payment Sources

Reconciliation
Webhooks

Browser Session
Audit Logs

Settings

Dashboard menampilkan:
Payment Hari Ini
Rp xxx.xxx

Transaksi Hari Ini
xxx

Paid
xxx

Pending
xxx

Expired
xxx

Unmatched
xxx

Webhook Failed
xxx

Serta status provider:
BRI Merchant

● CONNECTED

Last Sync:
5 detik lalu

Last Transaction:
13:10:03

11. Applications
Application adalah aplikasi yang menggunakan Rizpay.
Contoh:
Rizpay Mini POS
ISP Billing
Online Store

Database:
applications

id
app_code
name
description

webhook_url
webhook_secret

status

created_at
updated_at

Status:
ACTIVE
DISABLED

12. API Keys
Setiap application dapat mempunyai API key.
Contoh:
rz_test_xxxxxxxxxxxxx

rz_live_xxxxxxxxxxxxx

Database:
api_keys

id
application_id

name
key_prefix
key_hash

environment

last_used_at
expires_at

status

created_at

Secret tidak disimpan plaintext.
13. Payment Sources
Payment Source adalah sumber penerimaan pembayaran.
Contoh:
BRI QRIS Merchant

Satu Rizpay nantinya dapat memiliki:
BRI Merchant A
BRI Merchant B
Provider lain

Application dapat menentukan Payment Source atau menggunakan default.
14. Tambah Payment Source
Admin membuka:
Settings
   ↓
Payment Sources
   ↓
Tambah Payment Source

Form:
Nama
[ BRI QRIS Utama ]

Provider
[ BRI Merchant ▼ ]

QRIS Statis

┌───────────────────────────────┐
│                               │
│    Upload QRIS Merchant       │
│                               │
│ PNG / JPG / JPEG / WEBP       │
│                               │
└───────────────────────────────┘

[ Baca & Verifikasi QRIS ]

Admin tidak perlu menyalin payload QR secara manual.
15. QRIS Image Upload
Format yang diterima:
PNG
JPG
JPEG
WEBP

Ukuran maksimal configurable.
Default:
5 MB

Setelah upload:
Image
  ↓
QR Decoder
  ↓
Raw QR Payload
  ↓
EMV Parser
  ↓
QRIS Validator

16. QR Decoder
QR decoder mengambil payload dari image.
Contoh:
00020101021126580013ID.CO.BRI...

Payload kemudian diberikan ke QRIS Parser.
Jika gagal:
QR tidak dapat dibaca.

Pastikan gambar QRIS jelas dan tidak terpotong.

17. QRIS Parser
Jangan menggunakan string replacement sederhana.
Buat parser TLV/EMV.
Parser harus memahami:
00 Payload Format

01 Point of Initiation

26 Merchant Account Information

51 Merchant Account Information

52 MCC

53 Currency

54 Transaction Amount

58 Country

59 Merchant Name

60 Merchant City

61 Postal Code

62 Additional Data

63 CRC

Nested TLV harus didukung.
18. QRIS Validator
Validator melakukan:
QR readable
      ↓
TLV valid
      ↓
Payload Format valid
      ↓
Merchant Account valid
      ↓
Currency valid
      ↓
Merchant Name available
      ↓
CRC valid
      ↓
QRIS valid

19. Deteksi QRIS Statis
QRIS yang dijadikan acuan harus statis.
Umumnya konfigurasi acuan yang diharapkan:
POI Method = 11

dan tidak membawa transaction amount aktif.
Jika QR yang di-upload merupakan QR transaksi amount-specific:
⚠ QRIS yang diunggah tampaknya bukan QRIS statis.

Gunakan QRIS statis merchant sebagai QRIS acuan.

20. QRIS Preview
Setelah berhasil dibaca:
✓ QRIS berhasil diverifikasi

Merchant
Nana Permana Jasa Umum

Provider
BRI

MPAN
936000020070248545

MCC
7299

Currency
IDR

City
SUMEDANG

Postal Code
45355

QR Type
STATIC

CRC
VALID

Admin kemudian:
[ Simpan Payment Source ]

21. Advanced QRIS Information
Admin biasa tidak perlu melihat payload.
Tetapi developer/debug mode dapat menyediakan:
Advanced

Berisi:
Raw Payload

Parsed EMV Tree

Payload Hash

CRC

Merchant Account Fields

22. Payment Source Database
payment_sources

id
source_code

name
provider
type

merchant_name

mpan
store_id
mcc

country
city
postal_code

currency

qris_static_payload
qris_payload_hash

qris_original_filename
qris_uploaded_at

status

created_at
updated_at

23. Payment Source Status
Lifecycle:
DRAFT
  ↓
QR_UPLOADED
  ↓
VALIDATED
  ↓
TESTED
  ↓
ACTIVE

Tambahan:
DISABLED
ERROR
ARCHIVED

24. Test Generate QR
Sebelum Payment Source aktif, admin dapat melakukan test.
Nominal Test

Rp [ 1.000 ]

[ Generate Test QR ]

Rizpay menghasilkan:
┌───────────────────────────────┐
│ TEST QRIS                     │
│                               │
│           QR CODE             │
│                               │
│ Nana Permana Jasa Umum        │
│                               │
│ Rp1.000                       │
│                               │
│ CRC VALID                     │
└───────────────────────────────┘

Admin dapat scan untuk memastikan:
Merchant benar
Nominal benar
QR dapat diproses

Setelah pengujian:
[ Tandai Sudah Diuji ]

[ Aktifkan Payment Source ]

25. Ganti QRIS Acuan
Admin dapat:
Payment Source
   ↓
Ganti QRIS

Flow:
Upload Baru
   ↓
Decode
   ↓
Validate
   ↓
Preview
   ↓
Admin Confirm
   ↓
Activate

QR lama:
ARCHIVED

Payment lama tidak boleh berubah.
26. QRIS Generator
Generator menggunakan:
QRIS statis
+
payment amount

Flow:
Static QRIS
     ↓
Parse EMV
     ↓
Set POI
     ↓
Insert Amount
     ↓
Remove old CRC
     ↓
Calculate new CRC
     ↓
Encode EMV
     ↓
QR Payload
     ↓
QR Image

27. Internal QRIS Package
Struktur:
packages/qris/

decoder.ts
parser.ts
encoder.ts
validator.ts
crc.ts
generator.ts
merchant-extractor.ts
image-decoder.ts
types.ts

API internal:
decodeQRImage()

parseQRIS()

validateQRIS()

extractMerchant()

setAmount()

calculateCRC()

encodeQRIS()

generateQRIS()

28. QR Image Storage
QR transaksi tidak wajib disimpan sebagai PNG.
Database cukup menyimpan:
payload
amount
hash

QR dapat di-render:
PNG
SVG

on demand.
Ini menghemat storage.
29. Payment Creation
Endpoint:
POST /v1/payments

Header:
Authorization: Bearer rz_live_xxxxx
Idempotency-Key: ORDER-10001

Request:
{
  "reference_id": "ORDER-10001",
  "amount": 50000,
  "description": "Pembelian POS"
}

30. Unique Amount
Masalah utama payment matching:
PAY_A = Rp50.000
PAY_B = Rp50.000

Transaksi provider tidak memberikan ID payment Rizpay.
Karena itu MVP menggunakan unique amount.
Contoh:
Base Amount
Rp50.000

Unique Code
37

Pay Amount
Rp50.037

QR membawa:
Rp50.037

Customer tidak mengetik nominal.
31. Unique Code Range
Default:
1–999

Configurable.
Contoh:
PAY_A → 50.037
PAY_B → 50.081
PAY_C → 50.126

Kombinasi berikut harus unik:
payment_source
+
pay_amount

selama reservation masih aktif.
32. Unique Amount Reservation
Gunakan database transaction + distributed lock.
Flow:
Create Payment
      ↓
Lock unique pool
      ↓
Find available amount
      ↓
Reserve
      ↓
Create payment
      ↓
Commit

Redis key dapat berupa:
rizpay:
unique:
SOURCE01:
50037

TTL mengikuti payment expiry + cooldown.
33. Payment Expiration
Default:
15 menit

Configurable:
5 menit
15 menit
30 menit
60 menit

Payment states:
PENDING
PAID
EXPIRED
CANCELLED
AMBIGUOUS

34. Unique Amount Cooldown
Nominal tidak boleh langsung digunakan ulang setelah expiry.
Contoh:
Payment Expiry
15 menit

Cooldown
30 menit

Ini melindungi dari late payment.
35. Create Payment Response
{
  "payment_id": "PAY_01KXYZ",
  "reference_id": "ORDER-10001",

  "amount": 50000,
  "unique_code": 37,
  "pay_amount": 50037,

  "status": "PENDING",

  "qris": {
    "payload": "...",
    "image_url": "/v1/payments/PAY_01KXYZ/qris"
  },

  "expires_at": "2026-10-01T14:30:00+07:00"
}

36. Payment QR Endpoint
GET /v1/payments/:payment_id/qris

Support:
image/png
image/svg+xml

Optional query:
?format=svg

37. Get Payment
GET /v1/payments/PAY_01KXYZ

Pending:
{
  "payment_id": "PAY_01KXYZ",
  "reference_id": "ORDER-10001",
  "amount": 50000,
  "pay_amount": 50037,
  "status": "PENDING"
}

Setelah pembayaran:
{
  "payment_id": "PAY_01KXYZ",
  "reference_id": "ORDER-10001",

  "amount": 50000,
  "pay_amount": 50037,

  "status": "PAID",

  "provider": "BRI_MERCHANT",
  "provider_reference": "223074911478",

  "paid_at": "2026-10-01T13:10:03+07:00"
}

38. BRI Merchant Connection
URL login: https://brimerchant.bri.co.id/auth/login
URL transaksi untuk collector: https://brimerchant.bri.co.id/transaksi
Pada MVP, provider transaction collector menggunakan sesi merchant yang sah.
Browser:
Puppeteer
+
Chromium
+
Persistent Profile

Contoh:
/data/browser/bri/

39. Browser Session
Status:
CONNECTED

LOGIN_REQUIRED

CHALLENGE_REQUIRED

ERROR

DISABLED

Jika session expired:
LOGIN_REQUIRED

Admin melakukan login melalui flow BRI normal.
Sistem tidak melakukan bypass terhadap:
OTP
CAPTCHA
Security Challenge

40. Browser Session Dashboard
Admin melihat:
BRI Merchant Connection

Merchant
Nana Permana Jasa Umum

Session
● CONNECTED

Last Check
13:30:05

Last Sync
13:30:01

Collector
HEALTHY

Actions:
Open Login Browser

Reconnect

Test Connection

Sync Now

41. Transaction Collector
Collector bertugas membaca transaksi merchant dan mengubahnya ke format internal Rizpay.
Data minimal:
provider
merchant source

reference
amount

transaction date
transaction time

payment method
provider status

Jika tersedia:
trace number
batch number
CPAN masked
merchant name
status description

42. Provider Isolation
Data/endpoint yang digunakan website merchant diperlakukan sebagai detail internal provider, bukan kontrak API publik Rizpay.
Semua ketergantungan ditempatkan di:
providers/
└── bri-merchant/
    ├── browser.ts
    ├── session.ts
    ├── collector.ts
    ├── normalizer.ts
    ├── detail.ts
    └── health.ts

Jika website BRI berubah, yang diperbaiki hanya provider adapter.
43. Normalized Transaction
Collector menghasilkan:
{
  "provider": "BRI_MERCHANT",

  "reference": "223074911478",

  "amount": 1000,

  "transaction_date": "2026-10-01",
  "transaction_time": "13:10:03",

  "payment_method": "QRIS - BRImo",

  "provider_status": "Pencairan Diproses"
}

44. Transaction Detail
Jika diperlukan, Rizpay dapat mengambil detail transaksi setelah menemukan kandidat.
Contoh normalized detail:
{
  "reference": "223074911478",

  "trace_number": "850969",
  "batch_number": "3351232196",

  "amount": 1000,

  "status": "SUCCESS",

  "status_description": "Sales Success",

  "merchant": "Nana Permana Jasa Umum"
}

45. Provider Transactions Database
provider_transactions

id
payment_source_id

provider

provider_reference

amount

transaction_date
transaction_time
transaction_at

payment_method

provider_status

trace_no
batch_no

raw_data

first_seen_at
last_seen_at

created_at
updated_at

Unique:
payment_source_id
+
provider_reference

46. Deduplication
Jika collector mendapatkan transaksi yang sama 100 kali:
223074911478

Rizpay hanya mempunyai satu:
provider_transaction

Collector hanya memperbarui:
last_seen_at
provider_status
raw_data

jika diperlukan.
47. Payment Matcher
Ketika transaksi masuk:
Amount = 50037

Matcher mencari:
payment_source = SOURCE01
pay_amount = 50037
status = PENDING

Jika satu ditemukan:
MATCHED

Kemudian:
PENDING
   ↓
PAID

48. Matching Rules
Prioritas:
1. Payment Source

2. Pay Amount

3. Payment Status

4. Expiration/Cooldown Window

5. Transaction Timestamp

Jangan menggunakan urutan transaksi sebagai primary matcher.
49. Payment Match Record
Database:
payment_matches

id

payment_id
provider_transaction_id

match_type
confidence

matched_at

matched_by

created_at

match_type:
AUTO_UNIQUE_AMOUNT
MANUAL

50. Unmatched Transaction
Jika BRI menerima:
Rp75.123

tetapi Rizpay tidak mempunyai payment terkait:
UNMATCHED

Transaksi tetap disimpan.
Admin dapat melakukan:
Manual Match

51. Ambiguous Transaction
Jika dua payment mempunyai:
Rp50.037

Rizpay tidak boleh memilih salah satunya.
Status:
AMBIGUOUS

Admin harus melakukan reconciliation.
52. Late Payment
Contoh:
Payment Expired
13:30

Customer Pay
13:32

Transaksi tetap disimpan.
Rizpay harus mencoba menemukan payment expired yang masih berada dalam reconciliation window.
Jangan memasangkannya dengan payment baru hanya karena nominal sama.
53. Reconciliation
Menu:
Reconciliation

Tabs:
Matched
Unmatched
Ambiguous
Late Payment
Manual Matches

Contoh:
BRI Transaction

Reference
223074911478

Amount
Rp1.000

Time
13:10:03

Payment
PAY_TEST_001

Match
AUTO

Status
MATCHED

54. Webhook Engine
Setelah:
PENDING → PAID

buat event:
payment.paid

POST ke:
application.webhook_url

55. Webhook Payload
{
  "event": "payment.paid",

  "event_id": "EVT_01KXYZ",

  "data": {
    "payment_id": "PAY_01KXYZ",

    "reference_id": "ORDER-10001",

    "amount": 50000,

    "unique_code": 37,

    "paid_amount": 50037,

    "provider": "BRI_MERCHANT",

    "provider_reference": "223074911478",

    "paid_at": "2026-10-01T13:10:03+07:00"
  }
}

56. Webhook Signature
Headers:
X-Rizpay-Event-ID

X-Rizpay-Timestamp

X-Rizpay-Signature

Signature:
HMAC-SHA256(
    webhook_secret,
    timestamp + "." + raw_body
)

Consumer harus dapat memverifikasi signature.
57. Webhook Retry
Contoh:
Attempt 1
Immediately

Attempt 2
+1 minute

Attempt 3
+5 minutes

Attempt 4
+15 minutes

Attempt 5
+1 hour

Status:
PENDING
DELIVERED
FAILED

Admin dapat:
Retry

58. Webhook Logs
Admin melihat:
payment.paid

PAY_01KXYZ

Endpoint
https://...

HTTP
200

Attempt
1

Duration
243 ms

Status
DELIVERED

Jangan tampilkan secret.
59. Payments Database
payments

id
payment_id

application_id
payment_source_id

reference_id
idempotency_key

description

base_amount
unique_code
pay_amount

currency

status

expires_at
paid_at

provider_transaction_id
provider_reference

created_at
updated_at

Indexes:
UNIQUE(application_id, reference_id)

UNIQUE(application_id, idempotency_key)

INDEX(payment_source_id, pay_amount, status)

INDEX(status, expires_at)

INDEX(provider_reference)

60. Payment QRIS Database
payment_qris

id
payment_id

payload
payload_hash

amount

generated_at
expires_at

created_at

61. Webhook Database
webhook_events

id
event_id
application_id

event_type
payload

created_at

dan:
webhook_deliveries

id

event_id
endpoint

attempt

http_status
response_body

status

next_retry_at
delivered_at

created_at

Response body harus dibatasi ukurannya.
62. Audit Logs
Database:
audit_logs

id
actor_type
actor_id

event

resource_type
resource_id

metadata

ip_address

created_at

Event penting:
PAYMENT_CREATED

QR_GENERATED

QRIS_SOURCE_UPLOADED
QRIS_SOURCE_VALIDATED
PAYMENT_SOURCE_ACTIVATED

TRANSACTION_IMPORTED

PAYMENT_MATCHED
PAYMENT_PAID
PAYMENT_EXPIRED

MANUAL_MATCH

WEBHOOK_SENT
WEBHOOK_FAILED

BRI_CONNECTED
BRI_LOGIN_REQUIRED

63. Mini POS
Mini POS merupakan reference application resmi Rizpay.
Bukan hanya mockup.
Tujuan:
menguji seluruh payment flow

tanpa perlu menggunakan ISP Billing selama development.
64. Mini POS Mock Products
Contoh:
Produk	Harga
Kopi	Rp5.000
Teh	Rp4.000
Air Mineral	Rp3.000
Mie Instan	Rp7.000
Roti	Rp6.000
Snack	Rp8.000


Produk menggunakan mock data.
Tidak diperlukan inventory system kompleks untuk MVP.
65. Mini POS UI
Desktop/tablet:
┌────────────────────────────────────────────┐
│ RIZPAY POS                                │
├──────────────────────────┬─────────────────┤
│ PRODUK                   │ KERANJANG       │
│                          │                 │
│ Kopi          Rp5.000    │ Kopi       x2   │
│ Teh           Rp4.000    │ Roti       x1   │
│ Air Mineral   Rp3.000    │                 │
│ Mie           Rp7.000    │ ──────────────  │
│ Roti          Rp6.000    │                 │
│                          │ Total           │
│                          │ Rp16.000        │
│                          │                 │
│                          │ [ BAYAR QRIS ]  │
└──────────────────────────┴─────────────────┘

66. Mini POS Checkout
Ketika:
Bayar QRIS

POS backend memanggil:
POST /v1/payments

Misalnya:
Harga Barang
Rp16.000

Unique Code
37

QRIS
Rp16.037

67. POS Payment Screen
┌─────────────────────────────┐
│         SCAN QRIS           │
│                             │
│          ███████            │
│          QR CODE            │
│          ███████            │
│                             │
│ Total                       │
│ Rp16.000                    │
│                             │
│ Total Pembayaran            │
│ Rp16.037                    │
│                             │
│ Menunggu pembayaran...      │
│                             │
│ 14:32                       │
│                             │
│ [ Batalkan ]                │
└─────────────────────────────┘

68. POS Payment Detection
POS tidak membaca BRI Merchant.
POS hanya berkomunikasi dengan Rizpay.
Untuk MVP:
GET /v1/payments/:id

setiap:
2 detik

Status:
PENDING

kemudian:
PAID

69. POS Success Screen
┌─────────────────────────────┐
│                             │
│             ✓               │
│                             │
│   PEMBAYARAN BERHASIL       │
│                             │
│        Rp16.037             │
│                             │
│ Ref                         │
│ 22307xxxxxxxx               │
│                             │
│ [ Transaksi Baru ]          │
│                             │
└─────────────────────────────┘

70. Mini POS Webhook
Mini POS backend juga harus menyediakan:
POST /api/webhooks/rizpay

Dengan demikian Mini POS menjadi contoh implementasi:
API
+
Webhook

yang nantinya dapat ditiru ISP Billing.
71. End-to-End Payment Flow
Flow utama MVP:
ADMIN
 │
 │ Upload QRIS Statis
 ▼
QR Decoder
 │
 ▼
Validator
 │
 ▼
Payment Source ACTIVE


POS
 │
 │ Rp16.000
 ▼
Rizpay API
 │
 ▼
Unique Amount
 │
 │ +37
 ▼
Rp16.037
 │
 ▼
QR Generator
 │
 ▼
QRIS Rp16.037
 │
 ▼
Customer
 │
 │ Scan
 ▼
Payment App
 │
 │ Bayar
 ▼
QRIS / BRI
 │
 ▼
BRI Merchant
 │
 ▼
Transaction Collector
 │
 │ amount 16037
 ▼
Payment Matcher
 │
 ▼
PAYMENT FOUND
 │
 ▼
PENDING → PAID
 │
 ├───────────────┐
 ▼               ▼
Webhook        API Status
 │               │
 ▼               ▼
Mini POS ←──── SUCCESS

72. Collector Polling Strategy
Jangan polling agresif terus-menerus.
Adaptive polling:
Ada PENDING payment
        ↓
poll 5–10 detik

Jika tidak ada:
poll 30–60 detik

Configurable.
73. Collector Failure
Jika provider tidak dapat dibaca:
COLLECTOR_ERROR

Payment tetap:
PENDING

Jangan otomatis dianggap gagal.
Dashboard memberikan warning:
⚠ BRI Merchant Collector Offline

Payment confirmation may be delayed.

74. Session Expired
Jika BRI session habis:
CONNECTED
    ↓
LOGIN_REQUIRED

Dashboard:
⚠ BRI Merchant Login Required

Admin dapat membuka browser/login flow.
Setelah berhasil:
CONNECTED

Collector melanjutkan sinkronisasi.
75. Catch-Up Synchronization
Jika collector offline selama 30 menit:
13:00 collector offline

13:10 customer bayar

13:30 collector kembali

transaksi tidak boleh hilang.
Collector melakukan catch-up dari:
last_successful_sync

dengan overlap window.
Contoh:
last sync - 5 menit

Deduplication mencegah transaksi ganda.
76. Security
Jangan log:
password
OTP
session cookie
authorization token
webhook secret
API secret

Secrets harus menggunakan:
Environment Secrets

Docker Secrets

atau encrypted secret storage

77. QRIS Security
Sebelum QR dibuat, pastikan:
payment_source = ACTIVE

QRIS payload hash sesuai konfigurasi

CRC sumber valid

merchant identity sesuai

amount > 0

Setelah QR dibuat:
validate generated CRC

sebelum dikirim ke customer.
78. Amount Rules
Gunakan integer Rupiah.
Contoh:
50000

bukan:
50000.00

Validasi:
amount >= minimum configured amount
amount <= maximum configured amount

Jangan menggunakan floating point untuk perhitungan pembayaran.
79. Idempotency
Jika consumer mengirim dua kali:
Idempotency-Key:
ORDER-10001

Rizpay harus mengembalikan payment yang sama.
Tidak boleh membuat dua QR/payment.
80. API Error Format
Standar:
{
  "error": {
    "code": "PAYMENT_SOURCE_UNAVAILABLE",
    "message": "Payment source is currently unavailable."
  }
}

Contoh error:
INVALID_AMOUNT

INVALID_API_KEY

PAYMENT_NOT_FOUND

PAYMENT_EXPIRED

PAYMENT_SOURCE_UNAVAILABLE

QRIS_GENERATION_FAILED

DUPLICATE_REFERENCE

81. Provider Abstraction
Payment Core tidak boleh bergantung langsung pada BRI.
Interface:
interface TransactionProvider {
  collectTransactions(
    source: PaymentSource,
    range: DateRange
  ): Promise<ProviderTransaction[]>;

  getTransactionDetail(
    transaction: ProviderTransaction
  ): Promise<ProviderTransactionDetail>;

  healthCheck(
    source: PaymentSource
  ): Promise<ProviderHealth>;
}

82. QRIS Generator Abstraction
interface QRISGenerator {
  decode(image: Buffer): Promise<string>;

  validate(payload: string): QRISValidation;

  generate(
    sourcePayload: string,
    amount: number
  ): QRISResult;
}

Ini memungkinkan provider QR lain di masa depan.
83. Future Provider
Arsitektur harus memungkinkan:
BRI Merchant

DANA Merchant

GoPay Merchant

Provider QRIS lain

Official payment APIs

tanpa mengubah consumer API.
84. Repository Structure
Disarankan monorepo:
rizpay/
│
├── apps/
│   │
│   ├── api/
│   │
│   ├── dashboard/
│   │
│   ├── worker/
│   │
│   └── mini-pos/
│
├── packages/
│   │
│   ├── qris/
│   │
│   ├── payment-core/
│   │
│   ├── database/
│   │
│   ├── provider-core/
│   │
│   └── shared/
│
├── providers/
│   │
│   └── bri-merchant/
│
├── docker/
│
├── docs/
│
├── docker-compose.yml
│
├── package.json
│
└── README.md

85. Docker Services
mysql

redis

rizpay-api

rizpay-dashboard

rizpay-worker

bri-browser-worker

mini-pos

Browser worker dipisahkan dari API karena Chromium mempunyai lifecycle dan penggunaan resource sendiri.
86. Worker Architecture
rizpay-worker
│
├── Payment Expiry Worker
├── Payment Matcher
├── Webhook Worker
├── Reconciliation Worker
└── Cleanup Worker

BRI:
bri-browser-worker
│
├── Session Manager
├── Health Monitor
├── Transaction Collector
└── Transaction Detail Collector

87. Database Tables MVP
Minimal:
users
roles

applications
api_keys

payment_sources
payment_source_versions

payments
payment_qris

provider_transactions
payment_matches

webhook_endpoints
webhook_events
webhook_deliveries

browser_sessions

audit_logs
settings

88. Payment Source Versioning
Karena QRIS acuan dapat diganti, payment harus mengetahui versi sumber QR yang digunakannya.
payment_source_versions

id
payment_source_id

version

qris_payload
payload_hash

merchant_data

activated_at
archived_at

created_at

Payment menyimpan:
payment_source_version_id

Sehingga QR lama tetap dapat diaudit walaupun admin mengganti QRIS merchant.
89. Settings
Global Settings:
Default Payment Expiry
15 minutes

Unique Code Range
1–999

Unique Code Cooldown
30 minutes

Active Collector Interval
5 seconds

Idle Collector Interval
30 seconds

Reconciliation Window
configurable

Default Currency
IDR

90. Application Settings
Per application:
Payment Source

Payment Expiry

Webhook URL

Webhook Secret

Environment

Status

91. Payment Detail Dashboard
PAY_01KXYZ

Status
PAID

Application
Rizpay Mini POS

Reference
ORDER-10001

Description
POS Purchase

Base Amount
Rp50.000

Unique Code
Rp37

Pay Amount
Rp50.037

Provider
BRI Merchant

Provider Ref
223074911478

Paid At
13:10:03

Created
12:58:00

Actions:
View QR

View Provider Transaction

View Webhook

View Audit Trail

92. Transaction Detail Dashboard
Provider Transaction

Provider
BRI Merchant

Reference
223074911478

Trace
850969

Batch
3351232196

Amount
Rp1.000

Method
QRIS - BRImo

Transaction Time
13:10:03

Provider Status
Pencairan Diproses

Payment
PAY_TEST_001

Match
AUTO UNIQUE AMOUNT

93. Monitoring
Health checks:
API
Database
Redis
Worker
Browser
BRI Session
Collector
Webhook Queue

Dashboard:
System Health

API            ● Healthy
MySQL          ● Healthy
Redis          ● Healthy
Worker         ● Healthy
BRI Session    ● Connected
Collector      ● Healthy
Webhook Queue  ● Healthy

94. Logging
Gunakan structured JSON logs.
Contoh:
{
  "event": "payment_matched",
  "payment_id": "PAY_01KXYZ",
  "provider_reference": "223074911478",
  "amount": 50037
}

Jangan log credential.
95. Mini POS Development Mode
Untuk development tanpa pembayaran nyata, sediakan:
Mock Provider

Flow:
Create Payment
     ↓
QR generated
     ↓
Developer:
Simulate Payment
     ↓
Mock transaction created
     ↓
Matcher
     ↓
PAID

Button hanya tersedia:
development/test environment

96. Real Provider Test Mode
Setelah Mock POS bekerja:
Mock Provider
      ↓
BRI Merchant Test

Gunakan nominal kecil.
Flow sebenarnya:
POS
 ↓
Rizpay
 ↓
QR
 ↓
Scan
 ↓
Bayar
 ↓
BRI Merchant
 ↓
Collector
 ↓
Matcher
 ↓
Webhook
 ↓
POS Success

97. Development Phase 1
QRIS Core + POS Mock
Bangun:
Database

Admin Login

Payment Source

Upload QRIS

QR Decoder

QRIS Parser

CRC Validator

QRIS Generator

Unique Amount

Payment API

Mini POS

Mock Payment Simulator

Target:
Upload QRIS
→ POS checkout
→ QR amount-specific muncul

98. Development Phase 2
BRI Merchant Collector
Bangun:
Puppeteer

Persistent Session

Session Monitor

Transaction Collector

Normalizer

Deduplication

Payment Matcher

Target:
QR
→ pembayaran nyata
→ transaksi ditemukan
→ payment PAID

99. Development Phase 3
Production Payment Core
Tambahkan:
API Keys

Idempotency

Payment Expiration

Cooldown

Webhook

Webhook Signature

Webhook Retry

Reconciliation

Audit Log

100. Development Phase 4
Admin Dashboard
Tambahkan UI lengkap:
Dashboard

Payments

Transactions

Applications

Payment Sources

Reconciliation

Webhooks

Browser Session

Audit Logs

Settings

101. Development Phase 5
ISP Billing Integration
ISP Billing memanggil:
POST /v1/payments

Ketika invoice dibayar:
Rizpay
   ↓
payment.paid
   ↓
ISP Billing
   ↓
Invoice PAID

ISP Billing tidak perlu mengetahui:
BRI Merchant
Puppeteer
QR parsing
Unique amount
Transaction collector

Semua menjadi tanggung jawab Rizpay.
102. Acceptance Test Utama
Test wajib:
1. Admin login

2. Admin membuat Payment Source

3. Upload gambar QRIS statis

4. Rizpay berhasil decode QR

5. Merchant ditampilkan dengan benar

6. CRC VALID

7. Admin generate Test QR Rp1.000

8. QR dapat discan

9. Payment Source diaktifkan

10. Buka Mini POS

11. Tambah barang

12. Total Rp16.000

13. Klik Bayar

14. Rizpay allocate unique code

15. Pay amount Rp16.0xx

16. QR muncul

17. Customer scan

18. Nominal sesuai

19. Customer bayar

20. BRI menerima transaksi

21. Collector menemukan transaksi

22. Transaction deduplicated

23. Matcher menemukan payment

24. PENDING → PAID

25. Webhook dikirim

26. POS menerima status

27. POS menampilkan:
    PEMBAYARAN BERHASIL

103. Definition of Done MVP
MVP dianggap selesai jika:
✓ Admin dapat upload QRIS statis

✓ QR dapat didecode otomatis

✓ EMV dapat diparse

✓ CRC dapat divalidasi

✓ Merchant dapat dikenali

✓ Payment Source dapat diaktifkan

✓ QR amount-specific dapat dibuat

✓ QR dapat dibayar

✓ Unique amount bekerja

✓ Payment expiry bekerja

✓ Cooldown bekerja

✓ BRI session dapat dipertahankan

✓ Session expired dapat dideteksi

✓ Transaction collector berjalan

✓ Transaction deduplication berjalan

✓ Payment matching berjalan

✓ Payment otomatis PAID

✓ Unmatched transaction tersimpan

✓ Manual reconciliation tersedia

✓ Webhook payment.paid terkirim

✓ Webhook retry bekerja

✓ Mini POS berjalan end-to-end

✓ Audit log tersedia

✓ API siap digunakan ISP Billing

104. Arsitektur Akhir MVP
                       RIZPAY
                          │
              ┌───────────┴───────────┐
              │                       │
        PAYMENT CORE             ADMIN PANEL
              │
      ┌───────┼────────┐
      │       │        │
      ▼       ▼        ▼
    QRIS    Matcher   Webhook
 Generator
      │
      │
      ▼
 Customer
      │
      ▼
 QRIS Network
      │
      ▼
     BRI
      │
      ▼
 BRI Merchant
      │
      ▼
Browser Collector
      │
      ▼
Provider Transaction
      │
      ▼
Payment Matcher
      │
      ▼
     PAID
      │
      ▼
   Webhook
      │
   ┌──┴───────────────┐
   ▼                  ▼
Mini POS          ISP Billing

105. Target Produk Setelah MVP
Rizpay sebaiknya berkembang dari sistem BRI Merchant menjadi payment orchestration platform.
Consumer tetap menggunakan kontrak:
Create Payment
Get Payment
Receive Webhook

sementara backend dapat berkembang menjadi:
                RIZPAY
                  │
        ┌─────────┼─────────┐
        ▼         ▼         ▼
      BRI       DANA      Provider
    Merchant   Merchant    Lain
        │         │         │
        └─────────┼─────────┘
                  ▼
            Payment Core
                  │
                  ▼
              Applications

Dengan desain tersebut, ketergantungan terhadap BRI Merchant hanya berada pada provider adapter, bukan pada keseluruhan aplikasi.
106. Keputusan Implementasi MVP
Untuk development awal, urutannya ditetapkan:
1. Admin + Payment Source

2. Upload QRIS statis

3. QR Image Decoder

4. EMV Parser + CRC Validator

5. Local QRIS Generator

6. Unique Amount Engine

7. Payment API

8. Mini POS dengan mock products

9. Mock Payment Simulator

10. BRI Browser Session

11. Transaction Collector

12. Deduplication

13. Payment Matcher

14. Webhook

15. Reconciliation

16. Full Admin Dashboard

17. ISP Billing Integration

Dengan urutan ini kita tidak perlu menunggu seluruh dashboard selesai untuk menguji sistem. Milestone teknis pertama adalah:
ADMIN UPLOAD QRIS
        ↓
RIZPAY MENYIMPAN QRIS
        ↓
MINI POS MEMBUAT ORDER
        ↓
RIZPAY GENERATE QR
        ↓
CUSTOMER BAYAR
        ↓
BRI MERCHANT MENDETEKSI
        ↓
RIZPAY MATCH
        ↓
PAYMENT PAID
        ↓
MINI POS SUCCESS
