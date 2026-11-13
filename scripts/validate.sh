#!/bin/sh
# Valide un dossier de document avec validator-cli : sh scripts/validate.sh <dossier> <modèle>
# Affiche les erreurs et avertissements ; code retour 1 s'il y a des erreurs.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=$(mktemp -d)
java -jar "$ROOT/bin/validator-cli.jar" document_validator \
  --model "file://$ROOT/node_modules/validator-config-gpu/config/$2/files.json" \
  --input "$1" --srs CRS:84 --enable-conditions -O "$OUT" >/dev/null 2>&1 || true
python3 - "$OUT/validation.jsonl" <<'PY'
import json, sys
errors = 0
for line in open(sys.argv[1]):
    d = json.loads(line)
    if d['level'] in ('ERROR', 'WARNING'):
        print(d['level'], d['code'], d['file'], d['attribute'], '|', d['message'][:160])
        errors += d['level'] == 'ERROR'
sys.exit(1 if errors else 0)
PY
