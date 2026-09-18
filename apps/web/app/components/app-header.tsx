import Link from 'next/link';
import type { JSX } from 'react';
import { LogoutButton } from './logout-button';
import {
  IconeActeurs,
  IconeAppels,
  IconeBudget,
  IconeDroits,
  IconeEcarts,
  IconeFactures,
  IconeGed,
  IconeLots,
  IconeOperations,
  IconePasserelle,
  IconePpe,
  IconeSeances,
  IconeSecurite,
  IconeSoumissions,
  IconeTresorerie,
} from './icones';

export interface Me {
  compte: { compteId: number; email: string; adminPlateforme?: boolean };
  workspace: { societeId: number; membershipId: number; role: string } | null;
  societe: {
    id: number;
    raisonSociale: string;
    profil: string;
    modulesActifs: string[];
    /** Modules résiliés : consultables, plus modifiables. */
    modulesLecture?: string[];
    canton: string | null;
  } | null;
  membership: {
    id: number;
    role: string;
    fonction: string | null;
    acteur: { id: number; societeNom: string | null; type: string } | null;
  } | null;
  workspaces: { societeId: number; raisonSociale: string }[];
}

/**
 * Navigation latérale, fond encre — la coquille du prototype.
 *
 * Trois règles reprises du design system :
 *
 *   · la barre est **fixe**, 248 px, sur `--surface-ink` ; c'est le seul
 *     aplat sombre de l'application ;
 *   · l'élément actif porte la teinte de marque. Le pétrole ne sert jamais
 *     de fond de page — uniquement les actions, les liens et cet état ;
 *   · chaque entrée porte une icône Lucide monochrome, qui hérite de la
 *     couleur du texte.
 *
 * `operationId` est facultatif : le bloc des écrans d'une opération n'apparaît
 * que lorsqu'on est *dans* une promotion. Afficher ces entrées ailleurs
 * demanderait de choisir une promotion au hasard — ou de servir des liens
 * morts, ce qui est pire qu'un menu court.
 *
 * Un module absent de la société ne s'affiche pas. Ce n'est pas la sécurité —
 * l'API refuse de toute façon — mais un promoteur et une entreprise générale
 * ne doivent pas voir la même application.
 */
export function AppHeader({
  me,
  actif,
  operationId,
}: {
  me: Me;
  actif: string;
  operationId?: number;
}) {
  const estAdmin = me.membership?.role === 'OWNER' || me.membership?.role === 'ADMIN';
  // Un module résilié reste dans la navigation : ses données sont toujours
  // là, et les faire disparaître laisserait croire qu'elles ont été effacées.
  const enLecture = (m: string) => me.societe?.modulesLecture?.includes(m) ?? false;
  const moduleActif = (m: string) =>
    (me.societe?.modulesActifs.includes(m) ?? false) || enLecture(m);

  const lien = (
    cle: string,
    href: string,
    libelle: string,
    Icone: () => JSX.Element,
    module?: string,
  ) => (
    <Link key={cle} href={href} className={actif === cle ? 'actif' : ''}>
      <Icone />
      <span>{libelle}</span>
      {module && enLecture(module) && (
        <span className="lecture-seule" title="Module résilié : consultation seule">
          lecture
        </span>
      )}
    </Link>
  );

  const op = (chemin: string) => `/operations/${operationId}${chemin}`;

  return (
    <aside className="app-sidebar">
      <div className="marque">
        <span className="mark" aria-hidden="true">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </svg>
        </span>
        Prometis
      </div>

      <div className="societe">
        <strong>{me.societe?.raisonSociale}</strong>
        <span className="meta">
          {me.compte.email}
          <br />
          {me.membership?.role.toLowerCase().replace(/_/g, ' ')}
          {me.membership?.acteur?.societeNom ? ` · ${me.membership.acteur.societeNom}` : ''}
        </span>
      </div>

      <nav>
        {lien('operations', '/', 'Promotions', IconeOperations)}
        {moduleActif('ACTEURS') && lien('acteurs', '/acteurs', 'Acteurs & courtage', IconeActeurs)}

        {operationId !== undefined && (
          <>
            <div className="rubrique">Chantier</div>
            {moduleActif('FONCIER') && lien('foncier', op('/foncier'), 'Foncier', IconePpe)}
            {/* L'estimatif précède le budget : c'est l'ordre dans lequel une
                promotion se monte — on chiffre grossièrement avant de détailler. */}
            {moduleActif('BUDGET_CFC') &&
              lien('estimatif', op('/estimatif'), 'Budget estimatif', IconeBudget)}
            {moduleActif('BUDGET_CFC') && lien('budget', op('/budget'), 'Budget CFC', IconeBudget)}
            {moduleActif('ECARTS') && lien('ecarts', op('/ecarts'), 'Écarts', IconeEcarts)}
            {moduleActif('SOUMISSIONS') &&
              lien(
                'soumissions',
                op('/soumissions'),
                'Soumissions',
                IconeSoumissions,
                'SOUMISSIONS',
              )}
            {moduleActif('FACTURES') &&
              lien('factures', op('/factures'), 'Factures', IconeFactures, 'FACTURES')}
            {moduleActif('SEANCES') &&
              lien('seances', op('/seances'), 'Séances & PV', IconeSeances)}
            {moduleActif('GED') && lien('documents', op('/documents'), 'Documents', IconeGed)}

            {moduleActif('LOTS') && (
              <>
                <div className="rubrique">Commercialisation</div>
                {lien('lots', op('/lots'), 'Lots & acquéreurs', IconeLots, 'LOTS')}
                {moduleActif('APPELS_FONDS') &&
                  lien(
                    'appels',
                    op('/appels-de-fonds'),
                    'Appels de fonds',
                    IconeAppels,
                    'APPELS_FONDS',
                  )}
                {moduleActif('TRESORERIE') &&
                  lien(
                    'tresorerie',
                    op('/tresorerie'),
                    'Trésorerie',
                    IconeTresorerie,
                    'TRESORERIE',
                  )}
                {moduleActif('COURTAGE') &&
                  lien('courtage', op('/courtage'), 'Courtage', IconeActeurs, 'COURTAGE')}
                {lien('ppe', op('/registre-ppe'), 'Registre PPE', IconePpe)}
              </>
            )}
          </>
        )}

        {estAdmin && (
          <>
            <div className="rubrique">Administration</div>
            {lien('modules', '/modules', 'Modules', IconeBudget)}
            {lien('passerelle', '/passerelle', 'Passerelle', IconePasserelle)}
            {lien('droits', '/droits-acces', "Droits d'accès", IconeDroits)}
            {lien('taux', '/taux-acquisition', "Frais d'acquisition", IconeBudget)}
          </>
        )}
      </nav>

      <div className="pied">
        <nav>
          {me.compte.adminPlateforme &&
            lien('exploitant', '/exploitant', 'Exploitant', IconeDroits)}
          {lien('securite', '/securite', 'Sécurité', IconeSecurite)}
          {me.workspaces.length > 1 &&
            lien('espaces', '/espaces', "Changer d'espace", IconeOperations)}
          <LogoutButton />
        </nav>
      </div>
    </aside>
  );
}
