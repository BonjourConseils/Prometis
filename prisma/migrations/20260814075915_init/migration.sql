-- CreateEnum
CREATE TYPE "UtilisateurRole" AS ENUM ('OWNER', 'ADMIN', 'CHEF_PROJET', 'ECONOMISTE', 'COMPTABILITE', 'COMMERCIAL', 'LECTURE_SEULE', 'EXTERNE');

-- CreateEnum
CREATE TYPE "OperationAccessLevel" AS ENUM ('READ_ONLY', 'OPERATE', 'MANAGE');

-- CreateEnum
CREATE TYPE "AccessModule" AS ENUM ('FONCIER', 'BUDGET_CFC', 'SOUMISSIONS', 'CONTRATS', 'FACTURES', 'VENTES', 'APPELS_FONDS', 'DOCUMENTS', 'SEANCES', 'ACTEURS');

-- CreateEnum
CREATE TYPE "SocieteProfil" AS ENUM ('PROMOTEUR', 'ENTREPRISE_GENERALE', 'ARCHITECTE', 'BUREAU_TECHNIQUE', 'REGIE', 'AUTRE');

-- CreateEnum
CREATE TYPE "AppModule" AS ENUM ('FONCIER', 'BUDGET_CFC', 'SOUMISSIONS', 'ADJUDICATIONS', 'CONTRATS', 'FACTURES', 'SUIVI_CHANTIER', 'ECARTS', 'SEANCES', 'GED', 'ACTEURS', 'LOTS', 'ACQUEREURS', 'BILAN_PROMOTEUR', 'ECHEANCIER', 'APPELS_FONDS', 'TRESORERIE', 'COURTAGE');

-- CreateEnum
CREATE TYPE "OperationStatut" AS ENUM ('MONTAGE', 'EN_PREPARATION', 'EN_CHANTIER', 'EN_COMMERCIALISATION', 'LIVRAISON', 'CLOTUREE');

-- CreateEnum
CREATE TYPE "BienNature" AS ENUM ('LOTISSEMENT', 'VILLA', 'IMMEUBLE', 'CHALET');

-- CreateEnum
CREATE TYPE "LotStatut" AS ENUM ('DISPONIBLE', 'RESERVE', 'EN_ATTENTE_NOTAIRE', 'VENDU');

-- CreateEnum
CREATE TYPE "ParkingType" AS ENUM ('EXTERIEURE', 'INTERIEURE', 'COUVERTE', 'BOX', 'AUTRE');

-- CreateEnum
CREATE TYPE "ActeurType" AS ENUM ('NOTAIRE', 'GEOMETRE', 'INGENIEUR', 'ARCHITECTE', 'BUREAU_TECHNIQUE', 'ENTREPRISE_GENERALE', 'COURTIER', 'MAITRE_OUVRAGE', 'PILOTE', 'AUTRE');

-- CreateEnum
CREATE TYPE "ModeRealisation" AS ENUM ('ENTREPRISE_GENERALE', 'MANDAT_ARCHITECTE', 'CORPS_DETAT_SEPARES');

-- CreateEnum
CREATE TYPE "BudgetVersionStatut" AS ENUM ('BROUILLON', 'VALIDE', 'ARCHIVE');

-- CreateEnum
CREATE TYPE "SoumissionStatut" AS ENUM ('BROUILLON', 'ENVOYEE', 'OUVERTE', 'EN_COMPARAISON', 'ADJUGEE', 'INFRUCTUEUSE', 'ANNULEE');

-- CreateEnum
CREATE TYPE "OffreStatut" AS ENUM ('ATTENDUE', 'RECUE', 'RELANCE', 'RETENUE', 'ECARTEE');

-- CreateEnum
CREATE TYPE "ContratStatut" AS ENUM ('BROUILLON', 'SIGNE', 'EN_COURS', 'RECEPTION', 'SOLDE', 'RESILIE');

-- CreateEnum
CREATE TYPE "FactureType" AS ENUM ('SITUATION', 'ACOMPTE', 'SOLDE', 'AVOIR');

-- CreateEnum
CREATE TYPE "FactureStatut" AS ENUM ('RECUE', 'EN_LECTURE', 'A_VALIDER', 'VALIDEE', 'PAYEE', 'LITIGE', 'REJETEE');

-- CreateEnum
CREATE TYPE "OcrStatut" AS ENUM ('EN_ATTENTE', 'TRAITEE', 'ECHOUEE');

-- CreateEnum
CREATE TYPE "ReservationStatut" AS ENUM ('OPTION', 'RESERVE', 'FONDS_VERSES', 'VENDU', 'EXPIREE', 'ANNULEE');

-- CreateEnum
CREATE TYPE "EcheancierEtapeStatut" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "AppelDeFondsStatut" AS ENUM ('BROUILLON', 'EMIS', 'ENVOYE', 'PARTIELLEMENT_PAYE', 'PAYE', 'EN_RETARD', 'ANNULE');

