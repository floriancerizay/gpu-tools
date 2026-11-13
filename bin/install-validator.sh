#!/bin/sh
# Télécharge validator-cli.jar (dev-dépendance, tests de conformité) et vérifie son empreinte.
# Usage : sh bin/install-validator.sh [fichier cible, défaut bin/validator-cli.jar]
set -eu

VALIDATOR_VERSION=4.6.3
# sha256 de validator-cli.jar (à mettre à jour avec VALIDATOR_VERSION)
VALIDATOR_SHA256=09dc2b1447365ecf72ab6fed9a7f1e134314a7d0192865bae9e5cb861e87132f

BIN_DIR=$(cd "$(dirname "$0")" && pwd)
TARGET="${1:-$BIN_DIR/validator-cli.jar}"

if [ -f "$TARGET" ] && echo "${VALIDATOR_SHA256}  ${TARGET}" | sha256sum -c - >/dev/null 2>&1; then
    exit 0
fi

TMP_FILE="${TARGET}.tmp"
trap 'rm -f "$TMP_FILE"' EXIT
echo "install-validator : validator-cli v${VALIDATOR_VERSION} -> ${TARGET}"
curl -fsSL -o "$TMP_FILE" "https://github.com/IGNF/validator/releases/download/v${VALIDATOR_VERSION}/validator-cli.jar"
echo "${VALIDATOR_SHA256}  ${TMP_FILE}" | sha256sum -c -
mv "$TMP_FILE" "$TARGET"
