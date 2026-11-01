# Veyra — Messaging app starter

Veyra adalah aplikasi chat Android + web berbasis React, Capacitor 8, dan Firebase. Ini adalah proyek starter yang bisa kamu fork ke GitHub, hubungkan ke Firebase milikmu, lalu build menjadi APK melalui GitHub Actions.

> **Status proyek:** fondasi MVP yang bisa dikembangkan dan diuji dengan dua akun Firebase. ZIP ini berisi source code, bukan APK jadi; folder `android/` dibuat oleh workflow GitHub Actions setelah konfigurasi disiapkan. Build native, deploy Firebase, dan pengujian dua perangkat belum dapat diverifikasi dari paket ini. Ini bukan replika penuh WhatsApp dan belum siap dipublikasikan tanpa pengujian, audit Security Rules, App Check, monitoring, serta hardening tambahan.

## Fitur yang sudah disediakan di kode

- Login / create account memakai username + password melalui Firebase Authentication.
- Profil publik, foto profil, bio, nama tampilan maksimal 20 karakter, dan avatar inisial otomatis.
- Nomor Veyra 10 digit yang dibuat di server dengan transaksi Firestore dan indeks unik. Ini **bukan nomor SIM/nomor telepon** dan tidak menerima SMS.
- Add contact memakai nomor Veyra; alias kontak tersimpan hanya pada akun yang menyimpan kontak tersebut. Alias pendek maksimal 16 karakter dan nama lengkap maksimal 32 karakter.
- Direct chat realtime, typing indicator, timestamp tetap, status delivered/read (dua centang abu-abu/biru), reactions, edit pesan (15 menit), delete for me + tombol **Urungkan** 5 detik, delete for everyone (maksimal 48 jam untuk pengirim).
- Pesan teks, foto (otomatis dikecilkan dan dikompres ke JPEG), video, file, sticker berbasis gambar, dan voice note yang direkam dari mikrofon.
- Video dikompres di perangkat (maksimal sisi 1280 px, 24 fps, bitrate sekitar 1.4 Mbps) dan hasilnya dibatasi 35 MB. Proses ini berjalan real-time saat file dimainkan; kompatibilitas encoder bergantung pada Android WebView/perangkat.
- Grup, foto dan deskripsi grup, anggota, admin, tambah/kick anggota, dan pengaturan grup khusus admin.
- Status teks/foto/video, masa tampil 24 jam, serta balasan status yang membuka chat langsung.
- Block/unblock: hanya akun yang melakukan block yang dapat unblock; kedua akun tidak bisa saling mengirim pesan selama block aktif.
- Push notification native Android melalui Firebase Cloud Messaging di background, serta pemberitahuan dalam aplikasi saat sedang terbuka (setelah Firebase Android setup dan izin notifikasi diberikan).
- Video call dan audio call sengaja ditampilkan sebagai **coming soon** / belum tersedia.

## Belum termasuk (jangan diasumsikan sudah ada)

- **End-to-end encryption (E2EE) belum ada.** Transport jaringan Firebase menggunakan HTTPS/TLS, tetapi server Firebase tetap memproses data pesan. Jangan gunakan untuk rahasia atau data sensitif.
- Video call / audio call belum tersedia.
- Backup/restore chat, multi-device session management yang lengkap, message forwarding, pinned chat, channel, disappearing messages, encrypted backups, spam detection, report workflow, dan moderasi skala besar belum tersedia.
- Status saat ini untuk kontak yang disimpan; pengaturan audience status per kontak belum tersedia. Balasan status membuka chat langsung dengan konteks status sebagai draft, bukan thread balasan status terpisah.
- FCM membutuhkan konfigurasi Android Firebase dan pengujian pada perangkat nyata. Push di browser/PWA tidak dijanjikan oleh starter ini. Alur reset password/email recovery juga belum tersedia karena akun menggunakan username internal, bukan alamat email pengguna.

## 1. Buat Firebase project