-- CreateEnum
CREATE TYPE "WebhookEventStatut" AS ENUM ('RECU', 'TRAITE', 'IGNORE', 'ERREUR');

-- CreateEnum
CREATE TYPE "DocumentCategorie" AS ENUM ('MANDAT', 'CONTRAT', 'DEVIS', 'SOUMISSION', 'FACTURE', 'ACTE_VENTE', 'RESERVATION', 'PLAN', 'PROJET', 'PERMIS', 'AUTORISATION', 'EXTRAIT_RF', 'PPE_ACTE_CONSTITUTIF', 'PPE_REGLEMENT', 'PPE_PLAN', 'MANDAT_COURTAGE', 'GARANTIE', 'PV_RECEPTION', 'PV_SEANCE', 'NOTE', 'PHOTO_CHANTIER', 'ASSURANCE', 'FINANCEMENT', 'ADMINISTRATIF', 'AUTRE');

-- CreateEnum
CREATE TYPE "SeanceType" AS ENUM ('CHANTIER', 'ADJUDICATION', 'COPIL', 'PROMOTEUR', 'TECHNIQUE', 'CLIENT_ACQUEREUR', 'NOTAIRE', 'AUTRE');

-- CreateEnum
CREATE TYPE "SeanceStatut" AS ENUM ('PLANIFIEE', 'TENUE', 'ANNULEE');

-- CreateEnum
CREATE TYPE "SeancePointStatut" AS ENUM ('OUVERT', 'EN_COURS', 'CLOS');

-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('POURCENTAGE', 'FORFAIT');

-- CreateEnum
CREATE TYPE "CourtagePerimetre" AS ENUM ('TOUTE_OPERATION', 'LOTS_SELECTIONNES');

-- CreateEnum
CREATE TYPE "MandatStatut" AS ENUM ('BROUILLON', 'SIGNE', 'ACTIF', 'TERMINE', 'RESILIE');

-- CreateEnum
CREATE TYPE "CommissionStatut" AS ENUM ('DUE', 'FACTUREE', 'PAYEE', 'ANNULEE');

