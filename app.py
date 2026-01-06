#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Application Flask pour rechercher des entreprises et vérifier leurs sites web
"""

from flask import Flask, render_template, request, jsonify, send_file
import requests
import socket
import csv
import io
from urllib.parse import urlparse, quote, urlencode
import concurrent.futures
import time
import re
import os
import sys
from dotenv import load_dotenv

# Charger les variables d'environnement
load_dotenv()

app = Flask(__name__)

# Configuration
API_SIRENE = "https://recherche-entreprises.api.gouv.fr/search"
GOOGLE_PLACES_API_KEY = os.getenv('GOOGLE_PLACES_API_KEY', '')
GOOGLE_PLACES_URL = "https://maps.googleapis.com/maps/api/place/textsearch/json"
GOOGLE_PLACE_DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json"
TIMEOUT = 5
MAX_WORKERS = 10


def normaliser_nom_domaine(nom_entreprise):
    """
    Normalise le nom d'entreprise pour créer des variantes de domaine
    """
    # Enlever les caractères spéciaux et normaliser
    nom = re.sub(r'[^\w\s-]', '', nom_entreprise.lower())
    nom = re.sub(r'\s+', '-', nom)
    nom = nom.replace('é', 'e').replace('è', 'e').replace('ê', 'e')
    nom = nom.replace('à', 'a').replace('â', 'a')
    nom = nom.replace('ù', 'u').replace('û', 'u')
    nom = nom.replace('ô', 'o').replace('ö', 'o')
    nom = nom.replace('ç', 'c')
    nom = nom.replace('î', 'i').replace('ï', 'i')

    # Enlever les mots courants
    mots_a_enlever = ['sarl', 'sas', 'sa', 'eurl', 'sci', 'scp', 'scop', 'snc', 'selarl']
    for mot in mots_a_enlever:
        nom = nom.replace(f'-{mot}', '').replace(f'{mot}-', '')

    return nom.strip('-')


def generer_variantes_domaines(nom_entreprise):
    """
    Génère différentes variantes de domaines possibles
    """
    nom_normalise = normaliser_nom_domaine(nom_entreprise)

    extensions = ['.fr', '.com', '.net', '.org']
    prefixes = ['www.', '']

    domaines = []
    for ext in extensions:
        for prefix in prefixes:
            domaines.append(f"{prefix}{nom_normalise}{ext}")

    # Variante sans tirets
    nom_sans_tirets = nom_normalise.replace('-', '')
    if nom_sans_tirets != nom_normalise:
        for ext in extensions:
            for prefix in prefixes:
                domaines.append(f"{prefix}{nom_sans_tirets}{ext}")

    return domaines


def verifier_site_web(url):
    """
    Vérifie si un site web existe et répond
    """
    try:
        # Ajouter http:// si pas de protocole
        if not url.startswith(('http://', 'https://')):
            url = 'https://' + url

        response = requests.head(url, timeout=TIMEOUT, allow_redirects=True)
        if response.status_code < 400:
            return True, url
    except:
        pass

    # Essayer avec http:// si https:// échoue
    try:
        if url.startswith('https://'):
            url_http = url.replace('https://', 'http://')
            response = requests.head(url_http, timeout=TIMEOUT, allow_redirects=True)
            if response.status_code < 400:
                return True, url_http
    except:
        pass

    return False, None


def trouver_site_entreprise(nom_entreprise):
    """
    Cherche le site web d'une entreprise en testant différentes variantes
    """
    variantes = generer_variantes_domaines(nom_entreprise)

    for domaine in variantes:
        existe, url = verifier_site_web(domaine)
        if existe:
            return True, url

    return False, None


def rechercher_entreprises(secteur, ville="", code_postal="", limite=50, type_entreprise=""):
    """
    Recherche des entreprises via l'API Recherche Entreprises (data.gouv.fr)
    """
    # Construire la requête textuelle
    # Note: la ville dans la requête textuelle est moins précise qu'un filtre par code postal
    query_parts = []
    if secteur:
        query_parts.append(secteur)
    if ville and not code_postal:
        # Seulement ajouter la ville dans la recherche si pas de code postal
        # Car la ville en recherche textuelle est moins précise
        query_parts.append(ville)

    query = " ".join(query_parts) if query_parts else ""

    params = {
        "q": query if query else "*",  # * pour rechercher tout si pas de secteur
        "per_page": min(limite, 25),  # L'API limite à 25 résultats maximum
        "page": 1
    }

    # Le code postal est un filtre géographique PRÉCIS (recommandé)
    if code_postal:
        params["code_postal"] = code_postal

    # Filtrer par type d'entreprise
    if type_entreprise == "PME":
        params["categorie_entreprise"] = "PME"
    elif type_entreprise == "artisan":
        # Les artisans ont une activité enregistrée au répertoire des métiers
        params["est_entrepreneur_individuel"] = "true"
    elif type_entreprise == "petite":
        # Très petites entreprises: 0-9 salariés (tranches 00, 01, 02, 03)
        params["tranche_effectif_salarie"] = "00,01,02,03"

    try:
        print(f"[DEBUG] Requête API: {API_SIRENE}?{urlencode(params)}", file=sys.stderr, flush=True)
        response = requests.get(API_SIRENE, params=params, timeout=10)
        print(f"[DEBUG] Code réponse: {response.status_code}", file=sys.stderr, flush=True)
        response.raise_for_status()
        data = response.json()
        print(f"[DEBUG] Résultats trouvés: {data.get('total_results', 0)}", file=sys.stderr, flush=True)

        entreprises = []
        for result in data.get('results', []):
            entreprise = {
                'nom': result.get('nom_complet') or result.get('nom_raison_sociale', 'N/A'),
                'siret': result.get('siret', 'N/A'),
                'adresse': result.get('siege', {}).get('adresse', 'N/A'),
                'ville': result.get('siege', {}).get('commune', 'N/A'),
                'code_postal': result.get('siege', {}).get('code_postal', 'N/A'),
                'activite': result.get('activite_principale', 'N/A'),
                'nombre_etablissements': result.get('nombre_etablissements', 0)
            }
            entreprises.append(entreprise)

        return {
            'success': True,
            'entreprises': entreprises,
            'total': data.get('total_results', 0)
        }

    except Exception as e:
        return {
            'success': False,
            'error': str(e)
        }


def enrichir_avec_google_places(entreprise):
    """
    Enrichit les données d'une entreprise avec Google Places API
    Retourne l'entreprise enrichie avec site web, téléphone, note, etc.
    """
    if not GOOGLE_PLACES_API_KEY:
        # Fallback sur la méthode classique si pas de clé Google
        a_site, url_site = trouver_site_entreprise(entreprise['nom'])
        entreprise_enrichie = entreprise.copy()
        entreprise_enrichie['a_site_web'] = a_site
        entreprise_enrichie['url_site'] = url_site
        entreprise_enrichie['methode'] = 'fallback'
        return entreprise_enrichie

    try:
        # Construire la requête de recherche
        query = f"{entreprise['nom']}"
        if entreprise.get('ville') and entreprise['ville'] != 'N/A':
            query += f" {entreprise['ville']}"
        if entreprise.get('code_postal') and entreprise['code_postal'] != 'N/A':
            query += f" {entreprise['code_postal']}"

        # Recherche textuelle dans Google Places
        params = {
            'query': query,
            'key': GOOGLE_PLACES_API_KEY,
            'language': 'fr',
            'region': 'fr'
        }

        response = requests.get(GOOGLE_PLACES_URL, params=params, timeout=10)

        if response.status_code != 200:
            # Fallback en cas d'erreur
            a_site, url_site = trouver_site_entreprise(entreprise['nom'])
            entreprise_enrichie = entreprise.copy()
            entreprise_enrichie['a_site_web'] = a_site
            entreprise_enrichie['url_site'] = url_site
            entreprise_enrichie['methode'] = 'fallback'
            return entreprise_enrichie

        data = response.json()

        if data.get('status') != 'OK' or not data.get('results'):
            # Aucun résultat trouvé, utiliser le fallback
            a_site, url_site = trouver_site_entreprise(entreprise['nom'])
            entreprise_enrichie = entreprise.copy()
            entreprise_enrichie['a_site_web'] = a_site
            entreprise_enrichie['url_site'] = url_site
            entreprise_enrichie['methode'] = 'fallback'
            return entreprise_enrichie

        # Prendre le premier résultat (le plus pertinent)
        place = data['results'][0]
        place_id = place.get('place_id')

        # Récupérer les détails complets de l'établissement
        details_params = {
            'place_id': place_id,
            'fields': 'name,website,formatted_phone_number,rating,user_ratings_total,opening_hours,formatted_address',
            'key': GOOGLE_PLACES_API_KEY,
            'language': 'fr'
        }

        details_response = requests.get(GOOGLE_PLACE_DETAILS_URL, params=details_params, timeout=10)
        details_data = details_response.json()

        entreprise_enrichie = entreprise.copy()

        if details_data.get('status') == 'OK' and details_data.get('result'):
            result = details_data['result']

            # Extraire les données enrichies
            website = result.get('website', None)
            entreprise_enrichie['a_site_web'] = bool(website)
            entreprise_enrichie['url_site'] = website
            entreprise_enrichie['telephone'] = result.get('formatted_phone_number', None)
            entreprise_enrichie['note'] = result.get('rating', None)
            entreprise_enrichie['nombre_avis'] = result.get('user_ratings_total', 0)
            entreprise_enrichie['horaires'] = result.get('opening_hours', {}).get('weekday_text', [])
            entreprise_enrichie['methode'] = 'google_places'
        else:
            # Fallback si les détails ne sont pas disponibles
            a_site, url_site = trouver_site_entreprise(entreprise['nom'])
            entreprise_enrichie['a_site_web'] = a_site
            entreprise_enrichie['url_site'] = url_site
            entreprise_enrichie['methode'] = 'fallback'

        return entreprise_enrichie

    except Exception as e:
        # En cas d'erreur, utiliser la méthode classique
        a_site, url_site = trouver_site_entreprise(entreprise['nom'])
        entreprise_enrichie = entreprise.copy()
        entreprise_enrichie['a_site_web'] = a_site
        entreprise_enrichie['url_site'] = url_site
        entreprise_enrichie['methode'] = 'fallback'
        entreprise_enrichie['erreur'] = str(e)
        return entreprise_enrichie


@app.route('/')
def index():
    """Page d'accueil"""
    return render_template('index.html')


