#!/usr/bin/env bash
# The miyamints mainnet deploy, run by hand, with the deployer's key on a RAM disk ejected at the end
# (the imdUSD v2 launch pattern: imdusd-v2/deploy/mainnet/launch.sh).
#
#   script/launch.sh go        everything in order: RAM disk, key file in nano, status, simulate, SEND, broadcast,
#                              on-chain check, wipe. Pauses only for the key and for you to type SEND.
#   The single steps:
#   ramdisk   make the RAM disk and its key file template (nothing touches the SSD)
#   status    mode, deployer, Safe, keeper, commit, base fee (never prints the key)
#   deploy    simulate, show the plan, wait for SEND, broadcast through script/deploy.sh (--slow), then check
#   check     read the deployed system back from the chain: code, owners, keeper, swap targets, default vault
#   wipe      eject the RAM disk (the key is gone) and remove forge's cached RPC URLs
#
# CODE ON CHAIN IS THE ONLY PROOF. DeployMiyamints writes deployments/1.json during forge's simulation, before anything
# is sent, so `check` never trusts the record: it reads every address's code and every owner from the chain.
# There is no resume: a run that stops partway is the "A run that stops partway" case in DEPLOY.md (finish from the
# deployer before any handoff, or from the Safe after).
#
# Key file: /Volumes/MIYALAUNCH/launch.env (edit with nano; never paste the key into a shell prompt). Use a FRESH
# deployer EOA used for nothing else: after the handoff it holds no power anywhere (DeployMiyamints checks this).
# Broadcasts go to MAINNET_RPC_URL, or PRIVATE_RPC_URL when set (privacy only: nothing in the deploy is front-runnable).
#
# Rehearsal: FORK=1 with MAINNET_RPC_URL a local anvil fork of mainnet and LAUNCH_ENV a file holding an anvil test key.
# Fork mode refuses a non-local RPC, real mode refuses a local one; a rehearsal's record is moved to
# deployments/rehearsal/ (gitignored) so it can never be mistaken for the real one.
set -euo pipefail
export FOUNDRY_DISABLE_NIGHTLY_WARNING=1
cd "$(dirname "$0")/.."            # contracts/

die() { echo "launch: $*" >&2; exit 1; }
lc() { tr '[:upper:]' '[:lower:]' <<<"$1"; }

# Decided 2026-11-10 (not secrets): the imdUSD governance Safe owns everything; the vault keeper is its own hot wallet.
OWNER=${OWNER:-0xbeFd108085613662356aa26A2466Ad3426DA9C32}
KEEPER=${KEEPER:-0x4aC803E1EA65614Bc10367A21a18Cb076ff9bE1c}
ALLOWANCE_HOLDER=0x0000000000001fF3684f28c67538d4D072C22734
VOL=MIYALAUNCH; RD=/Volumes/$VOL; ENVF=$RD/launch.env
CAP=16777216                       # EIP-7825 per-transaction gas cap
REC=deployments/1.json
DRY=broadcast/DeployMiyamints.s.sol/1/dry-run/run-latest.json
if [ "${FORK:-0}" = 1 ]; then
  [ -n "${LAUNCH_ENV:-}" ] && ENVF=$LAUNCH_ENV
else
  [ -z "${LAUNCH_ENV:-}" ] || die "LAUNCH_ENV is for rehearsals (FORK=1) only: the real key lives on the RAM disk"
fi

