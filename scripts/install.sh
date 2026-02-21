#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  OpenClaw — One-command installer                                        ║
# ║  curl -fsSL https://get.openclaw.dev | bash                              ║
# ╚══════════════════════════════════════════════════════════════════════════╝
set -euo pipefail

OPENCLAW_VERSION="${OPENCLAW_VERSION:-latest}"
OPENCLAW_DEMO="${OPENCLAW_DEMO:-}"           # set to "1" to auto-run demo
OPENCLAW_ENTERPRISE="${OPENCLAW_ENTERPRISE:-}" # set to "1" to enable enterprise
OPENCLAW_SKIP_NODE="${OPENCLAW_SKIP_NODE:-}"  # set to "1" to skip Node.js check

# ── Colors & formatting ────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m' # No Color

CHECKMARK="${GREEN}✓${NC}"
ARROW="${CYAN}→${NC}"
LOBSTER="🦞"

# ── Utilities ──────────────────────────────────────────────────────────────
info()    { echo -e "  ${ARROW} $*"; }
success() { echo -e "  ${CHECKMARK} $*"; }
warn()    { echo -e "  ${YELLOW}⚠${NC}  $*"; }
error()   { echo -e "  ${RED}✗${NC}  $*" >&2; }
die()     { error "$*"; exit 1; }

print_banner() {
  echo ""
  echo -e "${CYAN}${BOLD}"
  cat <<'EOF'
   ██████╗ ██████╗ ███████╗███╗   ██╗ ██████╗██╗      █████╗ ██╗    ██╗
  ██╔═══██╗██╔══██╗██╔════╝████╗  ██║██╔════╝██║     ██╔══██╗██║    ██║
  ██║   ██║██████╔╝█████╗  ██╔██╗ ██║██║     ██║     ███████║██║ █╗ ██║
  ██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║██║     ██║     ██╔══██║██║███╗██║
  ╚██████╔╝██║     ███████╗██║ ╚████║╚██████╗███████╗██║  ██║╚███╔███╔╝
   ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝ ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝
EOF
  echo -e "${NC}"
  echo -e "  ${LOBSTER}  ${WHITE}${BOLD}Your own personal AI assistant. Any OS. Any platform.${NC}"
  echo -e "  ${DIM}https://github.com/openclaw/openclaw${NC}"
  echo ""
}

# ── OS / arch detection ────────────────────────────────────────────────────
detect_os() {
  OS="$(uname -s)"
  ARCH="$(uname -m)"
  case "$OS" in
    Linux*)   PLATFORM="linux" ;;
    Darwin*)  PLATFORM="macos" ;;
    CYGWIN*|MINGW*|MSYS*) PLATFORM="windows" ;;
    *) die "Unsupported OS: $OS" ;;
  esac
  case "$ARCH" in
    x86_64|amd64) ARCH="x64" ;;
    arm64|aarch64) ARCH="arm64" ;;
    *) warn "Unknown architecture: $ARCH — proceeding anyway" ;;
  esac
}

# ── Node.js detection & installation ──────────────────────────────────────
MIN_NODE_MAJOR=20

check_node() {
  if [[ -n "$OPENCLAW_SKIP_NODE" ]]; then
    return 0
  fi
  if command -v node &>/dev/null; then
    NODE_VER="$(node --version 2>/dev/null | tr -d 'v')"
    NODE_MAJOR="${NODE_VER%%.*}"
    if [[ "$NODE_MAJOR" -ge "$MIN_NODE_MAJOR" ]]; then
      success "Node.js ${NODE_VER} found"
      return 0
    else
      warn "Node.js ${NODE_VER} is too old (need v${MIN_NODE_MAJOR}+)"
    fi
  else
    info "Node.js not found"
  fi
  install_node
}

