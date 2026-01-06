// État de l'application
let entreprisesData = [];
let entreprisesVerifiees = [];
let suiviEntreprises = {}; // {siret: {statut, notes, dernierContact}}

// Statuts possibles
const STATUTS = {
    'a_demarcher': { label: 'À démarcher', color: '#718096' },
    'contacte': { label: 'Contacté', color: '#5a6c7d' },
    'negociation': { label: 'En négociation', color: '#4a5568' },
    'interesse': { label: 'Intéressé', color: '#2c3e50' },
    'refuse': { label: 'Refusé', color: '#95a5a6' },
    'client': { label: 'Client', color: '#2c3e50' }
};

// Gestion du localStorage
function chargerSuivi() {
    const data = localStorage.getItem('prospecteur_suivi');
    if (data) {
        try {
            suiviEntreprises = JSON.parse(data);
        } catch (e) {
            console.error('Erreur chargement localStorage:', e);
            suiviEntreprises = {};
        }
    }
}

function sauvegarderSuivi() {
    localStorage.setItem('prospecteur_suivi', JSON.stringify(suiviEntreprises));
}

function mettreAJourSuivi(siret, statut, notes) {
    suiviEntreprises[siret] = {
        statut: statut,
        notes: notes || '',
        dernierContact: new Date().toISOString()
    };
    sauvegarderSuivi();
}

function obtenirSuivi(siret) {
    return suiviEntreprises[siret] || null;
}

// Éléments DOM
const searchForm = document.getElementById('searchForm');
const resultsSection = document.getElementById('resultsSection');
const loadingSection = document.getElementById('loadingSection');
const errorSection = document.getElementById('errorSection');
const btnVerifierSites = document.getElementById('btnVerifierSites');
const btnExporter = document.getElementById('btnExporter');
const resultsTableBody = document.getElementById('resultsTableBody');
const statsContainer = document.getElementById('statsContainer');
const filtreSuivi = document.getElementById('filtreSuivi');

// Gestion du formulaire de recherche
searchForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const codePostalInput = document.getElementById('code_postal').value.trim();

    // Valider le code postal s'il est fourni
    if (codePostalInput && !/^\d{5}$/.test(codePostalInput)) {
        afficherErreur('Le code postal doit contenir exactement 5 chiffres (ex: 35000, 75001)');
        return;
    }

    const formData = {
        secteur: '',  // Pas de secteur, on récupère tout
        ville: document.getElementById('ville').value.trim(),
        code_postal: codePostalInput,
        limite: parseInt(document.getElementById('limite').value)
    };

    await rechercherEntreprises(formData);
});

// Bouton vérifier sites
btnVerifierSites.addEventListener('click', async () => {
    if (entreprisesData.length === 0) {
        afficherErreur('Aucune entreprise à vérifier');
        return;
    }

    await verifierSitesWeb();
});

// Bouton exporter
btnExporter.addEventListener('click', async () => {
    if (entreprisesVerifiees.length === 0) {
        afficherErreur('Aucune donnée à exporter');
        return;
    }

    await exporterResultats();
});

// Filtre par statut de suivi
filtreSuivi.addEventListener('change', () => {
    if (entreprisesVerifiees.length > 0) {
        afficherResultats(entreprisesVerifiees, true);
    } else if (entreprisesData.length > 0) {
        afficherResultats(entreprisesData);
    }
});

// Fonction de recherche d'entreprises
async function rechercherEntreprises(formData) {
    try {
        afficherChargement('Recherche des entreprises en cours...');
        cacherErreur();
        cacherResultats();

        const response = await fetch('/api/rechercher', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });

        const data = await response.json();

        if (!data.success) {
            afficherErreur(data.error || 'Erreur lors de la recherche');
            return;
        }

        if (data.entreprises.length === 0) {
            afficherErreur('Aucune entreprise trouvée pour ces critères. Essayez avec d\'autres mots-clés.');
            return;
        }

        entreprisesData = data.entreprises;
        entreprisesVerifiees = [];

        // Réinitialiser le filtre de suivi
        filtreSuivi.value = '';

        afficherResultats(entreprisesData);
        afficherStats({
            total: data.entreprises.length,
            avec_site: 0,
            sans_site: 0
        });

        btnVerifierSites.style.display = 'inline-block';
        btnExporter.style.display = 'none';

    } catch (error) {
        afficherErreur('Erreur de connexion au serveur : ' + error.message);
    } finally {
        cacherChargement();
    }
}