-- CreateTable
CREATE TABLE "societes" (
    "id" SERIAL NOT NULL,
    "raison_sociale" TEXT NOT NULL,
    "forme_juridique" TEXT,
    "ide" TEXT,
    "numero_tva" TEXT,
    "adresse" TEXT,
    "code_postal" TEXT,
    "localite" TEXT,
    "canton" TEXT,
    "pays" TEXT NOT NULL DEFAULT 'CH',
    "email" TEXT,
    "telephone" TEXT,
    "logo_url" TEXT,
    "iban" TEXT,
    "profil" "SocieteProfil" NOT NULL DEFAULT 'PROMOTEUR',
    "modules_actifs" "AppModule"[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "societes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comptes" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "prenom" TEXT,
    "nom" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comptes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" SERIAL NOT NULL,
    "compte_id" INTEGER NOT NULL,
    "societe_id" INTEGER NOT NULL,
    "role" "UtilisateurRole" NOT NULL DEFAULT 'LECTURE_SEULE',
    "fonction" TEXT,
    "acteur_id" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "actionnaires" (
    "id" SERIAL NOT NULL,
    "societe_id" INTEGER NOT NULL,
    "nom" TEXT NOT NULL,
    "part_pct" DECIMAL(5,2),
    "fonction" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "actionnaires_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" SERIAL NOT NULL,
    "societe_id" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations" (
    "id" SERIAL NOT NULL,
    "societe_id" INTEGER NOT NULL,
    "nom" TEXT NOT NULL,
    "description" TEXT,
    "commune" TEXT,
    "canton" TEXT,
    "parcelle" TEXT,
    "statut" "OperationStatut" NOT NULL DEFAULT 'MONTAGE',
    "date_debut" TIMESTAMP(3),
    "date_livraison_prevue" TIMESTAMP(3),
    "prix_terrain" DECIMAL(12,2),
    "frais_notaire_terrain" DECIMAL(12,2),
    "droits_mutation" DECIMAL(12,2),
    "terrain_avec_batiment" BOOLEAN NOT NULL DEFAULT false,
    "mode_realisation" "ModeRealisation",
    "notaire_acteur_id" INTEGER,
    "maitre_ouvrage_acteur_id" INTEGER,
    "commercialisation_active" BOOLEAN NOT NULL DEFAULT true,
    "kolabimo_promotion_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acteurs" (
    "id" SERIAL NOT NULL,
    "societe_id" INTEGER NOT NULL,
    "type" "ActeurType" NOT NULL DEFAULT 'NOTAIRE',
    "type_libre" TEXT,
    "societe_nom" TEXT,
    "nom" TEXT,
    "prenom" TEXT,
    "adresse" TEXT,
    "code_postal" TEXT,
    "localite" TEXT,
    "email" TEXT,
    "telephone" TEXT,
    "ide" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "acteurs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operation_acteurs" (
    "id" SERIAL NOT NULL,
    "operation_id" INTEGER NOT NULL,
    "acteur_id" INTEGER NOT NULL,
    "role" "ActeurType" NOT NULL,
    "role_libre" TEXT,
    "est_mandataire_general" BOOLEAN NOT NULL DEFAULT false,
    "suit_le_projet" BOOLEAN NOT NULL DEFAULT true,
    "montant_mandat" DECIMAL(12,2),
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operation_acteurs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "biens" (
    "id" SERIAL NOT NULL,
    "operation_id" INTEGER NOT NULL,
    "nature" "BienNature" NOT NULL DEFAULT 'IMMEUBLE',
    "nom" TEXT NOT NULL,
    "nb_etages" INTEGER,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "biens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lots" (
    "id" SERIAL NOT NULL,
    "bien_id" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "etage" INTEGER,
    "nombre_pieces" DECIMAL(3,1),
    "surface_m2" DECIMAL(7,2),
    "quote_part_ppe" DECIMAL(6,3),
    "prix_vente" DECIMAL(12,2),
    "statut" "LotStatut" NOT NULL DEFAULT 'DISPONIBLE',
    "kolabimo_appartement_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parkings" (
    "id" SERIAL NOT NULL,
    "lot_id" INTEGER NOT NULL,
    "reference" TEXT,
    "type" "ParkingType" NOT NULL DEFAULT 'EXTERIEURE',
    "prix" DECIMAL(12,2),
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "kolabimo_parking_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parkings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cfc_nodes" (
    "id" SERIAL NOT NULL,
    "operation_id" INTEGER NOT NULL,
    "parent_id" INTEGER,
    "code" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "niveau" INTEGER NOT NULL,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cfc_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_versions" (
    "id" SERIAL NOT NULL,
    "operation_id" INTEGER NOT NULL,
    "libelle" TEXT NOT NULL,
    "statut" "BudgetVersionStatut" NOT NULL DEFAULT 'BROUILLON',
    "is_courant" BOOLEAN NOT NULL DEFAULT false,
    "commentaire" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lignes_budget" (
    "id" SERIAL NOT NULL,
    "budget_version_id" INTEGER NOT NULL,
    "cfc_node_id" INTEGER NOT NULL,
    "designation" TEXT,
    "quantite" DECIMAL(12,3),
    "prix_unitaire" DECIMAL(12,2),
    "montant" DECIMAL(12,2) NOT NULL,
    "tva_pct" DECIMAL(4,2) DEFAULT 8.10,
    "est_reserve" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,

    CONSTRAINT "lignes_budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entreprises" (
    "id" SERIAL NOT NULL,
    "societe_id" INTEGER NOT NULL,
    "nom" TEXT NOT NULL,
    "corps_metier" TEXT,
    "contact_nom" TEXT,
    "email" TEXT,
    "telephone" TEXT,
    "ide" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entreprises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "soumissions" (
    "id" SERIAL NOT NULL,
    "operation_id" INTEGER NOT NULL,
    "cfc_node_id" INTEGER,
    "intitule" TEXT NOT NULL,
    "corps_metier" TEXT,
    "statut" "SoumissionStatut" NOT NULL DEFAULT 'BROUILLON',
    "date_envoi" TIMESTAMP(3),
    "date_limite" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "soumissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "soumission_invitations" (
    "id" SERIAL NOT NULL,
    "soumission_id" INTEGER NOT NULL,
    "entreprise_id" INTEGER NOT NULL,
    "date_envoi" TIMESTAMP(3),
    "a_repondu" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "soumission_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offres" (
    "id" SERIAL NOT NULL,
    "soumission_id" INTEGER NOT NULL,
    "entreprise_id" INTEGER NOT NULL,
    "montant" DECIMAL(12,2),
    "remise_pct" DECIMAL(4,2),
    "statut" "OffreStatut" NOT NULL DEFAULT 'ATTENDUE',
    "date_reception" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offres_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adjudications" (
    "id" SERIAL NOT NULL,
    "soumission_id" INTEGER NOT NULL,
    "offre_id" INTEGER NOT NULL,
    "montant_adjuge" DECIMAL(12,2) NOT NULL,
    "date_decision" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decide_par" INTEGER,
    "commentaire" TEXT,

    CONSTRAINT "adjudications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contrats" (
    "id" SERIAL NOT NULL,
    "operation_id" INTEGER NOT NULL,
    "entreprise_id" INTEGER NOT NULL,
    "cfc_node_id" INTEGER,
    "adjudication_id" INTEGER,
    "reference" TEXT,
    "montant" DECIMAL(12,2) NOT NULL,
    "retenue_garantie_pct" DECIMAL(4,2),
    "statut" "ContratStatut" NOT NULL DEFAULT 'BROUILLON',
    "date_signature" TIMESTAMP(3),
    "date_reception" TIMESTAMP(3),
    "fin_garantie" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contrats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "avenants" (
    "id" SERIAL NOT NULL,
    "contrat_id" INTEGER NOT NULL,
    "cfc_node_id" INTEGER,
    "reference" TEXT,
    "montant" DECIMAL(12,2) NOT NULL,
    "motif" TEXT,
    "date_avenant" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "avenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factures" (
    "id" SERIAL NOT NULL,
    "societe_id" INTEGER NOT NULL,
    "operation_id" INTEGER NOT NULL,
    "contrat_id" INTEGER,
    "entreprise_id" INTEGER,
    "cfc_node_id" INTEGER,
    "type" "FactureType" NOT NULL DEFAULT 'SITUATION',
    "statut" "FactureStatut" NOT NULL DEFAULT 'RECUE',
    "numero" TEXT,
    "date_facture" TIMESTAMP(3),
    "montant_ht" DECIMAL(12,2),
    "tva_pct" DECIMAL(4,2),
    "montant_ttc" DECIMAL(12,2),
    "fichier_url" TEXT,
    "ocr_statut" "OcrStatut" NOT NULL DEFAULT 'EN_ATTENTE',
    "ocr_texte" TEXT,
    "cfc_suggere_id" INTEGER,
    "ocr_confiance" DECIMAL(5,2),
    "valide_par" INTEGER,
    "date_validation" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "factures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paiements_fournisseurs" (
    "id" SERIAL NOT NULL,
    "facture_id" INTEGER NOT NULL,
    "montant" DECIMAL(12,2) NOT NULL,
    "date_valeur" TIMESTAMP(3) NOT NULL,
    "moyen" TEXT,
    "reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paiements_fournisseurs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acquereurs" (
    "id" SERIAL NOT NULL,
    "societe_id" INTEGER NOT NULL,
    "nom" TEXT,
    "prenom" TEXT,
    "email" TEXT,
    "telephone" TEXT,
    "adresse" TEXT,
    "kolabimo_client_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acquereurs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" SERIAL NOT NULL,
    "operation_id" INTEGER NOT NULL,
    "lot_id" INTEGER NOT NULL,
    "acquereur_id" INTEGER NOT NULL,
    "statut" "ReservationStatut" NOT NULL DEFAULT 'OPTION',
    "prix_total_acte" DECIMAL(12,2),
    "date_reservation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date_signature_acte" TIMESTAMP(3),
    "notaire_acteur_id" INTEGER,
    "external_id" TEXT,
    "kolabimo_reservation_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "echeancier_etapes" (
    "id" SERIAL NOT NULL,
    "operation_id" INTEGER NOT NULL,
    "ordre" INTEGER NOT NULL,
    "libelle" TEXT NOT NULL,
    "description" TEXT,
    "pourcentage" DECIMAL(5,2),
    "statut" "EcheancierEtapeStatut" NOT NULL DEFAULT 'NOT_STARTED',
    "date_completion" TIMESTAMP(3),
    "date_prevue" TIMESTAMP(3),
    "kolabimo_etape_id" INTEGER,
    "synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "echeancier_etapes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appels_de_fonds" (
    "id" SERIAL NOT NULL,
    "reservation_id" INTEGER NOT NULL,
    "etape_id" INTEGER NOT NULL,
    "numero" TEXT,
    "pourcentage" DECIMAL(5,2) NOT NULL,
    "montant" DECIMAL(12,2) NOT NULL,
    "statut" "AppelDeFondsStatut" NOT NULL DEFAULT 'BROUILLON',
    "date_emission" TIMESTAMP(3),
    "date_envoi" TIMESTAMP(3),
    "date_echeance" TIMESTAMP(3),
    "fichier_url" TEXT,
    "qr_reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appels_de_fonds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "encaissements" (
    "id" SERIAL NOT NULL,
    "appel_de_fonds_id" INTEGER NOT NULL,
    "montant" DECIMAL(12,2) NOT NULL,
    "date_valeur" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "source" TEXT,
    "confirme_par_id" INTEGER,
    "date_confirmation" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "encaissements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" SERIAL NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'kolabimo',
    "evenement" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "statut" "WebhookEventStatut" NOT NULL DEFAULT 'RECU',
    "erreur" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "societe_id" INTEGER NOT NULL,
    "utilisateur_id" INTEGER,
    "action" TEXT NOT NULL,
    "entite" TEXT NOT NULL,
    "entite_id" INTEGER,
    "donnees" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" SERIAL NOT NULL,
    "societe_id" INTEGER NOT NULL,
    "categorie" "DocumentCategorie" NOT NULL DEFAULT 'AUTRE',
    "titre" TEXT NOT NULL,
    "description" TEXT,
    "file_name" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_courant" BOOLEAN NOT NULL DEFAULT true,
    "parent_document_id" INTEGER,
    "visibilite_externe" BOOLEAN NOT NULL DEFAULT false,
    "uploaded_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "operation_id" INTEGER,
    "lot_id" INTEGER,
    "soumission_id" INTEGER,
    "contrat_id" INTEGER,
    "facture_id" INTEGER,
    "reservation_id" INTEGER,
    "acteur_id" INTEGER,
    "seance_id" INTEGER,
    "parcelle_id" INTEGER,
    "ppe_id" INTEGER,
    "mandat_courtage_id" INTEGER,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seances" (
    "id" SERIAL NOT NULL,
    "societe_id" INTEGER NOT NULL,
    "operation_id" INTEGER NOT NULL,
    "type" "SeanceType" NOT NULL DEFAULT 'CHANTIER',
    "titre" TEXT NOT NULL,
    "statut" "SeanceStatut" NOT NULL DEFAULT 'PLANIFIEE',
    "date" TIMESTAMP(3),
    "lieu" TEXT,
    "ordre_du_jour" TEXT,
    "notes" TEXT,
    "numero" TEXT,
    "created_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seance_participants" (
    "id" SERIAL NOT NULL,
    "seance_id" INTEGER NOT NULL,
    "membership_id" INTEGER,
    "acteur_id" INTEGER,
    "nom" TEXT,
    "organisation" TEXT,
    "email" TEXT,
    "present" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "seance_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seance_points" (
    "id" SERIAL NOT NULL,
    "seance_id" INTEGER NOT NULL,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "titre" TEXT NOT NULL,
    "contenu" TEXT,
    "responsable" TEXT,
    "echeance" TIMESTAMP(3),
    "statut" "SeancePointStatut" NOT NULL DEFAULT 'OUVERT',
    "cfc_node_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seance_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parcelles" (
    "id" SERIAL NOT NULL,
    "operation_id" INTEGER NOT NULL,
    "numero" TEXT NOT NULL,
    "egrid" TEXT,
    "commune" TEXT,
    "surface_m2" DECIMAL(12,2),
    "affectation_zone" TEXT,
    "registre_foncier" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parcelles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ppes" (
    "id" SERIAL NOT NULL,
    "operation_id" INTEGER NOT NULL,
    "bien_id" INTEGER,
    "numero" TEXT,
    "date_acte_constitutif" TIMESTAMP(3),
    "notaire_acteur_id" INTEGER,
    "total_millemes" INTEGER NOT NULL DEFAULT 1000,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ppes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mandats_courtage" (
    "id" SERIAL NOT NULL,
    "operation_id" INTEGER NOT NULL,
    "courtier_acteur_id" INTEGER NOT NULL,
    "commission_type" "CommissionType" NOT NULL DEFAULT 'POURCENTAGE',
    "commission_pct" DECIMAL(5,2),
    "commission_forfait" DECIMAL(12,2),
    "assiette_ttc" BOOLEAN NOT NULL DEFAULT false,
    "perimetre" "CourtagePerimetre" NOT NULL DEFAULT 'TOUTE_OPERATION',
    "exclusif" BOOLEAN NOT NULL DEFAULT false,
    "date_signature" TIMESTAMP(3),
    "statut" "MandatStatut" NOT NULL DEFAULT 'BROUILLON',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mandats_courtage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mandat_courtage_lots" (
    "id" SERIAL NOT NULL,
    "mandat_courtage_id" INTEGER NOT NULL,
    "lot_id" INTEGER NOT NULL,

    CONSTRAINT "mandat_courtage_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commissions_courtage" (
    "id" SERIAL NOT NULL,
    "mandat_courtage_id" INTEGER NOT NULL,
    "reservation_id" INTEGER NOT NULL,
    "montant" DECIMAL(12,2) NOT NULL,
    "statut" "CommissionStatut" NOT NULL DEFAULT 'DUE',
    "date_due" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commissions_courtage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operation_accesses" (
    "id" SERIAL NOT NULL,
    "operation_id" INTEGER NOT NULL,
    "membership_id" INTEGER NOT NULL,
    "access_level" "OperationAccessLevel" NOT NULL DEFAULT 'READ_ONLY',
    "modules" "AccessModule"[],
    "granted_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operation_accesses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "comptes_email_key" ON "comptes"("email");

-- CreateIndex
CREATE INDEX "memberships_societe_id_idx" ON "memberships"("societe_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_compte_id_societe_id_key" ON "memberships"("compte_id", "societe_id");

-- CreateIndex
CREATE INDEX "actionnaires_societe_id_idx" ON "actionnaires"("societe_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_key" ON "api_keys"("key");

-- CreateIndex
CREATE INDEX "operations_societe_id_idx" ON "operations"("societe_id");

-- CreateIndex
CREATE INDEX "operations_kolabimo_promotion_id_idx" ON "operations"("kolabimo_promotion_id");

-- CreateIndex
CREATE INDEX "acteurs_societe_id_type_idx" ON "acteurs"("societe_id", "type");

-- CreateIndex
CREATE INDEX "operation_acteurs_operation_id_idx" ON "operation_acteurs"("operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "operation_acteurs_operation_id_acteur_id_role_key" ON "operation_acteurs"("operation_id", "acteur_id", "role");

-- CreateIndex
CREATE INDEX "biens_operation_id_idx" ON "biens"("operation_id");

-- CreateIndex
CREATE INDEX "lots_bien_id_idx" ON "lots"("bien_id");

-- CreateIndex
CREATE INDEX "lots_kolabimo_appartement_id_idx" ON "lots"("kolabimo_appartement_id");

-- CreateIndex
CREATE INDEX "parkings_lot_id_idx" ON "parkings"("lot_id");

-- CreateIndex
CREATE INDEX "cfc_nodes_operation_id_idx" ON "cfc_nodes"("operation_id");

-- CreateIndex
CREATE INDEX "cfc_nodes_parent_id_idx" ON "cfc_nodes"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "cfc_nodes_operation_id_code_key" ON "cfc_nodes"("operation_id", "code");

-- CreateIndex
CREATE INDEX "budget_versions_operation_id_idx" ON "budget_versions"("operation_id");

-- CreateIndex
CREATE INDEX "lignes_budget_budget_version_id_idx" ON "lignes_budget"("budget_version_id");

-- CreateIndex
CREATE INDEX "lignes_budget_cfc_node_id_idx" ON "lignes_budget"("cfc_node_id");

-- CreateIndex
CREATE INDEX "entreprises_societe_id_idx" ON "entreprises"("societe_id");

-- CreateIndex
CREATE INDEX "soumissions_operation_id_idx" ON "soumissions"("operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "soumission_invitations_soumission_id_entreprise_id_key" ON "soumission_invitations"("soumission_id", "entreprise_id");

-- CreateIndex
CREATE INDEX "offres_soumission_id_idx" ON "offres"("soumission_id");

-- CreateIndex
CREATE UNIQUE INDEX "adjudications_soumission_id_key" ON "adjudications"("soumission_id");

-- CreateIndex
CREATE UNIQUE INDEX "adjudications_offre_id_key" ON "adjudications"("offre_id");

-- CreateIndex
CREATE UNIQUE INDEX "contrats_adjudication_id_key" ON "contrats"("adjudication_id");

-- CreateIndex
CREATE INDEX "contrats_operation_id_idx" ON "contrats"("operation_id");

-- CreateIndex
CREATE INDEX "contrats_entreprise_id_idx" ON "contrats"("entreprise_id");

-- CreateIndex
CREATE INDEX "avenants_contrat_id_idx" ON "avenants"("contrat_id");

-- CreateIndex
CREATE INDEX "factures_operation_id_idx" ON "factures"("operation_id");

-- CreateIndex
CREATE INDEX "factures_cfc_node_id_idx" ON "factures"("cfc_node_id");

-- CreateIndex
CREATE INDEX "factures_statut_idx" ON "factures"("statut");

-- CreateIndex
CREATE INDEX "paiements_fournisseurs_facture_id_idx" ON "paiements_fournisseurs"("facture_id");

-- CreateIndex
CREATE INDEX "acquereurs_societe_id_idx" ON "acquereurs"("societe_id");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_external_id_key" ON "reservations"("external_id");

-- CreateIndex
CREATE INDEX "reservations_operation_id_idx" ON "reservations"("operation_id");

-- CreateIndex
CREATE INDEX "reservations_lot_id_idx" ON "reservations"("lot_id");

-- CreateIndex
CREATE INDEX "echeancier_etapes_operation_id_idx" ON "echeancier_etapes"("operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "echeancier_etapes_operation_id_ordre_key" ON "echeancier_etapes"("operation_id", "ordre");

-- CreateIndex
CREATE INDEX "appels_de_fonds_reservation_id_idx" ON "appels_de_fonds"("reservation_id");

-- CreateIndex
CREATE INDEX "appels_de_fonds_statut_idx" ON "appels_de_fonds"("statut");

-- CreateIndex
CREATE UNIQUE INDEX "appels_de_fonds_reservation_id_etape_id_key" ON "appels_de_fonds"("reservation_id", "etape_id");

-- CreateIndex
CREATE INDEX "encaissements_appel_de_fonds_id_idx" ON "encaissements"("appel_de_fonds_id");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_dedupe_key_key" ON "webhook_events"("dedupe_key");

-- CreateIndex
CREATE INDEX "webhook_events_evenement_statut_idx" ON "webhook_events"("evenement", "statut");

-- CreateIndex
CREATE INDEX "audit_logs_societe_id_created_at_idx" ON "audit_logs"("societe_id", "created_at");

-- CreateIndex
CREATE INDEX "documents_societe_id_idx" ON "documents"("societe_id");

-- CreateIndex
CREATE INDEX "documents_operation_id_categorie_idx" ON "documents"("operation_id", "categorie");

-- CreateIndex
CREATE INDEX "seances_operation_id_date_idx" ON "seances"("operation_id", "date");

-- CreateIndex
CREATE INDEX "seance_participants_seance_id_idx" ON "seance_participants"("seance_id");

-- CreateIndex
CREATE INDEX "seance_points_seance_id_idx" ON "seance_points"("seance_id");

-- CreateIndex
CREATE INDEX "parcelles_operation_id_idx" ON "parcelles"("operation_id");

-- CreateIndex
CREATE INDEX "ppes_operation_id_idx" ON "ppes"("operation_id");

-- CreateIndex
CREATE INDEX "mandats_courtage_operation_id_idx" ON "mandats_courtage"("operation_id");

-- CreateIndex
CREATE INDEX "mandats_courtage_courtier_acteur_id_idx" ON "mandats_courtage"("courtier_acteur_id");

-- CreateIndex
CREATE UNIQUE INDEX "mandat_courtage_lots_mandat_courtage_id_lot_id_key" ON "mandat_courtage_lots"("mandat_courtage_id", "lot_id");

-- CreateIndex
CREATE INDEX "commissions_courtage_mandat_courtage_id_idx" ON "commissions_courtage"("mandat_courtage_id");

-- CreateIndex
CREATE INDEX "commissions_courtage_reservation_id_idx" ON "commissions_courtage"("reservation_id");

-- CreateIndex
CREATE INDEX "operation_accesses_operation_id_idx" ON "operation_accesses"("operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "operation_accesses_operation_id_membership_id_key" ON "operation_accesses"("operation_id", "membership_id");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_compte_id_fkey" FOREIGN KEY ("compte_id") REFERENCES "comptes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_societe_id_fkey" FOREIGN KEY ("societe_id") REFERENCES "societes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_acteur_id_fkey" FOREIGN KEY ("acteur_id") REFERENCES "acteurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actionnaires" ADD CONSTRAINT "actionnaires_societe_id_fkey" FOREIGN KEY ("societe_id") REFERENCES "societes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_societe_id_fkey" FOREIGN KEY ("societe_id") REFERENCES "societes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_societe_id_fkey" FOREIGN KEY ("societe_id") REFERENCES "societes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_notaire_acteur_id_fkey" FOREIGN KEY ("notaire_acteur_id") REFERENCES "acteurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_maitre_ouvrage_acteur_id_fkey" FOREIGN KEY ("maitre_ouvrage_acteur_id") REFERENCES "acteurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acteurs" ADD CONSTRAINT "acteurs_societe_id_fkey" FOREIGN KEY ("societe_id") REFERENCES "societes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_acteurs" ADD CONSTRAINT "operation_acteurs_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_acteurs" ADD CONSTRAINT "operation_acteurs_acteur_id_fkey" FOREIGN KEY ("acteur_id") REFERENCES "acteurs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biens" ADD CONSTRAINT "biens_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_bien_id_fkey" FOREIGN KEY ("bien_id") REFERENCES "biens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parkings" ADD CONSTRAINT "parkings_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cfc_nodes" ADD CONSTRAINT "cfc_nodes_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cfc_nodes" ADD CONSTRAINT "cfc_nodes_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "cfc_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_versions" ADD CONSTRAINT "budget_versions_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lignes_budget" ADD CONSTRAINT "lignes_budget_budget_version_id_fkey" FOREIGN KEY ("budget_version_id") REFERENCES "budget_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lignes_budget" ADD CONSTRAINT "lignes_budget_cfc_node_id_fkey" FOREIGN KEY ("cfc_node_id") REFERENCES "cfc_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entreprises" ADD CONSTRAINT "entreprises_societe_id_fkey" FOREIGN KEY ("societe_id") REFERENCES "societes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "soumissions" ADD CONSTRAINT "soumissions_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "soumissions" ADD CONSTRAINT "soumissions_cfc_node_id_fkey" FOREIGN KEY ("cfc_node_id") REFERENCES "cfc_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "soumission_invitations" ADD CONSTRAINT "soumission_invitations_soumission_id_fkey" FOREIGN KEY ("soumission_id") REFERENCES "soumissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "soumission_invitations" ADD CONSTRAINT "soumission_invitations_entreprise_id_fkey" FOREIGN KEY ("entreprise_id") REFERENCES "entreprises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offres" ADD CONSTRAINT "offres_soumission_id_fkey" FOREIGN KEY ("soumission_id") REFERENCES "soumissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offres" ADD CONSTRAINT "offres_entreprise_id_fkey" FOREIGN KEY ("entreprise_id") REFERENCES "entreprises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjudications" ADD CONSTRAINT "adjudications_soumission_id_fkey" FOREIGN KEY ("soumission_id") REFERENCES "soumissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjudications" ADD CONSTRAINT "adjudications_offre_id_fkey" FOREIGN KEY ("offre_id") REFERENCES "offres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contrats" ADD CONSTRAINT "contrats_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contrats" ADD CONSTRAINT "contrats_entreprise_id_fkey" FOREIGN KEY ("entreprise_id") REFERENCES "entreprises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contrats" ADD CONSTRAINT "contrats_cfc_node_id_fkey" FOREIGN KEY ("cfc_node_id") REFERENCES "cfc_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contrats" ADD CONSTRAINT "contrats_adjudication_id_fkey" FOREIGN KEY ("adjudication_id") REFERENCES "adjudications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avenants" ADD CONSTRAINT "avenants_contrat_id_fkey" FOREIGN KEY ("contrat_id") REFERENCES "contrats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avenants" ADD CONSTRAINT "avenants_cfc_node_id_fkey" FOREIGN KEY ("cfc_node_id") REFERENCES "cfc_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factures" ADD CONSTRAINT "factures_societe_id_fkey" FOREIGN KEY ("societe_id") REFERENCES "societes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factures" ADD CONSTRAINT "factures_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factures" ADD CONSTRAINT "factures_contrat_id_fkey" FOREIGN KEY ("contrat_id") REFERENCES "contrats"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factures" ADD CONSTRAINT "factures_entreprise_id_fkey" FOREIGN KEY ("entreprise_id") REFERENCES "entreprises"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factures" ADD CONSTRAINT "factures_cfc_node_id_fkey" FOREIGN KEY ("cfc_node_id") REFERENCES "cfc_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paiements_fournisseurs" ADD CONSTRAINT "paiements_fournisseurs_facture_id_fkey" FOREIGN KEY ("facture_id") REFERENCES "factures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acquereurs" ADD CONSTRAINT "acquereurs_societe_id_fkey" FOREIGN KEY ("societe_id") REFERENCES "societes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_acquereur_id_fkey" FOREIGN KEY ("acquereur_id") REFERENCES "acquereurs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_notaire_acteur_id_fkey" FOREIGN KEY ("notaire_acteur_id") REFERENCES "acteurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "echeancier_etapes" ADD CONSTRAINT "echeancier_etapes_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appels_de_fonds" ADD CONSTRAINT "appels_de_fonds_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appels_de_fonds" ADD CONSTRAINT "appels_de_fonds_etape_id_fkey" FOREIGN KEY ("etape_id") REFERENCES "echeancier_etapes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encaissements" ADD CONSTRAINT "encaissements_appel_de_fonds_id_fkey" FOREIGN KEY ("appel_de_fonds_id") REFERENCES "appels_de_fonds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_societe_id_fkey" FOREIGN KEY ("societe_id") REFERENCES "societes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_societe_id_fkey" FOREIGN KEY ("societe_id") REFERENCES "societes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_soumission_id_fkey" FOREIGN KEY ("soumission_id") REFERENCES "soumissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_contrat_id_fkey" FOREIGN KEY ("contrat_id") REFERENCES "contrats"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_facture_id_fkey" FOREIGN KEY ("facture_id") REFERENCES "factures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_acteur_id_fkey" FOREIGN KEY ("acteur_id") REFERENCES "acteurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_seance_id_fkey" FOREIGN KEY ("seance_id") REFERENCES "seances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_parcelle_id_fkey" FOREIGN KEY ("parcelle_id") REFERENCES "parcelles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_ppe_id_fkey" FOREIGN KEY ("ppe_id") REFERENCES "ppes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_mandat_courtage_id_fkey" FOREIGN KEY ("mandat_courtage_id") REFERENCES "mandats_courtage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_parent_document_id_fkey" FOREIGN KEY ("parent_document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seances" ADD CONSTRAINT "seances_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seance_participants" ADD CONSTRAINT "seance_participants_seance_id_fkey" FOREIGN KEY ("seance_id") REFERENCES "seances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seance_points" ADD CONSTRAINT "seance_points_seance_id_fkey" FOREIGN KEY ("seance_id") REFERENCES "seances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcelles" ADD CONSTRAINT "parcelles_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ppes" ADD CONSTRAINT "ppes_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mandats_courtage" ADD CONSTRAINT "mandats_courtage_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mandats_courtage" ADD CONSTRAINT "mandats_courtage_courtier_acteur_id_fkey" FOREIGN KEY ("courtier_acteur_id") REFERENCES "acteurs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mandat_courtage_lots" ADD CONSTRAINT "mandat_courtage_lots_mandat_courtage_id_fkey" FOREIGN KEY ("mandat_courtage_id") REFERENCES "mandats_courtage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mandat_courtage_lots" ADD CONSTRAINT "mandat_courtage_lots_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions_courtage" ADD CONSTRAINT "commissions_courtage_mandat_courtage_id_fkey" FOREIGN KEY ("mandat_courtage_id") REFERENCES "mandats_courtage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions_courtage" ADD CONSTRAINT "commissions_courtage_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_accesses" ADD CONSTRAINT "operation_accesses_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_accesses" ADD CONSTRAINT "operation_accesses_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
