'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useEnvoi } from '../../components/formulaire';
import { appelApi } from '../../../lib/api-client';

const champ = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

const STATUTS = [
  ['MONTAGE', 'Montage'],
  ['EN_PREPARATION', 'En préparation'],
  ['EN_CHANTIER', 'En chantier'],
  ['EN_COMMERCIALISATION', 'En commercialisation'],
  ['LIVRAISON', 'Livraison'],
  ['CLOTUREE', 'Clôturée'],
] as const;

/**
 * Modifier la fiche : le nom, la commune, l'avancement, les dates.
 *
 * Le nom d'une promotion change — un nom de travail devient un nom
 * commercial, une promotion arrivée par la passerelle porte celui de
 * Kolabimo. Il se corrigeait en base et nulle part à l'écran.
 */
export function ModifierPromotion({
  operationId,
  valeurs,
}: {
  operationId: number;
  valeurs: {
    nom: string;
    commune: string | null;
    canton: string | null;
    statut: string;
    description: string | null;
    dateDebut: string | null;
    dateLivraisonPrevue: string | null;
  };
}) {
  const { envoyer, erreur, enCours } = useEnvoi();
  const [ouvert, setOuvert] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const ok = await envoyer(
      `/operations/${operationId}`,
      {
        nom: String(d.get('nom') ?? '').trim(),
        commune: champ(d.get('commune')),
        canton: champ(d.get('canton')),
        statut: d.get('statut'),
        description: champ(d.get('description')),
        dateDebut: champ(d.get('dateDebut')),
        dateLivraisonPrevue: champ(d.get('dateLivraisonPrevue')),
      },
      'PATCH',
    );
    if (ok) setOuvert(false);
  }

  if (!ouvert) {
    return (
      <button type="button" className="secondaire" onClick={() => setOuvert(true)}>
        Modifier la fiche
      </button>
    );
  }

  const jour = (v: string | null) => (v ? v.slice(0, 10) : '');

  return (
    <form onSubmit={onSubmit} className="form">
      <div className="grille-3">
        <label>
          Nom de la promotion
          <input name="nom" required autoFocus defaultValue={valeurs.nom} />
        </label>
        <label>
          Commune
          <input name="commune" defaultValue={valeurs.commune ?? ''} />
        </label>
        <label>
          Canton
          <input name="canton" defaultValue={valeurs.canton ?? ''} placeholder="VS" />
        </label>
      </div>
      <div className="grille-3">
        <label>
          Statut
          <select name="statut" defaultValue={valeurs.statut}>
            {STATUTS.map(([v, libelle]) => (
              <option key={v} value={v}>
                {libelle}
              </option>
            ))}
          </select>
        </label>
        <label>
          Début des travaux
          <input name="dateDebut" type="date" defaultValue={jour(valeurs.dateDebut)} />
        </label>
        <label>
          Livraison prévue
          <input
            name="dateLivraisonPrevue"
            type="date"
            defaultValue={jour(valeurs.dateLivraisonPrevue)}
          />
        </label>
      </div>
      <label>
        Description
        <input name="description" defaultValue={valeurs.description ?? ''} />
      </label>
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

export const ROLES = [
  ['NOTAIRE', 'Notaire'],
  ['GEOMETRE', 'Géomètre'],
  ['INGENIEUR', 'Ingénieur'],
  ['ARCHITECTE', 'Architecte'],
  ['BUREAU_TECHNIQUE', 'Bureau technique'],
  ['ENTREPRISE_GENERALE', 'Entreprise générale'],
  ['COURTIER', 'Courtier'],
  ['MAITRE_OUVRAGE', 'Maître d’ouvrage'],
  ['PILOTE', 'Pilote'],
  ['AUTRE', 'Autre'],
] as const;

/**
 * Rattacher un acteur de l'annuaire à cette promotion — c'est ce qui fait
 * l'équipe du projet. Le même architecte sert plusieurs promotions : on le
 * choisit dans l'annuaire, on ne le ressaisit pas.
 */
export function RattacherActeur({
  operationId,
  acteurs,
}: {
  operationId: number;
  acteurs: { id: number; type: string; societeNom: string | null; nom: string | null }[];
}) {
  const { envoyer, erreur, enCours } = useEnvoi();
  const [ouvert, setOuvert] = useState(false);
  const [acteurId, setActeurId] = useState('');
  // Le rôle suit le métier de l'acteur choisi : un notaire ne se rattache pas
  // en architecte. Il reste modifiable — un bureau technique peut assurer la
  // direction des travaux.
  const [role, setRole] = useState('ARCHITECTE');

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const ok = await envoyer(`/operations/${operationId}/acteurs/${acteurId}`, {
      role,
      roleLibre: champ(d.get('roleLibre')),
      estMandataireGeneral: d.get('estMandataireGeneral') === 'on',
      suitLeProjet: d.get('suitLeProjet') === 'on',
      montantMandat: champ(d.get('montantMandat')),
    });
    if (ok) {
      setOuvert(false);
      setActeurId('');
    }
  }

  if (!acteurs.length) {
    return (
      <p className="meta">
        L’annuaire de la société est vide : ajoutez d’abord un acteur dans « Acteurs &amp; courtage
        ».
      </p>
    );
  }

  if (!ouvert) {
    return (
      <button type="button" onClick={() => setOuvert(true)}>
        Rattacher un acteur
      </button>
    );
  }

  const libelle = (type: string) => ROLES.find(([v]) => v === type)?.[1] ?? type;

  return (
    <form onSubmit={onSubmit} className="form">
      <div className="grille-3">
        <label>
          Acteur
          <select
            name="acteurId"
            required
            value={acteurId}
            onChange={(e) => {
              setActeurId(e.target.value);
              const choisi = acteurs.find((a) => String(a.id) === e.target.value);
              if (choisi) setRole(choisi.type);
            }}
          >
            <option value="" disabled>
              — choisir dans l’annuaire —
            </option>
            {acteurs.map((a) => (
              <option key={a.id} value={a.id}>
                {a.societeNom ?? a.nom ?? `#${a.id}`} — {libelle(a.type)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Rôle sur la promotion
          <select name="role" value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Précision du rôle
          <input name="roleLibre" placeholder="direction des travaux" />
        </label>
      </div>
      <div className="grille-3">
        <label>
          Montant du mandat (CHF)
          <input name="montantMandat" inputMode="decimal" placeholder="120000" />
        </label>
        <label className="case">
          <input type="checkbox" name="estMandataireGeneral" /> Mandataire général
        </label>
        <label className="case">
          <input type="checkbox" name="suitLeProjet" defaultChecked /> Suit le projet
        </label>
      </div>
      {erreur && <p className="ko">{erreur}</p>}
      <div className="actions">
        <button type="submit" disabled={enCours || !acteurId}>
          {enCours ? 'Rattachement…' : 'Rattacher'}
        </button>
        <button type="button" className="secondaire" onClick={() => setOuvert(false)}>
          Annuler
        </button>
      </div>
    </form>
  );
}

/** Détacher : l'acteur reste dans l'annuaire, il quitte cette promotion. */
export function DetacherActeur({
  operationId,
  rattachementId,
}: {
  operationId: number;
  rattachementId: number;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();
  const [confirme, setConfirme] = useState(false);

  if (!confirme) {
    return (
      <button type="button" className="lien" onClick={() => setConfirme(true)}>
        Détacher
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        className="secondaire"
        disabled={enCours}
        onClick={() =>
          envoyer(
            `/operations/${operationId}/acteurs/rattachements/${rattachementId}`,
            undefined,
            'DELETE',
          )
        }
      >
        {enCours ? '…' : 'Confirmer'}
      </button>{' '}
      <button type="button" className="lien" onClick={() => setConfirme(false)}>
        Annuler
      </button>
      {erreur && <p className="ko">{erreur}</p>}
    </>
  );
}

/**
 * Supprimer une promotion — pour celles créées pour rien : un essai, un
 * doublon, une démonstration.
 *
 * Le serveur refuse dès qu'il y a une pièce comptable. Ici, on demande le
 * nom écrit en toutes lettres : un clic de trop ne doit pas effacer une
 * promotion.
 */
export function SupprimerPromotion({ operationId, nom }: { operationId: number; nom: string }) {
  const router = useRouter();
  const [ouvert, setOuvert] = useState(false);
  const [saisi, setSaisi] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function supprimer() {
    setEnCours(true);
    setErreur(null);
    const res = await appelApi(`/operations/${operationId}`, { methode: 'DELETE' });
    setEnCours(false);
    if (!res.ok) {
      setErreur(res.erreur ?? 'Suppression impossible.');
      return;
    }
    router.push('/');
    router.refresh();
  }

  if (!ouvert) {
    return (
      <button type="button" className="secondaire" onClick={() => setOuvert(true)}>
        Supprimer la promotion
      </button>
    );
  }

  return (
    <div className="form">
      <p className="note">
        La suppression est définitive : budget, postes CFC, lots et documents partent avec la
        promotion. Elle est refusée s’il existe des factures, contrats, réservations, appels de
        fonds ou ordres de paiement — ces pièces-là se clôturent, elles ne s’effacent pas.
      </p>
      <label>
        Écrivez « {nom} » pour confirmer
        <input value={saisi} onChange={(e) => setSaisi(e.target.value)} autoFocus />
      </label>
      {erreur && <p className="ko">{erreur}</p>}
      <div className="actions">
        <button type="button" disabled={enCours || saisi.trim() !== nom} onClick={supprimer}>
          {enCours ? 'Suppression…' : 'Supprimer définitivement'}
        </button>
        <button type="button" className="secondaire" onClick={() => setOuvert(false)}>
          Annuler
        </button>
      </div>
    </div>
  );
}