ramdisk() {
  [ -d "$RD" ] && die "$RD is already mounted. Run 'wipe' first if it is left over from an earlier run."
  local dev; dev=$(hdiutil attach -nomount ram://65536 | awk '{print $1}')   # 32 MB
  diskutil erasevolume HFS+ "$VOL" "$dev" >/dev/null
  touch "$RD/.metadata_never_index"
  tmutil addexclusion "$RD" >/dev/null 2>&1 || true
  ( umask 077; cat > "$ENVF" <<'EOT'
# Fill in, save, and leave the editor. This file lives in memory only and is gone at `launch.sh wipe`.
PRIVATE_KEY=
# the address the key must sign as (a fresh deployer: it holds no power after the handoff to the Safe)
DEPLOYER=
# your own RPC for reads and simulation (and broadcasts unless PRIVATE_RPC_URL is set)
MAINNET_RPC_URL=
# optional: PRIVATE_RPC_URL=https://rpc.mevblocker.io/fullprivacy
# optional: ETHERSCAN_API_KEY=
EOT
  )
  echo "RAM disk ready: $RD ($dev). Now:  nano $ENVF"
}

load() {
  [ -f "$ENVF" ] || die "no $ENVF. Run 'ramdisk' first."
  if [ "${FORK:-0}" != 1 ] || [ -z "${LAUNCH_ENV:-}" ]; then
    hdiutil info | grep -q "$RD" || die "$RD is not a disk image mount. The key file must live on the RAM disk."
  fi
  # Variables DeployMiyamints reads as overrides without a warning: a leftover one would change mainnet settings.
  local stray; stray=$(env | grep -oE '^(TREASURY|ALIGNMENT_TOKEN|ALIGNMENT_TARGET_NAME|PROTOCOL_FEE_BPS|MIN_ALIGNMENT_BPS|SALT_NAMESPACE|MIYAMINTS_CONFIG|ALLOW_MISSING_POOL)=' || true)
  [ -z "$stray" ] || die "unset these first, they override config/1.json: $(tr '\n' ' ' <<<"$stray")"
  set -a; . "$ENVF"; set +a
  [[ "${PRIVATE_KEY:-}" =~ ^(0x)?[0-9a-fA-F]{64}$ ]] || die "PRIVATE_KEY is missing or not 32 bytes of hex."
  [[ "$PRIVATE_KEY" == 0x* ]] || PRIVATE_KEY=0x$PRIVATE_KEY
  SIGNER=$(cast wallet address --private-key "$PRIVATE_KEY" 2>/dev/null </dev/null | tail -1)
  [ -n "${DEPLOYER:-}" ] || die "DEPLOYER is empty in $ENVF."
  [ "$(lc "$SIGNER")" = "$(lc "$DEPLOYER")" ] || die "the key signs as $SIGNER, not the deployer $DEPLOYER."
  [ "$(lc "$SIGNER")" != "$(lc "$KEEPER")" ] || die "the deployer must not be the keeper."
  [ -n "${MAINNET_RPC_URL:-}" ] || die "MAINNET_RPC_URL is empty."
  local local_rpc=0; [[ "$MAINNET_RPC_URL" =~ ^https?://(127\.0\.0\.1|localhost)(:|/|$) ]] && local_rpc=1
  if [ "${FORK:-0}" = 1 ]; then
    [ $local_rpc = 1 ] || die "FORK=1 but MAINNET_RPC_URL is not local. A rehearsal must not reach mainnet."
    SEND_RPC=$MAINNET_RPC_URL; MODE="REHEARSAL (local fork)"
  else
    [ $local_rpc = 0 ] || die "MAINNET_RPC_URL is local. Set FORK=1 for a rehearsal."
    SEND_RPC=${PRIVATE_RPC_URL:-$MAINNET_RPC_URL}; MODE="MAINNET"
  fi
  [ "$(cast chain-id --rpc-url "$MAINNET_RPC_URL" 2>/dev/null </dev/null)" = 1 ] || die "the RPC is not chain 1."
  [ "$(cast code "$OWNER" --rpc-url "$MAINNET_RPC_URL" </dev/null 2>/dev/null | wc -c)" -gt 10 ] || die "the owner Safe $OWNER has no code"
  [ "$(cast code "$KEEPER" --rpc-url "$MAINNET_RPC_URL" </dev/null 2>/dev/null)" = 0x ] || die "the keeper $KEEPER is not an EOA"
  export ETHERSCAN_API_KEY=${ETHERSCAN_API_KEY:-}
}

confirm() {
  echo; echo "[$MODE] $1"; read -r -p "Type SEND to broadcast, anything else to stop: " a
  [ "$a" = SEND ] || die "stopped, nothing sent."
}

basefee_wei() { cast base-fee --rpc-url "$MAINNET_RPC_URL" 2>/dev/null </dev/null | tail -1; }
basefee() {
  local wei; wei=$(basefee_wei)
  echo "base fee  $(python3 -c "print(f'{$wei/1e9:.3f}')") gwei"
  if [ "${FORK:-0}" != 1 ] && python3 -c "import sys; sys.exit(0 if $wei > ${MAX_BASEFEE_GWEI:-5}*1e9 else 1)"; then
    die "base fee above MAX_BASEFEE_GWEI=${MAX_BASEFEE_GWEI:-5}: wait for a cheaper block (or raise it knowingly)"
  fi
}

# Forge's script runner: deploy.sh (clean main == origin/main) for real; on a fork, the same env deploy.sh would set.
run_forge() {
  if [ "${FORK:-0}" = 1 ]; then
    FOUNDRY_PROFILE=deploy DEPLOY_GIT_COMMIT=$(git rev-parse HEAD) DEPLOY_GIT_REF=rehearsal \
      forge script script/DeployMiyamints.s.sol "$@"
  else
    script/deploy.sh "$@"
  fi
}

status() {
  load
  echo "mode      $MODE"
  echo "deployer  $SIGNER  $(cast balance "$SIGNER" --ether --rpc-url "$MAINNET_RPC_URL" </dev/null) ETH  nonce $(cast nonce "$SIGNER" --rpc-url "$MAINNET_RPC_URL" </dev/null)"
  echo "owner     $OWNER  threshold $(cast call "$OWNER" 'getThreshold()(uint256)' --rpc-url "$MAINNET_RPC_URL" </dev/null 2>/dev/null) of $(cast call "$OWNER" 'getOwners()(address[])' --rpc-url "$MAINNET_RPC_URL" </dev/null 2>/dev/null)"
  echo "keeper    $KEEPER  $(cast balance "$KEEPER" --ether --rpc-url "$MAINNET_RPC_URL" </dev/null) ETH"
  echo "commit    $(git rev-parse --short HEAD)$(git diff --quiet HEAD -- . || echo ' + UNCOMMITTED changes in contracts/')"
  echo "send via  $([ "$SEND_RPC" = "$MAINNET_RPC_URL" ] && echo 'MAINNET_RPC_URL' || echo 'PRIVATE_RPC_URL')"
  basefee
}

deploy() {
  load
  if [ -f "$REC" ]; then
    [ "${FORK:-0}" = 1 ] && die "$REC exists (the real record): a rehearsal would overwrite it. Rehearse from a checkout without it."
    die "$REC exists: a deploy has already run. Run 'check' and read DEPLOY.md before anything else."
  fi
  [ "$(cast nonce "$SIGNER" --block pending --rpc-url "$MAINNET_RPC_URL" </dev/null)" = "$(cast nonce "$SIGNER" --rpc-url "$MAINNET_RPC_URL" </dev/null)" ] \
    || die "the deployer has a pending transaction: wait for it, forge numbers every transaction from the next nonce"
  basefee
  echo "simulating DeployMiyamints (owner $OWNER, keeper $KEEPER)"
  rm -f "$DRY"
  OWNER=$OWNER KEEPER=$KEEPER run_forge --rpc-url "$MAINNET_RPC_URL" --private-key "$PRIVATE_KEY" \
    --gas-estimate-multiplier 103 </dev/null 2>&1 | grep -E '^\s+(owner|conversion keeper|treasury|default vault|MiyaRegistry)\b|in-range liquidity|Error|revert' || true
  [ -f "$DRY" ] || die "no simulation output ($DRY): the simulation failed (run it by hand to see why)"
  local bf; bf=$(basefee_wei); [ -n "$bf" ] || die "cannot read the base fee"
  local tip=${PRIORITY_WEI:-100000000}
  local maxfee=$(( bf * 3 + tip ))
  local plan; plan=$(python3 - "$DRY" "$CAP" "$maxfee" "$(cast balance "$SIGNER" --rpc-url "$MAINNET_RPC_URL" </dev/null)" <<'PY'
import json, sys
path, cap, maxfee, bal = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
txs = json.load(open(path))["transactions"]
gas = [int(t["transaction"]["gas"], 16) for t in txs]
total, worst = sum(gas), max(gas)
cost = total * maxfee
print(f"plan      {len(txs)} transactions, {total:,} gas, largest {worst:,} (cap {cap:,})")
print(f"cost      at most {cost/1e18:.5f} ETH at max fee {maxfee/1e9:.3f} gwei; deployer holds {bal/1e18:.5f} ETH")
if worst > cap: print(f"REFUSE    a transaction is over the {cap:,} gas cap"); sys.exit(2)
if cost > bal: print("REFUSE    the deployer cannot pay the worst case"); sys.exit(2)
PY
) || { echo "$plan"; die "the gas plan refuses this deploy"; }
  echo "$plan"
  confirm "Deploy miyamints from $SIGNER: $(grep -oE '^plan .*' <<<"$plan" | sed 's/^plan *//')"
  # --slow (added by deploy.sh, explicit here for the fork) waits for each receipt. Explicit fees: 3 x the live base fee
  # + the tip, so a tiny base fee can't put forge's max fee under the tip (imdUSD launch, 2026-10-23).
  local verify=(); [ -n "$ETHERSCAN_API_KEY" ] && [ "${FORK:-0}" != 1 ] && verify=(--verify --etherscan-api-key "$ETHERSCAN_API_KEY")
  echo "fees      base $bf wei, tip $tip wei, max fee $maxfee wei"
  OWNER=$OWNER KEEPER=$KEEPER run_forge --rpc-url "$SEND_RPC" --private-key "$PRIVATE_KEY" --broadcast --slow \
    --gas-estimate-multiplier 103 --with-gas-price "$maxfee" --priority-gas-price "$tip" --timeout "${TX_TIMEOUT:-900}" \
    ${verify[@]+"${verify[@]}"} </dev/null 2>&1 | grep -vE 'Warning|^$' | tail -25 \
    || echo "launch: the broadcast did not finish cleanly; checking what landed"
  check
  if [ "${FORK:-0}" = 1 ] && [ -f "$REC" ]; then
    mkdir -p deployments/rehearsal && mv "$REC" "deployments/rehearsal/1.$(date +%s).json"
    echo "rehearsal record moved to deployments/rehearsal/"
  fi
}

check() {
  load
  [ -f "$REC" ] || die "no $REC: nothing was broadcast"
  local r=$MAINNET_RPC_URL fail=0
  get() { python3 -c "import json,sys; print(json.load(open('$REC'))['$1'])"; }
  ok() { echo "  ok    $1"; }
  bad() { echo "  FAIL  $1"; fail=1; }
  eqa() { [ "$(lc "$1")" = "$(lc "$2")" ]; }
  for k in registry vaultFactory vaultImplementation erc721DropFactory erc721AuctionFactory erc1155Factory \
           dynamicPricingModule miyaPoolFactory defaultVault; do
    local a; a=$(get "$k")
    [ "$(cast code "$a" --rpc-url "$r" </dev/null 2>/dev/null | wc -c)" -gt 10 ] && ok "$k $a has code" || bad "$k $a has NO code"
  done
  for k in registry vaultFactory erc721AuctionFactory erc1155Factory dynamicPricingModule; do
    local o; o=$(cast call "$(get "$k")" 'owner()(address)' --rpc-url "$r" </dev/null 2>/dev/null || echo none)
    eqa "$o" "$OWNER" && ok "$k owner = Safe" || bad "$k owner is $o, not the Safe $OWNER"
  done
  local reg vf dv; reg=$(get registry); vf=$(get vaultFactory); dv=$(get defaultVault)
  local kp; kp=$(cast call "$reg" 'conversionKeeper()(address)' --rpc-url "$r" </dev/null 2>/dev/null || echo none)
  eqa "$kp" "$KEEPER" && ok "registry keeper = $KEEPER" || bad "registry keeper is $kp, not $KEEPER"
  [ "$(cast call "$reg" 'isVault(address)(bool)' "$dv" --rpc-url "$r" </dev/null 2>/dev/null)" = true ] && ok "default vault registered" || bad "default vault not registered"
  local dvo; dvo=$(cast call "$dv" 'owner()(address)' --rpc-url "$r" </dev/null 2>/dev/null || echo none)
  eqa "$dvo" "$vf" && ok "default vault owned by the vault factory" || bad "default vault owner is $dvo"
  for t in "$ALLOWANCE_HOLDER" "$(get zRouter)"; do
    [ "$(cast call "$vf" 'isSwapTarget(address)(bool)' "$t" --rpc-url "$r" </dev/null 2>/dev/null)" = true ] && ok "swap target $t" || bad "swap target $t not set"
  done
  [ $fail = 0 ] || die "the deployed system does not match: STOP, read DEPLOY.md 'A run that stops partway'"
  echo "check: every contract has code, the Safe owns everything, keeper and swap targets set (read from chain)"
}

wipe() {
  if [ -d "$RD" ]; then
    diskutil eject force "$RD" >/dev/null && echo "ejected $RD: the key file is gone" || die "eject failed; close anything using $RD and run wipe again"
  else
    echo "no RAM disk mounted"
  fi
  # forge keeps the RPC URL of every script run in cache/<script>/ ("sensitive values"); a provider URL can carry a key.
  rm -f cache/DeployMiyamints.s.sol/*/run-*.json cache/DeployMiyamints.s.sol/*/dry-run/run-*.json 2>/dev/null \
    && echo "removed forge's cached RPC URLs" || true
}

case "${1:-}" in
  ramdisk) ramdisk ;;
  status) status ;;
  deploy) deploy ;;
  check) check ;;
  wipe) wipe ;;
  go)
    if [ "${FORK:-0}" != 1 ] || [ -z "${LAUNCH_ENV:-}" ]; then
      [ -d "$RD" ] || "$0" ramdisk
      if ! grep -qE '^PRIVATE_KEY=.+' "$ENVF"; then
        echo; echo "Opening the key file. Fill in PRIVATE_KEY, DEPLOYER and MAINNET_RPC_URL, save (ctrl-O, Enter), exit (ctrl-X)."
        read -r -p "Press Enter to open it: " _; ${EDITOR:-nano} "$ENVF"
      fi
    fi
    status
    echo; "$0" deploy
    if [ "${FORK:-0}" != 1 ] || [ -z "${LAUNCH_ENV:-}" ]; then echo; "$0" wipe; fi
    echo; echo "Done. Next: commit deployments/1.json to main, point the app at it, fund and start the keeper."
    ;;
  *) sed -n 2,13p "$0"; exit 1 ;;
esac
