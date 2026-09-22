import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../../../../lib/session';
import { AppHeader, type Me } from '../../../../components/app-header';
import { PageHeader } from '../../../../components/page-header';
import { date, lisible, montant } from '../../../../../lib/format';
import { RafraichirPendantLecture } from '../capture';
import { ChangerStatut, EnregistrerPaiement, ValiderFacture } from '../saisie';
import { CorrigerFacture, LignesFacture, Relire, ViserFacture } from './controle';

interface Champ {
  valeur: string | number | null;
  ancrage: 'qr' | 'ancree' | 'proposee' | 'absente';
  extrait: string | null;
}

interface Detail {
  id: number;
  numero: string | null;
  type: string;
  statut: string;
  source: string;
  dateFacture: string | null;
  dateEcheance: string | null;
  montantHT: string | null;
  tvaPct: string | null;
  montantTVA: string | null;
  montantTTC: string | null;
  retenueGarantie: string | null;
  acomptesDeduits: string | null;
  iban: string | null;
  referenceQR: string | null;
  fichierNom: string | null;
  fichierCle: string | null;
  lectureMethode: string | null;
  lectureErreur: string | null;
  ocrConfiance: string | null;
  lecture: {
    modele: string;
    rapprochement?: string;
    champs: Record<string, Champ>;
    qr?: {
      montant: number | null;
      monnaie: string;
      debiteur: string | null;
      typeReference: string;
    } | null;
  } | null;
  controles: {
    constats: {
      code: string;
      gravite: 'info' | 'attention' | 'critique';
      titre: string;
      detail?: string;
    }[];
    resume: string[];
    chiffres: {
      avancementPct: string | null;
      aPayer?: string | null;
      aPayerSource?: 'bulletin' | 'facture' | null;
    };
  } | null;
  controleLe: string | null;
  entreprise: { id: number; nom: string } | null;
  contrat: { id: number; reference: string | null } | null;
  cfcNode: { code: string; libelle: string } | null;
  lignes: { id: number; designation: string; codeCfc: string | null; montant: string }[];
  visas: {
    id: number;
    etape: string;
    decision: string;
    par: string;
    commentaire: string | null;
    createdAt: string;
  }[];
  paiements: { id: number; montant: string }[];
  operation: { nom: string };
  directionTravaux: { membershipId: number; nom: string } | null;
}

interface NoeudBudget {
  id: number;
  code: string;
  libelle: string;
  enfants: NoeudBudget[];
}

const LIBELLES: [string, string][] = [
  ['fournisseur', 'Fournisseur'],
  ['ide', 'IDE'],
  ['numero', 'N° de facture'],
  ['dateFacture', 'Date'],
  ['dateEcheance', 'Échéance'],
  ['type', 'Type'],
  ['montantHT', 'Montant HT'],
  ['tvaPct', 'TVA %'],
  ['montantTVA', 'TVA'],
  ['montantTTC', 'Montant TTC'],
  ['retenueGarantie', 'Retenue de garantie'],
  ['acomptesDeduits', 'Acomptes déduits'],
  ['referenceContrat', 'Référence citée'],
  ['iban', 'IBAN'],
  ['referenceQR', 'Référence QR'],
];

const ANCRAGE: Record<string, string> = {
  qr: 'lu dans le bulletin QR',
  ancree: 'lu dans la facture',
  proposee: 'proposé — à vérifier',
  absente: 'absent',
};

const aplatir = (n: NoeudBudget[]): { id: number; code: string; libelle: string }[] =>
  n.flatMap((x) => [{ id: x.id, code: x.code, libelle: x.libelle }, ...aplatir(x.enfants)]);

/**
 * Le contrôle d'une facture : le rapport d'abord — ce qu'un promoteur veut
 * savoir en dix secondes —, puis ce qui a été lu et d'où, puis le circuit.
 */
