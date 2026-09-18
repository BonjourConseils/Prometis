import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Hanken_Grotesk, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

/**
 * Les polices sont servies **par Prometis**, pas par Google.
 *
 * Elles étaient chargées depuis `fonts.googleapis.com` : chaque ouverture de
 * page envoyait l'adresse du visiteur à Google — un destinataire de données
 * personnelles de plus, à inventorier, pour une question de typographie.
 * `next/font` les télécharge une fois, à la construction, et les sert depuis
 * notre origine. C'est aussi ce qui permet une politique de contenu stricte.
 */
const sans = Hanken_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  style: ['normal', 'italic'],
  variable: '--police-sans',
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--police-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Prometis',
  description: 'Gestion de promotions immobilières — Suisse romande',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr-CH" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