1. Buka [Firebase Console](https://console.firebase.google.com/) dan buat project baru, misalnya `veyra-chat`.
2. Pada **Project settings → General → Your apps**, buat aplikasi **Web**. Salin config-nya.
3. Buat aplikasi **Android** dengan package name persis: `app.veyra.chat`.
4. Download `google-services.json` untuk Android. Simpan di `android/app/google-services.json` (file ini sengaja masuk `.gitignore`).
5. Di **Authentication → Sign-in method**, aktifkan **Email/Password**.
6. Di **Firestore Database**, buat database pada region yang dekat dengan pengguna, misalnya `asia-southeast1` jika tersedia. Mulai dalam production mode.
7. Di **Storage**, buat default bucket. Untuk bucket Firebase Storage baru, project harus memakai paket **Blaze (pay as you go)**.
8. Di **Cloud Messaging**, aktifkan Firebase Cloud Messaging API / HTTP v1.
9. Tambahkan billing alerts dan budget alerts di Google Cloud Billing sebelum menguji upload media atau Cloud Functions.

### Isi Firebase Web config

Salin `.env.example` menjadi `.env.local`, kemudian isi enam nilai berikut dari konfigurasi Web App Firebase:

```bash
cp .env.example .env.local
```

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

Firebase API key pada konfigurasi aplikasi Firebase bersifat publik untuk identifikasi project; keamanan data tetap harus ditegakkan dengan Security Rules, App Check, dan IAM. Jangan pernah memasukkan service-account private key ke aplikasi atau repository.

## 2. Jalankan lokal

Persyaratan resmi Capacitor 8: Node.js 22+, Android Studio dan Android SDK. Untuk Android SDK gunakan platform yang didukung oleh Android Studio terbaru.

```bash
npm install
npm run dev
```

Buka URL lokal yang ditampilkan Vite. Login dan fitur realtime membutuhkan Firebase config dan backend yang sudah dideploy.

## 3. Siapkan Android

Folder `android/` dibuat oleh Capacitor CLI. Bila folder itu belum ada:

```bash
npm run build
npx cap add android
node scripts/install-android-icons.mjs
```

Lalu:

1. Letakkan `google-services.json` di `android/app/google-services.json`.
2. Jalankan:

```bash
npm run cap:sync
npx cap open android
```

3. Di Android Studio, tunggu Gradle sync, pilih perangkat Android/emulator, lalu tekan Run.

### Firebase Android Gradle

Capacitor 8 Android template sudah menyiapkan dependency Google Services Gradle plugin dan menerapkannya saat `android/app/google-services.json` tersedia. Karena itu, workflow GitHub membuat file JSON sebelum Gradle build dijalankan. Pastikan nama package Android pada Firebase persis `app.veyra.chat`. Jangan menambahkan service-account private key ke aplikasi.

Pastikan AndroidManifest mempunyai permission berikut (plugin dapat menambahkan sebagian permission secara otomatis):

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

## 4. Deploy Firebase backend dan rules

Pasang Firebase CLI:

```bash
npm install -g firebase-tools
firebase login
```

Salin `.firebaserc.example` menjadi `.firebaserc`, lalu ganti `YOUR_FIREBASE_PROJECT_ID` dengan project ID milikmu. Kemudian:

```bash
firebase use --add
cd functions
npm install
npm run build
cd ..
firebase deploy --only firestore:rules,firestore:indexes,storage,functions
```

Opsional deploy versi web:

```bash
npm run build
firebase deploy --only hosting
```

**Catatan billing:** Cloud Functions for Firebase dan Cloud Storage for Firebase memerlukan paket Blaze. Blaze adalah pay-as-you-go; penggunaan gratis tertentu tetap tersedia, tetapi penggunaan di atas kuota gratis dapat dikenakan biaya. Atur budget alerts dan pantau usage.

## 5. Hasilkan APK dengan GitHub Actions

1. Buat repository GitHub baru dan upload seluruh isi folder proyek ini.
2. Workflow otomatis membuat folder Android, memasang icon Veyra, dan build APK.
3. Di GitHub buka **Settings → Secrets and variables → Actions → New repository secret**.
4. Tambahkan secret berikut:

| Secret | Isi |
|---|---|
| `GOOGLE_SERVICES_JSON_BASE64` | Isi file `google-services.json` yang dikodekan Base64 satu baris |
| `VITE_FIREBASE_API_KEY` | API key dari Firebase Web app |
| `VITE_FIREBASE_AUTH_DOMAIN` | Auth domain |
| `VITE_FIREBASE_PROJECT_ID` | Project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | Storage bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Messaging sender ID |
| `VITE_FIREBASE_APP_ID` | Web app ID |

Cara membuat Base64:

```bash
base64 -w 0 google-services.json
```

5. Buka tab **Actions** → workflow **Build Android APK** → **Run workflow** (atau push commit baru).
6. Setelah sukses, buka run terakhir dan download artifact `veyra-debug-apk`. Di dalamnya ada `app-debug.apk`.
7. APK debug hanya untuk testing. Untuk distribusi publik, buat upload keystore sendiri, simpan signing key/password sebagai GitHub Secrets, lalu buat workflow release signed APK/AAB.

## 6. Uji dua akun

- Install APK pada dua perangkat (atau satu perangkat + emulator).
- Buat akun berbeda, catat nomor Veyra masing-masing.
- Dari akun A, tambahkan nomor akun B; beri short name dan full name.
- B juga perlu menambahkan nomor A untuk balas chat atau membuat grup bersama.
- Coba teks, edit, hapus untuk diri sendiri, urungkan, hapus semua, reaction, foto, file, voice note, status, grup, block, unblock.
- Uji notifikasi dengan aplikasi benar-benar ditutup/background dan izin notifikasi Android diaktifkan.

## Data model ringkas

- `users/{uid}` — profil publik.
- `usernames/{username}` dan `numbers/{number}` — index unik, hanya Cloud Functions yang dapat menulis/membaca.
- `users/{uid}/contacts/{contactUid}` — nama lokal tiap kontak.
- `users/{uid}/blocks/{blockedUid}` — daftar blokir (server-managed).
- `users/{uid}/hiddenMessages/{messageId}` — hapus hanya di tampilan pengguna.
- `conversations/{conversationId}` — anggota, admin, metadata grup dan ringkasan chat.
- `conversations/{conversationId}/messages/{messageId}` — pesan, media reference, receipts, reactions, edited/deleted state.
- `conversations/{conversationId}/typing/{uid}` — typing presence sementara.
- `statuses/{statusId}` — status 24 jam.
- `users/{uid}/devices/{deviceId}` — token push notification.

## Security notes sebelum production

- Tambahkan Firebase App Check untuk Web/Android dan enforce untuk produk yang mendukungnya.
- Review dan test Security Rules memakai Firebase Emulator Suite; rules pada repository adalah baseline, bukan audit keamanan formal.
- Atur App Check, quotas, rate-limiting/abuse controls, retention/TTL, Storage lifecycle, backups, crash reporting, dan moderation/reporting.
- Tambahkan E2EE dengan protokol yang telah diaudit (jangan merancang kriptografi sendiri) sebelum mengiklankan chat sebagai private end-to-end encrypted.
- Jangan gunakan data pengguna nyata sebelum kebijakan privasi, terms, consent media/mikrofon, dan proses penghapusan akun/data disiapkan.
