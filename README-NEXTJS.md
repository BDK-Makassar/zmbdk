# Zoom Live Monitor — Next.js + Vercel

Versi ini menggantikan backend Laravel dengan Next.js App Router, di-deploy
sepenuhnya ke Vercel. Panel Zoom App (`public/zoom-app/`) ikut ter-host
dalam satu project yang sama — jadi cuma satu deployment, bukan dua server
terpisah seperti versi Laravel.

## Perbedaan arsitektur penting dari versi Laravel

| Bagian | Versi Laravel | Versi Next.js/Vercel |
|---|---|---|
| Backend | Laravel (server sendiri) | Next.js API Routes (serverless) |
| Database | MySQL/Postgres di server sendiri | Vercel Postgres / Neon (managed) |
| Realtime | Laravel Reverb (WebSocket self-hosted) | Pusher (managed, karena Vercel serverless **tidak bisa** menjaga koneksi WebSocket tetap terbuka) |
| Hosting panel Zoom App | Nginx static file terpisah | Folder `public/` di project Next.js yang sama |

**Kenapa harus Pusher, bukan Reverb?** Function di Vercel bersifat
stateless dan mati setelah selesai memproses satu request (cold
start/serverless) — tidak bisa mempertahankan koneksi WebSocket jangka
panjang seperti server Reverb yang jalan terus 24/7. Pusher jadi lapisan
realtime terkelola: API route Next.js cukup `trigger()` event ke Pusher,
Pusher yang push ke browser dashboard.

## 1. Setup database (Vercel Postgres)

1. Buka [vercel.com/dashboard](https://vercel.com/dashboard) → project kamu
   (buat project baru dulu kalau belum ada, import dari repo Git)
2. Tab **Storage** → **Create Database** → pilih **Postgres** (Neon)
3. Setelah dibuat, Vercel otomatis inject env var `POSTGRES_PRISMA_URL`
   dan `POSTGRES_URL_NON_POOLING` ke project — tidak perlu isi manual
4. Jalankan migration Prisma dari lokal (sekali saja, arahkan ke database
   production):
   ```bash
   npx prisma migrate deploy
   ```
   atau kalau mau sekalian generate migration pertama:
   ```bash
   npx prisma migrate dev --name init
   ```

## 2. Setup Pusher

1. Daftar gratis di [pusher.com](https://pusher.com) → **Channels** →
   **Create app**
2. Pilih cluster terdekat (misal `ap1` untuk Singapore)
3. Catat 4 nilai dari halaman **App Keys**: `app_id`, `key`, `secret`,
   `cluster`

## 3. Environment variables di Vercel

Buka project di Vercel → **Settings** → **Environment Variables**, isi:

```
ZOOM_MONITOR_TOKEN=generate-string-acak-panjang
PUSHER_APP_ID=isi dari Pusher
PUSHER_SECRET=isi dari Pusher
NEXT_PUBLIC_PUSHER_KEY=isi dari Pusher
NEXT_PUBLIC_PUSHER_CLUSTER=ap1
NEXT_PUBLIC_MONITOR_DASHBOARD_TOKEN=sama dengan ZOOM_MONITOR_TOKEN
```

> **Catatan keamanan penting**: variabel `NEXT_PUBLIC_*` di Next.js
> ke-bundle ke JavaScript sisi browser — artinya siapapun yang buka
> DevTools di halaman dashboard bisa lihat token ini. Untuk kebutuhan
> internal ini risikonya rendah, tapi untuk produksi yang lebih serius,
> ganti pendekatan endpoint summary supaya pakai session login (NextAuth)
> alih-alih token statis yang ter-expose ke publik. Saya bisa bantu
> buatkan versi itu kalau dibutuhkan.

Generate token acak dari terminal:
```bash
openssl rand -hex 24
```

## 4. Deploy

### Opsi A — lewat Git (direkomendasikan)

1. Push folder project ini ke repo GitHub/GitLab
2. Di Vercel dashboard → **Add New Project** → import repo tersebut
3. Vercel otomatis detect Next.js, build command dan output sudah benar
   dari `package.json` (`prisma generate && next build`)
4. Klik **Deploy**

### Opsi B — lewat Vercel CLI (langsung dari komputer kamu)

```bash
npm install -g vercel
cd zoom-monitor-nextjs
vercel login
vercel --prod
```

## 5. Update panel Zoom App

Setelah deploy, kamu dapat domain seperti `zoom-monitor-xxx.vercel.app`
(atau domain custom kalau sudah di-setup). Buka
`public/zoom-app/app.js`, edit:

```js
const BACKEND_URL = "https://domain-vercel-kamu.vercel.app/api/zoom-monitor";
const API_TOKEN = "sama-dengan-ZOOM_MONITOR_TOKEN-di-Vercel";
```

Redeploy setelah edit (`vercel --prod` lagi, atau push ke Git kalau pakai
opsi A — panel akan otomatis ter-update juga karena satu project yang
sama).

## 6. Update Zoom App Marketplace config

Di halaman app config Zoom Marketplace (dari yang sudah kamu setup
sebelumnya):

- **Home URL**: `https://domain-vercel-kamu.vercel.app/zoom-app/index.html`
- **Domain Allow List**: tambahkan `domain-vercel-kamu.vercel.app`

## 7. Testing

1. Buka meeting Zoom, aktifkan panel app dari sidebar **Apps**
2. Cek status "Terhubung ke meeting" muncul di panel
3. Buka dashboard di `https://domain-vercel-kamu.vercel.app/zoom-monitor/{meeting_uuid}`
   (ambil UUID dari log panel)
4. Uji skenario yang sama seperti versi Laravel: peserta join, kamera
   mati, breakout room berubah — cek dashboard update real-time

## Struktur project

```
zoom-monitor-nextjs/
├── app/
│   ├── api/zoom-monitor/
│   │   ├── events/route.ts              ← terima event dari panel
│   │   └── sessions/[meetingUuid]/summary/route.ts  ← fallback REST
│   ├── zoom-monitor/[meetingUuid]/page.tsx  ← dashboard live
│   └── layout.tsx
├── lib/
│   ├── prisma.ts
│   ├── pusher.ts
│   └── auth.ts
├── prisma/schema.prisma                 ← 4 model setara migration Laravel
├── public/zoom-app/                     ← panel Zoom App (host di sini juga)
│   ├── index.html
│   └── app.js
└── .env.example
```

## Batasan yang tetap sama seperti versi Laravel

- Status kamera peserta LAIN tetap terbatas (SDK hanya beri info kamera
  diri sendiri dengan mudah) — solusinya sama: semua peserta buka panel
  masing-masing, atau polling `getMeetingParticipants` dari host.
- Data breakout room tetap perlu diuji manual dulu, karena konsistensi ID
  antara Zoom Apps SDK dan Report API bisa berbeda.
- Ini tetap bukan sumber kebenaran akhir untuk laporan kehadiran resmi —
  tetap pakai REST API `past_meetings/{uuid}/participants` untuk itu.

## Biaya

- **Vercel**: free tier (Hobby) cukup untuk trafik internal skala kecil
- **Vercel Postgres/Neon**: free tier tersedia, cukup untuk kebutuhan ini
- **Pusher**: free tier meliputi 200k pesan/hari & 100 koneksi bersamaan —
  jauh lebih dari cukup untuk 1-2 meeting berjalan bersamaan
