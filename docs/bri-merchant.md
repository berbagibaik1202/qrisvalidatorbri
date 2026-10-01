# BRI Merchant

Login: https://brimerchant.bri.co.id/auth/login

Transaksi: https://brimerchant.bri.co.id/transaksi

## Login di Windows

Login otomatis tersedia melalui konfigurasi server berikut. `BRI_USERNAME` adalah nomor handphone akun BRI Merchant; password yang mengandung `#` harus diapit tanda kutip dalam `.env`.

```dotenv
BRI_AUTO_LOGIN_ENABLED=true
BRI_USERNAME=nomor_handphone_akun
BRI_PASSWORD="password_akun"
BRI_BROWSER_VISIBLE=true
```

Restart `npm run bri:worker` setelah konfigurasi diisi. Worker memulihkan profil tersimpan saat startup, kemudian mengisi form login resmi bila sesi sudah berakhir. CONNECTED tetap membutuhkan verifikasi halaman transaksi. Kredensial tidak ditampilkan melalui API/status atau dicatat dalam log. Jangan memasukkan `.env` dan profil browser ke repository.

Login gagal hanya dicoba sekali sampai **Pulihkan sesi** atau restart worker; periksa kredensial sebelum mencoba kembali. OTP/CAPTCHA atau perubahan form memerlukan login manual. **Buka browser login** menunda otomatisasi selama login manual; **Tutup browser** menghentikan pemulihan otomatis sampai **Pulihkan sesi**. Penutupan browser di luar kontrol tersebut akan dipulihkan otomatis ketika konfigurasi login aktif.

Di Linux proses browser tetap diperlukan. `BRI_BROWSER_VISIBLE=false` menjalankannya tanpa jendela jika portal mengizinkan headless. Jika portal membatasi headless, gunakan display virtual (Xvfb) dan `BRI_BROWSER_VISIBLE=true`. Konfigurasi Docker Xvfb tersedia melalui `docker-compose.bri.yml`; runtime server Linux masih perlu diuji.

Jalankan `npm run dev` dan, pada terminal terpisah, `npm run bri:worker`. Setelah update schema, jalankan `npm run db:local` terlebih dahulu saat server berhenti.

Buka Dashboard → Browser Session → **Buka browser login**. Login/OTP/CAPTCHA dilakukan langsung pada browser BRI yang muncul di komputer worker. Setelah login selesai, klik **Cek koneksi**. Collector tidak me-reload halaman saat LOGIN_REQUIRED. Tautan biasa ke portal tidak berbagi sesi dengan profil worker.

Profil tersimpan di `data/browser/bri`. Executable dideteksi dari Chrome, Edge, atau Chromium Playwright. Alternatif: set `BRI_BROWSER_EXECUTABLE`. Gunakan `BRI_BROWSER_PROFILE` untuk lokasi profil khusus; jangan pakai profil browser pribadi.

Control worker mendengarkan `127.0.0.1:3010`, dilindungi token internal dari SECRET_ENCRYPTION_KEY. API memakai `BRI_WORKER_URL`, default `http://127.0.0.1:3010`. Jangan expose port ini ke internet. Remote login membuka browser pada komputer worker, sehingga membutuhkan desktop/display di sana.

## Status akses nyata

Pembaruan setelah login resmi: sesi **CONNECTED**, collector **READY**, dan empat transaksi nyata telah tersimpan. Portal menggunakan `#transaction-revamp-list` berisi kartu; bukti sukses dibaca dari struk `#dataStruk-*`, bukan status settlement pada kartu. Collector network kini menjadi default. Tidak memerlukan BRI_COLLECTOR_MAPPING.

Pemeriksaan browser headless pernah memperoleh **HTTP 403** dan frame challenge **Incapsula**. Form login nyata telah diinspeksi melalui browser interaktif: nomor handphone `#username`, password `#confirm_password`, dan tombol submit **Masuk**. Jika akses dibatasi, gunakan verifikasi resmi di portal/provider.

Worker tidak memakai URL `/transaksi` saja untuk menandai CONNECTED. Ia memerlukan marker authenticated, atau gabungan link Transaksi, tombol Logout/Keluar, dan judul merchant/transaksi. `BRI_AUTHENTICATED_SELECTOR` dapat diisi setelah marker sah terverifikasi dari portal nyata.

## Collector network

Collector aktif menggunakan response JSON daftar, summary dan detail BRI; polling tidak lagi me-reload halaman atau membuka struk. Panduan verifikasi, pagination, session, cache dan batas range terdapat di [network collector](bri-network.md). Adapter DOM lama hanya dipertahankan untuk fixture historis dan tidak dipanggil oleh worker aktif.

## Pengujian

`npm test`, `npm run test:bri`, dan `npm run test:browser` memverifikasi normalisasi, sesi, dan UI. BRI fixture test mengintercept request dan memakai halaman sintetis; tidak mengirim request ke BRI dan tidak membuktikan koneksi transaksi nyata.
