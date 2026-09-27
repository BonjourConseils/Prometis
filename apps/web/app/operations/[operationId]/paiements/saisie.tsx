'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useEnvoi } from '../../../components/formulaire';

const chf = (v: string | number | null | undefined) => {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return Number.isFinite(n) ? `CHF ${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, '’')}` : '—';
};

/** Le compte d'où partent les paiements : le crédit de construction. */
export function CompteDePromotion({
  operationId,
  iban,
  bic,
}: {
  operationId: number;
  iban: string | null;
  bic: string | null;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();
  const [ouvert, setOuvert] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const ok = await envoyer(
      `/operations/${operationId}/ordres-paiement/compte`,
      {
        iban: String(d.get('iban') ?? '').trim() || null,
        bic: String(d.get('bic') ?? '').trim() || null,
      },
      'PUT',
    );
    if (ok) setOuvert(false);
  }

  if (!ouvert) {
    return (
      <p>
        Compte de la promotion : <strong>{iban ?? 'non renseigné'}</strong>
        {bic ? ` · ${bic}` : ''}{' '}
        <button type="button" className="lien" onClick={() => setOuvert(true)}>
          {iban ? 'Changer' : 'Renseigner'}
        </button>
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <p className="note">
        C&apos;est de ce compte que partiront les paiements aux entreprises — en principe le crédit
        de construction de la promotion. Le BIC ne sert que si votre banque l&apos;exige dans le
        fichier.
      </p>
      <div className="grille-3">
        <label>
          IBAN
          <input name="iban" defaultValue={iban ?? ''} placeholder="CH93 0076 2011 6238 5295 7" />
        </label>
        <label>
          BIC (facultatif)
          <input name="bic" defaultValue={bic ?? ''} placeholder="POFICHBEXXX" />
        </label>
      </div>
      {erreur && <p className="ko">{erreur}</p>}
      <div className="actions">
        <button type="submit" disabled={enCours}>
          {enCours ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        <button type="button" className="secondaire" onClick={() => setOuvert(false)}>
          Annuler
        </button>
      </div>
    </form>
  );
}

export interface APayer {
  id: number;
  numero: string | null;
  type: string;
  dateFacture: string | null;
  dateEcheance: string | null;
  entreprise: { id: number; nom: string } | null;
  montant: string;
  iban: string | null;
  reference: string | null;
  manque: string[];
}

/**
 * Composer un ordre : on coche les factures à régler ensemble, comme sur le
 * bordereau papier. Ce qui manque pour payer est dit avant, pas au moment du
 * téléchargement.
 */
export function ComposerOrdre({
  operationId,
  factures,
  compteRenseigne,
}: {
  operationId: number;
  factures: APayer[];
  compteRenseigne: boolean;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();
  const payables = factures.filter((f) => f.manque.length === 0);
  const [choisies, setChoisies] = useState<number[]>(payables.map((f) => f.id));

  const total = factures
    .filter((f) => choisies.includes(f.id))
    .reduce((t, f) => t + Number(f.montant), 0);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    await envoyer(`/operations/${operationId}/ordres-paiement`, {
      factureIds: choisies,
      libelle: String(d.get('libelle') ?? '').trim() || null,
      dateExecution: d.get('dateExecution'),
    });
  }

  if (!factures.length) {
    return <p className="meta">Aucune facture validée n’attend d’être payée.</p>;
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <div className="tableau-large">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Facture</th>
              <th>Entreprise</th>
              <th>Échéance</th>
              <th className="nombre">À payer</th>
              <th>Paiement</th>
            </tr>
          </thead>
          <tbody>
            {factures.map((f) => (
              <tr key={f.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={choisies.includes(f.id)}
                    disabled={f.manque.length > 0}
                    onChange={(e) =>
                      setChoisies((c) =>
                        e.target.checked ? [...c, f.id] : c.filter((x) => x !== f.id),
                      )
                    }
                    aria-label={`Payer la facture ${f.numero ?? f.id}`}
                  />
                </td>
                <td>
                  <Link href={`/operations/${operationId}/factures/${f.id}`}>
                    {f.numero ?? `#${f.id}`}
                  </Link>
                </td>
                <td>{f.entreprise?.nom ?? '—'}</td>
                <td>{f.dateEcheance ? f.dateEcheance.slice(0, 10) : '—'}</td>
                <td className="nombre">{chf(f.montant)}</td>
                <td className="meta">
                  {f.manque.length
                    ? `manque : ${f.manque.join(', ')}`
                    : f.reference
                      ? 'QR-facture'
                      : 'communication libre'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grille-3">
        <label>
          Libellé
          <input name="libelle" placeholder={`Ordre de paiement n° ${factures.length}`} />
        </label>
        <label>
          Date d’exécution
          <input
            name="dateExecution"
            type="date"
            required
            defaultValue={new Date().toISOString().slice(0, 10)}
          />
        </label>
      </div>
      <p>
        <strong>{choisies.length}</strong> facture{choisies.length > 1 ? 's' : ''} ·{' '}
        <strong>{chf(total)}</strong>
      </p>
      {!compteRenseigne && (
        <p className="ko">
          Renseignez d’abord le compte de la promotion : sans lui, aucun ordre ne peut partir.
        </p>
      )}
      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" disabled={enCours || !choisies.length || !compteRenseigne}>
        {enCours ? 'Composition…' : 'Composer l’ordre'}
      </button>
    </form>
  );
}

/** Le visa du promoteur : c'est lui qui autorise la sortie d'argent. */
export function ViserOrdre({
  operationId,
  ordreId,
  total,
  nombre,
}: {
  operationId: number;
  ordreId: number;
  total: string;
  nombre: number;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();
  const [confirme, setConfirme] = useState(false);

  if (!confirme) {
    return (
      <>
        <button type="button" onClick={() => setConfirme(true)}>
          Viser l’ordre
        </button>
        {erreur && <p className="ko">{erreur}</p>}
      </>
    );
  }

  return (
    <div className="note">
      <p>
        Vous autorisez le paiement de <strong>{nombre}</strong> facture{nombre > 1 ? 's' : ''} pour{' '}
        <strong>{chf(total)}</strong>. Le fichier pourra ensuite être remis à la banque.
      </p>
      {erreur && <p className="ko">{erreur}</p>}
      <button
        type="button"
        disabled={enCours}
        onClick={() => envoyer(`/operations/${operationId}/ordres-paiement/${ordreId}/visa`)}
      >
        {enCours ? 'Visa…' : `Confirmer et viser ${chf(total)}`}
      </button>{' '}
      <button type="button" className="secondaire" onClick={() => setConfirme(false)}>
        Annuler
      </button>
    </div>
  );
}

export function AnnulerOrdre({ operationId, ordreId }: { operationId: number; ordreId: number }) {
  const { envoyer, erreur, enCours } = useEnvoi();
  return (
    <>
      <button
        type="button"
        className="secondaire"
        disabled={enCours}
        onClick={() => envoyer(`/operations/${operationId}/ordres-paiement/${ordreId}/annulation`)}
      >
        {enCours ? '…' : 'Annuler l’ordre'}
      </button>
      {erreur && <p className="ko">{erreur}</p>}
    </>
  );
}
