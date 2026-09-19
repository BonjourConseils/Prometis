import type { Metadata } from 'next';
import { API } from '../../../lib/session';
import { entetesRelais } from '../../../lib/relais';
import { date } from '../../../lib/format';
import { Accepter } from './accepter';

/** L'adresse porte le lien personnel : ni indexée, ni transmise en « referer ». */
export const metadata: Metadata = {
  title: 'Invitation — Prometis',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

interface Invitation {
  societe: string;
  email: string;
  prenom: string | null;
  nom: string | null;
  titre: string;
  societeNom: string | null;
  operations: string[];
  directionTravaux: boolean;
  compteExistant: boolean;
  expireLe: string;
}

export default async function InvitationPage({ params }: { params: Promise<{ jeton: string }> }) {
  const { jeton } = await params;
  let inv: Invitation | null = null;
  if (/^[A-Za-z0-9_-]{40,64}$/.test(jeton)) {
    const res = await fetch(`${API}/invitations/${jeton}`, {
      headers: await entetesRelais(),
      cache: 'no-store',
    });
    if (res.ok) inv = (await res.json()) as Invitation;
  }

  return (
    <main className="espace-entreprise">
      <header className="espace-entete">
        <strong>Prometis</strong> · invitation
      </header>
      {!inv ? (
        <section>
          <h1>Invitation non valable</h1>
          <p>
            Ce lien a expiré, a déjà servi ou a été retiré. Demandez une nouvelle invitation à la
            personne qui vous l’a envoyée.
          </p>
        </section>
      ) : (
        <section>
          <h1>{inv.societe} vous invite</h1>
          <p>
            En tant que <strong>{inv.titre}</strong>
            {inv.societeNom ? ` (${inv.societeNom})` : ''}.
          </p>
          {inv.operations.length > 0 && (
            <p>
              Promotions ouvertes : {inv.operations.join(', ')}.
              {inv.directionTravaux && (
                <>
                  {' '}
                  Vous y êtes nommé·e <strong>direction des travaux</strong> : vous viserez les
                  factures avant l’approbation du promoteur.
                </>
              )}
            </p>
          )}
          <p className="meta">
            Pour {inv.email} · valable jusqu’au {date(inv.expireLe)}.
          </p>
          <Accepter
            jeton={jeton}
            compteExistant={inv.compteExistant}
            prenom={inv.prenom}
            nom={inv.nom}
          />
        </section>
      )}
    </main>
  );
}
