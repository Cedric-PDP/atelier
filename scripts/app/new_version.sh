#!/usr/bin/env bash
# One command when the game ships a patch: fetch the wiki's engine + model + cards + meta decks into
# spam/versions/<version>/, recompute every score with it, build the changelog against the previous version and make
# it the page's base (site/data.json + site/shop.json). Publishing the page stays a separate, manual step.
# Usage: bash scripts/app/new_version.sh [--force] [--no-site]
#   --force    redo everything even if the wiki still serves the same assets as the last fetch.
#   --no-site  passed to recompute.sh: keep site/ on the previous version.
set -euo pipefail
R="$(cd "$(dirname "$0")/../.." && (pwd -W 2>/dev/null || pwd))"
FORCE=""; PASS=()
for a in "$@"; do case "$a" in --force) FORCE=--force;; *) PASS+=("$a");; esac; done
set +e; OUT=$(node "$R/scripts/app/fetch_version.js" "$R" $FORCE); CODE=$?; set -e
echo "$OUT"
VER=$(echo "$OUT" | tail -1)
if [ "$CODE" = 3 ]; then echo "Rien de nouveau sur le wiki (version $VER déjà calculée). --force pour tout refaire."; exit 0; fi
[ "$CODE" = 0 ] || { echo "fetch_version a échoué ($CODE)" >&2; exit "$CODE"; }
bash "$R/scripts/app/recompute.sh" "$VER" "${PASS[@]+"${PASS[@]}"}"
echo "Version $VER prête : spam/versions/$VER/CHANGELOG.md ; republier l'Atelier (voir CLAUDE.md)."
