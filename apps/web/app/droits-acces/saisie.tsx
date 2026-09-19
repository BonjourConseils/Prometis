'use client';

import { useState, type FormEvent } from 'react';
import { champ } from '../../lib/api-client';
import { Repliable, useEnvoi } from '../components/formulaire';

/**
 * Les gestes de l'écran « Droits d'accès » : inviter, modifier un rôle,
 * ouvrir ou fermer une promotion, nommer la direction des travaux.
 *
 * L'API vérifie tout ; ces formulaires ne décident rien. Ils disent seulement,
 * à côté de chaque choix, ce qu'il ouvre.
 */

export interface OperationChoix {
  id: number;
  nom: string;
}

const ROLES_INTERNES: [string, string][] = [
  ['CHEF_PROJET', 'Chef de projet'],
  ['ECONOMISTE', 'Économiste de la construction'],
  ['COMPTABILITE', 'Comptabilité'],
  ['COMMERCIAL', 'Commercial'],
  ['LECTURE_SEULE', 'Lecture seule'],
  ['ADMIN', 'Administrateur — toutes les promotions, gère les accès'],
];

const TYPES_EXTERNES: [string, string][] = [
  ['DIRECTION_TRAVAUX', 'Direction des travaux'],
  ['ARCHITECTE', 'Architecte'],
  ['INGENIEUR', 'Ingénieur'],
  ['BUREAU_TECHNIQUE', 'Bureau technique'],
  ['ENTREPRISE_GENERALE', 'Entreprise générale'],
  ['PILOTE', 'Pilote'],
  ['AUTRE', 'Autre'],
];

const NIVEAUX: [string, string][] = [
  ['READ_ONLY', 'Lecture — consulte'],
  ['OPERATE', 'Saisie — saisit soumissions, factures, documents'],
  ['MANAGE', 'Gestion — tout, y compris les droits sur la promotion'],
];

/** Ce qu'un intervenant de chantier voit par défaut : ni ventes, ni acquéreurs, ni foncier. */
const MODULES_CHANTIER = [
  'SOUMISSIONS',
  'CONTRATS',
  'FACTURES',
  'DOCUMENTS',
  'SEANCES',
  'BUDGET_CFC',
];

const MODULES: [string, string][] = [
  ['BUDGET_CFC', 'Budget CFC'],
  ['SOUMISSIONS', 'Soumissions'],
  ['CONTRATS', 'Contrats'],
  ['FACTURES', 'Factures'],
  ['DOCUMENTS', 'Documents'],
  ['SEANCES', 'Séances'],
  ['PASSEPORT', 'Passeport'],
  ['FONCIER', 'Foncier'],
  ['VENTES', 'Ventes'],
  ['APPELS_FONDS', 'Appels de fonds'],
  ['ACTEURS', 'Acteurs'],
];

interface AccesChoisi {
  operationId: number;
  accessLevel: string;
  modules: string[];
  dt: boolean;
}

export function InviterMembre({ operations }: { operations: OperationChoix[] }) {
  return (
    <Repliable libelle="Inviter une personne">
      {(fermer) => <FormulaireInvitation operations={operations} fermer={fermer} />}
    </Repliable>
  );
}

