import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../../../lib/session';
import { AppHeader, type Me } from '../../../components/app-header';
import { PageHeader } from '../../../components/page-header';
import { chf } from '../../../../lib/format';
import { AjouterPosteEstimatif, SaisieEstimatif } from './saisie';
import { AdopterVersion, ImporterTrame } from '../budget/saisie';

interface Noeud {
  id: number;
  code: string;
  libelle: string;
  propre: { budgeteRevise: string };
  total: { budgeteRevise: string };
  enfants: Noeud[];
}

interface Version {
  id: number;
  libelle: string;
  statut: string;
  isCourant: boolean;
}

interface VueBudget {
  versions: Version[];
  versionAffichee: Version | null;
  arbre: Noeud[];
}

interface Operation {
  id: number;
  nom: string;
  recettesPrevisionnelles: string | null;
}

/**
 * Budget estimatif — l'étude de faisabilité.
 *
 * Le promoteur pose un chiffre par grand poste, un total de ventes attendu,
 * et lit son bénéfice. Rien d'autre : ni sous-postes, ni TVA, ni ventilation.
 *
 * **Ce n'est pas un modèle à part.** L'estimatif est une version de budget
 * comme les autres, dont les lignes visent les postes de premier niveau.
 * C'est ce qui rend la suite gratuite : quand les vraies soumissions
 * arrivent, on crée une révision, et l'écran Budget CFC compare poste par
 * poste ce qui était estimé et ce qui est chiffré. Un modèle « estimatif »
 * séparé aurait produit deux vérités qui divergent en silence.
 */
