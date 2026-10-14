#!/bin/sh
set -eu
umask 077

REPO=chillykidd/podkop-subscriptions
VERSION=0.2.0
ARCHIVE=podkop-subscriptions-$VERSION.tar.gz
BASE=https://github.com/$REPO/releases/download/v$VERSION
MODE=${1:-install}
case "$MODE" in install|--check) ;; *) echo 'Usage: sh get.sh [--check]' >&2; exit 1 ;; esac

[ "$(id -u)" = 0 ] || { echo 'Run as root on the router.' >&2; exit 1; }
installed() {
    if command -v apk >/dev/null; then
        apk info -e "$1" >/dev/null 2>&1
    elif command -v opkg >/dev/null; then
        opkg status "$1" 2>/dev/null | grep -q 'Status:.* installed'
    else
        return 1
    fi
}
for package in podkop luci-app-podkop; do
    installed "$package" || { echo "Install $package first." >&2; exit 1; }
done
for program in curl tar sha256sum mktemp; do
    command -v "$program" >/dev/null || { echo "Missing dependency: $program" >&2; exit 1; }
done

work=$(mktemp -d /tmp/podkop-subscriptions.XXXXXX)
cleanup() { rm -rf "$work"; }
trap cleanup 0
trap 'exit 1' 1 2 15
download() {
    curl -q --fail --silent --show-error --location \
        --proto '=https' --proto-redir '=https' \
        --connect-timeout 10 --max-time 120 --max-filesize "$3" \
        --output "$2" --url "$1"
}

echo "Downloading Podkop subscriptions $VERSION..."
download "$BASE/$ARCHIVE" "$work/$ARCHIVE" 4194304
download "$BASE/SHA256SUMS" "$work/SHA256SUMS" 512
IFS=' ' read -r expected filename < "$work/SHA256SUMS"
case "$expected" in ''|*[!0-9a-f]*) echo 'Invalid checksum file.' >&2; exit 1 ;; esac
[ "${#expected}" = 64 ] && [ "$filename" = "$ARCHIVE" ] || { echo 'Invalid checksum file.' >&2; exit 1; }
actual=$(sha256sum "$work/$ARCHIVE")
actual=${actual%% *}
[ "$actual" = "$expected" ] || { echo 'Checksum mismatch; installation cancelled.' >&2; exit 1; }

tar -tzf "$work/$ARCHIVE" > "$work/entries"
while IFS= read -r entry; do
    case "$entry" in
        /*|../*|*/../*|*/..|*\\*) echo 'Invalid archive path.' >&2; exit 1 ;;
        podkop-subscriptions-$VERSION/*) ;;
        *) echo 'Unexpected archive contents.' >&2; exit 1 ;;
    esac
done < "$work/entries"
tar -tvzf "$work/$ARCHIVE" > "$work/types"
while IFS= read -r entry; do
    case "$entry" in -*) ;; *) echo 'Archive must contain regular files only.' >&2; exit 1 ;; esac
done < "$work/types"

tar -xzf "$work/$ARCHIVE" -C "$work"
if [ "$MODE" = --check ]; then
    echo "Podkop subscriptions $VERSION: download and checksum verified."
    exit 0
fi
sh "$work/podkop-subscriptions-$VERSION/install.sh"
