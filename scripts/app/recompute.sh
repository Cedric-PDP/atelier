#!/usr/bin/env bash
# Recomputes the page data of ONE game version from its engine snapshot in spam/versions/<version>/js, then makes it
# the page's base (site/data.json + site/shop.json) with the changelog against the previous version embedded.
# Steps: variants + Tox info -> pre (every 4-card deck of the pool) -> shop keys -> lost + shop -> global sample (same
#        24,000 decks every version) + Monte-Carlo shop of the reference decks -> meta decks scored by this AND the
#        previous engine -> build_core / build_shop -> build_changelog -> site/ -> page smoke test.
# Usage: bash scripts/app/recompute.sh [<version>] [--only-build] [--no-site]
#   <version>     folder under spam/versions (default: the highest one). A new version comes from fetch_version.js
#                 (or new_version.sh, which chains both).
#   --only-build  skip the engine runs, redo the assembly from the existing spam/versions/<v>/app outputs.
#   --only-lost   recompute only the lost-card metric L (then the assembly), e.g. after adding a stress patcher.
#   --no-site     leave site/ untouched (outputs stay in spam/versions/<v>/data.json, shop.json, changelog.json).
#   CHUNKS=<n>    processes per step (default 16; the PC has 22 cores). pre ≈ 4 min, shop ≈ 4 min, the rest < 3 min.
set -euo pipefail
# Windows-style root (C:/...) under Git Bash so node gets paths it understands; plain pwd elsewhere.
R="$(cd "$(dirname "$0")/../.." && (pwd -W 2>/dev/null || pwd))"
D="$R/spam"; S="$R/scripts/app"; N="${CHUNKS:-16}"
VER=""; ONLY_BUILD=0; ONLY_LOST=0; SITE=1
for a in "$@"; do case "$a" in --only-build) ONLY_BUILD=1;; --only-lost) ONLY_LOST=1;; --no-site) SITE=0;; -*) echo "unknown option $a" >&2; exit 2;; *) VER="$a";; esac; done
VERS=$(ls "$D/versions" | sort -V)
[ -n "$VER" ] || VER=$(echo "$VERS" | tail -1)
PREV=$(echo "$VERS" | awk -v v="$VER" '$0==v{print p; exit} {p=$0}')
V="$D/versions/$VER"; JS="$V/js"; A="$V/app"; DRV="$V/drv"; E="$JS/simulation.js"
[ -f "$JS/model.json" ] && [ -f "$E" ] || { echo "no engine in $JS (run fetch_version.js first)" >&2; exit 1; }
mkdir -p "$A" "$DRV"
echo "version $VER (previous: ${PREV:-none}), $N processes per step"

variants() { # <js dir>: build the model variants (not versioned) when missing or made from another model.json: the wiki
  # can serve a new engine + model under the same game version (1.21, 2026-10-09), and the engine reads the model's
  # baseline / recommended talents, so stale variants would score with the old ones.
  local h; h=$(grep -o '"engineHash":"[^"]*"' "$1/model.json" | head -1 || true)
  [ -f "$1/model_nocrit.json" ] && [ -f "$1/model_dead.json" ] && [ -f "$1/model_crit0.5.json" ] \
    && grep -q "$h" "$1/model_nocrit.json" && grep -q "$h" "$1/model_dead.json" && grep -q "$h" "$1/model_crit0.5.json" \
    || node "$S/make_variants.js" "$1/model.json" "$1"
}
run() { # <kind> <chunks> <models spec> [engine]: drivers $DRV/drv_<kind>_<i>.js -> $A/<kind>_<i>.json
  local kind=$1 n=$2 models=$3 eng=${4:-$E} pids=() fail=0
  for i in $(seq 0 $((n-1))); do
    node "$R/scripts/sim_lab2.js" "$eng" "$models" "$DRV/drv_${kind}_$i.js" "$A/${kind}_$i.json" > "$A/${kind}_log_$i.txt" 2>&1 &
    pids+=($!)
  done
  for p in "${pids[@]}"; do wait "$p" || fail=1; done
  [ "$fail" = 0 ] || { echo "$kind: a chunk failed, see $A/${kind}_log_*.txt" >&2; exit 1; }
  echo "$kind: $n chunks done $(date +%H:%M:%S)"
}
one() { # <name> <models spec> <driver> [engine]: a single run -> $A/<name>.json
  node "$R/scripts/sim_lab2.js" "${4:-$E}" "$2" "$3" "$A/$1.json" > "$A/$1_log.txt" 2>&1 || { echo "$1 failed, see $A/$1_log.txt" >&2; return 1; }
}

