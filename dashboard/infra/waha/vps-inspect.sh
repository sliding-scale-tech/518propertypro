#!/usr/bin/env bash
# Read-only survey of a VPS before installing anything on it.
#
# Nothing here stops, deletes or changes a single thing — it only reports. Run it, read the
# output, and decide what to remove by hand. Deliberately not automated: on a box that is
# already running something you care about, a script that "cleans up" is how you lose it.
#
#   scp vps-inspect.sh user@your-vps:~/ && ssh user@your-vps 'bash vps-inspect.sh'

set -u

line() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }

line "Host"
hostname
uname -a
echo "uptime: $(uptime -p 2>/dev/null || uptime)"

line "Memory"
free -h

line "Disk"
df -h / 2>/dev/null

line "CPU"
nproc
echo "load: $(cat /proc/loadavg)"

line "Docker installed?"
if command -v docker >/dev/null 2>&1; then
  docker --version
  docker compose version 2>/dev/null || echo "(compose plugin not found)"
else
  echo "DOCKER NOT INSTALLED — install it before deploying WAHA"
fi

line "Running containers"
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null || echo "(none / docker unavailable)"

line "ALL containers, including stopped"
docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}' 2>/dev/null

line "Live resource usage"
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}' 2>/dev/null

line "Compose projects on this box"
# Anything with a project label is managed by a compose file somewhere — find that folder
# before touching the containers, or you will fight it on the next reboot.
docker ps -a --filter 'label=com.docker.compose.project' \
  --format '{{.Label "com.docker.compose.project"}}\t{{.Names}}\t{{.Label "com.docker.compose.project.working_dir"}}' 2>/dev/null | sort -u

line "Volumes (data lives here — never prune blindly)"
docker volume ls 2>/dev/null

line "Networks"
docker network ls 2>/dev/null

line "Images (disk usage)"
docker images --format 'table {{.Repository}}:{{.Tag}}\t{{.Size}}' 2>/dev/null
docker system df 2>/dev/null

line "Ports already listening (is 3001 free?)"
(ss -tulpn 2>/dev/null || netstat -tulpn 2>/dev/null) | grep -E 'LISTEN|udp' | head -40

line "Non-Docker services (an Instagram bot may be a plain systemd unit or a cron job)"
systemctl list-units --type=service --state=running --no-pager 2>/dev/null | head -40

line "Enabled-at-boot services"
systemctl list-unit-files --type=service --state=enabled --no-pager 2>/dev/null | head -40

line "Cron jobs"
echo "--- root crontab ---";  crontab -l 2>/dev/null || echo "(none)"
echo "--- /etc/cron.d ---";   ls -la /etc/cron.d 2>/dev/null
echo "--- per-user crontabs ---"; ls -la /var/spool/cron/crontabs 2>/dev/null

line "Heaviest processes"
ps aux --sort=-%mem 2>/dev/null | head -15

line "PM2 / node process managers"
command -v pm2 >/dev/null 2>&1 && pm2 list 2>/dev/null || echo "(pm2 not installed)"

line "Python / node processes that look like bots"
ps aux 2>/dev/null | grep -iE 'python|node|insta|selenium|chrome|chromium|playwright|puppeteer' | grep -v grep | head -20

line "Existing reverse proxy?"
for svc in nginx caddy apache2 traefik; do
  if command -v "$svc" >/dev/null 2>&1 || systemctl is-active --quiet "$svc" 2>/dev/null; then
    echo "$svc: present/active"
  fi
done

line "Firewall"
ufw status 2>/dev/null || iptables -L -n 2>/dev/null | head -20

printf '\n\033[1mDone. Nothing was changed.\033[0m\n'