@app.route('/api/rechercher', methods=['POST'])
def api_rechercher():
    """
    Endpoint pour rechercher des entreprises
    """
    data = request.json
    secteur = data.get('secteur', '').strip()
    ville = data.get('ville', '').strip()
    code_postal = data.get('code_postal', '').strip()
    limite = int(data.get('limite', 50))
    type_entreprise = data.get('type_entreprise', '')

    # Au moins un critère de recherche doit être fourni
    if not secteur and not ville and not code_postal:
        return jsonify({'success': False, 'error': 'Veuillez indiquer au moins un critère de recherche (secteur, ville ou code postal)'})

    # Rechercher les entreprises
    resultat = rechercher_entreprises(secteur, ville, code_postal, limite, type_entreprise)

    return jsonify(resultat)


@app.route('/api/verifier-sites', methods=['POST'])
def api_verifier_sites():
    """
    Endpoint pour vérifier les sites web des entreprises (méthode classique)
    """
    data = request.json
    entreprises = data.get('entreprises', [])

    if not entreprises:
        return jsonify({'success': False, 'error': 'Aucune entreprise fournie'})

    # Vérifier les sites web en parallèle
    resultats = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {
            executor.submit(trouver_site_entreprise, ent['nom']): ent
            for ent in entreprises
        }

        for future in concurrent.futures.as_completed(futures):
            entreprise = futures[future]
            try:
                a_site, url_site = future.result()
                entreprise_result = entreprise.copy()
                entreprise_result['a_site_web'] = a_site
                entreprise_result['url_site'] = url_site if a_site else None
                resultats.append(entreprise_result)
            except Exception as e:
                entreprise_result = entreprise.copy()
                entreprise_result['a_site_web'] = False
                entreprise_result['url_site'] = None
                entreprise_result['erreur'] = str(e)
                resultats.append(entreprise_result)

    # Trier : entreprises sans site en premier
    resultats.sort(key=lambda x: (x['a_site_web'], x['nom']))

    return jsonify({
        'success': True,
        'resultats': resultats,
        'stats': {
            'total': len(resultats),
            'avec_site': sum(1 for r in resultats if r['a_site_web']),
            'sans_site': sum(1 for r in resultats if not r['a_site_web'])
        }
    })


