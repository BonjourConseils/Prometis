import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../lib/session';
import { AppHeader, type Me } from '../components/app-header';
import { PageHeader } from '../components/page-header';

interface Ligne {
  usage: string;
  etage: 'LOCAL' | 'PUISSANT' | 'RECHERCHE';
  fournisseur: string;
  modele: string;
  appels: number;
  echecs: number;
  devise: string;
  coutTotal: string;
  creditsTotal: number;
  jetonsEntree: number;
  jetonsSortie: number;
  dureeMoyenneMs: number;
}

interface Usage {
  jours: number;
  appels: number;
  echecs: number;
  credits: number;
  chfParCredit: number;
  tauxUsdChf: number;
  totaux: { devise: string; appels: number; cout: string; equivalentChf: string }[];
  lignes: Ligne[];
}

const ETAGE: Record<Ligne['etage'], string> = {
  LOCAL: 'notre serveur',
  PUISSANT: 'Infomaniak (Suisse)',
  RECHERCHE: 'Perplexity (États-Unis)',
};

const argent = (v: string, devise: string) =>
  `${devise} ${Number(v)
    .toFixed(4)
    .replace(/\B(?=(\d{3})+(?!\d))/g, '’')}`;

/**
 * Ce que l'IA coûte — par opération et par modèle.
 *
 * À quoi ça sert : fixer la valeur d'un crédit, repérer l'opération la plus
 * chère, voir l'effet d'un changement de modèle, et décider si une opération
 * peut descendre sur notre propre serveur.
 */
export default async function UsageIaPage({
  searchParams,
}: {
  searchParams: Promise<{ jours?: string }>;
}) {
  const token = await getToken();
  if (!token) redirect('/login');
  if (!lirePayload(token)?.sid) redirect('/espaces');

  const me = await apiGet<Me>('/auth/me');
  if (!me) redirect('/login');

  const { jours } = await searchParams;
  const periode = [7, 30, 90].includes(Number(jours)) ? Number(jours) : 30;
  const usage = await apiGet<Usage>(`/usage-ia?jours=${periode}`);

  if (!usage) {
    return (
      <main>
        <AppHeader me={me} actif="usage-ia" />
        <section>
          <h2>Usage de l’IA</h2>
          <p>Réservé à l’administration de la société.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="large">
      <AppHeader me={me} actif="usage-ia" />
      <PageHeader titre="Usage de l’IA" />

      <section>
        <p>
          {[7, 30, 90].map((j) => (
            <span key={j}>
              {j === periode ? (
                <strong>{j} jours</strong>
              ) : (
                <Link href={`/usage-ia?jours=${j}`}>{j} jours</Link>
              )}{' '}
            </span>
          ))}
        </p>
        <div className="grille-3">
          <div className="kpi">
            <span className="etiquette">Appels</span>
            <span className="valeur">{usage.appels}</span>
            <span className="meta">{usage.echecs} en échec</span>
          </div>
          {usage.totaux.map((t) => (
            <div key={t.devise} className="carte-chiffre">
              <span className="etiquette">Coût {t.devise}</span>
              <span className="valeur">{argent(t.cout, t.devise)}</span>
              <span className="meta">
                {t.devise === 'CHF'
                  ? `${t.appels} appels`
                  : `≈ CHF ${t.equivalentChf} au taux de ${usage.tauxUsdChf}`}
              </span>
            </div>
          ))}
          <div className="kpi">
            <span className="etiquette">Crédits</span>
            <span className="valeur">{usage.credits}</span>
            <span className="meta">1 crédit = CHF {usage.chfParCredit}</span>
          </div>
        </div>
        <p className="meta">
          Les devises ne s’additionnent pas : Infomaniak facture en francs, Perplexity en dollars —
          et, chez lui, un forfait par requête s’ajoute aux jetons. Les moyennes ne portent que sur
          les appels réussis.
        </p>
      </section>

      <section>
        <h2>Par opération</h2>
        {usage.lignes.length === 0 ? (
          <p className="meta">Aucun appel sur la période.</p>
        ) : (
          <div className="tableau-large">
            <table>
              <thead>
                <tr>
                  <th>Opération</th>
                  <th>Où</th>
                  <th>Modèle</th>
                  <th className="nombre">Appels</th>
                  <th className="nombre">Échecs</th>
                  <th className="nombre">Jetons ↓ / ↑</th>
                  <th className="nombre">Durée</th>
                  <th className="nombre">Crédits</th>
                  <th className="nombre">Coût</th>
                </tr>
              </thead>
              <tbody>
                {usage.lignes.map((l) => (
                  <tr key={`${l.usage}-${l.modele}`}>
                    <td>{l.usage}</td>
                    <td>{ETAGE[l.etage]}</td>
                    <td className="meta">{l.modele}</td>
                    <td className="nombre">{l.appels}</td>
                    <td className="nombre">{l.echecs || '—'}</td>
                    <td className="nombre">
                      {l.jetonsEntree} / {l.jetonsSortie}
                    </td>
                    <td className="nombre">{(l.dureeMoyenneMs / 1000).toFixed(1)} s</td>
                    <td className="nombre">{l.creditsTotal}</td>
                    <td className="nombre">{argent(l.coutTotal, l.devise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
