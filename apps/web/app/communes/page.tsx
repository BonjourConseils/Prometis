import { redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../lib/session';
import { AppHeader, type Me } from '../components/app-header';
import { PageHeader } from '../components/page-header';
import { date } from '../../lib/format';
import { AjouterCommune, AjouterReglement, LireReglement } from './saisie';

interface Reglement {
  id: number;
  titre: string;
  version: string | null;
  url: string | null;
  cleObjet: string | null;
  nomFichier: string | null;
  methodeLecture: string | null;
  luLe: string | null;
  erreur: string | null;
  _count: { zones: number };
}

interface Commune {
  id: number;
  nom: string;
  canton: string;
  reglements: Reglement[];
}

/**
 * Communes et règlements de construction — une **référence partagée**.
 *
 * Un RCCZ est public et identique pour tous les promoteurs qui bâtissent
 * dans la commune : il est donc enregistré une fois pour tout le monde, et
 * non par société. C'est la même logique que la trame CFC — ce qui est
 * commun à la branche ne se ressaisit pas client par client.
 *
 * Cet écran sert aux gestes rares : enregistrer un règlement, le relire
 * quand la commune en publie une nouvelle version, vérifier ce qui en a été
 * tiré. Le point d'usage, lui, est l'écran Foncier d'une promotion.
 */
export default async function CommunesPage() {
  const token = await getToken();
  if (!token) redirect('/login');
  if (!lirePayload(token)?.sid) redirect('/espaces');

  const me = await apiGet<Me>('/auth/me');
  if (!me) redirect('/login');

  const communes = (await apiGet<Commune[]>('/communes')) ?? [];

  return (
    <main>
      <AppHeader me={me} actif="communes" />

      <PageHeader titre="Communes & règlements" contexte={me.societe?.raisonSociale} />

      <section>
        <h2>Ce que la commune autorise</h2>
        <p className="note">
          Le règlement des constructions et des zones (RCCZ) dit la densité, les hauteurs, les
          distances et le degré de sensibilité au bruit de chaque zone. Enregistré ici, il sert à
          toutes les promotions de cette commune — et à toutes les sociétés : un règlement communal
          est un document public, le même pour tout le monde.
        </p>

        {communes.length === 0 ? (
          <p className="note">
            Aucune commune enregistrée. Ajoutez celle de votre terrain, puis son règlement.
          </p>
        ) : (
          <div className="tableau-large">
            <table>
              <thead>
                <tr>
                  <th>Commune</th>
                  <th>Règlement</th>
                  <th>Source</th>
                  <th>Lecture</th>
                  <th className="droite">Zones</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {communes.map((c) =>
                  c.reglements.length === 0 ? (
                    <tr key={c.id}>
                      <td>
                        <strong>{c.nom}</strong>
                        <br />
                        <span className="meta">{c.canton}</span>
                      </td>
                      <td colSpan={4}>
                        <span className="meta">Aucun règlement enregistré.</span>
                      </td>
                      <td>
                        <AjouterReglement communeId={c.id} nom={c.nom} />
                      </td>
                    </tr>
                  ) : (
                    c.reglements.map((r, i) => (
                      <tr key={r.id}>
                        {i === 0 && (
                          <td rowSpan={c.reglements.length}>
                            <strong>{c.nom}</strong>
                            <br />
                            <span className="meta">{c.canton}</span>
                            <div className="actions-cellule">
                              <AjouterReglement communeId={c.id} nom={c.nom} />
                            </div>
                          </td>
                        )}
                        <td>
                          {r.titre}
                          {r.version && (
                            <>
                              <br />
                              <span className="meta">version {r.version}</span>
                            </>
                          )}
                        </td>
                        <td>
                          {/* Lien et fichier ne s'excluent pas : un lien
                              communal meurt, le fichier déposé reste. */}
                          {r.url && (
                            <div>
                              <a href={r.url} target="_blank" rel="noopener noreferrer">
                                lien communal
                                <span aria-hidden="true"> ↗</span>
                              </a>
                            </div>
                          )}
                          {r.cleObjet && (
                            <span className="meta">{r.nomFichier ?? 'fichier déposé'}</span>
                          )}
                          {!r.url && !r.cleObjet && <span className="meta">—</span>}
                        </td>
                        <td>
                          {r.luLe ? (
                            <>
                              <span className="ok">lu</span> le {date(r.luLe)}
                              <br />
                              {/* Dire PAR QUELLE voie : un texte océrisé
                                  porte des fautes, et il faut pouvoir s'en
                                  souvenir en relisant une valeur douteuse. */}
                              <span className="meta">
                                {r.methodeLecture === 'ocr'
                                  ? 'océrisé (fautes possibles)'
                                  : r.methodeLecture === 'texte-pdf'
                                    ? 'couche texte du PDF'
                                    : (r.methodeLecture ?? '')}
                              </span>
                            </>
                          ) : r.erreur ? (
                            <>
                              <span className="ko">non lu</span>
                              <br />
                              <span className="meta">{r.erreur}</span>
                            </>
                          ) : (
                            <span className="meta">non lu</span>
                          )}
                        </td>
                        <td className="droite">
                          {r._count.zones > 0 ? r._count.zones : <span className="meta">—</span>}
                        </td>
                        <td>
                          <LireReglement reglementId={r.id} relu={r.luLe !== null} />
                        </td>
                      </tr>
                    ))
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}

        <AjouterCommune />
      </section>
    </main>
  );
}