@app.route('/api/verifier-sites-hybride', methods=['POST'])
def api_verifier_sites_hybride():
    """
    Endpoint pour vérifier les sites web avec méthode hybride (Google Places + Fallback)
    """
    data = request.json
    entreprises = data.get('entreprises', [])

    if not entreprises:
        return jsonify({'success': False, 'error': 'Aucune entreprise fournie'})

    # Enrichir avec Google Places en parallèle
    resultats = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {
            executor.submit(enrichir_avec_google_places, ent): ent
            for ent in entreprises
        }

        for future in concurrent.futures.as_completed(futures):
            try:
                entreprise_enrichie = future.result()
                resultats.append(entreprise_enrichie)
            except Exception as e:
                entreprise_original = futures[future]
                entreprise_error = entreprise_original.copy()
                entreprise_error['a_site_web'] = False
                entreprise_error['url_site'] = None
                entreprise_error['erreur'] = str(e)
                entreprise_error['methode'] = 'error'
                resultats.append(entreprise_error)

    # Trier : entreprises sans site en premier
    resultats.sort(key=lambda x: (x['a_site_web'], x['nom']))

    # Statistiques
    stats = {
        'total': len(resultats),
        'avec_site': sum(1 for r in resultats if r['a_site_web']),
        'sans_site': sum(1 for r in resultats if not r['a_site_web']),
        'methode_google': sum(1 for r in resultats if r.get('methode') == 'google_places'),
        'methode_fallback': sum(1 for r in resultats if r.get('methode') == 'fallback')
    }

    return jsonify({
        'success': True,
        'resultats': resultats,
        'stats': stats,
        'google_api_active': bool(GOOGLE_PLACES_API_KEY)
    })


