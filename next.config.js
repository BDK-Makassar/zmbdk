/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        // Berlaku untuk semua file di public/zoom-app/ (termasuk index.html)
        source: "/zoom-app/:path*",
        headers: [
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Content-Security-Policy",
            // frame-ancestors mengizinkan halaman ini ditampilkan di dalam
            // iframe Zoom client — wajib, karena panel ini memang didesain
            // untuk dibuka sebagai in-client app.
            value:
              "frame-ancestors 'self' https://*.zoom.us https://*.zoomgov.com; default-src 'self'; script-src 'self' https://appssdk.zoom.us 'unsafe-inline'; connect-src 'self' https://*.vercel.app; style-src 'self' 'unsafe-inline';",
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;