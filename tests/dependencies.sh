#!/bin/sh
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' 0
mkdir -p "$work/bin"
ln -s "$(command -v grep)" "$work/bin/grep"
cat > "$work/manager" <<'MOCK'
#!/bin/sh
case "$1" in
    info|status)
        for package; do :; done
        if [ "$package" != ucode-mod-digest ] || [ -f "$FIXTURE/installed" ]; then
            echo 'Status: install ok installed'
            exit 0
        fi
        exit 1 ;;
    update)
        echo update >> "$FIXTURE/log"
        [ "$SCENARIO" != update-failure ] ;;
    add|install)
        echo "$*" >> "$FIXTURE/log"
        [ "$SCENARIO" != install-failure ] || exit 1
        [ "$SCENARIO" = false-success ] || : > "$FIXTURE/installed" ;;
    *) exit 1 ;;
esac
MOCK
chmod 700 "$work/manager"
for manager in apk opkg; do
    cp "$work/manager" "$work/bin/$manager"
    for scenario in missing existing update-failure install-failure false-success; do
        rm -f "$work/installed" "$work/log"
        [ "$scenario" != existing ] || : > "$work/installed"
        code=0
        FIXTURE="$work" SCENARIO="$scenario" PATH="$work/bin" \
            /bin/sh -ec '. "$1"; install_dependencies' sh "$HERE/../dependencies.sh" || code=$?
        case "$scenario" in
            existing)
                [ "$code" = 0 ] && [ ! -e "$work/log" ] ;;
            missing)
                [ "$code" = 0 ] && [ -f "$work/installed" ]
                [ "$(cat "$work/log")" = "$(printf 'update\n%s ucode-mod-digest' "$( [ "$manager" = apk ] && echo add || echo install )")" ] ;;
            update-failure)
                [ "$code" != 0 ] && [ "$(cat "$work/log")" = update ] ;;
            *) [ "$code" != 0 ] ;;
        esac
        echo "Dependencies: $manager $scenario passed"
    done
    rm "$work/bin/$manager"
done