install_node() {
  info "Installing Node.js via fnm (fast node manager)..."

  if ! command -v fnm &>/dev/null; then
    info "Installing fnm..."
    if [[ "$PLATFORM" == "macos" ]] && command -v brew &>/dev/null; then
      brew install fnm &>/dev/null
    else
      curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell 2>/dev/null || \
        curl -fsSL https://raw.githubusercontent.com/Schniz/fnm/master/.ci/install.sh | bash -s -- --skip-shell 2>/dev/null
    fi
    # Add fnm to PATH for this session
    export PATH="$HOME/.fnm:$PATH"
    eval "$(fnm env --use-on-cd 2>/dev/null || true)"
  fi

  if command -v fnm &>/dev/null; then
    fnm install --lts &>/dev/null
    fnm use lts-latest &>/dev/null || fnm use default &>/dev/null || true
    eval "$(fnm env 2>/dev/null || true)"
    success "Node.js $(node --version 2>/dev/null) installed via fnm"
    return 0
  fi

  # Fallback: nvm
  if ! command -v nvm &>/dev/null; then
    info "Installing nvm as fallback..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash 2>/dev/null
    export NVM_DIR="$HOME/.nvm"
    # shellcheck disable=SC1091
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
  fi

  if command -v nvm &>/dev/null; then
    nvm install --lts &>/dev/null
    nvm use --lts &>/dev/null
    success "Node.js $(node --version 2>/dev/null) installed via nvm"
    return 0
  fi

  die "Could not install Node.js automatically. Please install Node.js v${MIN_NODE_MAJOR}+ from https://nodejs.org and re-run this script."
}

# ── Install OpenClaw ───────────────────────────────────────────────────────
install_openclaw() {
  info "Installing openclaw${OPENCLAW_VERSION:+ (${OPENCLAW_VERSION})}..."

  if [[ "$OPENCLAW_VERSION" == "latest" ]]; then
    npm install -g openclaw --silent 2>/dev/null || \
    npm install -g openclaw 2>&1 | tail -5 || \
    die "npm install failed. Try: sudo npm install -g openclaw"
  else
    npm install -g "openclaw@${OPENCLAW_VERSION}" --silent 2>/dev/null || \
    npm install -g "openclaw@${OPENCLAW_VERSION}" 2>&1 | tail -5 || \
    die "npm install failed. Try: sudo npm install -g openclaw@${OPENCLAW_VERSION}"
  fi

  INSTALLED_VERSION="$(openclaw --version 2>/dev/null || echo 'unknown')"
  success "openclaw ${INSTALLED_VERSION} installed"
}

# ── Quick onboarding ───────────────────────────────────────────────────────
run_onboarding() {
  echo ""
  echo -e "  ${BOLD}Quick setup${NC}"
  echo ""

  # Check if already configured
  CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.openclaw}"
  if [[ -f "$CONFIG_DIR/config.yaml" ]]; then
    info "Existing config found at ${CONFIG_DIR}/config.yaml"
    return 0
  fi

  # Create default config
  mkdir -p "$CONFIG_DIR"

  if [[ -n "$OPENCLAW_ENTERPRISE" ]]; then
    cat > "$CONFIG_DIR/config.yaml" <<'YAML'
# OpenClaw Enterprise Configuration
# Generated by installer — edit to customize

enterprise:
  enabled: true
  secrets:
    backend: file          # file | vault | aws-sm | gcp-sm | azure-kv
  iam:
    enabled: true
    jwt:
      algorithm: RS256
  audit:
    enabled: true
    storage:
      driver: sqlite
  monitoring:
    enabled: true

gateway:
  bind: loopback           # loopback | lan | tailnet | custom
  auth:
    mode: jwt              # jwt | apikey | none (loopback only)
  port: 3284
YAML
    success "Enterprise config written to ${CONFIG_DIR}/config.yaml"
  else
    cat > "$CONFIG_DIR/config.yaml" <<'YAML'
# OpenClaw Configuration
# Generated by installer — edit to customize

