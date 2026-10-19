import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../../../lib/session';
import { AppHeader, type Me } from '../../../components/app-header';
import { PageHeader } from '../../../components/page-header';
import { chf, date, nombre } from '../../../../lib/format';
import { AjouterParcelle, TableauParcelles } from './saisie';
import { enToutesLettres, sbp, type Parcelle } from '../../../../lib/foncier';

interface ZoneReglement {
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
  valideLe: string | null;
}

interface Parking {
  id: number;
  reference: string | null;
  type: string;
  prix: string | null;
}

interface Lot {
  id: number;
  reference: string;
  etage: number | null;
  nombrePieces: string | null;
  surfaceM2: string | null;
  quotePartPPE: string | null;
  prixVente: string | null;
  statut: string;
  parkings: Parking[];
}

interface Bien {
  id: number;
  nom: string;
  nature: string;
  nbEtages: number | null;
  description: string | null;
  lots: Lot[];
}

interface Operation {
  id: number;
  nom: string;
  canton: string | null;
  fraisNotaireTerrain: string | null;
  droitsMutation: string | null;
}

interface TauxAcquisition {
  id: number;
  canton: string;
  pourcentage: string;
}

/**
 * Lien vers un site tiers — géoportail, extrait RDPPF.
 *
 * Trois choses, et aucune n'est décorative :
 *
 *   · `target="_blank"` ouvre dans un nouvel onglet. On ne fait pas sortir un
 *     promoteur de sa saisie en cours pour consulter un plan ;
 *   · `rel="noopener noreferrer"` : sans `noopener`, la page ouverte garde
 *     une prise sur la nôtre via `window.opener` et peut la rediriger. Ces
 *     URL viennent d'une saisie libre, on ne leur fait pas confiance ;
 *   · le chevron ↗ annonce la sortie. Un lien qui change de contexte sans
 *     prévenir est un lien qui surprend.
 */
/**
 * Saisie du foncier : le terrain, ses parcelles et le bien qui s'y bâtit.
 *
 * Les lots et leurs places de parc appartiennent au plan de vente, pas au
 * foncier : ils se saisissent sous « Lots & acquéreurs ».
 *
 * C'est la première étape du parcours — sans lots, il n'y a ni recettes au
 * bilan, ni assiette pour les appels de fonds.
 */
