import Link from 'next/link';
import { LogoutButton } from './logout-button';

export interface Me {
  compte: { compteId: number; email: string };
  workspace: { societeId: number; membershipId: number; role: string } | null;
  societe: {
    id: number;
    raisonSociale: string;
    profil: string;
    modulesActifs: string[];
    canton: string | null;
  } | null;
  membership: {
    id: number;
    role: string;
    fonction: string | null;
    acteur: { id: number; societeNom: string | null; type: string } | null;
  } | null;
  workspaces: { societeId: number; raisonSociale: string }[];
}

export function AppHeader({ me, actif }: { me: Me; actif: string }) {
  const estAdmin = me.membership?.role === 'OWNER' || me.membership?.role === 'ADMIN';
  // Un menu n'est affiché que si le module existe pour cette société. Ce
  // n'est pas la sécurité — l'API refuse de toute façon — mais un promoteur
  // et une entreprise générale ne doivent pas voir la même application.
  const moduleActif = (m: string) => me.societe?.modulesActifs.includes(m) ?? false;

  return (
    <header className="app-header">
      <div className="identite">
        <strong>{me.societe?.raisonSociale}</strong>
        <span className="meta">
          {me.compte.email} · {me.membership?.role.toLowerCase().replace('_', ' ')}
          {me.membership?.acteur?.societeNom ? ` (${me.membership.acteur.societeNom})` : ''}
        </span>
      </div>

      <nav>
        <Link href="/" className={actif === 'operations' ? 'actif' : ''}>
          Opérations
        </Link>
        {moduleActif('ACTEURS') && (
          <Link href="/acteurs" className={actif === 'acteurs' ? 'actif' : ''}>
            Acteurs
          </Link>
        )}
        {estAdmin && (
          <Link href="/droits-acces" className={actif === 'droits' ? 'actif' : ''}>
            Droits d&apos;accès
          </Link>
        )}
        {me.workspaces.length > 1 && <Link href="/espaces">Changer d&apos;espace</Link>}
        <LogoutButton />
      </nav>
    </header>
  );
}
