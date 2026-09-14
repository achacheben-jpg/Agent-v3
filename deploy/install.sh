#!/usr/bin/env bash
# =============================================================================
#  Installation de « Mon Assistant » sur un serveur Ubuntu (VPS OVH ou autre).
#
#  À lancer une seule fois, en administrateur :
#     curl -fsSL https://raw.githubusercontent.com/achacheben-jpg/Agent-v3/claude/conversational-agent-iphone-1djevb/deploy/install.sh | sudo bash
#
#  Le script :
#    1. installe Node.js, Git et Caddy (serveur web qui gère le https tout seul) ;
#    2. télécharge l'application dans /opt/mon-assistant ;
#    3. vous demande votre clé API Anthropic, un mot de passe et l'adresse du site ;
#    4. démarre l'application en arrière-plan (redémarre seule après un reboot) ;
#    5. affiche l'adresse à ouvrir sur l'iPhone.
#
#  Relancer le script plus tard est sans danger : il met à jour l'application
#  et conserve vos réglages et vos données.
# =============================================================================
set -euo pipefail

REPO="${REPO:-achacheben-jpg/Agent-v3}"
BRANCH="${BRANCH:-claude/conversational-agent-iphone-1djevb}"
APP_DIR="/opt/mon-assistant"
DATA_DIR="/var/lib/mon-assistant"
ENV_FILE="/etc/mon-assistant.env"
SERVICE="mon-assistant"
APP_USER="assistant"
PORT=3000

# Couleurs (si le terminal les supporte)
if [ -t 1 ]; then B=$'\e[1m'; G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; N=$'\e[0m'; else B=""; G=""; Y=""; R=""; N=""; fi
say()  { echo "${B}${G}==>${N} $*"; }
warn() { echo "${Y}!!${N} $*"; }
die()  { echo "${R}ERREUR :${N} $*" >&2; exit 1; }

# Quand le script est lancé via « curl | bash », le clavier n'est pas relié au
# script : on lit les réponses directement sur le terminal.
ask() { # ask VARIABLE "Question" [valeur par défaut] [secret]
  local var="$1" q="$2" def="${3:-}" secret="${4:-}" val=""
  if [ -n "${!var:-}" ]; then return; fi   # déjà fourni via variable d'environnement
  while [ -z "$val" ]; do
    if [ -n "$def" ]; then printf "%s [%s] : " "$q" "$def"; else printf "%s : " "$q"; fi
    if [ -n "$secret" ]; then read -rs val </dev/tty; echo; else read -r val </dev/tty; fi
    val="${val:-$def}"
  done
  printf -v "$var" '%s' "$val"
}

[ "$(id -u)" -eq 0 ] || die "Lancez ce script avec sudo (ex. : curl ... | sudo bash)."
command -v apt-get >/dev/null || die "Ce script est prévu pour Ubuntu / Debian."
export DEBIAN_FRONTEND=noninteractive

# ----------------------------------------------------------------------------
say "1/6 Installation des logiciels de base"
apt-get update -qq
apt-get install -y -qq curl git ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https >/dev/null

if ! command -v node >/dev/null || [ "$(node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))')" -lt 20 ]; then
  say "Installation de Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
say "Node.js $(node -v) prêt"

if ! command -v caddy >/dev/null; then
  say "Installation de Caddy (https automatique)"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
fi

# ----------------------------------------------------------------------------
say "2/6 Téléchargement de l'application"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$DATA_DIR"; chown "$APP_USER:$APP_USER" "$DATA_DIR"; chmod 700 "$DATA_DIR"

clone_url="https://github.com/${REPO}.git"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --quiet origin "$BRANCH" || true
  git -C "$APP_DIR" checkout --quiet "$BRANCH" 2>/dev/null || true
  git -C "$APP_DIR" reset --quiet --hard "origin/$BRANCH" 2>/dev/null || warn "Mise à jour impossible, on garde la version en place."
else
  if ! git clone --quiet --depth 1 --branch "$BRANCH" "$clone_url" "$APP_DIR" 2>/dev/null; then
    warn "Le dépôt GitHub est privé. Il faut un code d'accès (token) GitHub."
    echo "   Créez-le sur https://github.com/settings/personal-access-tokens (Fine-grained, accès en lecture au dépôt ${REPO})."
    ask GITHUB_TOKEN "Collez le code d'accès GitHub" "" secret
    git clone --quiet --depth 1 --branch "$BRANCH" "https://x-access-token:${GITHUB_TOKEN}@github.com/${REPO}.git" "$APP_DIR" \
      || die "Téléchargement impossible. Vérifiez le code d'accès ou rendez le dépôt public."
    git -C "$APP_DIR" remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@github.com/${REPO}.git"
  fi