variants "$JS"
M1="$JS/model.json"; M0="$JS/model_nocrit.json"
# Lost-card metric L: ABSORB (card removed at turn 1 without dying) when this version has a stress-engine patcher;
# otherwise the 1-HP 'dead-card', whose death fires the allies' on-death effects (Vengeur, Cimetière…) and inflates L
# on those decks — flagged in meta.lostMethod. A new version needs scripts/app/stress/make_engine_<v>.js (port).
if [ -f "$S/stress/make_engine_$VER.js" ]; then
  node "$S/stress/make_engine_$VER.js" "$E" "$JS/engine_stress.js"; LOST=absorb
else
  LOST=dead-card; echo "⚠ pas de scripts/app/stress/make_engine_$VER.js : L par dead-card (gonflé sur les decks à effets de mort)" >&2
fi
if [ "$LOST" = absorb ]; then LOSTSPEC=lost:lostabs; else LOSTSPEC=lost; fi
lost_step() {
  if [ "$LOST" = absorb ]; then run lost "$N" "x1=$M1" "$JS/engine_stress.js"; else run lost "$N" "x1=$JS/model_dead.json"; fi
  echo "$LOST" > "$A/lost_method.txt"
}
if [ "$ONLY_LOST" = 1 ]; then
  rm -f "$A"/lost_*.json
  node "$S/gen_drivers.js" "$R" "$LOSTSPEC" --out="$DRV" --chunks="$N"
  lost_step
elif [ "$ONLY_BUILD" = 0 ]; then
  one toxinfo "x1=$M1" "$R/scripts/drv_toxinfo.js"
  rm -f "$A"/pre_*.json "$A"/lost_*.json "$A"/shop_*.json "$A"/g_*.json
  node "$S/gen_drivers.js" "$R" pre "$LOSTSPEC" --out="$DRV" --chunks="$N"
  run pre "$N" "x1=$M1;x0=$M0"
  node "$S/pick_shop_keys.js" "$D" --app="$A"
  node "$S/gen_drivers.js" "$R" shop --out="$DRV" --keys="$A/shop_keys.json" --chunks="$N"
  lost_step
  run shop "$N" "x1=$M1"
  # Monte-Carlo shop of the reference decks (spam/mcv2/deck_<name>.json) next to the global sample.
  mc_pids=(); for f in "$R"/scripts/mcv2/drv_*.js; do n=$(basename "$f" .js); n=${n#drv_}
    one "mc_$n" "x1=$M1;x05=$JS/model_crit0.5.json" "$f" & mc_pids+=($!); done
  node "$S/gen_global_drivers.js" "$D/stats/global_decks.json" "$DRV" "$N"
  run g "$N" "x1=$M1;x0=$M0"
  for p in "${mc_pids[@]}"; do wait "$p"; done; echo "mc: done $(date +%H:%M:%S)"
fi
# Meta decks (wiki deck tier lists of this version and the previous one) scored by both engines.
node -e '
const fs=require("fs"),[a,b,out]=process.argv.slice(1);const seen=new Set(),all=[];
for(const f of [a,b])if(f&&fs.existsSync(f))for(const d of JSON.parse(fs.readFileSync(f,"utf8")).decks){const k=d.join("-");if(!seen.has(k)){seen.add(k);all.push(d)}}
fs.writeFileSync(out,JSON.stringify(all));console.log("meta decks to score",all.length)' "$V/meta_decks.json" "${PREV:+$D/versions/$PREV/meta_decks.json}" "$A/meta_list.json"
node "$S/gen_eval_driver.js" "$A/meta_list.json" "$DRV/drv_meta.js"
one meta_eval "x1=$M1;x0=$M0" "$DRV/drv_meta.js"
if [ -n "$PREV" ]; then
  PJS="$D/versions/$PREV/js"; variants "$PJS"
  one meta_eval_prev "x1=$PJS/model.json;x0=$PJS/model_nocrit.json" "$DRV/drv_meta.js" "$PJS/simulation.js"
fi
node "$S/build_core.js" "$D" "$V/data.json" --ver="$V"
node "$S/build_shop.js" "$A" "$V/shop.json" "$N"
node "$S/build_changelog.js" "$D" "$VER" ${PREV:+"$PREV"}
if [ "$SITE" = 1 ]; then
  cp "$V/data.json" "$R/site/data.json"; cp "$V/shop.json" "$R/site/shop.json"
  node "$S/smoke_page.js" "$R/site/atelier-spam.html" "$R/site" | tail -1
  rm -f "$R/site/_analysis.html"
  echo "site/ = version $VER"
fi
