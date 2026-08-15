import { redirect } from 'next/navigation';
import { apiGet, getToken } from '../../lib/session';
import { AppHeader, type Me } from '../components/app-header';
import { MfaForm } from './mfa-form';

interface EtatMfa {
  actif: boolean;
  enrolementEnCours: boolean;
  codesSecoursRestants: number;
  activeDepuis: string | null;
}

/**
 * Sécurité du compte.
 *
 * Accessible avec le seul jeton d'identité, sans espace de travail choisi :
 * le second facteur porte sur la personne, pas sur la société.
 */
export default async function SecuritePage() {
  const token = await getToken();
  if (!token) redirect('/login');

  const me = await apiGet<Me>('/auth/me');
  if (!me) redirect('/login');

  const etat = await apiGet<EtatMfa>('/auth/mfa');
  if (!etat) redirect('/login');

  return (
    <main>
      {me.societe ? (
        <AppHeader me={me} actif="securite" />
      ) : (
        <header className="app-header">
          <div className="identite">
            <strong>{me.compte.email}</strong>
          </div>
        </header>
      )}

      <section>
        <h2>Sécurité du compte</h2>
        <p className="note">
          {me.compte.email} — ces réglages suivent la personne, pas la société. Ils
          s&apos;appliquent à tous vos espaces de travail.
        </p>
      </section>

      <MfaForm
        etat={{
          actif: etat.actif,
          enrolementEnCours: etat.enrolementEnCours,
          codesSecoursRestants: etat.codesSecoursRestants,
        }}
      />
    </main>
  );
}