export default async function FacturePage({
  params,
}: {
  params: Promise<{ operationId: string; factureId: string }>;
}) {
  const token = await getToken();
  if (!token) redirect('/login');
  if (!lirePayload(token)?.sid) redirect('/espaces');
  const { operationId, factureId } = await params;
  const me = await apiGet<Me>('/auth/me');
  if (!me) redirect('/login');

  const [f, contrats, budget] = await Promise.all([
    apiGet<Detail>(`/operations/${operationId}/factures/${factureId}`),
    apiGet<{ id: number; reference: string | null; entreprise: { nom: string } | null }[]>(
      `/operations/${operationId}/contrats`,
    ),
    apiGet<{ arbre: NoeudBudget[] }>(`/operations/${operationId}/budget`),
  ]);
  if (!f) notFound();

  const id = Number(operationId);
  const fid = Number(factureId);
  const ouverte = !['VALIDEE', 'PAYEE', 'REJETEE'].includes(f.statut);
  const suisDT = f.directionTravaux?.membershipId === me.membership?.id;
  const dernierVisaDT = [...f.visas].reverse().find((v) => v.etape === 'DIRECTION_TRAVAUX');
  const attenteDT = !!f.directionTravaux && dernierVisaDT?.decision !== 'APPROUVE';
  const critiques = (f.controles?.constats ?? [])
    .filter((c) => c.gravite === 'critique' && c.code !== 'depassement')
    .map((c) => c.titre);
  const role = me.membership?.role ?? '';
  const peutValider = ['OWNER', 'ADMIN', 'CHEF_PROJET', 'COMPTABILITE'].includes(role);

  return (
    <main className="large">
      <AppHeader me={me} actif="factures" operationId={id} />
      <RafraichirPendantLecture actif={f.statut === 'EN_LECTURE'} />
      <PageHeader
        titre={`Facture ${f.numero ?? `#${f.id}`}`}
        contexte={
          <Link href={`/operations/${operationId}/factures`}>{f.operation.nom} · factures</Link>
        }
      />

      <section>
        {f.statut === 'EN_LECTURE' ? (
          <p className="note">Lecture en cours — la page se met à jour d’elle-même.</p>
        ) : f.lectureErreur ? (
          <p className="note avertissement">
            {f.lectureErreur} <Relire operationId={id} factureId={fid} />
          </p>
        ) : null}
        {f.controles && (
          <>
            <h2>Rapport de contrôle</h2>
            <ul className="rapport-facture">
              {f.controles.resume.map((l, i) => {
                const k = f.controles!.constats.find((c) => c.titre === l);
                return (
                  <li key={i} className={k ? `constat ${k.gravite}` : ''}>
                    {k?.gravite === 'critique' ? '⛔ ' : k?.gravite === 'attention' ? '⚠️ ' : ''}
                    {l}
                  </li>
                );
              })}
            </ul>
            {f.controles.chiffres.aPayer && (
              <p>
                <strong>À payer :</strong> CHF{' '}
                {Number(f.controles.chiffres.aPayer)
                  .toFixed(2)
                  .replace(/\B(?=(\d{3})+(?!\d))/g, '’')}{' '}
                <span className="meta">
                  {f.controles.chiffres.aPayerSource === 'bulletin'
                    ? '— montant du bulletin QR'
                    : '— TTC de la facture, net de retenue et d’acomptes'}
                </span>
              </p>
            )}
            {f.controles.constats.some((c) => c.detail) && (
              <details>
                <summary>Le détail des constats</summary>
                {f.controles.constats
                  .filter((c) => c.detail)
                  .map((c, i) => (
                    <div key={i} className={`constat ${c.gravite}`}>
                      <strong>{c.titre}</strong>
                      <p className="meta">{c.detail}</p>
                    </div>
                  ))}
              </details>
            )}
            <p className="meta">
              Chiffres calculés par Prometis à partir des montants lus et des contrats — pas par
              l’IA. Contrôle du {date(f.controleLe)}
              {f.lecture?.rapprochement ? ` · rapprochement : ${f.lecture.rapprochement}` : ''}.
            </p>
          </>
        )}
      </section>

      <section>
        <h2>La facture</h2>
        <p>
          {f.entreprise?.nom ?? 'Fournisseur non identifié'}
          {f.contrat && ` · contrat ${f.contrat.reference ?? f.contrat.id}`}
          {f.cfcNode && ` · CFC ${f.cfcNode.code} ${f.cfcNode.libelle}`} · {lisible(f.type)} ·{' '}
          <span className="meta">
            reçue par{' '}
            {f.source === 'CAMERA'
              ? 'photo'
              : f.source === 'EMAIL'
                ? 'e-mail'
                : f.source === 'UPLOAD'
                  ? 'dépôt'
                  : 'saisie'}
          </span>
        </p>
        {f.fichierCle && (
          <p>
            <a
              href={`/api/prometis/operations/${operationId}/factures/${fid}/fichier`}
              download={f.fichierNom ?? undefined}
            >
              Ouvrir la pièce ({f.fichierNom})
            </a>
          </p>
        )}
        {f.lecture ? (
          <div className="tableau-large">
            <table>
              <thead>
                <tr>
                  <th>Champ</th>
                  <th>Lu</th>
                  <th>Retenu</th>
                  <th>Ancrage</th>
                </tr>
              </thead>
              <tbody>
                {LIBELLES.map(([cle, libelle]) => {
                  const c = f.lecture!.champs[cle];
                  const retenu = (f as unknown as Record<string, string | null>)[cle];
                  return (
                    <tr key={cle}>
                      <td>{libelle}</td>
                      <td>
                        {c?.valeur ?? '—'}
                        {c?.ancrage === 'proposee' && c.extrait && (
                          <>
                            <br />
                            <span className="meta">« {c.extrait} »</span>
                          </>
                        )}
                      </td>
                      <td>
                        {retenu === undefined
                          ? ''
                          : retenu === null
                            ? '—'
                            : /^\d{4}-\d{2}-\d{2}T/.test(String(retenu))
                              ? date(String(retenu))
                              : String(retenu)}
                      </td>
                      <td className={`ancrage-${c?.ancrage ?? 'absente'}`}>
                        {ANCRAGE[c?.ancrage ?? 'absente']}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {f.lecture.qr && (
              <p>
                <strong>Bulletin QR</strong> : {f.lecture.qr.monnaie}{' '}
                {f.lecture.qr.montant === null
                  ? 'montant laissé libre'
                  : `${f.lecture.qr.montant.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, '’')} à payer`}
                {f.lecture.qr.debiteur && ` · débiteur ${f.lecture.qr.debiteur}`}
              </p>
            )}
            <p className="meta">
              Lecture :{' '}
              {f.lectureMethode === 'qr'
                ? 'bulletin QR seul, le texte de la pièce n’a pas pu être lu'
                : f.lectureMethode === 'texte-pdf-partiel'
                  ? 'texte partiel du PDF, la reconnaissance de caractères n’est pas disponible'
                  : f.lectureMethode === 'texte-pdf+ocr'
                    ? 'texte du PDF et reconnaissance de caractères'
                    : f.lectureMethode === 'ocr'
                      ? 'reconnaissance de caractères'
                      : 'texte du PDF'}
              {f.lecture.modele === 'bulletin-qr'
                ? ''
                : f.lecture.modele === 'lecture-locale'
                  ? ', motifs locaux'
                  : ', IA Infomaniak (Suisse)'}
              {f.lecture.qr ? ', bulletin QR décodé' : ''}. « Lu dans le bulletin QR » : écrit par
              l’émetteur lui-même, fait foi. « Lu dans la facture » : la valeur figure telle quelle
              dans le document. « Proposé » : à vérifier.
            </p>
          </div>
        ) : (
          <p className="meta">Pas de lecture automatique : saisie manuelle.</p>
        )}
        {ouverte && (
          <CorrigerFacture
            operationId={id}
            factureId={fid}
            valeurs={{
              numero: f.numero,
              dateFacture: f.dateFacture,
              montantHT: f.montantHT,
              tvaPct: f.tvaPct,
              montantTTC: f.montantTTC,
              retenueGarantie: f.retenueGarantie,
              acomptesDeduits: f.acomptesDeduits,
              iban: f.iban,
              type: f.type,
              contratId: f.contrat?.id ?? null,
            }}
            contrats={(contrats ?? []).map((k) => ({
              id: k.id,
              libelle: `${k.entreprise?.nom ?? '—'}${k.reference ? ` — ${k.reference}` : ''}`,
            }))}
          />
        )}
      </section>

      <section>
        <h2>Lignes facturées</h2>
        {f.lignes.length === 0 ? (
          <p className="meta">Aucune ligne relevée.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Poste</th>
                <th>Désignation</th>
                <th className="droite">Montant</th>
              </tr>
            </thead>
            <tbody>
              {f.lignes.map((l) => (
                <tr key={l.id}>
                  <td>{l.codeCfc ?? '—'}</td>
                  <td>{l.designation}</td>
                  <td className="droite">{montant(l.montant)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {ouverte && (
          <LignesFacture
            operationId={id}
            factureId={fid}
            lignes={f.lignes.map((l) => ({
              designation: l.designation,
              codeCfc: l.codeCfc ?? '',
              montant: l.montant,
            }))}
          />
        )}
      </section>

      <section>
        <h2>Circuit de validation</h2>
        <ol className="circuit">
          {f.directionTravaux && (
            <li>
              <strong>Direction des travaux</strong> — {f.directionTravaux.nom} :{' '}
              {dernierVisaDT
                ? `${dernierVisaDT.decision === 'APPROUVE' ? 'visée' : 'refusée'} le ${date(dernierVisaDT.createdAt)}${dernierVisaDT.commentaire ? ` — « ${dernierVisaDT.commentaire} »` : ''}`
                : 'visa attendu'}
              {suisDT && ouverte && f.statut !== 'EN_LECTURE' && (
                <ViserFacture operationId={id} factureId={fid} />
              )}
            </li>
          )}
          <li>
            <strong>Promoteur</strong> —{' '}
            {['VALIDEE', 'PAYEE'].includes(f.statut)
              ? 'validée'
              : attenteDT
                ? 'attend le visa de la direction des travaux'
                : 'à valider'}
            {ouverte && !attenteDT && peutValider && f.statut !== 'EN_LECTURE' && (
              <ValiderFacture
                operationId={id}
                factureId={fid}
                postes={aplatir(budget?.arbre ?? [])}
                contrats={(contrats ?? []).map((k) => ({
                  id: k.id,
                  reference: k.reference,
                  entrepriseNom: k.entreprise?.nom ?? '—',
                }))}
                critiques={critiques}
              />
            )}
          </li>
          <li>
            <strong>Comptabilité</strong> —{' '}
            {f.statut === 'PAYEE'
              ? 'payée'
              : f.paiements.length
                ? 'paiement partiel'
                : 'paiement après validation'}
            {['VALIDEE', 'PAYEE'].includes(f.statut) && (
              <EnregistrerPaiement operationId={id} factureId={fid} suggestion={f.montantTTC} />
            )}
          </li>
        </ol>
        {f.visas.length > 0 && (
          <details>
            <summary>Historique des visas</summary>
            <ul>
              {f.visas.map((v) => (
                <li key={v.id}>
                  {date(v.createdAt)} ·{' '}
                  {v.etape === 'DIRECTION_TRAVAUX' ? 'direction des travaux' : 'promoteur'} ·{' '}
                  {v.decision === 'APPROUVE' ? 'favorable' : 'refus'} · {v.par}
                  {v.commentaire ? ` — « ${v.commentaire} »` : ''}
                </li>
              ))}
            </ul>
          </details>
        )}
        {f.statut !== 'PAYEE' && peutValider && <ChangerStatut operationId={id} factureId={fid} />}
      </section>
    </main>
  );
}
