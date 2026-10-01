# Analisis PRD v2.1

PRD mendefinisikan payment orchestration terpisah dari billing. QRIS memerlukan parsing TLV/CRC, versi source, reservasi nominal, dedup transaksi, waktu transaksi dan bukti sukses provider untuk konfirmasi payment.

Implementasi lokal membuktikan QRIS core, Payment API, Mini POS consumer HTTP terpisah, webhook dengan signature/retry serta dashboard. Collector BRI berhasil membaca empat transaksi nyata. Status rinci dan batas acceptance ada pada [status PRD](status-prd.md).

## Keputusan implementasi

- Integer Rupiah; default base amount Rp100–Rp10 juta, kode unik 1–999.
- Idempotency scoped application/key; reference unik per application; request berbeda pada key sama menghasilkan 409.
- Reservasi bertahan sampai expiry + cooldown termasuk setelah PAID/CANCELLED. MySQL memakai Redis lock dan serializable transaction; SQLite untuk development.
- Timestamp sebelum expiry dapat mengonfirmasi invoice EXPIRED akibat collector terlambat. Timestamp setelah expiry menjadi LATE_PAYMENT; beberapa kandidat menjadi AMBIGUOUS. Manual match memvalidasi source, amount, waktu dan SUCCESS.
- Reference provider tidak boleh berubah amount/provider/timestamp. Settlement bukan bukti SUCCESS; BRI memerlukan struk Sales Success.
- Webhook durable dan at-least-once, HMAC raw body, retry lima attempts, lease recovery. Consumer deduplikasi event ID. URL consumer umum wajib HTTPS publik; internal POS hanya dari konfigurasi operator.
- Mini POS memakai HTTP API dan database order/receipt sendiri ketika MINI_POS_URL dikonfigurasi. Backend embedded tetap tersedia sebagai fallback compatibility untuk pengujian core.
- Penggantian QRIS mempertahankan merchant, mengarsipkan versi lama dan mewajibkan uji ulang. Merchant berbeda menjadi source baru.

## Dependensi luar

Login BRI resmi sudah berhasil. OTP/CAPTCHA ditangani operator. Perubahan portal memerlukan verifikasi selector/status ulang.

Deployment MySQL/Redis/HTTPS, pembayaran bank baru end-to-end, memerlukan lingkungan/akses yang belum tersedia. Integrasi ISP Billing ditunda sesuai instruksi pengguna. Lihat [deployment](deployment.md) dan [API](api.md).

BRIVA, payout, refund dan settlement automation berada di luar MVP.