function FormulaireInvitation({
  operations,
  fermer,
}: {
  operations: OperationChoix[];
  fermer: () => void;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();
  const [externe, setExterne] = useState(true);
  const [type, setType] = useState('DIRECTION_TRAVAUX');
  const [role, setRole] = useState('CHEF_PROJET');
  const [acces, setAcces] = useState<AccesChoisi[]>([]);
  const toutes = !externe && role === 'ADMIN';

  const basculer = (id: number, coche: boolean) =>
    setAcces((a) =>
      coche
        ? [
            ...a,
            {
              operationId: id,
              accessLevel: 'OPERATE',
              modules: externe ? MODULES_CHANTIER : [],
              dt: externe && type === 'DIRECTION_TRAVAUX',
            },
          ]
        : a.filter((x) => x.operationId !== id),
    );
  const maj = (id: number, c: Partial<AccesChoisi>) =>
    setAcces((a) => a.map((x) => (x.operationId === id ? { ...x, ...c } : x)));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const ok = await envoyer('/acces/invitations', {
      email: String(d.get('email') ?? ''),
      prenom: champ(d.get('prenom')) ?? null,
      nom: champ(d.get('nom')) ?? null,
      externe,
      ...(externe
        ? { acteurType: type, societeNom: champ(d.get('societeNom')) ?? null }
        : { role, fonction: champ(d.get('fonction')) ?? null }),
      acces: toutes
        ? []
        : acces.map(({ operationId, accessLevel, modules }) => ({
            operationId,
            accessLevel,
            modules,
          })),
      directionTravauxDe: acces.filter((a) => a.dt).map((a) => a.operationId),
    });
    if (ok) fermer();
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <fieldset>
        <legend>Qui invitez-vous ?</legend>
        <label className="case">
          <input type="radio" checked={externe} onChange={() => setExterne(true)} /> Un intervenant
          externe — architecte, direction des travaux, ingénieur…
        </label>
        <label className="case">
          <input type="radio" checked={!externe} onChange={() => setExterne(false)} /> Un employé de
          la société
        </label>
      </fieldset>

      <div className="grille-3">
        <label>
          E-mail
          <input name="email" type="email" required autoComplete="off" />
        </label>
        <label>
          Prénom
          <input name="prenom" />
        </label>
        <label>
          Nom
          <input name="nom" />
        </label>
      </div>

      {externe ? (
        <div className="grille-2">
          <label>
            À quel titre
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {TYPES_EXTERNES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Société
            <input name="societeNom" required placeholder="Bureau d’architectes Dupuis SA" />
          </label>
        </div>
      ) : (
        <div className="grille-2">
          <label>
            Rôle
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLES_INTERNES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Fonction
            <input name="fonction" placeholder="Cheffe de projet" />
          </label>
        </div>
      )}

      {toutes ? (
        <p className="note">Un administrateur voit toutes les promotions par son rôle.</p>
      ) : (
        <fieldset>
          <legend>Promotions ouvertes</legend>
          {operations.map((o) => {
            const a = acces.find((x) => x.operationId === o.id);
            return (
              <div key={o.id} className="acces-operation">
                <label className="case">
                  <input
                    type="checkbox"
                    checked={!!a}
                    onChange={(e) => basculer(o.id, e.target.checked)}
                  />{' '}
                  {o.nom}
                </label>
                {a && (
                  <div className="grille-2">
                    <label>
                      Niveau
                      <select
                        value={a.accessLevel}
                        onChange={(e) => maj(o.id, { accessLevel: e.target.value })}
                      >
                        {NIVEAUX.map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </label>
                    {externe && (
                      <label className="case">
                        <input
                          type="checkbox"
                          checked={a.dt}
                          onChange={(e) => maj(o.id, { dt: e.target.checked })}
                        />{' '}
                        Direction des travaux de cette promotion
                        <span className="meta"> — vise chaque facture avant votre approbation</span>
                      </label>
                    )}
                    <fieldset className="modules">
                      <legend>
                        Modules{' '}
                        <span className="meta">
                          {a.modules.length ? '' : '— tous ceux que le niveau permet'}
                        </span>
                      </legend>
                      {MODULES.map(([v, l]) => (
                        <label key={v} className="case">
                          <input
                            type="checkbox"
                            checked={a.modules.includes(v)}
                            onChange={(e) =>
                              maj(o.id, {
                                modules: e.target.checked
                                  ? [...a.modules, v]
                                  : a.modules.filter((m) => m !== v),
                              })
                            }
                          />{' '}
                          {l}
                        </label>
                      ))}
                    </fieldset>
                  </div>
                )}
              </div>
            );
          })}
        </fieldset>
      )}

      <p className="meta">
        La personne reçoit un lien personnel, valable quatorze jours et utilisable une fois. Si elle
        a déjà un compte Prometis, elle rejoint votre espace avec son mot de passe.
      </p>
      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" className="principal" disabled={enCours}>
        {enCours ? 'Envoi…' : 'Envoyer l’invitation'}
      </button>
    </form>
  );
}

export function ActionsInvitation({ id }: { id: number }) {
  const { envoyer, erreur, enCours } = useEnvoi();
  return (
    <span>
      <button
        type="button"
        className="lien"
        disabled={enCours}
        onClick={() => envoyer(`/acces/invitations/${id}/renvoyer`)}
      >
        Renvoyer
      </button>{' '}
      <button
        type="button"
        className="lien"
        disabled={enCours}
        onClick={() => envoyer(`/acces/invitations/${id}/revoquer`)}
      >
        Révoquer
      </button>
      {erreur && <span className="ko"> {erreur}</span>}
    </span>
  );
}

export function ModifierMembre({
  id,
  role,
  isActive,
  externe,
}: {
  id: number;
  role: string;
  isActive: boolean;
  externe: boolean;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();
  return (
    <span>
      {!externe && (
        <select
          aria-label="Rôle"
          defaultValue={role}
          disabled={enCours}
          onChange={(e) => envoyer(`/acces/membres/${id}`, { role: e.target.value }, 'PATCH')}
        >
          {role === 'OWNER' && <option value="OWNER">Propriétaire</option>}
          {ROLES_INTERNES.map(([v, l]) => (
            <option key={v} value={v}>
              {l.split(' —')[0]}
            </option>
          ))}
        </select>
      )}{' '}
      <button
        type="button"
        className="lien"
        disabled={enCours}
        onClick={() => envoyer(`/acces/membres/${id}`, { isActive: !isActive }, 'PATCH')}
      >
        {isActive ? 'Désactiver' : 'Réactiver'}
      </button>
      {erreur && <span className="ko"> {erreur}</span>}
    </span>
  );
}

export function OuvrirPromotion({
  membershipId,
  operations,
  externe,
}: {
  membershipId: number;
  operations: OperationChoix[];
  externe: boolean;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    await envoyer(
      `/acces/operations/${Number(d.get('operationId'))}/membres/${membershipId}`,
      {
        accessLevel: String(d.get('accessLevel')),
        modules: externe ? MODULES_CHANTIER : [],
      },
      'PUT',
    );
  }
  if (!operations.length) return null;
  return (
    <Repliable libelle="Ouvrir une promotion">
      {() => (
        <form onSubmit={onSubmit} className="form">
          <select name="operationId" required>
            {operations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.nom}
              </option>
            ))}
          </select>
          <select name="accessLevel" defaultValue="OPERATE">
            {NIVEAUX.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          {externe && (
            <p className="meta">Modules de chantier seulement : ni ventes, ni acquéreurs.</p>
          )}
          {erreur && <p className="ko">{erreur}</p>}
          <button type="submit" disabled={enCours}>
            Ouvrir
          </button>
        </form>
      )}
    </Repliable>
  );
}

export function FermerPromotion({
  operationId,
  membershipId,
}: {
  operationId: number;
  membershipId: number;
}) {
  const { envoyer, enCours } = useEnvoi();
  return (
    <button
      type="button"
      className="lien"
      disabled={enCours}
      title="Retirer l’accès à cette promotion"
      onClick={() =>
        envoyer(`/acces/operations/${operationId}/membres/${membershipId}`, undefined, 'DELETE')
      }
    >
      retirer
    </button>
  );
}

export function NommerDirectionTravaux({
  operationId,
  actuel,
  candidats,
}: {
  operationId: number;
  actuel: number | null;
  candidats: { id: number; libelle: string }[];
}) {
  const { envoyer, erreur, enCours } = useEnvoi();
  return (
    <span>
      <select
        aria-label="Direction des travaux"
        defaultValue={actuel ?? ''}
        disabled={enCours}
        onChange={(e) =>
          envoyer(
            `/acces/operations/${operationId}/direction-travaux`,
            { membershipId: e.target.value ? Number(e.target.value) : null },
            'PUT',
          )
        }
      >
        <option value="">— aucune : le promoteur valide seul —</option>
        {candidats.map((c) => (
          <option key={c.id} value={c.id}>
            {c.libelle}
          </option>
        ))}
      </select>
      {erreur && <span className="ko"> {erreur}</span>}
    </span>
  );
}