// Fonction de vérification des sites web (méthode hybride)
async function verifierSitesWeb() {
    try {
        afficherChargement('Vérification des sites web en cours...');
        toggleButton(btnVerifierSites, true);

        const response = await fetch('/api/verifier-sites-hybride', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                entreprises: entreprisesData
            })
        });

        const data = await response.json();

        if (!data.success) {
            afficherErreur(data.error || 'Erreur lors de la vérification');
            return;
        }

        entreprisesVerifiees = data.resultats;

        afficherResultats(entreprisesVerifiees, true);
        afficherStats(data.stats, data.google_api_active);

        btnExporter.style.display = 'inline-block';

    } catch (error) {
        afficherErreur('Erreur de connexion au serveur : ' + error.message);
    } finally {
        cacherChargement();
        toggleButton(btnVerifierSites, false);
    }
}

// Fonction d'export
async function exporterResultats() {
    try {
        toggleButton(btnExporter, true);

        // Enrichir les entreprises avec les données de suivi
        const entreprisesAvecSuivi = entreprisesVerifiees.map(ent => {
            const suivi = obtenirSuivi(ent.siret);
            return {
                ...ent,
                suivi: suivi
            };
        });

        const response = await fetch('/api/exporter', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                entreprises: entreprisesAvecSuivi,
                seulement_sans_site: true
            })
        });

        if (!response.ok) {
            afficherErreur('Erreur lors de l\'export');
            return;
        }

        // Télécharger le fichier
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `prospection_${Date.now()}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

    } catch (error) {
        afficherErreur('Erreur lors de l\'export : ' + error.message);
    } finally {
        toggleButton(btnExporter, false);
    }
}

// Affichage des résultats dans le tableau
function afficherResultats(entreprises, avecVerification = false) {
    resultsTableBody.innerHTML = '';

    // Appliquer le filtre de suivi
    const filtreStatut = filtreSuivi.value;
    let entreprisesFiltrees = entreprises;

    if (filtreStatut) {
        entreprisesFiltrees = entreprises.filter(ent => {
            const suivi = obtenirSuivi(ent.siret);
            if (filtreStatut === 'sans_suivi') {
                return !suivi;
            } else {
                return suivi && suivi.statut === filtreStatut;
            }
        });
    }

    entreprisesFiltrees.forEach(ent => {
        const row = document.createElement('tr');

        let statutSite = '<span class="badge badge-pending">Non vérifié</span>';
        let infoComplementaires = '';

        if (avecVerification) {
            if (ent.a_site_web) {
                const url = ent.url_site || '#';
                statutSite = `
                    <span class="badge badge-success">✓ Site trouvé</span><br>
                    <a href="${url}" target="_blank" class="site-link">${url}</a>
                `;
            } else {
                statutSite = '<span class="badge badge-danger">✗ Pas de site</span>';
            }

            // Afficher les infos enrichies Google si disponibles
            if (ent.telephone || ent.note) {
                infoComplementaires = '<div style="margin-top: 8px; font-size: 0.9em;">';
                if (ent.telephone) {
                    infoComplementaires += `<div>📞 ${escapeHtml(ent.telephone)}</div>`;
                }
                if (ent.note) {
                    infoComplementaires += `<div>⭐ ${ent.note}/5 (${ent.nombre_avis || 0} avis)</div>`;
                }
                infoComplementaires += '</div>';
            }
        }

        // Colonne de suivi
        const suivi = obtenirSuivi(ent.siret);
        let colonneSuivi;
        if (suivi) {
            const statut = STATUTS[suivi.statut];
            const date = new Date(suivi.dernierContact).toLocaleDateString('fr-FR');
            colonneSuivi = `
                <span class="statut-badge" style="background-color: ${statut.color}">${statut.label}</span>
                <div style="font-size: 0.8em; margin-top: 4px; color: #666;">Le ${date}</div>
                <button class="btn-suivi" data-siret="${ent.siret}" data-nom="${ent.nom.replace(/"/g, '&quot;')}">Modifier</button>
            `;
        } else {
            colonneSuivi = `<button class="btn-suivi" data-siret="${ent.siret}" data-nom="${ent.nom.replace(/"/g, '&quot;')}">Ajouter suivi</button>`;
        }

        row.innerHTML = `
            <td><strong>${escapeHtml(ent.nom)}</strong>${infoComplementaires}</td>
            <td>${escapeHtml(ent.ville)}</td>
            <td>${escapeHtml(ent.code_postal)}</td>
            <td>${escapeHtml(ent.activite)}</td>
            <td>${statutSite}</td>
            <td>${colonneSuivi}</td>
        `;

        resultsTableBody.appendChild(row);
    });

    resultsSection.style.display = 'block';
}

