'use client';

import { useState, type FormEvent } from 'react';
import { champ } from '../../../../../lib/api-client';
import { Repliable, useEnvoi } from '../../../../components/formulaire';

const base = (op: number, f: number) => `/operations/${op}/factures/${f}`;

/** Le visa de la direction des travaux : favorable, ou refus motivé. */
export function ViserFacture({
  operationId,
  factureId,
}: {
  operationId: number;
  factureId: number;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();
  const [refus, setRefus] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    await envoyer(`${base(operationId, factureId)}/visa-direction-travaux`, {
      decision: refus ? 'REFUSE' : 'APPROUVE',
      commentaire: champ(d.get('commentaire')) ?? null,
    });
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <label>
        {refus ? 'Ce qui ne va pas (obligatoire)' : 'Commentaire (facultatif)'}
        <input name="commentaire" required={refus} />
      </label>
      <label className="case">
        <input type="checkbox" checked={refus} onChange={(e) => setRefus(e.target.checked)} />{' '}
        Refuser cette facture
      </label>
      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" className={refus ? '' : 'principal'} disabled={enCours}>
        {refus ? 'Refuser — mise en litige' : 'Viser favorablement'}
      </button>
    </form>
  );
}

export function Relire({ operationId, factureId }: { operationId: number; factureId: number }) {
  const { envoyer, enCours } = useEnvoi();
  return (
    <button
      type="button"
      className="lien"
      disabled={enCours}
      onClick={() => envoyer(`${base(operationId, factureId)}/relire`)}
    >
      Relancer la lecture
    </button>
  );
}

interface Valeurs {
  numero: string | null;
  dateFacture: string | null;
  montantHT: string | null;
  tvaPct: string | null;
  montantTTC: string | null;
  retenueGarantie: string | null;
  acomptesDeduits: string | null;
  iban: string | null;
  type: string;
  contratId: number | null;
}

/** Corriger ce qui a été lu. Le contrôle se relance à l'enregistrement. */
export function CorrigerFacture({
  operationId,
  factureId,
  valeurs,
  contrats,
}: {
  operationId: number;
  factureId: number;
  valeurs: Valeurs;
  contrats: { id: number; libelle: string }[];
}) {
  const { envoyer, erreur, enCours } = useEnvoi();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const n = (k: string) => champ(d.get(k)) ?? null;
    const contrat = champ(d.get('contratId'));
    await envoyer(
      base(operationId, factureId),
      {
        numero: n('numero'),
        dateFacture: n('dateFacture'),
        type: String(d.get('type')),
        montantHT: n('montantHT'),
        tvaPct: n('tvaPct'),
        montantTTC: n('montantTTC'),
        retenueGarantie: n('retenueGarantie'),
        acomptesDeduits: n('acomptesDeduits'),
        iban: n('iban'),
        contratId: contrat ? Number(contrat) : null,
      },
      'PATCH',
    );
  }

  return (
    <Repliable libelle="Corriger les valeurs">
      {() => (
        <form onSubmit={onSubmit} className="form">
          <div className="grille-3">
            <label>
              N° de facture
              <input name="numero" defaultValue={valeurs.numero ?? ''} />
            </label>
            <label>
              Date
              <input
                name="dateFacture"
                type="date"
                defaultValue={valeurs.dateFacture?.slice(0, 10) ?? ''}
              />
            </label>
            <label>
              Type
              <select name="type" defaultValue={valeurs.type}>
                <option value="SITUATION">Situation</option>
                <option value="ACOMPTE">Acompte</option>
                <option value="SOLDE">Facture finale</option>
                <option value="AVOIR">Note de crédit</option>
              </select>
            </label>
            <label>
              Montant HT
              <input name="montantHT" inputMode="decimal" defaultValue={valeurs.montantHT ?? ''} />
            </label>
            <label>
              TVA %
              <input name="tvaPct" inputMode="decimal" defaultValue={valeurs.tvaPct ?? ''} />
            </label>
            <label>
              Montant TTC
              <input
                name="montantTTC"
                inputMode="decimal"
                defaultValue={valeurs.montantTTC ?? ''}
              />
            </label>
            <label>
              Retenue de garantie
              <input
                name="retenueGarantie"
                inputMode="decimal"
                defaultValue={valeurs.retenueGarantie ?? ''}
              />
            </label>
            <label>
              Acomptes déduits
              <input
                name="acomptesDeduits"
                inputMode="decimal"
                defaultValue={valeurs.acomptesDeduits ?? ''}
              />
            </label>
            <label>
              IBAN
              <input name="iban" defaultValue={valeurs.iban ?? ''} />
            </label>
          </div>
          <label>
            Contrat
            <select name="contratId" defaultValue={valeurs.contratId ?? ''}>
              <option value="">— aucun —</option>
              {contrats.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.libelle}
                </option>
              ))}
            </select>
          </label>
          {erreur && <p className="ko">{erreur}</p>}
          <button type="submit" disabled={enCours}>
            Enregistrer et recontrôler
          </button>
        </form>
      )}
    </Repliable>
  );
}

interface Ligne {
  designation: string;
  codeCfc: string;
  montant: string;
}

export function LignesFacture({
  operationId,
  factureId,
  lignes,
}: {
  operationId: number;
  factureId: number;
  lignes: Ligne[];
}) {
  const [etat, setEtat] = useState<Ligne[]>(lignes);
  const { envoyer, erreur, enCours } = useEnvoi();
  const maj = (i: number, c: Partial<Ligne>) =>
    setEtat((ls) => ls.map((l, j) => (j === i ? { ...l, ...c } : l)));
  return (
    <Repliable libelle="Corriger les lignes">
      {(fermer) => (
        <div className="form">
          {etat.map((l, i) => (
            <div key={i} className="grille-3">
              <input
                value={l.codeCfc}
                placeholder="Poste (211.32)"
                onChange={(e) => maj(i, { codeCfc: e.target.value })}
              />
              <input
                value={l.designation}
                placeholder="Désignation"
                onChange={(e) => maj(i, { designation: e.target.value })}
              />
              <input
                value={l.montant}
                inputMode="decimal"
                placeholder="Montant"
                onChange={(e) => maj(i, { montant: e.target.value })}
              />
            </div>
          ))}
          <button
            type="button"
            className="lien"
            onClick={() => setEtat((ls) => [...ls, { designation: '', codeCfc: '', montant: '' }])}
          >
            + Ajouter une ligne
          </button>{' '}
          <button
            type="button"
            disabled={enCours}
            onClick={async () => {
              const ok = await envoyer(
                `${base(operationId, factureId)}/lignes`,
                {
                  lignes: etat
                    .filter((l) => l.designation.trim() && l.montant.trim())
                    .map((l) => ({
                      designation: l.designation,
                      codeCfc: l.codeCfc.trim() || null,
                      montant: l.montant,
                    })),
                },
                'PUT',
              );
              if (ok) fermer();
            }}
          >
            Enregistrer et recontrôler
          </button>
          {erreur && <p className="ko">{erreur}</p>}
        </div>
      )}
    </Repliable>
  );
}
