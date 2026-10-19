import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../../../lib/session';
import { AppHeader, type Me } from '../../../components/app-header';
import { PageHeader } from '../../../components/page-header';
import { date, nombre } from '../../../../lib/format';
import { ExtraireZones, ValiderZone } from './validation';

interface Zone {
  id: number;
  code: string;
  libelle: string | null;
  indice: string | null;
  hauteurMaxM: string | null;
  niveauxMax: number | null;
  distanceLimiteM: string | null;
  degreSensibilite: string | null;
  placesParLogement: string | null;
  conditions: string | null;
  extrait: string | null;
  ancrage: string;
  valideLe: string | null;
}

interface Reglement {
  id: number;
  titre: string;
  version: string | null;
  url: string | null;
  nomFichier: string | null;
  methodeLecture: string | null;
  luLe: string | null;
  erreur: string | null;
  longueurTexte: number;
  commune: { nom: string; canton: string };
  zones: Zone[];
}

/**
 * Un règlement et ses zones — l'écran où l'on **valide**.
 *
 * Ce que le modèle a tiré du texte n'est qu'une proposition : un règlement
 * passé à l'OCR d'un photocopieur porte des fautes, et ses chiffres vivent
 * dans un tableau dont les colonnes se lisent mal. Chaque zone montre donc
 * d'où elle sort, et rien ne remonte sur une parcelle avant qu'un humain
 * ait dit oui.
 */
export default async function ReglementPage({
  params,
}: {
  params: Promise<{ reglementId: string }>;
}) {
  const { reglementId } = await params;
  const token = await getToken();
  if (!token) redirect('/login');
  if (!lirePayload(token)?.sid) redirect('/espaces');

  const me = await apiGet<Me>('/auth/me');
  if (!me) redirect('/login');

  const reglement = await apiGet<Reglement>(`/communes/reglements/${reglementId}`);
  if (!reglement) notFound();

  const validees = reglement.zones.filter((z) => z.valideLe !== null).length;

  return (
    <main>
      <AppHeader me={me} actif="communes" />

      <PageHeader
        titre={`${reglement.commune.nom} (${reglement.commune.canton})`}
        contexte={<Link href="/communes">Communes &amp; règlements</Link>}
      />

      <section>
        <h2>{reglement.titre}</h2>
        <p className="note">
          {reglement.version && <>Version {reglement.version}. </>}
          {reglement.luLe ? (
            <>
              Lu le {date(reglement.luLe)}, {nombre(String(reglement.longueurTexte))} caractères
              extraits —{' '}
              {reglement.methodeLecture === 'ocr'
                ? 'par OCR, donc avec des fautes possibles'
                : 'par la couche texte du PDF'}
              .
            </>
          ) : (
            <>Pas encore lu.</>
          )}{' '}
          {reglement.url && (
            <a href={reglement.url} target="_blank" rel="noopener noreferrer">
              voir la source<span aria-hidden="true"> ↗</span>
            </a>
          )}
        </p>

        {reglement.luLe && <ExtraireZones reglementId={reglement.id} relu={reglement.zones.length > 0} />}
      </section>

      {reglement.zones.length > 0 && (
        <section>
          <h2>
            Zones à bâtir — {validees} validée(s) sur {reglement.zones.length}
          </h2>
          <p className="note">
            Une zone validée alimente l&apos;écran Foncier des promotions de cette commune. Tant
            qu&apos;elle ne l&apos;est pas, elle s&apos;y affiche comme <strong>proposée</strong> et
            aucun indice n&apos;est repris. Vérifiez au moins la densité : c&apos;est elle qui
            commande la surface à bâtir, donc le prix qu&apos;on accepte de payer pour le terrain.
          </p>

          <div className="tableau-large">
            <table>
              <thead>
                <tr>
                  <th>Zone</th>
                  <th className="droite">Indice</th>
                  <th className="droite">Hauteur</th>
                  <th className="droite">Niveaux</th>
                  <th className="droite">Distance</th>
                  <th>Bruit</th>
                  <th>Conditions</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {reglement.zones.map((z) => (
                  <tr key={z.id} className={z.valideLe ? 'en-edition' : undefined}>
                    <td>
                      <code>{z.code}</code>
                      {z.libelle && (
                        <>
                          <br />
                          <span className="meta">{z.libelle}</span>
                        </>
                      )}
                    </td>
                    <td className="droite">
                      <strong>{z.indice ? nombre(z.indice) : '—'}</strong>
                    </td>
                    <td className="droite">{z.hauteurMaxM ? nombre(z.hauteurMaxM, 'm') : '—'}</td>
                    <td className="droite">{z.niveauxMax ?? '—'}</td>
                    <td className="droite">
                      {z.distanceLimiteM ? nombre(z.distanceLimiteM, 'm') : '—'}
                    </td>
                    <td>{z.degreSensibilite ?? '—'}</td>
                    <td>
                      {z.conditions ?? <span className="meta">—</span>}
                      {/* L'extrait est la seule façon de vérifier sans
                          rouvrir le PDF de 68 pages. */}
                      {z.extrait && (
                        <>
                          <br />
                          <span className="meta">« {z.extrait} »</span>
                        </>
                      )}
                    </td>
                    <td>
                      {z.valideLe ? (
                        <>
                          <span className="ok">validée</span>
                          <br />
                          <span className="meta">{date(z.valideLe)}</span>
                        </>
                      ) : (
                        <span className="meta">proposée</span>
                      )}
                      <div className="actions-cellule">
                        <ValiderZone zoneId={z.id} valide={z.valideLe !== null} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
