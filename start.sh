#!/bin/bash

# Script de démarrage de l'application Prospecteur Web

echo "🎯 Démarrage de Prospecteur Web..."
echo ""

# Vérifier si l'environnement virtuel existe
if [ ! -d "venv" ]; then
    echo "📦 Création de l'environnement virtuel..."
    python3 -m venv venv
    echo "✅ Environnement virtuel créé"
    echo ""
fi

# Activer l'environnement virtuel
echo "🔧 Activation de l'environnement virtuel..."
source venv/bin/activate

# Installer/mettre à jour les dépendances
echo "📥 Installation des dépendances..."
pip install -q -r requirements.txt

echo ""
echo "✅ Tout est prêt !"
echo ""
echo "🚀 Lancement de l'application..."
echo "📍 Accédez à l'application sur : http://localhost:5001"
echo ""
echo "Pour arrêter l'application, appuyez sur Ctrl+C"
echo ""

# Lancer l'application
python app.py