#!/bin/sh
# Sourced by install.sh before any add-on files are replaced.
package_installed() {
    if command -v apk >/dev/null; then
        apk info -e "$1" >/dev/null 2>&1
    elif command -v opkg >/dev/null; then
        opkg status "$1" 2>/dev/null | grep -q 'Status:.* installed'
    else
        return 1
    fi
}

install_dependencies() {
    set --
    for dependency in ucode ucode-mod-fs ucode-mod-digest curl ca-bundle flock; do
        package_installed "$dependency" || set -- "$@" "$dependency"
    done
    [ "$#" -gt 0 ] || return 0
    echo "Installing dependencies: $*"
    if command -v apk >/dev/null; then
        apk update || { echo 'Unable to update package indexes; installation cancelled.' >&2; return 1; }
        apk add "$@" || { echo 'Unable to install dependencies from configured OpenWrt repositories.' >&2; return 1; }
    elif command -v opkg >/dev/null; then
        opkg update || { echo 'Unable to update package indexes; installation cancelled.' >&2; return 1; }
        opkg install "$@" || { echo 'Unable to install dependencies from configured OpenWrt repositories.' >&2; return 1; }
    else
        echo 'No supported OpenWrt package manager found.' >&2
        return 1
    fi
    for dependency in "$@"; do
        package_installed "$dependency" || { echo "Dependency still missing: $dependency" >&2; return 1; }
    done
}
