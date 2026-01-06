// État de l'application
let entreprisesData = [];
let entreprisesVerifiees = [];

// Éléments DOM
const searchForm = document.getElementById('searchForm');
const resultsSection = document.getElementById('resultsSection');
const loadingSection = document.getElementById('loadingSection');
const errorSection = document.getElementById('errorSection');
const btnVerifierSites = document.getElementById('btnVerifierSites');
const btnExporter = document.getElementById('btnExporter');
const resultsTableBody = document.getElementById('resultsTableBody');
const statsContainer = document.getElementById('statsContainer');

// Gestion du formulaire de recherche
searchForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const formData = {
        secteur: document.getElementById('secteur').value.trim(),
        ville: document.getElementById('ville').value.trim(),
        code_postal: document.getElementById('code_postal').value.trim(),
        limite: parseInt(document.getElementById('limite').value),
        type_entreprise: document.getElementById('type_entreprise').value
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

        const response = await fetch('/api/exporter', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                entreprises: entreprisesVerifiees,
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

    entreprises.forEach(ent => {
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

        row.innerHTML = `
            <td><strong>${escapeHtml(ent.nom)}</strong>${infoComplementaires}</td>
            <td>${escapeHtml(ent.ville)}</td>
            <td>${escapeHtml(ent.code_postal)}</td>
            <td>${escapeHtml(ent.activite)}</td>
            <td>${statutSite}</td>
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

// Message de bienvenue dans la console
console.log('%c🎯 Prospecteur Web', 'font-size: 20px; font-weight: bold; color: #667eea');
console.log('Application développée pour faciliter la prospection commerciale');