fi
cd "$APP_DIR"
say "3/6 Installation des dépendances"
npm ci --omit=dev --no-audit --no-fund --loglevel=error

# ----------------------------------------------------------------------------
say "4/6 Réglages"
if [ -f "$ENV_FILE" ]; then
  say "Réglages existants trouvés dans $ENV_FILE, ils sont conservés."
  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE"; set +a
fi
public_ip="$(curl -fsS --max-time 5 https://api.ipify.org || curl -fsS --max-time 5 https://ifconfig.me || true)"
default_domain="$(hostname -f 2>/dev/null || hostname)"
case "$default_domain" in *.*) ;; *) default_domain="${public_ip:-$default_domain}";; esac

echo
echo "  Répondez aux questions suivantes (Entrée = garder la valeur entre crochets)."
echo
ask ANTHROPIC_API_KEY "Clé API Anthropic (commence par sk-ant-)" "" secret
ask APP_PASSWORD     "Mot de passe pour ouvrir l'application" "" secret
ask USER_NAME        "Votre prénom" "Ben"
ask DOMAIN           "Adresse du site (nom de domaine ou nom du VPS)" "$default_domain"
: "${TIMEZONE:=Europe/Paris}"
SESSION_SECRET="${SESSION_SECRET:-$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')}"

umask 077
cat > "$ENV_FILE" <<ENV
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
APP_PASSWORD=${APP_PASSWORD}
USER_NAME=${USER_NAME}
TIMEZONE=${TIMEZONE}
DOMAIN=${DOMAIN}
SESSION_SECRET=${SESSION_SECRET}
DATA_DIR=${DATA_DIR}
PORT=${PORT}
NODE_ENV=production
ENV
umask 022
chown root:"$APP_USER" "$ENV_FILE"; chmod 640 "$ENV_FILE"

# ----------------------------------------------------------------------------
say "5/6 Démarrage automatique de l'application"
cat > "/etc/systemd/system/${SERVICE}.service" <<UNIT
[Unit]
Description=Mon Assistant (agent conversationnel)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=/usr/bin/node ${APP_DIR}/server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${DATA_DIR}
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --quiet "$SERVICE"
systemctl restart "$SERVICE"
sleep 2
systemctl is-active --quiet "$SERVICE" || { journalctl -u "$SERVICE" -n 30 --no-pager; die "L'application n'a pas démarré (voir les lignes ci-dessus)."; }

# ----------------------------------------------------------------------------
say "6/6 Mise en ligne en https (Caddy)"
case "$DOMAIN" in
  *[a-zA-Z]*) site="$DOMAIN" ;;                       # nom de domaine : certificat automatique
  *)          site="https://${DOMAIN}"; warn "Adresse IP sans nom de domaine : le certificat sera auto-signé (Safari affichera un avertissement)." ;;
esac
cat > /etc/caddy/Caddyfile <<CADDY
${site} {
	encode gzip
	reverse_proxy 127.0.0.1:${PORT} {
		flush_interval -1
	}
}
CADDY
caddy fmt --overwrite /etc/caddy/Caddyfile >/dev/null 2>&1 || true
systemctl enable --quiet caddy
systemctl restart caddy

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
fi

cat > /usr/local/bin/mon-assistant <<'CLI'
#!/usr/bin/env bash
# Petit utilitaire : mon-assistant {maj|statut|journal|redemarrer|reglages}
case "${1:-}" in
  maj|update)   sudo BRANCH="$(git -C /opt/mon-assistant rev-parse --abbrev-ref HEAD)" bash /opt/mon-assistant/deploy/install.sh ;;
  statut|status) systemctl status mon-assistant caddy --no-pager ;;
  journal|logs) journalctl -u mon-assistant -f ;;
  redemarrer|restart) sudo systemctl restart mon-assistant && echo "Redémarré." ;;
  reglages|config) sudo nano /etc/mon-assistant.env && sudo systemctl restart mon-assistant ;;
  *) echo "Usage : mon-assistant {maj|statut|journal|redemarrer|reglages}" ;;
esac
CLI
chmod +x /usr/local/bin/mon-assistant

echo
echo "${B}${G}✔ Installation terminée.${N}"
echo
echo "   Ouvrez sur votre iPhone (Safari) :  ${B}https://${DOMAIN}${N}"
echo "   puis Partager → « Sur l'écran d'accueil »."
echo
echo "   Commandes utiles sur le serveur :"
echo "     mon-assistant maj          mettre à jour l'application"
echo "     mon-assistant statut       vérifier que tout tourne"
echo "     mon-assistant journal      voir ce qui se passe en direct"
echo "     mon-assistant reglages     changer la clé API ou le mot de passe"
echo
