# Le parcours du promoteur — l'ordre réel des gestes

> **À quoi sert ce document.** Prometis a des écrans justes pris un par un, et
> des écrans faux pris dans l'ordre : le foncier affichait les lots à vendre,
> l'estimatif demandait soixante-dix montants avant qu'on sache seulement si
> le terrain s'achète. Ce fichier fixe **l'ordre dans lequel un promoteur
> travaille**. Chaque écran s'y rattache à une étape ; ce qui n'appartient pas
> à l'étape n'a rien à faire sur l'écran.
>
> Source : Christophe Bonjour (CB Promotions), en testant l'app le 30.09.2026.
> **Dicté par le métier, pas déduit du code.** Ce qui n'a pas encore été dit
> porte la mention « à confirmer » : ne pas le combler en devinant.

## 1. Le terrain — écran **Foncier** ✅ dit le 30.09.2026

Le promoteur trouve un terrain. C'est le point de départ de tout : sans
terrain, il n'y a pas de promotion.

Il saisit **les parcelles et leur prix**. La parcelle porte son numéro, sa
commune, sa surface, son indice d'utilisation (IBUS), ses découpages quand
elle est en plusieurs zones — et **son prix**. S'y ajoutent les frais
d'acquisition (notaire, droits de mutation), qui dépendent du canton.

Ce qui en sort : **la surface de plancher à bâtir** (surface × IBUS) et le
**prix de revient du terrain**. C'est ce qui permet de dire si l'affaire tient
avant d'avoir dessiné quoi que ce soit.

**N'appartient pas à cet écran** : l'immeuble qu'on va construire, ses lots,
leurs places de parc. Ils se vendent, donc ils vivent sous « Lots &
acquéreurs » (corrigé le 30.09.2026).

## 2. La faisabilité — écran **Budget estimatif** ✅ dit le 30.09.2026

Avec la surface à bâtir et un prix de vente au mètre carré, le promoteur
chiffre grossièrement l'opération : **les grands postes CFC 0 à 5, et les
frais de vente** (commission de courtage, publicité). Rien d'autre — à ce
stade, ni entreprise ni détail des travaux ne sont connus.

Le total des ventes attendu face au total des coûts donne le **bénéfice
prévisionnel**. C'est la décision d'y aller ou non.

**Plusieurs objets dans une même promotion** (dit le 30.09.2026) : un
estimatif doit pouvoir porter **un ou plusieurs immeubles, ou plusieurs
villas**, chacun avec ses grandes lignes CFC. Un lotissement de cinq villas
n'est pas un seul bâtiment qu'on additionne : le promoteur veut voir ce que
coûte chaque objet, et ce que chacun rapporte.

Conséquence sur le modèle : le budget ne connaît aujourd'hui qu'une seule
dimension, le poste CFC. Il faut une seconde dimension — l'objet — soit un
tableau **CFC × objet**. Questions ouvertes avant de construire :

- Le terrain (CFC 0) est-il commun à l'opération et réparti ensuite, ou saisi
  par objet ?
- Cinq villas identiques : une ligne « villa type » multipliée par cinq, ou
  cinq colonnes ?
- Les frais de vente suivent-ils l'objet (commission par villa) ou
  l'opération ?

**À confirmer** : ce qui se passe entre la faisabilité et le chantier —
promesse de vente, dépôt du permis, financement.

## 3. Le détail — écran **Budget CFC** ✅ dit le 30.09.2026

Le promoteur **reprend les éléments de l'estimatif** et les affine avec les
sous-postes. Ce n'est pas un second budget : c'est le même, regardé de plus
près.

Mécaniquement, c'est déjà ce que fait l'app — et le piège est tenu :

- l'estimatif et le budget CFC sont **la même version de budget**, à deux
  mailles d'affichage. Rien n'est ressaisi ;
- un groupe vaut son **montant propre plus celui de ses sous-postes**. Si
  CFC 2 porte 3'000'000 estimés et qu'on détaille ensuite 21, 22, 23, le total
  compterait les deux. L'écran le signale en rouge — « estimation non
  ventilée : X s'ajoutent au détail des sous-postes » — et propose
  **« Ventiler »**, qui répartit le montant du parent sur ses enfants ;
- quand les chiffres réels arrivent, on crée une **révision** : l'estimatif
  initial reste lisible en face, colonne « budgété initial ».

**À confirmer** : à quel moment le promoteur bascule de l'estimatif au détail
— au permis, à l'avant-projet de l'architecte, aux premières soumissions ?

## 4 et suivantes — à écrire avec le promoteur

L'ordre ci-dessous est **supposé**, tiré du code existant et non de la bouche
du métier. À reprendre point par point.

| Étape supposée | Écran | Questions ouvertes |
|---|---|---|
| Consulter les entreprises, comparer, adjuger | Soumissions | Toutes les entreprises en même temps, ou corps de métier par corps de métier au fil du chantier ? |
| Contrats, avenants | Soumissions → contrat | |
| Plan de vente : bien, lots, parkings, prix | Lots & acquéreurs | Les lots se saisissent-ils avant la mise en vente, ou viennent-ils de Kolabimo ? |
| Réservations, acquéreurs, échéancier | Lots & acquéreurs, Appels de fonds | |
| Factures des entreprises, visas, paiement | Factures, Ordres de paiement | |
| Appels de fonds aux acquéreurs | Appels de fonds | |
| Écarts, trésorerie, bilan | Écarts, Trésorerie | |

## Ce que ce document doit devenir

Pour chaque étape : **ce que le promoteur fait**, **ce qu'il saisit**, **ce
qu'il en attend**, et **ce qui n'y appartient pas**. C'est cette dernière ligne
qui a le plus de valeur : elle dit où un écran déborde.
