#!/bin/zsh
# Re-tunes the target time of every standard level (see README). Usage: scripts/tune-all.sh [first] [last]
cd "$(dirname "$0")/.."
first=${1:-1}; last=${2:-20}
for n in $(seq $first $last); do
  k=$(python3 -c "import json;print(len(json.load(open('public/levels/level$n.json'))['intersections']))")
  if [ $k -le 2 ]; then b=500; elif [ $k -le 4 ]; then b=600; elif [ $k -le 6 ]; then b=450; else b=350; fi
  echo "=== level$n (k=$k budget=$b) $(date +%T)"
  npx vite-node -c scripts/vite-node.config.ts scripts/tune-level.ts public/levels/level$n.json $b --apply 2>&1 | grep -vE "^\s+at |^$"
done
python3 scripts/generate-levels.py > /dev/null
echo "=== DONE $(date +%T)"
