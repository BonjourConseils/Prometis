import type { ReactNode } from 'react';

/**
 * En-tête de page : le titre, et son contexte sur la même ligne.
 *
 * Le prototype ne met pas le nom de l'opération au-dessus ni en dessous mais
 * **à côté**, en gris : on lit « Budget CFC · Les Jardins de Prilly » d'un
 * seul regard, sans que le contexte concurrence le titre.
 */
export function PageHeader({ titre, contexte }: { titre: string; contexte?: ReactNode }) {
  return (
    <div className="page-header">
      <h1>{titre}</h1>
      {contexte !== undefined && <span className="contexte">{contexte}</span>}
    </div>
  );
}
