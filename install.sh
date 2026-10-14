#!/bin/sh
# Source installer for both opkg and apk firmware. Run from extracted bundle.
set -eu
umask 077
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
[ "$(id -u)" = 0 ] || { echo 'Run as root.' >&2; exit 1; }
. "$HERE/dependencies.sh"
for required in podkop luci-app-podkop; do
    package_installed "$required" || { echo "Install $required first. This add-on requires Podkop." >&2; exit 1; }
done
[ -x /usr/bin/podkop ] && [ -f /etc/config/podkop ] || { echo 'Podkop installation is incomplete.' >&2; exit 1; }
for package in podkop-subscriptions luci-app-podkop-subscriptions; do
    if command -v apk >/dev/null && apk info -e "$package" >/dev/null 2>&1; then
        echo "Use apk to upgrade installed package $package." >&2; exit 1
    fi
    if command -v opkg >/dev/null && opkg status "$package" 2>/dev/null | grep -q 'Status:.* installed'; then
        echo "Use opkg to upgrade installed package $package." >&2; exit 1
    fi
done
[ -d /www/luci-static/resources ] || { echo 'LuCI is required.' >&2; exit 1; }
install_dependencies
for cmd in ucode curl flock ping; do
    command -v "$cmd" >/dev/null || { echo "Missing dependency: $cmd" >&2; exit 1; }
done
ucode -e 'import * as fs from "fs"; import { sha256 } from "digest"; print(sha256("check"));' >/dev/null || {
    echo 'ucode fs/digest modules could not be loaded; add-on files have not been changed.' >&2
    exit 1
}
[ -e /etc/ssl/certs/ca-certificates.crt ] || { echo 'Install ca-bundle first.' >&2; exit 1; }
ucode "$HERE/addon/luci-app-podkop-subscriptions/files/usr/share/podkop-subscriptions/integrate.uc" check

STAMP=$(date +%Y%m%d-%H%M%S)-$$
BACKUP=/etc/podkop-subscriptions/backups/$STAMP
mkdir -p "$BACKUP"
copy_file() {
    package=$1
    relative=$2
    source="$HERE/addon/$package/files/$relative"
    target="/$relative"
    if [ -f "$target" ]; then
        mkdir -p "$BACKUP/$(dirname "$relative")"
        cp -p "$target" "$BACKUP/$relative"
    fi
    mkdir -p "$(dirname "$target")"
    cp "$source" "$target"
    chmod 0644 "$target"
}
copy_file podkop-subscriptions usr/share/podkop-subscriptions/parser.uc
copy_file podkop-subscriptions usr/share/podkop-subscriptions/backend.uc
copy_file podkop-subscriptions usr/libexec/rpcd/podkop-subscriptions
chmod 0755 /usr/libexec/rpcd/podkop-subscriptions
copy_file luci-app-podkop-subscriptions usr/share/rpcd/acl.d/luci-app-podkop-subscriptions.json
copy_file luci-app-podkop-subscriptions www/luci-static/resources/view/podkop/subscriptions.js
copy_file luci-app-podkop-subscriptions usr/share/podkop-subscriptions/integrate.uc
copy_file luci-app-podkop-subscriptions etc/init.d/podkop-subscriptions
chmod 0755 /etc/init.d/podkop-subscriptions
if [ ! -f /etc/config/podkop_subscriptions ]; then
    cp "$HERE/addon/podkop-subscriptions/files/etc/config/podkop_subscriptions" /etc/config/podkop_subscriptions
fi
chmod 0600 /etc/config/podkop_subscriptions
mkdir -p /etc/podkop-subscriptions/integration
ucode /usr/share/podkop-subscriptions/integrate.uc install
/etc/init.d/podkop-subscriptions enable
# Remove the previous 0.1 source installation's standalone page.
rm -f /usr/share/luci/menu.d/luci-app-podkop-subscriptions.json \
    /www/luci-static/resources/view/podkop-subscriptions/overview.js
printf '%s\n' '0.2.3 (inline source installation)' > /usr/share/podkop-subscriptions/VERSION
# Regenerate the LuCI menu, then register the dedicated RPC plugin.
# Podkop, sing-box, networking and firewall services are not restarted.
for cache in /tmp/luci-indexcache*; do
    [ -f "$cache" ] && rm -f "$cache"
done
/etc/init.d/rpcd restart
echo "Installed Podkop subscriptions 0.2.3. Backup: $BACKUP"
echo 'Open Services -> Podkop -> Connection Type -> Подписка. Log in to LuCI again if needed.'
echo 'Podkop routing configuration and running connections have not been changed.'
