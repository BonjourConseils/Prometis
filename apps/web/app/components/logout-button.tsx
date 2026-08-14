'use client';

import { useRouter } from 'next/navigation';

export function LogoutButton() {
  const router = useRouter();

  async function deconnecter() {
    await fetch('/api/session', { method: 'DELETE' });
    router.push('/login');
    router.refresh();
  }

  return (
    <button type="button" className="lien" onClick={deconnecter}>
      Déconnexion
    </button>
  );
}
