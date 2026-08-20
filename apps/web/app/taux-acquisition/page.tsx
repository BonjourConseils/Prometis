import { redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../lib/session';
import { AppHeader, type Me } from '../components/app-header';
import { PageHeader } from '../components/page-header';
import { date, nombre } from '../../lib/format';
import { DefinirTaux, SupprimerTaux } from './saisie';

interface Taux {
  id: number;
  canton: string;
  pourcentage: string;
  note: string | null;
  updatedAt: string;
}

/**
 * Taux de frais d'acquisition par canton.
 *
 * Aucun barème n'est livré par défaut, et c'est délibéré : notaire, registre
 * foncier et droits de mutation varient d'un canton à l'autre et d'une étude
 * à l'autre. Un chiffre inventé ici se retrouverait dans un bilan promoteur
 * sans que personne ne sache d'où il vient.
 */
export default async function TauxAcquisitionPage() {
  const token = await getToken();
  if (!token) redirect('/login');
  if (!lirePayload(token)?.sid) redirect('/espaces');

  const me = await apiGet<Me>('/auth/me');
  if (!me) redirect('/login');

  const taux = await apiGet<Taux[]>('/taux-acquisition');
  const estAdmin = me.membership?.role === 'OWNER' || me.membership?.role === 'ADMIN';

  return (
    <main>
      <AppHeader me={me} actif="taux" />

      <PageHeader titre="Frais d'acquisition" contexte={me.societe?.raisonSociale} />

      <section>
        <h2>Taux par canton</h2>
        <p className="note">
          Ces taux <strong>estiment</strong> les frais d&apos;acquisition d&apos;un terrain —
          notaire, registre foncier, droits de mutation — tant que les montants réels ne sont pas
          saisis sur la promotion. L&apos;écran Foncier les affiche alors précédés d&apos;un « ≈ ».
          Dès qu&apos;un montant est saisi, l&apos;estimation s&apos;efface.
        </p>

        {taux === null ? (
          <p className="ko">Lecture impossible.</p>
        ) : taux.length === 0 ? (
          <p className="note">
            Aucun taux défini. Aucun barème n&apos;est fourni par défaut : les pratiques varient
            d&apos;un canton et d&apos;une étude à l&apos;autre, et un chiffre inventé finirait dans
            un bilan.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Canton</th>
                <th className="droite">Taux</th>
                <th>Note</th>
                <th>Modifié le</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {taux.map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>{t.canton}</strong>
                  </td>
                  <td className="droite">{nombre(t.pourcentage)} %</td>
                  <td>{t.note ?? <span className="meta">—</span>}</td>
                  <td>{date(t.updatedAt)}</td>
                  <td>{estAdmin && <SupprimerTaux id={t.id} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {estAdmin ? (
          <DefinirTaux existants={(taux ?? []).map((t) => t.canton)} />
        ) : (
          <p className="note">Seule l&apos;administration de la société modifie ces taux.</p>
        )}
      </section>
    </main>
  );
}
