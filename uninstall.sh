#!/bin/sh
set -eu
[ "$(id -u)" = 0 ] || { echo 'Run as root.' >&2; exit 1; }
for package in podkop-subscriptions luci-app-podkop-subscriptions; do
    if command -v apk >/dev/null && apk info -e "$package" >/dev/null 2>&1; then
        echo "Remove $package with apk instead." >&2; exit 1
    fi
    if command -v opkg >/dev/null && opkg status "$package" 2>/dev/null | grep -q 'Status:.* installed'; then
        echo "Remove $package with opkg instead." >&2; exit 1
    fi
done
if [ -f /usr/share/podkop-subscriptions/integrate.uc ]; then
    ucode /usr/share/podkop-subscriptions/integrate.uc remove
fi
if [ -x /etc/init.d/podkop-subscriptions ]; then
    /etc/init.d/podkop-subscriptions disable
fi
rm -f /usr/libexec/rpcd/podkop-subscriptions \
    /usr/share/podkop-subscriptions/backend.uc \
    /usr/share/podkop-subscriptions/parser.uc \
    /usr/share/podkop-subscriptions/VERSION \
    /usr/share/podkop-subscriptions/integrate.uc \
    /etc/init.d/podkop-subscriptions \
    /usr/share/rpcd/acl.d/luci-app-podkop-subscriptions.json \
    /usr/share/luci/menu.d/luci-app-podkop-subscriptions.json \
    /www/luci-static/resources/view/podkop-subscriptions/overview.js \
    /www/luci-static/resources/view/podkop/subscriptions.js
for cache in /tmp/luci-indexcache*; do
    [ -f "$cache" ] && rm -f "$cache"
done
/etc/init.d/rpcd restart
echo 'Original Podkop interface restored. Configuration, backups and current proxy links preserved.'