export default async function FoncierPage({
  params,
}: {
  params: Promise<{ operationId: string }>;
}) {
  const token = await getToken();
  if (!token) redirect('/login');
  if (!lirePayload(token)?.sid) redirect('/espaces');

  const { operationId } = await params;
  const ongletActif = 'foncier';
  const id = Number(operationId);

  const me = await apiGet<Me>('/auth/me');
  if (!me) redirect('/login');

  const operation = await apiGet<Operation>(`/operations/${operationId}`);
  if (!operation) notFound();

  const [parcelles, biens, taux, referentielCommunes] = await Promise.all([
    apiGet<Parcelle[]>(`/operations/${operationId}/parcelles`),
    apiGet<Bien[]>(`/operations/${operationId}/biens`),
    // Sert uniquement à ESTIMER les frais quand ils ne sont pas connus.
    apiGet<TauxAcquisition[]>('/taux-acquisition'),
    // Le canton de la promotion est souvent vide : les parcelles, elles,
    // portent leur commune. Le référentiel des communes fait le lien.
    apiGet<
      {
        nom: string;
        canton: string;
        reglements: { id: number; titre: string; luLe: string | null; _count: { zones: number } }[];
      }[]
    >('/communes'),
  ]);

  if (parcelles === null || biens === null) {
    return (
      <main>
        <AppHeader me={me} actif={ongletActif} operationId={id} />
        <PageHeader titre="Foncier" contexte={operation.nom} />
        <section>
          <h2>Accès refusé</h2>
          <p className="note">
            Le module Foncier n&apos;est pas activé sur cette société, ou votre accès à la promotion
            ne le couvre pas.
          </p>
        </section>
      </main>
    );
  }

  // L'assiette foncière, agrégée depuis les parcelles. Le prix au m² et
  // l'indice moyen s'en déduisent : rien de tout cela n'est stocké.
  const surfaceTotale = parcelles.reduce((t, p) => t + Number(p.surfaceM2 ?? 0), 0);
  const prixTotal = parcelles.reduce((t, p) => t + Number(p.prixAchat ?? 0), 0);
  const sbpTotale = parcelles.reduce((t, p) => t + (sbp(p) ?? 0), 0);
  /**
   * Frais d'acquisition : le montant SAISI s'il existe, sinon une estimation
   * au taux du canton.
   *
   * L'estimation s'affiche précédée d'un « ≈ ». Un chiffre calculé qui se
   * présente comme un chiffre connu est la façon la plus sûre de faire
   * signer un bilan faux.
   */
  const fraisSaisis =
    Number(operation.fraisNotaireTerrain ?? 0) + Number(operation.droitsMutation ?? 0);
  // Le canton : celui de la promotion, sinon celui de la commune des
  // parcelles. Déduit, donc dit — jamais présenté comme une saisie.
  const sansAccents = (t: string) =>
    t
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  const communeDesParcelles = parcelles.map((p) => p.commune).filter(Boolean)[0] ?? null;
  const cantonDeduit = communeDesParcelles
    ? ((referentielCommunes ?? []).find(
        (c) => sansAccents(c.nom) === sansAccents(communeDesParcelles),
      )?.canton ?? null)
    : null;
  const canton = operation.canton ?? cantonDeduit;
  const cantonDeduitSeulement = !operation.canton && cantonDeduit !== null;

  // Le règlement de la commune des parcelles, s'il est enregistré.
  const ficheCommune = communeDesParcelles
    ? ((referentielCommunes ?? []).find(
        (c) => sansAccents(c.nom) === sansAccents(communeDesParcelles),
      ) ?? null)
    : null;
  const premier = ficheCommune?.reglements[0] ?? null;

  /**
   * Ce que le règlement dit de CHAQUE affectation présente sur le terrain.
   *
   * Une par affectation distincte, pas une par parcelle : deux parcelles en
   * R3 posent la même question et reçoivent la même réponse.
   */
  const affectations = [
    ...new Map(
      parcelles
        .filter((p) => p.commune && p.affectationZone)
        .map((p) => [`${p.commune}|${p.affectationZone}`, p]),
    ).values(),
  ];
  const zonesDuTerrain = (
    await Promise.all(
      affectations.map(async (p) => {
        const zone = await apiGet<ZoneReglement | null>(
          `/communes/zone?commune=${encodeURIComponent(p.commune!)}` +
            `&affectation=${encodeURIComponent(p.affectationZone!)}`,
        );
        return zone ? { affectation: p.affectationZone!, zone } : null;
      }),
    )
  ).filter((x): x is { affectation: string; zone: ZoneReglement } => x !== null);
  const reglementCommune = premier
    ? { titre: premier.titre, luLe: premier.luLe, zones: premier._count.zones }
    : null;

  const tauxDuCanton = (taux ?? []).find((t) => t.canton === canton);
  const estimation =
    fraisSaisis === 0 && tauxDuCanton && prixTotal > 0
      ? (prixTotal * Number(tauxDuCanton.pourcentage)) / 100
      : null;
  const fraisAcquisition = fraisSaisis > 0 ? fraisSaisis : (estimation ?? 0);
  const communes = [...new Set(parcelles.map((p) => p.commune).filter(Boolean))] as string[];

  /**
   * Le chiffre qui tranche : ce que coûte le terrain par mètre carré que
   * l'on pourra bâtir dessus, frais d'acquisition compris.
   *
   * Le prix au m² de TERRAIN ne dit rien — 663 CHF/m² est cher à 0.6 et bon
   * marché à 1.5. C'est ce coût-ci qui se compare au prix de vente au m²,
   * et qui dit en une ligne si l'affaire tient avant d'avoir rien dessiné.
   */
  /**
   * Le prix du terrain au m², et le même prix rapporté au m² constructible.
   *
   * **Sans les frais d'acquisition**, délibérément : ici on veut savoir ce
   * qu'on paie le terrain. Notaire et droits de mutation sont un poste de
   * coût comme un autre — ils arrivent en CFC 0 dans le budget estimatif,
   * puis au réel dans le Budget CFC. Les mêler au prix du sol rendrait le
   * chiffre incomparable à une autre offre.
   */
  const prixParM2Terrain = surfaceTotale > 0 ? prixTotal / surfaceTotale : null;
  const prixParM2Batir = sbpTotale > 0 ? prixTotal / sbpTotale : null;

  return (
    <main>
      <AppHeader me={me} actif={ongletActif} operationId={id} />

      <PageHeader
        titre="Foncier"
        contexte={<Link href={`/operations/${operationId}`}>{operation.nom}</Link>}
      />

      <div className="fil-ariane">
        <Link href="/">Promotions</Link> <span aria-hidden="true">›</span>{' '}
        <Link href={`/operations/${operationId}`}>{operation.nom}</Link>{' '}
        <span aria-hidden="true">›</span> Foncier
      </div>

      {/* L'assiette foncière : ce qui rend l'opération possible. Les lots,
          les recettes et les millièmes appartiennent à la commercialisation,
          pas au terrain — ils se lisent sur « Lots & acquéreurs ». */}
      <div className="kpis degrade">
        <div className="kpi">
          <span className="etiquette">Parcelles</span>
          <span className="valeur">{parcelles.length}</span>
          <span className="precision">
            {communes.length > 0 ? communes.join(', ') : 'commune non renseignée'}
          </span>
        </div>
        <div className="kpi">
          <span className="etiquette">Surface du terrain</span>
          <span className="valeur">{nombre(surfaceTotale, 'm²')}</span>
          <span className="precision">
            {parcelles.length > 1 ? `${parcelles.length} parcelles réunies` : 'assiette du projet'}
          </span>
        </div>
        <div className="kpi">
          <span className="etiquette">Surface de plancher à bâtir</span>
          <span className="valeur">{sbpTotale > 0 ? nombre(sbpTotale, 'm²') : '—'}</span>
          <span className="precision">
            {sbpTotale > 0 && surfaceTotale > 0
              ? `indice moyen ${(sbpTotale / surfaceTotale).toFixed(2)}`
              : 'saisir l’IBUS des parcelles'}
          </span>
        </div>
        <div className="kpi">
          <span className="etiquette">Prix du terrain</span>
          <span className="valeur">{chf(String(prixTotal))}</span>
          <span className="precision">
            {prixTotal > 0 && surfaceTotale > 0
              ? `${nombre((prixTotal / surfaceTotale).toFixed(2), 'CHF/m²')}`
              : 'prix non renseigné'}
          </span>
        </div>
        <div className="kpi">
          <span className="etiquette">Frais d&apos;acquisition</span>
          <span className="valeur">
            {estimation !== null && <span aria-label="environ">≈ </span>}
            {chf(String(fraisAcquisition))}
          </span>
          <span className="precision">
            {estimation !== null
              ? `Estimation sur la base de ${nombre(tauxDuCanton!.pourcentage)} % de frais ` +
                `d’acquisition en ${enToutesLettres(canton)}` +
                (cantonDeduitSeulement
                  ? ` — canton déduit de la commune de ${communeDesParcelles}`
                  : ' (canton de la promotion)')
              : fraisSaisis > 0
                ? 'notaire et droits de mutation'
                : canton
                  ? `aucun frais saisi, aucun taux défini pour ${enToutesLettres(canton)}`
                  : 'aucun frais saisi — la promotion n’a pas de canton'}
          </span>
        </div>
        {/* Le gros chiffre est celui qu'on PAIE pour le sol. Dessous, le
            même prix rapporté au plancher constructible : c'est lui qui se
            compare au prix de vente au m², et leur rapport est l'indice.
            Aucun des deux ne porte les frais d'acquisition. */}
        <div className="kpi">
          <span className="etiquette">Terrain au m&sup2;</span>
          <span className="valeur">
            {prixParM2Terrain !== null ? chf(prixParM2Terrain.toFixed(2)) : '—'}
          </span>
          <span className="precision">
            {prixParM2Terrain === null
              ? 'saisir la surface des parcelles'
              : prixParM2Batir !== null
                ? `${nombre(prixParM2Batir.toFixed(2), 'CHF/m²')} par m² à bâtir · hors frais`
                : 'saisir l’indice pour le prix du m² à bâtir'}
          </span>
        </div>
      </div>

      <section>
        <h2>Parcelles</h2>
        {parcelles.length === 0 ? (
          <p className="note">
            Aucune parcelle. Elles portent les extraits du registre foncier et les plans cadastraux.
          </p>
        ) : (
          <TableauParcelles operationId={id} parcelles={parcelles} />
        )}
        <AjouterParcelle operationId={id} />
      </section>

      {/* Ce que la commune autorise sur CE terrain.
          
          Sa place est ici et nulle part ailleurs : au moment du foncier, on
          ne sait pas encore ce qu'on bâtira — on sait ce qu'on a le DROIT de
          bâtir, et c'est précisément ce qui décide d'acheter ou non. */}
      <section>
        <h2>Ce que le règlement autorise</h2>
        {reglementCommune === null ? (
          <p className="note">
            {communeDesParcelles
              ? `Le règlement des constructions de ${communeDesParcelles} n’est pas encore enregistré.`
              : 'Saisissez la commune de vos parcelles pour retrouver son règlement.'}{' '}
            Il donne la densité, les hauteurs, les distances aux limites et le degré de sensibilité
            au bruit de chaque zone — les chiffres qui disent ce que le terrain porte.{' '}
            <Link href="/communes">Enregistrer un règlement</Link>.
          </p>
        ) : reglementCommune.luLe === null ? (
          <p className="note">
            <strong>{reglementCommune.titre}</strong> est enregistré pour {communeDesParcelles},
            mais pas encore lu. <Link href="/communes">Le lire</Link> pour en tirer les zones et
            leurs paramètres.
          </p>
        ) : zonesDuTerrain.length === 0 ? (
          <p className="note">
            <strong>{reglementCommune.titre}</strong> — lu le {date(reglementCommune.luLe)}.{' '}
            {reglementCommune.zones === 0
              ? 'Aucune zone n’en a encore été tirée.'
              : `Aucune de ses ${reglementCommune.zones} zones ne correspond à l’affectation saisie sur vos parcelles.`}{' '}
            <Link href="/communes">Voir le règlement</Link>.
          </p>
        ) : (
          <>
            {zonesDuTerrain.map(({ affectation, zone }) => (
              <div key={zone.id}>
                <h3>
                  {affectation} — <code>{zone.code}</code>{' '}
                  {zone.libelle && <span className="meta">{zone.libelle}</span>}
                </h3>
                <dl className="recapitulatif">
                  <div>
                    <dt>Indice d&apos;utilisation</dt>
                    <dd>
                      <strong>{zone.indice ? nombre(zone.indice) : '—'}</strong>
                    </dd>
                  </div>
                  <div>
                    <dt>Hauteur maximale</dt>
                    <dd>{zone.hauteurMaxM ? nombre(zone.hauteurMaxM, 'm') : '—'}</dd>
                  </div>
                  <div>
                    <dt>Niveaux</dt>
                    <dd>{zone.niveauxMax ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Distance à la limite</dt>
                    <dd>{zone.distanceLimiteM ? nombre(zone.distanceLimiteM, 'm') : '—'}</dd>
                  </div>
                  <div>
                    <dt>Sensibilité au bruit</dt>
                    <dd>{zone.degreSensibilite ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Places par logement</dt>
                    <dd>{zone.placesParLogement ? nombre(zone.placesParLogement) : '—'}</dd>
                  </div>
                </dl>
                {/* Les conditions, c'est ce qui empêche de prendre un indice
                    pour un acquis : « 0.8 avec plan d'affectation spécial »
                    n'est pas la même chose que 0.8. */}
                {zone.conditions && <p className="note">{zone.conditions}</p>}
                <p className="note">
                  {zone.valideLe ? (
                    <>
                      <span className="ok">Validé</span> le {date(zone.valideLe)}.
                    </>
                  ) : (
                    <>
                      <span className="ko">Proposé</span> d’après le règlement lu le{' '}
                      {date(reglementCommune.luLe)} — <strong>à vérifier</strong> avant d’en tirer
                      une surface à bâtir.
                    </>
                  )}{' '}
                  <Link href="/communes">Voir le règlement</Link>.
                </p>
              </div>
            ))}
          </>
        )}
      </section>
    </main>
  );
}
