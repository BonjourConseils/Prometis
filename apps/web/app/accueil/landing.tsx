import Link from 'next/link';
import s from './landing.module.css';

/**
 * Page publique de Prometis.
 *
 * Reprend les maquettes Claude Design (`Screenshots/screenshots/landing/`)
 * sur les mêmes tokens que l'application : c'est le même produit, la landing
 * ne doit pas promettre une autre esthétique que celle qu'on découvre en se
 * connectant.
 *
 * **Règle tenue sur le contenu** : rien n'est annoncé ici qui ne soit livré.
 * Là où la maquette allait plus loin que le produit — relances automatiques à
 * J+10, import camt.054, exports ISO 20022, catalogue CRB importable — le
 * texte a été ramené à ce qui existe. Une landing qui promet ce que la
 * démonstration ne montre pas se paie à la première réunion.
 */

/* --------------------------------------------------------------------
 *  Données de démonstration — celles du prototype, cohérentes entre elles.
 *  Le lot A02 vaut 850 000 (815 000 + box 35 000) et les sept jalons en
 *  reprennent exactement 100 %.
 * ------------------------------------------------------------------ */

const PRIX_ACTE = 850_000;

const LIGNES_ECART = [
  { nom: 'Budgété', valeur: 1_284_000, part: 90 },
  { nom: 'Adjugé', valeur: 1_284_000, part: 90 },
  { nom: 'Commandé', valeur: 1_432_200, part: 100, alerte: true },
  { nom: 'Facturé', valeur: 873_120, part: 61 },
  { nom: 'Payé', valeur: 812_400, part: 57 },
];

const JALONS = [
  {
    titre: "Signature de l'acte",
    pct: 5,
    texte:
      'Le premier appel est déclenché lot par lot, à la signature chez le notaire. Les suivants concernent tous les lots engagés.',
  },
  {
    titre: 'Dalle sur rez terminée',
    pct: 15,
    texte:
      "La fin d'étape est saisie une fois. Les appels de fonds sont calculés, générés en PDF avec QR-facture, et envoyés.",
    actif: true,
  },
  {
    titre: 'Gros œuvre terminé',
    pct: 20,
    texte:
      'Rejouer un jalon ne crée aucune créance en double : le couple réservation × étape est unique.',
  },
  {
    titre: "Hors d'eau, hors d'air",
    pct: 20,
    texte:
      "Les encaissements se saisissent au fil de l'eau ; une relance part en un geste depuis le suivi, avec la QR-facture.",
  },
  {
    titre: 'Second œuvre',
    pct: 20,
    texte:
      'Le prix total acte est figé à la réservation : un prix catalogue qui bouge ne change rien aux appels déjà partis.',
  },
  {
    titre: 'Finitions',
    pct: 15,
    texte: 'Le décompte final compare le budgété au facturé, poste CFC par poste CFC.',
  },
  {
    titre: 'Remise des clés',
    pct: 5,
    texte:
      'Réception des travaux, levée des réserves, et fin de garantie calculée depuis la réception selon la SIA 118.',
  },
];

const CONSTATS = [
  {
    titre: 'Triple saisie',
    texte: "Le même montant retapé au budget, à l'offre puis à la facture.",
  },
  {
    titre: 'Aucune vue temps réel',
    texte: 'Le reste à engager par poste CFC se calcule à la main, quand il se calcule.',
  },
  {
    titre: 'Réconciliation manuelle',
    texte: "Factures des entreprises d'un côté, appels de fonds de l'autre, rien entre les deux.",
  },
  {
    titre: "Pas de piste d'audit",
    texte: 'Rien à montrer à la banque, aux associés ou aux investisseurs.',
  },
];

const MODULES = [
  {
    titre: 'Budget CFC',
    texte:
      'Arborescence à N niveaux, trame de départ des groupes 0 à 5, versions et révisions, TVA 8,1 %, ventilation par lot.',
  },
  {
    titre: 'Soumissions & adjudications',
    texte:
      'Consultation par poste CFC, tableau comparatif des offres, notation du prix, adjudication et contrat SIA 118.',
  },
  {
    titre: 'Factures lues automatiquement',
    texte:
      'Chaque facture est lue sur nos serveurs, imputée au bon poste CFC et rapprochée du contrat. La validation reste humaine.',
  },
  {
    titre: 'Écart permanent',
    texte:
      'Budgété, adjugé, commandé, facturé, payé — comparés en continu, avec refus du dépassement au moment de valider.',
  },
  {
    titre: 'Appels de fonds',
    texte:
      'Échéancier paramétrable par opération, génération du PDF et de la QR-facture suisse, suivi des encaissements et relances.',
  },
  {
    titre: 'Trésorerie & séances',
    texte:
      'Dépenses et recettes dans un même plan de trésorerie mois par mois, PV de séance rédigés et archivés en GED.',
  },
];

