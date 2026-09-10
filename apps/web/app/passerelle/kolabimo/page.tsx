import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../../lib/session';
import { AppHeader, type Me } from '../../components/app-header';
import { PageHeader } from '../../components/page-header';

interface PromotionKolabimo {
  id: number;
  nom: string;
  statut: string | null;
  localisation: string | null;
  promoteur: { nom: string } | null;
  operation: { id: number; nom: string } | null;
}

/**
 * Les promotions que la clé Kolabimo de la société donne à lire.
 *
 * Le périmètre est celui que Kolabimo accorde à la clé — ses promotions et
 * ses co-promotions, rien d'autre. Prometis n'en ajoute ni n'en retire.
 */
export default async function PromotionsKolabimoPage() {
  const token = await getToken();
  if (!token) redirect('/login');
  if (!lirePayload(token)?.sid) redirect('/espaces');

  const me = await apiGet<Me>('/auth/me');
  if (!me) redirect('/login');

  const promotions = await apiGet<PromotionKolabimo[]>('/passerelle/kolabimo/promotions');

  return (
    <main>
      <AppHeader me={me} actif="passerelle" />
      <PageHeader
        titre="Promotions Kolabimo"
        contexte={<Link href="/passerelle">Passerelle</Link>}
      />

      <section>
        {promotions === null ? (
          <p className="ko">
            Kolabimo n&apos;a pas pu être lu : la clé n&apos;est pas saisie, ou Kolabimo ne répond
            pas. <Link href="/passerelle">Revenir à la connexion</Link>.
          </p>
        ) : promotions.length === 0 ? (
          <p>Votre clé ne donne accès à aucune promotion dans Kolabimo.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Promotion</th>
                <th>Lieu</th>
                <th>Statut Kolabimo</th>
                <th>Dans Prometis</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {promotions.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.nom}</strong>
                    <br />
                    <span className="meta">n° {p.id}</span>
                  </td>
                  <td>{p.localisation ?? '—'}</td>
                  <td>{p.statut?.toLowerCase().replaceAll('_', ' ') ?? '—'}</td>
                  <td>
                    {p.operation ? (
                      <Link href={`/operations/${p.operation.id}`}>{p.operation.nom}</Link>
                    ) : (
                      <span className="meta">non rattachée</span>
                    )}
                  </td>
                  <td>
                    <Link className="bouton" href={`/passerelle/kolabimo/${p.id}`}>
                      Lire
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