@app.route('/api/exporter', methods=['POST'])
def api_exporter():
    """
    Exporte les résultats en CSV
    """
    data = request.json
    entreprises = data.get('entreprises', [])
    seulement_sans_site = data.get('seulement_sans_site', True)

    # Filtrer si nécessaire
    if seulement_sans_site:
        entreprises = [e for e in entreprises if not e.get('a_site_web', False)]

    # Créer le CSV en mémoire
    output = io.StringIO()
    writer = csv.writer(output)

    # Vérifier si on a des données enrichies Google
    has_enriched_data = any(ent.get('telephone') or ent.get('note') for ent in entreprises)

    # En-têtes (adapter selon le type de données)
    if has_enriched_data:
        writer.writerow([
            'Nom',
            'SIRET',
            'Adresse',
            'Code Postal',
            'Ville',
            'Activité',
            'A un site web',
            'URL du site',
            'Téléphone',
            'Note Google',
            'Nombre d\'avis'
        ])
    else:
        writer.writerow([
            'Nom',
            'SIRET',
            'Adresse',
            'Code Postal',
            'Ville',
            'Activité',
            'A un site web',
            'URL du site'
        ])

    # Données
    for ent in entreprises:
        row = [
            ent.get('nom', ''),
            ent.get('siret', ''),
            ent.get('adresse', ''),
            ent.get('code_postal', ''),
            ent.get('ville', ''),
            ent.get('activite', ''),
            'Oui' if ent.get('a_site_web') else 'Non',
            ent.get('url_site', '')
        ]

        if has_enriched_data:
            row.extend([
                ent.get('telephone', ''),
                ent.get('note', ''),
                ent.get('nombre_avis', '')
            ])

        writer.writerow(row)

    # Préparer le fichier pour téléchargement
    output.seek(0)
    bytes_output = io.BytesIO()
    bytes_output.write(output.getvalue().encode('utf-8-sig'))  # utf-8-sig pour Excel
    bytes_output.seek(0)

    return send_file(
        bytes_output,
        mimetype='text/csv',
        as_attachment=True,
        download_name=f'prospection_{int(time.time())}.csv'
    )


if __name__ == '__main__':
    print("🚀 Démarrage de l'application Prospecteur Web...")
    print("📍 Accédez à l'application sur : http://localhost:5001")
    app.run(debug=True, host='0.0.0.0', port=5001)