export default async function EstimatifPage({
  params,
}: {
  params: Promise<{ operationId: string }>;
}) {
  const token = await getToken();
  if (!token) redirect('/login');
  if (!lirePayload(token)?.sid) redirect('/espaces');

  const { operationId } = await params;
  const ongletActif = 'estimatif';
  const id = Number(operationId);

  const me = await apiGet<Me>('/auth/me');
  if (!me) redirect('/login');

  const [operation, vue] = await Promise.all([
    apiGet<Operation>(`/operations/${operationId}`),
    apiGet<VueBudget>(`/operations/${operationId}/budget`),
  ]);

  if (!operation) notFound();
  if (vue === null) {
    return (
      <main>
        <AppHeader me={me} actif={ongletActif} operationId={id} />
        <section>
          <h2>Budget estimatif</h2>
          <p>Votre accès à cette promotion ne couvre pas le budget.</p>
        </section>
      </main>
    );
  }

  /**
   * La maille de l'estimatif : les deux premiers niveaux, plus tout poste
   * plus profond qui porte déjà un montant.
   *
   * Deux niveaux parce que c'est la forme d'un bilan de faisabilité — des
   * grands postes, et sous « taxes » le détail des cédules et du permis.
   * Descendre plus bas donnerait soixante-neuf champs de saisie pour un
   * exercice qui en demande huit ; s'arrêter au premier niveau, comme le
   * faisait cet écran, rendait invisible tout poste rattaché à un parent.
   *
   * L'exception — garder ce qui est chiffré, quelle que soit la profondeur —
   * existe pour qu'un montant saisi ne disparaisse jamais de la vue où on
   * l'a saisi.
   *
   * Le montant proposé est celui du poste LUI-MÊME (`propre`), pas de ses
   * sous-postes : sinon la saisie écraserait un détail chiffré ailleurs, et
   * le total compterait deux fois.
   */
  const aplatirEstimatif = (
    noeuds: Noeud[],
    profondeur = 0,
  ): {
    id: number;
    code: string;
    libelle: string;
    montant: string;
    profondeur: number;
    supprimable: boolean;
  }[] =>
    noeuds.flatMap((n) => {
      const chiffre = Number(n.total.budgeteRevise) !== 0;
      const visible = profondeur < 2 || chiffre;
      const ligne = {
        id: n.id,
        code: n.code,
        libelle: n.libelle,
        montant: n.propre.budgeteRevise,
        profondeur,
        // Un poste vide et sans sous-poste. Les autres rattachements —
        // soumission, contrat, facture — restent contrôlés par l'API, qui
        // dira lequel bloque.
        supprimable: n.enfants.length === 0 && !chiffre,
      };
      const enfants = aplatirEstimatif(n.enfants, profondeur + 1);
      return visible ? [ligne, ...enfants] : enfants;
    });

  const postes = aplatirEstimatif(vue.arbre);

  return (
    <main>
      <AppHeader me={me} actif={ongletActif} operationId={id} />

      <PageHeader
        titre="Budget estimatif"
        contexte={<Link href={`/operations/${operationId}`}>{operation.nom}</Link>}
      />

      <div className="fil-ariane">
        <Link href="/">Promotions</Link> <span aria-hidden="true">›</span>{' '}
        <Link href={`/operations/${operationId}`}>{operation.nom}</Link>{' '}
        <span aria-hidden="true">›</span> Budget estimatif
      </div>

      {postes.length === 0 ? (
        <section>
          <h2>Aucun poste</h2>
          <p className="note">
            L&apos;estimatif se saisit sur les grands postes CFC. Importez la trame de départ : elle
            pose les groupes 0 à 5, largement suffisants pour une faisabilité.
          </p>
          <ImporterTrame operationId={id} />
        </section>
      ) : vue.versionAffichee === null ? (
        <section>
          <h2>Aucune version de budget</h2>
          <p className="note">
            Créez d&apos;abord une version — nommez-la « Estimatif » — depuis l&apos;écran{' '}
            <Link href={`/operations/${operationId}/budget`}>Budget CFC</Link>. L&apos;estimatif est
            une version de budget comme une autre : c&apos;est ce qui permettra de le comparer aux
            chiffres réels, plus tard, sans rien resaisir.
          </p>
        </section>
      ) : (
        <>
          <section>
            <h2>{vue.versionAffichee.libelle}</h2>
            <p className="note">
              Un montant par grand poste, <strong>hors taxe</strong>. Le total et le bénéfice se
              recalculent à mesure que vous tapez ; rien n&apos;est enregistré avant le bouton. Les
              deux premiers niveaux CFC sont proposés — pour descendre plus bas, passez par{' '}
              <Link href={`/operations/${operationId}/budget`}>Budget CFC</Link>.
            </p>

            <SaisieEstimatif
              operationId={id}
              versionId={vue.versionAffichee.id}
              postes={postes}
              recettesInitiales={operation.recettesPrevisionnelles ?? '0'}
            />
          </section>

          {/* Un estimatif en brouillon ne compte nulle part ailleurs : la
              fiche promotion afficherait des recettes sans coûts, donc une
              marge égale au chiffre d'affaires. Mieux vaut le dire ici que
              laisser lire un bénéfice faux sur un autre écran. */}
          {!vue.versionAffichee.isCourant && (
            <section>
              <h2>Adopter cet estimatif</h2>
              <p className="note">
                Cette version est en <strong>brouillon</strong> : elle ne compte pas encore dans le
                bilan promoteur, qui affichera donc vos recettes sans aucun coût en face. Adoptez-la
                pour que la fiche promotion dise la vérité — vous pourrez toujours créer une
                révision ensuite.
              </p>
              <div className="actions">
                <AdopterVersion operationId={id} versionId={vue.versionAffichee.id} />
              </div>
            </section>
          )}

          <section>
            <h2>Compléter la structure</h2>
            <p className="note">
              Un poste manque — cédules hypothécaires, contribution de remplacement, commission de
              vente ? Créez-le ici, il apparaîtra dans le tableau ci-dessus.
            </p>
            <AjouterPosteEstimatif
              operationId={id}
              parents={vue.arbre.map((n) => ({ id: n.id, code: n.code, libelle: n.libelle }))}
            />
          </section>

          <section>
            <h2>Et ensuite</h2>
            <p className="note">
              Quand les vraies soumissions arrivent, ne modifiez pas cet estimatif : créez une{' '}
              <strong>révision</strong> depuis l&apos;écran{' '}
              <Link href={`/operations/${operationId}/budget`}>Budget CFC</Link>. Les deux versions
              cohabitent, et la colonne « écart » vous dira poste par poste où vous vous étiez
              trompé — c&apos;est exactement ce que vous cherchez à mesurer.
            </p>
            {operation.recettesPrevisionnelles && (
              <p className="note">
                Le total des ventes saisi ici ({chf(operation.recettesPrevisionnelles)}) alimente le
                bilan promoteur <strong>tant qu&apos;aucun lot n&apos;est saisi</strong>. Dès le
                premier lot, ce sont les prix réels qui comptent.
              </p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