gateway:
  bind: loopback
  auth:
    mode: none             # safe on loopback; change to jwt for network access
  port: 3284
YAML
    success "Config written to ${CONFIG_DIR}/config.yaml"
  fi

  echo ""
  info "Set your AI provider API key:"
  echo ""
  echo -e "  ${DIM}# Anthropic Claude (recommended)${NC}"
  echo -e "  export ANTHROPIC_API_KEY=sk-ant-..."
  echo ""
  echo -e "  ${DIM}# Or run the interactive setup:${NC}"
  echo -e "  openclaw onboard"
  echo ""
}

# ── Demo mode ─────────────────────────────────────────────────────────────
run_demo() {
  echo ""
  echo -e "  ${BOLD}${CYAN}Running demo...${NC} ${DIM}(press Ctrl+C to exit)${NC}"
  echo ""
  openclaw demo --quick 2>/dev/null || \
  openclaw --demo 2>/dev/null || \
  info "Run 'openclaw demo' to see OpenClaw in action"
}

# ── Shell completion ───────────────────────────────────────────────────────
install_completion() {
  SHELL_NAME="$(basename "${SHELL:-/bin/bash}")"
  case "$SHELL_NAME" in
    bash)
      COMPLETION_FILE="$HOME/.bash_completion.d/openclaw"
      mkdir -p "$(dirname "$COMPLETION_FILE")"
      openclaw completion bash > "$COMPLETION_FILE" 2>/dev/null && \
        info "Bash completion installed (restart shell or: source ${COMPLETION_FILE})" || true
      ;;
    zsh)
      COMPLETION_FILE="${ZDOTDIR:-$HOME}/.zsh/completions/_openclaw"
      mkdir -p "$(dirname "$COMPLETION_FILE")"
      openclaw completion zsh > "$COMPLETION_FILE" 2>/dev/null && \
        info "Zsh completion installed" || true
      ;;
    fish)
      COMPLETION_FILE="$HOME/.config/fish/completions/openclaw.fish"
      mkdir -p "$(dirname "$COMPLETION_FILE")"
      openclaw completion fish > "$COMPLETION_FILE" 2>/dev/null && \
        info "Fish completion installed" || true
      ;;
  esac
}

# ── Print success summary ──────────────────────────────────────────────────
print_success() {
  echo ""
  echo -e "  ${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "  ${GREEN}${BOLD}  ${LOBSTER}  OpenClaw is ready!${NC}"
  echo -e "  ${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo -e "  ${BOLD}Get started:${NC}"
  echo ""
  echo -e "    ${CYAN}openclaw start${NC}          ${DIM}# start the gateway${NC}"
  echo -e "    ${CYAN}openclaw onboard${NC}         ${DIM}# interactive setup wizard${NC}"
  echo -e "    ${CYAN}openclaw demo${NC}            ${DIM}# see it in action${NC}"
  echo ""
  echo -e "  ${BOLD}Documentation:${NC}"
  echo -e "    ${DIM}https://github.com/openclaw/openclaw${NC}"
  echo ""
  if [[ -n "$OPENCLAW_ENTERPRISE" ]]; then
    echo -e "  ${BOLD}Enterprise docs:${NC}"
    echo -e "    ${DIM}https://github.com/openclaw/openclaw/tree/main/docs/enterprise${NC}"
    echo ""
  fi
  echo -e "  ${DIM}Found a bug? https://github.com/openclaw/openclaw/issues${NC}"
  echo ""
}

# ── Main ───────────────────────────────────────────────────────────────────
main() {
  print_banner
  detect_os

  echo -e "  ${DIM}Platform: ${PLATFORM}/${ARCH}${NC}"
  echo ""

  check_node
  install_openclaw
  run_onboarding
  install_completion 2>/dev/null || true
  print_success

  if [[ -n "$OPENCLAW_DEMO" ]]; then
    run_demo
  fi
}

main "$@"