// Affichage des statistiques
function afficherStats(stats, googleApiActive = false) {
    let cartes = `
        <div class="stat-card total">
            <div class="stat-number">${stats.total}</div>
            <div class="stat-label">Entreprises trouvées</div>
        </div>
        <div class="stat-card with-site">
            <div class="stat-number">${stats.avec_site}</div>
            <div class="stat-label">Avec site web</div>
        </div>
        <div class="stat-card without-site">
            <div class="stat-number">${stats.sans_site}</div>
            <div class="stat-label">Sans site web</div>
        </div>
    `;

    // Ajouter les stats sur la méthode utilisée si disponibles
    if (stats.methode_google !== undefined) {
        cartes += `
            <div class="stat-card ${googleApiActive ? 'with-site' : 'without-site'}">
                <div class="stat-number">${googleApiActive ? '✓' : '✗'}</div>
                <div class="stat-label">${googleApiActive ? 'Google Places actif' : 'Mode gratuit'}</div>
            </div>
        `;
    }

    statsContainer.innerHTML = cartes;
}

// Gestion de l'affichage du chargement
function afficherChargement(message) {
    loadingSection.style.display = 'block';
    document.getElementById('loadingText').textContent = message;
}

function cacherChargement() {
    loadingSection.style.display = 'none';
}

// Gestion de l'affichage des erreurs
function afficherErreur(message) {
    errorSection.style.display = 'block';
    document.getElementById('errorText').textContent = message;
    setTimeout(() => {
        cacherErreur();
    }, 5000);
}

function cacherErreur() {
    errorSection.style.display = 'none';
}

// Gestion de l'affichage des résultats
function cacherResultats() {
    resultsSection.style.display = 'none';
}

// Toggle état des boutons
function toggleButton(button, loading) {
    if (loading) {
        button.disabled = true;
        button.querySelector('.btn-text').style.display = 'none';
        button.querySelector('.btn-loader').style.display = 'inline';
    } else {
        button.disabled = false;
        button.querySelector('.btn-text').style.display = 'inline';
        button.querySelector('.btn-loader').style.display = 'none';
    }
}

// Fonction utilitaire pour échapper HTML
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}

// Gestion du modal de suivi
function ouvrirModalSuivi(siret, nomEntreprise) {
    const modal = document.getElementById('suiviModal');
    const suiviForm = document.getElementById('suiviForm');
    const infoDiv = document.getElementById('suiviEntrepriseInfo');

    // Afficher les infos de l'entreprise
    infoDiv.innerHTML = `<strong>${nomEntreprise}</strong><br><small>SIRET: ${siret}</small>`;

    // Remplir le formulaire avec les données existantes
    document.getElementById('suiviSiret').value = siret;
    const suivi = obtenirSuivi(siret);

    if (suivi) {
        document.getElementById('suiviStatut').value = suivi.statut;
        document.getElementById('suiviNotes').value = suivi.notes;
    } else {
        suiviForm.reset();
        document.getElementById('suiviSiret').value = siret;
    }

    modal.style.display = 'flex';
}

function fermerModalSuivi() {
    document.getElementById('suiviModal').style.display = 'none';
}

// Gérer le formulaire de suivi
document.getElementById('suiviForm').addEventListener('submit', function(e) {
    e.preventDefault();

    const siret = document.getElementById('suiviSiret').value;
    const statut = document.getElementById('suiviStatut').value;
    const notes = document.getElementById('suiviNotes').value;

    mettreAJourSuivi(siret, statut, notes);
    fermerModalSuivi();

    // Rafraîchir l'affichage
    if (entreprisesVerifiees.length > 0) {
        afficherResultats(entreprisesVerifiees, true);
    } else if (entreprisesData.length > 0) {
        afficherResultats(entreprisesData);
    }

    // Rafraîchir le pipeline si on est sur l'onglet suivi
    const ongletSuivi = document.getElementById('onglet-suivi');
    if (ongletSuivi.classList.contains('active')) {
        afficherPipeline();
    }
});

// Fermer le modal en cliquant à l'extérieur
document.getElementById('suiviModal').addEventListener('click', function(e) {
    if (e.target === this) {
        fermerModalSuivi();
    }
});