const CORRESPONDANCES: [string, string][] = [
  ['Promotion', 'Opération'],
  ['Immeuble', 'Immeuble'],
  ['Appartement', 'Lot'],
  ['Parking (box, couverte…)', 'Parking du lot'],
  ['Réservation client', 'Acquéreur'],
  ["Étape d'échéancier", "Jalon d'appel de fonds"],
  ['—', 'Appel de fonds réel'],
];

const CHIFFRES = [
  {
    valeur: '3 à 6 ans',
    texte: "La durée d'une opération. Le budget doit rester lisible du premier jour au dernier.",
  },
  {
    valeur: 'CFC 0 → 9',
    texte: "Toute l'arborescence, jusqu'au sous-poste 271.0 « plâtrerie — travaux ».",
  },
  {
    valeur: '5 étapes',
    texte: 'Budgété, adjugé, commandé, facturé, payé — comparés à chaque niveau CFC.',
  },
  {
    valeur: '100 %',
    texte: "L'échéancier des appels de fonds, défini par l'acte notarié, opération par opération.",
  },
];

const chf = (v: number) => `${v.toLocaleString('fr-CH').replace(/[\u00a0\u202f]/g, ' ')}.—`;

/** Grue et immeuble, au trait : le chantier monte, les appels suivent. */
function Grue() {
  return (
    <svg
      viewBox="0 0 300 380"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      width="100%"
    >
      {/* Mât et flèche */}
      <path d="M96 60 h108 l-24 -18 H96" />
      <path d="M96 42 v298" />
      <path d="M110 42 v298" />
      <path d="M96 60 h14" />
      <path d="M96 96 h14M96 132 h14M96 168 h14M96 204 h14M96 240 h14M96 276 h14M96 312 h14" />
      {/* Câble et charge */}
      <path d="M168 60 v92" />
      <rect x="161" y="152" width="14" height="10" fill="currentColor" stroke="none" />
      {/* Immeuble en construction, étage par étage */}
      <path d="M18 150 h64 v190 H18 z" />
      <path d="M18 190 h64M18 230 h64M18 270 h64M18 310 h64" />
      <path d="M204 210 h78 v130 h-78 z" opacity="0.45" />
      <path d="M204 250 h78M204 290 h78" opacity="0.45" />
      {/* Terrain */}
      <path d="M0 340 h300" />
    </svg>
  );
}

