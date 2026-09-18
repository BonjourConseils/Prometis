const production = process.env.NODE_ENV === 'production';

/**
 * Politique de contenu du site.
 *
 * Tout vient de notre origine : scripts, styles, images, polices — les polices
 * sont servies par `next/font`, plus par Google. Le navigateur ne parle qu'à
 * nous : les appels à l'API passent par le relais, jamais en direct.
 *
 * `'unsafe-inline'` reste nécessaire aux scripts d'hydratation de Next ; le
 * retirer suppose des nonces par requête, un chantier à part. `'unsafe-eval'`
 * et les websockets ne servent qu'au rechargement à chaud du développement.
 */
const politique = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${production ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${production ? '' : ' ws: wss:'}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const entetes = [
  { key: 'Content-Security-Policy', value: politique },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  // HSTS en production seulement : sur `localhost`, il forcerait HTTPS sur
  // tous les projets locaux du navigateur pendant un an.
  ...(production
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
    : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Dire quel framework répond n'aide que celui qui cherche la faille qui va avec.
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001',
  },
  async headers() {
    return [{ source: '/(.*)', headers: entetes }];
  },
};

export default nextConfig;
