import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Prometis',
  description: 'Gestion de promotions immobilières — Suisse romande',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr-CH">
      <body>{children}</body>
    </html>
  );
}