export function Landing() {
  return (
    <div className={s.page}>
      <header className={s.nav}>
        <div className={s.navInterieur}>
          <Link href="/" className={s.marque}>
            <span className={s.marqueSigle} aria-hidden="true">
              <svg
                width="18"
                height="18"
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
          </Link>
          <nav className={s.navLiens}>
            <a href="#produit">Le produit</a>
            <a href="#echeancier">Du terrain aux clés</a>
            <a href="#kolabimo">Kolabimo</a>
            <Link href="/login" className={s.cta}>
              Se connecter
            </Link>
          </nav>
        </div>
      </header>

      {/* ---- Hero -------------------------------------------------------- */}
      <section className={`${s.section} ${s.hero}`}>
        <div>
          <span className={s.badge}>Conçu pour la promotion immobilière romande</span>
          <h1 className={s.heroTitre}>
            Le fil rouge financier
            <br />
            de vos promotions.
          </h1>
          <p className={s.chapo}>
            Du budget CFC à l&apos;acte de vente : soumissions, adjudications, factures et appels de
            fonds réunis dans un seul outil. Budgété, adjugé, commandé, facturé, payé — comparés en
            permanence, poste par poste.
          </p>
          <div className={s.heroActions}>
            <a href="#pilotes" className={s.cta}>
              Demander une démo
            </a>
            <a href="#produit" className={s.ctaSecondaire}>
              Voir le produit
            </a>
          </div>
        </div>

        <div className={s.carteEcart}>
          <p className={s.carteEcartTitre}>Écart permanent · CFC 23 Électricité</p>
          {LIGNES_ECART.map((l) => (
            <div key={l.nom} className={s.ligneEcart}>
              <div className={s.ligneEcartTete}>
                <span className={s.ligneEcartNom}>{l.nom}</span>
                <span
                  className={`${s.ligneEcartValeur} ${l.alerte ? s.ligneEcartValeurAlerte : ''}`}
                >
                  {chf(l.valeur)}
                </span>
              </div>
              <div className={s.jauge}>
                <div
                  className={`${s.jaugeRemplissage} ${l.alerte ? s.jaugeAlerte : ''}`}
                  style={{ width: `${l.part}%` }}
                />
              </div>
            </div>
          ))}
          <div className={s.depassement}>
            <span className={s.depassementLibelle}>Dépassement détecté</span>
            <span className={s.depassementValeur}>+ {chf(1_432_200 - 1_284_000)}</span>
          </div>
        </div>
      </section>

      {/* ---- Le constat -------------------------------------------------- */}
      <section className={s.section}>
        <span className={s.etiquette}>Le constat</span>
        <h2 className={s.titre}>Un tableur, un logiciel de métré, une compta, et des classeurs.</h2>
        <p className={s.chapo}>
          Les mêmes montants sont saisis trois fois — au budget, à l&apos;offre, à la facture.
          Personne ne sait, à l&apos;instant T, ce qu&apos;il reste à engager.
        </p>
        <div className={s.grille4}>
          {CONSTATS.map((c) => (
            <article key={c.titre} className={s.carte}>
              <h3>{c.titre}</h3>
              <p>{c.texte}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ---- Échéancier -------------------------------------------------- */}
      <div className={s.sectionSombre} id="echeancier">
        <section className={s.section}>
          <span className={s.etiquette}>Du terrain aux clés</span>
          <h2 className={s.titre}>Chaque étage monté déclenche un appel de fonds.</h2>
          <p className={s.chapo}>
            L&apos;échéancier n&apos;est pas réglementé en Suisse : il découle de l&apos;acte
            notarié, propre à chaque opération. Le pourcentage de chaque jalon s&apos;applique au
            prix total acte de chaque lot — appartement et parkings compris.
          </p>

          <div className={s.echeancier}>
            <div className={s.illustration}>
              <Grue />
            </div>
            <div>
              {JALONS.map((j, i) => (
                <article
                  key={j.titre}
                  className={`${s.jalon} ${j.actif ? s.jalonActif : ''}`}
                  aria-current={j.actif ? 'step' : undefined}
                >
                  <div className={s.jalonTete}>
                    <span className={s.jalonNumero}>{String(i + 1).padStart(2, '0')}</span>
                    <span className={s.jalonTitre}>{j.titre}</span>
                    <span className={s.jalonPct}>{j.pct} %</span>
                  </div>
                  <p className={s.jalonTexte}>{j.texte}</p>
                  <p className={s.jalonMontant}>
                    Lot A02 · {chf(PRIX_ACTE)} ·{' '}
                    <strong className={s.jalonMontantFort}>{chf((PRIX_ACTE * j.pct) / 100)}</strong>
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* ---- Une seule chaîne -------------------------------------------- */}
      <section className={s.section} id="produit">
        <span className={s.etiquette}>Le produit</span>
        <h2 className={s.titre}>Une seule chaîne, de l&apos;achat du terrain au décompte final.</h2>
        <div className={s.grille3}>
          {MODULES.map((m) => (
            <article key={m.titre} className={s.carte}>
              <h3>{m.titre}</h3>
              <p>{m.texte}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ---- Passerelle Kolabimo ----------------------------------------- */}
      <section className={s.section} id="kolabimo">
        <div className={s.passerelle}>
          <div>
            <span className={s.etiquette}>Passerelle Kolabimo</span>
            <h2 className={s.titre}>
              Vos lots et vos réservations sont déjà saisis. On ne les ressaisit pas.
            </h2>
            <p className={s.chapo}>
              Kolabimo reste la source de vérité pour la commercialisation : promotions, immeubles,
              lots, parkings, réservations et échéancier. Prometis lit ces données par API, génère
              les appels de fonds réels et repousse les encaissements vers la trésorerie de
              Kolabimo.
            </p>
            <p className={s.remarque}>
              Une fin d&apos;étape dans l&apos;échéancier déclenche l&apos;envoi automatique, client
              par client.
            </p>
          </div>
          <table className={s.tableCorrespondance}>
            <thead>
              <tr>
                <th>Kolabimo</th>
                <th>Prometis</th>
              </tr>
            </thead>
            <tbody>
              {CORRESPONDANCES.map(([source, cible]) => (
                <tr key={cible}>
                  <td>{source}</td>
                  <td className={s.colonneProduit}>{cible}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---- Chiffres ---------------------------------------------------- */}
      <section className={s.section}>
        <div className={s.grille4}>
          {CHIFFRES.map((c) => (
            <div key={c.valeur}>
              <p className={s.chiffre}>{c.valeur}</p>
              <p className={s.chiffreTexte}>{c.texte}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---- Appel aux pilotes et pied de page --------------------------- */}
      <div className={s.sectionSombre} id="pilotes">
        <section className={s.section}>
          <div className={s.appel}>
            <div>
              <h2 className={s.appelTitre}>Nous cherchons deux promoteurs pilotes.</h2>
              <p className={s.chapo}>
                Une opération réelle, un accompagnement direct, un tarif d&apos;amorçage. En échange
                : votre regard de métier sur le produit pendant sa construction.
              </p>
            </div>
            <div className={s.appelActions}>
              <a
                href="mailto:contact@prometis.ch?subject=Demande%20de%20d%C3%A9mo"
                className={s.cta}
              >
                Demander une démo
              </a>
              <span className={s.appelPrecision}>30 minutes, sans engagement</span>
            </div>
          </div>

          <div className={s.pied}>
            <span>Prometis · Suisse romande · Données hébergées en Suisse</span>
            <span>CFC · SIA 112 · SIA 118 · nLPD</span>
          </div>
        </section>
      </div>
    </div>
  );
}
