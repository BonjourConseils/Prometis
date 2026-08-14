# Documentation Notion (miroir)

Le **dépôt est maître**. Notion est un miroir de lecture pour le pilotage : toute décision se
prend dans le dépôt (`prisma/schema.prisma`, `Plan_Prometis.md`, `BACKLOG.md`), puis se reflète ici.

## Arborescence

Racine `🌐 SAAS` de l'espace Notion (aux côtés de CRM Immobilier, Kolabimo, CareerPulse AI,
Ici Newsletter, Digital Systems) :

| Page | URL |
|---|---|
| 🏗️ **PROMETIS** (racine projet) | https://app.notion.com/p/3bca1a97d3dd8178bf46dfd7eb1bc381 |
| 🧭 Projet & Produit | https://app.notion.com/p/3bca1a97d3dd81de9c60db8ee3c2851d |
| 🏛️ Architecture technique | https://app.notion.com/p/3bca1a97d3dd81a98a86c3bfb8577c2a |
| 🗄️ Modèle de données | https://app.notion.com/p/3bca1a97d3dd81bbb9bec9529464aaac |
| 🔌 Passerelle Kolabimo | https://app.notion.com/p/3bca1a97d3dd8105bb1bf146a82e0928 |
| 🚀 Roadmap & Lots | https://app.notion.com/p/3bca1a97d3dd8140a42afae5ac2972aa |
| 📦 Releases & Versions | https://app.notion.com/p/3bca1a97d3dd812f9a78d0e45c164fa2 |
| ⚠️ Risques & Décisions | https://app.notion.com/p/3bca1a97d3dd8174a30bd33148242cfd |

Page Kolabimo (SaaS jumeau, utile pour la passerelle) :
https://app.notion.com/p/34fa1a97d3dd8129b409dc3afb5cd8dd

## Quand mettre Notion à jour

| Événement dans le dépôt | Page à mettre à jour |
|---|---|
| Un lot passe de « en cours » à « livré » | 📦 Releases & Versions — tableau d'état des lots |
| Une décision technique contraignante est prise | ⚠️ Risques & Décisions — ajouter un `D-nn` avec sa raison |
| Le modèle de données évolue (nouvelle table, invariant) | 🗄️ Modèle de données **et** `references/data-model.md` + `references/rls.md` |
| Un endpoint ou un événement de passerelle change | 🔌 Passerelle Kolabimo |
| Le périmètre d'un lot change | 🚀 Roadmap & Lots **et** `BACKLOG.md` (le dépôt d'abord) |
| Un écran est ajouté ou retiré | 🧭 Projet & Produit — inventaire des écrans |

Mettre à jour **en même temps** le fichier de référence du skill correspondant : les deux doivent
raconter la même histoire, sinon Notion devient une source de vérité concurrente.

## Convention d'écriture

- Notion-flavored Markdown : tables en balises `<table header-row="true">`, callouts en
  `<callout icon="…">`, diagrammes en blocs ```mermaid, sections dépliables via
  `### Titre {toggle="true"}` avec enfants indentés par tabulation.
- Pas de titre de page dans le contenu — il vient de la propriété `title`.
- Mettre à jour une page existante (`update-page`) plutôt que d'en créer une nouvelle : les URLs
  ci-dessus sont référencées ailleurs.
