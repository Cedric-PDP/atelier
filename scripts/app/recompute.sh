#!/usr/bin/env bash
# Recomputes the page data (site/data.json + site/shop.json) from the engine snapshot in spam/js.
# Steps: drivers -> pre (every 4-card deck of the pool, 6 procs) -> shop keys -> lost + shop (20 procs each)
#        -> build_core / build_shop -> page smoke test.
# Usage: bash scripts/app/recompute.sh        (~9 min for pre on 6 procs; shop ~2,4 s/deck spread over 20 procs)
set -euo pipefail
# Windows-style root (C:/...) under Git Bash so node gets paths it understands; plain pwd elsewhere.
R="$(cd "$(dirname "$0")/../.." && (pwd -W 2>/dev/null || pwd))"
D="$R/spam"; A="$D/app"; E="$D/js/simulation.js"

run() { # <kind> <chunks> <models spec>
  local kind=$1 n=$2 models=$3 pids=() fail=0
  for i in $(seq 0 $((n-1))); do
    node "$R/scripts/sim_lab2.js" "$E" "$models" "$R/scripts/app/drv_${kind}_$i.js" "$A/${kind}_$i.json" > "$A/${kind}_log_$i.txt" 2>&1 &
    pids+=($!)
  done
  for p in "${pids[@]}"; do wait "$p" || fail=1; done
  [ "$fail" = 0 ] || { echo "$kind: a chunk failed, see $A/${kind}_log_*.txt" >&2; exit 1; }
  echo "$kind: $n chunks done $(date +%H:%M:%S)"
}

node "$R/scripts/app/gen_drivers.js" "$R" pre lost
run pre 6 "x1=$D/js/model_crit1.json;x0=$D/js/model_nocrit.json"
node "$R/scripts/app/pick_shop_keys.js" "$D"
node "$R/scripts/app/gen_drivers.js" "$R" shop
run lost 20 "x1=$D/js/model_dead.json"
run shop 20 "x1=$D/js/model_crit1.json"
node "$R/scripts/app/build_core.js" "$D" "$R/site/data.json"
node "$R/scripts/app/build_shop.js" "$A" "$R/site/shop.json" 20
node "$R/scripts/app/smoke_page.js" "$R/site/atelier-spam.html" "$R/site" | tail -1
rm -f "$R/site/_analysis.html"