// Charger le suivi au démarrage
chargerSuivi();

// Gestionnaire d'événements délégué pour les boutons de suivi
document.addEventListener('click', function(e) {
    if (e.target.classList.contains('btn-suivi') || e.target.closest('.btn-suivi')) {
        const button = e.target.classList.contains('btn-suivi') ? e.target : e.target.closest('.btn-suivi');
        const siret = button.dataset.siret;
        const nom = button.dataset.nom;
        if (siret && nom) {
            ouvrirModalSuivi(siret, nom);
        }
    }

    // Gestionnaire pour les cartes du pipeline
    if (e.target.classList.contains('pipeline-card') || e.target.closest('.pipeline-card')) {
        const card = e.target.classList.contains('pipeline-card') ? e.target : e.target.closest('.pipeline-card');
        const siret = card.dataset.siret;
        const nom = card.dataset.nom;
        if (siret && nom) {
            ouvrirModalSuivi(siret, nom);
        }
    }
});

// Gestion des onglets
function changerOnglet(onglet) {
    // Masquer tous les onglets
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });

    // Désactiver tous les boutons
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.remove('active');
    });

    // Activer l'onglet sélectionné
    document.getElementById('onglet-' + onglet).classList.add('active');

    // Activer le bouton correspondant
    event.target.classList.add('active');

    // Si on ouvre l'onglet suivi, afficher le pipeline
    if (onglet === 'suivi') {
        afficherPipeline();
    }
}

// Afficher le pipeline de prospection
function afficherPipeline() {
    const container = document.getElementById('pipelineContainer');

    // Organiser les entreprises par statut
    const entreprisesParStatut = {
        'a_demarcher': [],
        'contacte': [],
        'negociation': [],
        'interesse': [],
        'refuse': [],
        'client': []
    };

    // Récupérer toutes les entreprises suivies
    Object.keys(suiviEntreprises).forEach(siret => {
        const suivi = suiviEntreprises[siret];
        const statut = suivi.statut;

        // Chercher les infos de l'entreprise dans les données chargées
        let entreprise = entreprisesData.find(e => e.siret === siret);
        if (!entreprise) {
            entreprise = entreprisesVerifiees.find(e => e.siret === siret);
        }

        if (entreprise) {
            entreprisesParStatut[statut].push({
                ...entreprise,
                suivi: suivi
            });
        } else {
            // Si l'entreprise n'est pas dans les résultats, créer une entrée minimale
            entreprisesParStatut[statut].push({
                siret: siret,
                nom: 'Entreprise (données non disponibles)',
                ville: '-',
                code_postal: '-',
                activite: '-',
                suivi: suivi
            });
        }
    });

    // Créer le HTML du pipeline
    let html = '<div class="pipeline-grid">';

    Object.keys(STATUTS).forEach(statutKey => {
        const statut = STATUTS[statutKey];
        const entreprises = entreprisesParStatut[statutKey] || [];

        html += `
            <div class="pipeline-column">
                <div class="pipeline-column-header">
                    <span class="pipeline-column-title">${statut.label}</span>
                    <span class="pipeline-column-count">${entreprises.length}</span>
                </div>
        `;

        if (entreprises.length === 0) {
            html += '<div class="pipeline-empty">Aucune entreprise</div>';
        } else {
            entreprises.forEach(ent => {
                const date = new Date(ent.suivi.dernierContact).toLocaleDateString('fr-FR');
                html += `
                    <div class="pipeline-card" data-siret="${ent.siret}" data-nom="${ent.nom.replace(/"/g, '&quot;')}">
                        <div class="pipeline-card-name">${escapeHtml(ent.nom)}</div>
                        <div class="pipeline-card-info">📍 ${escapeHtml(ent.ville)} (${escapeHtml(ent.code_postal)})</div>
                        <div class="pipeline-card-info">💼 ${escapeHtml(ent.activite)}</div>
                `;

                if (ent.suivi.notes) {
                    html += `<div class="pipeline-card-notes">"${escapeHtml(ent.suivi.notes)}"</div>`;
                }

                html += `
                        <div class="pipeline-card-date">Dernière mise à jour: ${date}</div>
                    </div>
                `;
            });
        }

        html += '</div>';
    });

    html += '</div>';

    container.innerHTML = html;
}

// Message de bienvenue dans la console
console.log('%c🎯 Prospecteur Web', 'font-size: 20px; font-weight: bold; color: #2c3e50');
console.log('Application développée pour faciliter la prospection commerciale');