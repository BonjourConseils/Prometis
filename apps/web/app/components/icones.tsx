import type { ReactNode } from 'react';

/**
 * Icônes de navigation — tracés Lucide, recopiés en SVG en ligne.
 *
 * Le design system impose Lucide : 24×24, trait de 2 px, extrémités et
 * jonctions arrondies, aucun remplissage. Les tracés sont écrits ici plutôt
 * qu'appelés depuis un CDN — l'application doit se servir hors ligne, et une
 * icône de menu ne justifie pas une dépendance de plus.
 *
 * Elles héritent de `currentColor` : c'est ce qui leur fait suivre l'état
 * actif de la navigation sans règle supplémentaire.
 */
function Icone({ children }: { children: ReactNode }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** layout-dashboard */
export const IconeDashboard = () => (
  <Icone>
    <rect width="7" height="9" x="3" y="3" rx="1" />
    <rect width="7" height="5" x="14" y="3" rx="1" />
    <rect width="7" height="9" x="14" y="12" rx="1" />
    <rect width="7" height="5" x="3" y="16" rx="1" />
  </Icone>
);

/** building-2 */
export const IconeOperations = () => (
  <Icone>
    <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
    <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
    <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
    <path d="M10 6h4M10 10h4M10 14h4M10 18h4" />
  </Icone>
);

/** list-tree */
export const IconeBudget = () => (
  <Icone>
    <path d="M21 12h-8M21 6h-8M21 18h-8M3 3v14a2 2 0 0 0 2 2h3M3 9h5" />
  </Icone>
);

/** bar-chart-3 */
export const IconeEcarts = () => (
  <Icone>
    <path d="M3 3v18h18M8 17V9M13 17V5M18 17v-4" />
  </Icone>
);

/** file-text */
export const IconeSoumissions = () => (
  <Icone>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v5h5M16 13H8M16 17H8M10 9H8" />
  </Icone>
);

/** receipt */
export const IconeFactures = () => (
  <Icone>
    <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
    <path d="M16 8H8M16 12H8" />
  </Icone>
);

/** layers */
export const IconeLots = () => (
  <Icone>
    <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
    <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65M22 12.65l-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
  </Icone>
);

/** banknote */
export const IconeAppels = () => (
  <Icone>
    <rect width="20" height="12" x="2" y="6" rx="2" />
    <circle cx="12" cy="12" r="2" />
    <path d="M6 12h.01M18 12h.01" />
  </Icone>
);

/** trending-up */
export const IconeTresorerie = () => (
  <Icone>
    <path d="M22 7 13.5 15.5 8.5 10.5 2 17M16 7h6v6" />
  </Icone>
);

/** home */
export const IconePpe = () => (
  <Icone>
    <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Icone>
);

/** users */
export const IconeActeurs = () => (
  <Icone>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </Icone>
);

/** calendar-days */
export const IconeSeances = () => (
  <Icone>
    <rect width="18" height="18" x="3" y="4" rx="2" />
    <path d="M3 10h18M8 2v4M16 2v4M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
  </Icone>
);

/** folder */
export const IconeGed = () => (
  <Icone>
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </Icone>
);

/** plug-zap — la passerelle */
export const IconePasserelle = () => (
  <Icone>
    <path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z" />
    <path d="m2 22 3-3M7.5 13.5 10 11M10.5 16.5 13 14M18 3l-4 4h6l-4 4" />
  </Icone>
);

/** shield-check */
export const IconeSecurite = () => (
  <Icone>
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1Z" />
    <path d="m9 12 2 2 4-4" />
  </Icone>
);

/** key-round — droits d'accès */
export const IconeDroits = () => (
  <Icone>
    <path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" />
    <circle cx="16.5" cy="7.5" r=".5" fill="currentColor" />
  </Icone>
);

/** log-out */
export const IconeDeconnexion = () => (
  <Icone>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
  </Icone>
);
