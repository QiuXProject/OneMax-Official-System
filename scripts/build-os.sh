#!/usr/bin/env bash
# OneMax 0.1: buduje jadro Linuksa 6.1.158, system Debian 12 (bookworm), initramfs,
# obraz ISO (BIOS + UEFI) oraz obraz dysku BIOS (MBR + ext4).
#
# Uzycie:
#   scripts/build-os.sh all                  # wszystkie etapy po kolei
#   scripts/build-os.sh tools                # narzedzia i zrodla (zlib, libelf, squashfs-tools, limine)
#   scripts/build-os.sh kernel               # jadro: konfiguracja + kompilacja
#   scripts/build-os.sh rootfs               # system Debian 12 + konfiguracja OneMax (sudo)
#   scripts/build-os.sh squashfs             # rootfs -> live/rootfs.squashfs (sudo)
#   scripts/build-os.sh initramfs            # initramfs z busybox i os/initramfs/init
#   scripts/build-os.sh iso                  # obraz ISO (El Torito: BIOS + UEFI)
#   scripts/build-os.sh bios                 # obraz dysku BIOS (sudo)
#   scripts/build-os.sh release              # kopia wynikow do $ONEMAX_OUT + SHA256SUMS
#
# Zmienne srodowiskowe:
#   ONEMAX_WORK      katalog roboczy (zrodla, drzewa, wyniki posrednie). Domyslnie ~/.cache/onemax-build
#   ONEMAX_OUT       katalog koncowych plikow (ISO, obraz BIOS). Domyslnie ~/onemax-release
#   ROOTFS_SOURCE    host (kopia pakietow zainstalowanego Debiana 12) albo debootstrap.
#                    Domyslnie debootstrap, jesli jest zainstalowany; w przeciwnym razie host.
#   ONEMAX_PASSWORD  haslo konta onemax w obrazie. Domyslnie: onemax (zmien przed publikacja!)
#   JOBS             liczba watkow make. Domyslnie nproc.
#   BUSYBOX          statyczny busybox dla initramfs. Domyslnie /usr/bin/busybox
#                    (Debian: sudo apt install busybox-static)
#
# Wymagania: gcc make tar gzip curl python3 (z venv) sudo e2fsprogs (mkfs.ext4)
#            busybox (statyczny, z apletem bc) i dla ROOTFS_SOURCE=debootstrap: debootstrap.
# Pliki posrednie zostaja w ONEMAX_WORK; do repozytorium nie trafiaja zadne pliki wynikowe.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${ONEMAX_WORK:-$HOME/.cache/onemax-build}"
OUT="${ONEMAX_OUT:-$HOME/onemax-release}"
ROOTFS_SOURCE="${ROOTFS_SOURCE:-}"
ONEMAX_PASSWORD="${ONEMAX_PASSWORD:-onemax}"
JOBS="${JOBS:-$(nproc)}"
BUSYBOX="${BUSYBOX:-/usr/bin/busybox}"

VERSION="0.1"
KVER="6.1.158"
ZLIB_VER="1.3.1"
SQUASHFS_VER="4.6.1"
LIBELF_TAG="v0.194"
LIMINE_BRANCH="v8.x-binary"

SRC="$WORK/src"
TOOLS="$WORK/tools"
DL="$WORK/dl"
LOGS="$WORK/logs"
BUILD="$WORK/build"
OUTW="$WORK/out"
ROOTFS="$WORK/rootfs"
KSRC="$SRC/linux-$KVER"
LIMINE_DIR="$SRC/Limine-8.x-binary"
PY="$WORK/venv/bin/python"

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'BLAD: %s\n' "$*" >&2; exit 1; }

need() {
    local c
    for c in "$@"; do
        command -v "$c" >/dev/null 2>&1 || die "brak narzedzia: $c"
    done
}

# fetch URL CEL: pobiera tylko gdy pliku jeszcze nie ma
fetch() {
    local url="$1" dest="$2"
    [ -s "$dest" ] && return 0
    mkdir -p "$(dirname "$dest")"
    curl -fL --retry 3 --max-time 1200 -o "$dest.part" "$url" || die "pobieranie nieudane: $url"
    mv "$dest.part" "$dest"
}

# Sprawdza, czy .config zawiera wszystkie opcje z fragmentu (kconfiglib moze je odrzucic przez zaleznosci).
check_fragment() {
    local frag="$1" n=0 line name want got
    while IFS= read -r line; do
        case "$line" in
            CONFIG_*=*)
                name=${line%%=*}
                want=${line#*=}
                want=${want//\"/}
                got=$(grep -E "^${name}=" .config | tail -1 | cut -d= -f2- | tr -d '"' || true)
                if [ "$got" != "$want" ]; then
                    echo "niezgodna opcja: $name (oczekiwano '$want', jest '${got:-brak}')" >&2
                    n=$((n + 1))
                fi
                ;;
            "# CONFIG_"*" is not set")
                name=$(printf '%s' "$line" | sed -E 's/^# (CONFIG_[A-Za-z0-9_]+) is not set$/\1/')
                if grep -qE "^${name}=" .config; then
                    echo "niezgodna opcja: $name (oczekiwano wylaczonej)" >&2
                    n=$((n + 1))
                fi
                ;;
        esac
    done < "$frag"
    [ "$n" -eq 0 ]
}

# Bezpiecznik: nie usuwamy niczego poza katalogiem rootfs OneMax.
check_rootfs_path() {
    case "$ROOTFS" in
        */onemax-build/rootfs) ;;
        *) die "nieoczekiwana sciezka rootfs: $ROOTFS" ;;
    esac
}

stage_tools() {
    need gcc make tar gzip curl python3 sudo
    [ -x "$BUSYBOX" ] || die "brak statycznego busybox ($BUSYBOX). Debian: sudo apt install busybox-static"
    "$BUSYBOX" --list | grep -qx bc || die "busybox bez apletu bc (jadro potrzebuje bc do timeconst.h)"
    mkdir -p "$SRC" "$TOOLS/bin" "$TOOLS/lib" "$TOOLS/include" "$DL" "$LOGS" "$BUILD" "$OUTW"
    ln -sf "$BUSYBOX" "$TOOLS/bin/bc"

    # Jadro buduje certs/extract-cert, ktory wymaga naglowkow openssl/*.h i libcrypto.
    # Debian: sudo apt install libssl-dev. Alternatywa: OPENSSL_INCLUDE=katalog z openssl/*.h.
    local ossl="${OPENSSL_INCLUDE:-/usr/include}"
    [ -f "$ossl/openssl/bio.h" ] || die "brak naglowkow OpenSSL w $ossl/openssl (Debian: sudo apt install libssl-dev; albo ustaw OPENSSL_INCLUDE)"
    mkdir -p "$TOOLS/openssl-include"
    ln -sfn "$ossl/openssl" "$TOOLS/openssl-include/openssl"
    if [ ! -e "$TOOLS/lib/libcrypto.so" ]; then
        local lc
        for f in /usr/lib/x86_64-linux-gnu/libcrypto.so /usr/lib/x86_64-linux-gnu/libcrypto.so.3; do
            if [ -e "$f" ]; then lc="$f"; break; fi
        done
        [ -n "$lc" ] || die "brak libcrypto (Debian: sudo apt install libssl-dev)"
        ln -sf "$lc" "$TOOLS/lib/libcrypto.so"
    fi

    log "Srodowisko Python (kconfiglib do konfiguracji jadra, pycdlib do ISO, pillow do logo)"
    if [ ! -x "$PY" ]; then
        python3 -m venv "$WORK/venv"
    fi
    "$WORK/venv/bin/pip" install -q kconfiglib==14.1.0 pycdlib==1.21.0 pillow==12.3.0

    log "zlib $ZLIB_VER (statyczna, do mksquashfs)"
    if [ ! -f "$TOOLS/lib/libz.a" ]; then
        fetch "https://codeload.github.com/madler/zlib/tar.gz/refs/tags/v$ZLIB_VER" "$DL/zlib-$ZLIB_VER.tar.gz"
        tar -xzf "$DL/zlib-$ZLIB_VER.tar.gz" -C "$SRC"
        (cd "$SRC/zlib-$ZLIB_VER" && ./configure --static --prefix="$TOOLS" >"$LOGS/zlib.log" 2>&1 \
            && make -j"$JOBS" >>"$LOGS/zlib.log" 2>&1 && make install >>"$LOGS/zlib.log" 2>&1) \
            || die "zlib (zob. $LOGS/zlib.log)"
    fi

    log "libelf ${LIBELF_TAG} (naglowki dla objtool; brak libelf-dev na hoscie)"
    if [ ! -f "$TOOLS/lib/libelf.a" ]; then
        fetch "https://codeload.github.com/arachsys/libelf/tar.gz/refs/tags/$LIBELF_TAG" "$DL/libelf-$LIBELF_TAG.tar.gz"
        tar -xzf "$DL/libelf-$LIBELF_TAG.tar.gz" -C "$SRC"
        local ldir
        ldir="$(find "$SRC" -maxdepth 1 -type d -name 'libelf-*' | sort | tail -1)"
        # zstd nie jest zainstalowany na hoscie: wylaczamy kompresje zstd w libelf
        sed -i -e 's|^#define USE_ZSTD .*$|/* zstd wylaczony w buildzie OneMax */|' \
               -e 's|^#define USE_ZSTD_COMPRESS .*$||' "$ldir/src/config.h"
        (cd "$ldir" && make libelf.a CFLAGS="-O2 -Wall -Iinclude -Isrc -DHAVE_CONFIG_H -I$TOOLS/include" \
            >"$LOGS/libelf.log" 2>&1) || die "libelf (zob. $LOGS/libelf.log)"
        cp "$ldir/include/libelf.h" "$ldir/include/gelf.h" "$ldir/include/nlist.h" "$TOOLS/include/"
        cp "$ldir/libelf.a" "$TOOLS/lib/"
    fi

    log "squashfs-tools $SQUASHFS_VER (mksquashfs, statyczny)"
    if [ ! -x "$TOOLS/bin/mksquashfs" ]; then
        fetch "https://codeload.github.com/plougher/squashfs-tools/tar.gz/refs/tags/$SQUASHFS_VER" "$DL/squashfs-tools-$SQUASHFS_VER.tar.gz"
        tar -xzf "$DL/squashfs-tools-$SQUASHFS_VER.tar.gz" -C "$SRC"
        (cd "$SRC/squashfs-tools-$SQUASHFS_VER/squashfs-tools" && make -j"$JOBS" mksquashfs unsquashfs \
            XZ_SUPPORT=0 ZSTD_SUPPORT=0 LZO_SUPPORT=0 LZ4_SUPPORT=0 \
            EXTRA_CFLAGS="-I$TOOLS/include" LDFLAGS="-static -L$TOOLS/lib" LIBS="-lz -lpthread -lm" \
            >"$LOGS/squashfs.log" 2>&1 && cp mksquashfs unsquashfs "$TOOLS/bin/") \
            || die "squashfs-tools (zob. $LOGS/squashfs.log)"
    fi

    log "Limine $LIMINE_BRANCH (pliki BIOS/UEFI + instalator limine)"
    if [ ! -f "$LIMINE_DIR/limine.c" ]; then
        fetch "https://codeload.github.com/limine-bootloader/limine/tar.gz/refs/heads/$LIMINE_BRANCH" "$DL/limine-$LIMINE_BRANCH.tar.gz"
        tar -xzf "$DL/limine-$LIMINE_BRANCH.tar.gz" -C "$SRC"
    fi
    if [ ! -x "$TOOLS/bin/limine" ]; then
        gcc -O2 -Wall -o "$TOOLS/bin/limine" "$LIMINE_DIR/limine.c" >"$LOGS/limine.log" 2>&1 || die "limine (zob. $LOGS/limine.log)"
    fi
}

stage_kernel() {
    need gcc make
    fetch "https://codeload.github.com/gregkh/linux/tar.gz/refs/tags/v$KVER" "$DL/linux-$KVER.tar.gz"
    if [ ! -f "$KSRC/Makefile" ]; then
        log "Rozpakowanie jadra $KVER"
        tar -xzf "$DL/linux-$KVER.tar.gz" -C "$SRC"
    fi
    # kconfiglib 14.1 nie zna slowa kluczowego 'modules' z Kconfig 6.1; usuwamy je tylko w drzewie
    # do generowania konfiguracji (CONFIG_MODULES zostaje, a w tym buildzie nie ma modulow).
    if sed -n '/^\tmodules$/p' "$KSRC/kernel/module/Kconfig" | grep -q .; then
        sed -i '/^\tmodules$/d' "$KSRC/kernel/module/Kconfig"
    fi

    # Ponowna konfiguracja zmienia mtime plikow, od ktorych zalezy caly build (autoconf.h).
    # Robimy ja tylko, gdy zmienil sie fragment OneMax albo nie ma wczesniejszej konfiguracji.
    local key
    key=$(sha256sum "$REPO/os/kernel/onemax.config" | cut -d' ' -f1)
    if [ -f "$KSRC/.onemax-config-key" ] && [ "$(cat "$KSRC/.onemax-config-key")" = "$key" ] \
        && [ -f "$KSRC/include/generated/autoconf.h" ]; then
        log "Konfiguracja jadra bez zmian (pomijam ponowne generowanie)"
        return 0
    fi

    (
        log "Konfiguracja jadra: x86_64_defconfig + os/kernel/onemax.config"
        cd "$KSRC"
        export srctree=. ARCH=x86 SRCARCH=x86 KERNELVERSION="$KVER" KCONFIG_CONFIG=.config CC=gcc HOSTCC=gcc LD=ld
        # Wartosc bez nawiasow: make nie radzi sobie z cudzyslowami w wartosci CC_VERSION_TEXT.
        local ccv
        ccv="gcc-$(gcc -dumpversion)"
        export CC_VERSION_TEXT="$ccv"
        local K="$WORK/venv/bin"
        "$K/defconfig" arch/x86/configs/x86_64_defconfig >"$LOGS/kconfig.log" 2>&1
        cat "$REPO/os/kernel/onemax.config" >> .config
        "$K/olddefconfig" Kconfig >>"$LOGS/kconfig.log" 2>&1
        check_fragment "$REPO/os/kernel/onemax.config" || die "konfiguracja jadra odrzucila opcje (zob. $LOGS/kconfig.log)"

        # Pliki, ktore make sprawdza zamiast uruchamiac syncconfig (ktory wymagalby flex/bison)
        mkdir -p include/config include/generated
        "$K/genconfig" --header-path include/generated/autoconf.h --config-out include/config/auto.conf \
            --sync-deps include/config >>"$LOGS/kconfig.log" 2>&1
        "$K/genconfig" --file-list "$BUILD/kconfig-files.txt" --header-path include/generated/autoconf.h \
            --config-out include/config/auto.conf >>"$LOGS/kconfig.log" 2>&1
        # kconfiglib zapisuje wartosci tekstowe w cudzyslowach; make oczekuje ich bez cudzyslowow
        sed -i -E 's/^(CONFIG_[A-Za-z0-9_]+)="(.*)"$/\1=\2/' include/config/auto.conf
        {
            echo 'deps_config := \'
            awk '!seen[$0]++' "$BUILD/kconfig-files.txt" | sed 's/^/\t/; s/$/ \\/' | sed '$ s/ \\$//'
            echo
            echo '$(deps_config): ;'
        } > include/config/auto.conf.cmd
        : > include/generated/rustc_cfg
        touch include/config/auto.conf include/generated/autoconf.h include/config/auto.conf.cmd include/generated/rustc_cfg

        log "Logo OneMax dla jadra (CONFIG_LOGO_LINUX_CLUT224)"
        "$PY" "$REPO/scripts/make-kernel-logo.py" --out "$BUILD/logo_linux_clut224.ppm"
        if ! cmp -s "$BUILD/logo_linux_clut224.ppm" drivers/video/logo/logo_linux_clut224.ppm; then
            cp "$BUILD/logo_linux_clut224.ppm" drivers/video/logo/logo_linux_clut224.ppm
        fi
        echo "$key" > .onemax-config-key
    )
}

stage_kernel_build() {
    (
        cd "$KSRC"
        export PATH="$TOOLS/bin:$PATH" CPATH="$TOOLS/include:$TOOLS/openssl-include" LIBRARY_PATH="$TOOLS/lib"
        log "Kompilacja jadra (make -j$JOBS bzImage), log: $LOGS/kernel-build.log"
        make -j"$JOBS" bzImage HOSTLDFLAGS=-lz >"$LOGS/kernel-build.log" 2>&1 || die "kompilacja jadra (zob. $LOGS/kernel-build.log)"
        cp arch/x86/boot/bzImage "$OUTW/vmlinuz-onemax"
    )
    log "Jadro: $OUTW/vmlinuz-onemax ($(stat -c %s "$OUTW/vmlinuz-onemax") bajtow)"
}

rootfs_copy_host() {
    # Kopia pakietow zainstalowanego Debiana 12, bez danych sandboxa i bez sekretow.
    sudo tar -C / --one-file-system --numeric-owner --anchored -cpf - \
        --exclude='./proc' --exclude='./sys' --exclude='./dev' --exclude='./run' --exclude='./tmp' \
        --exclude='./root' --exclude='./home' --exclude='./boot' --exclude='./mnt' --exclude='./media' \
        --exclude='./srv' --exclude='./.e2b' --exclude='./lost+found' \
        --exclude='./var/cache' --exclude='./var/log' --exclude='./var/tmp' \
        --exclude='./var/lib/apt/lists' --exclude='./var/lib/systemd' --exclude='./var/lib/dbus' \
        --exclude='./var/lib/sudo' \
        --exclude='./usr/share/doc' --exclude='./usr/share/man' --exclude='./usr/share/info' \
        --exclude='./usr/bin/envd' --exclude='./usr/local/share/ca-certificates/e2b-ca.crt' \
        --exclude='./usr/local/bin/docker-entrypoint.sh' \
        --exclude='./etc/ssh/ssh_host_*' --exclude='./etc/machine-id' --exclude='./etc/hostname' \
        --exclude='./etc/hosts' --exclude='./etc/resolv.conf' --exclude='./etc/inittab' \
        --exclude='./etc/passwd-' --exclude='./etc/group-' --exclude='./etc/shadow-' --exclude='./etc/gshadow-' \
        --exclude='./etc/profile.d/prompt.sh' --exclude='./etc/profile.d/shell.sh' \
        --exclude='./etc/systemd/journald.conf.d/e2b.conf' \
        --exclude='./etc/systemd/system/envd.service' \
        --exclude='./etc/systemd/system/multi-user.target.wants/envd.service' \
        --exclude='./etc/systemd/system/serial-getty@ttyS0.service.d' \
        --exclude='./etc/systemd/system/systemd-networkd.service.d' \
        --exclude='./etc/systemd/system/sshd.service' \
        . | sudo tar -C "$ROOTFS" -xpf -
}

rootfs_debootstrap() {
    need debootstrap
    sudo debootstrap --variant=minbase bookworm "$ROOTFS" http://deb.debian.org/debian
    local pkgs
    pkgs=$(grep -v '^#' "$REPO/os/rootfs/packages.txt" | grep -v '^$' | tr '\n' ' ')
    sudo mount -t proc proc "$ROOTFS/proc"
    sudo mount --rbind /sys "$ROOTFS/sys"
    sudo mount --rbind /dev "$ROOTFS/dev"
    # shellcheck disable=SC2064
    trap "sudo umount -R '$ROOTFS/dev' '$ROOTFS/sys' '$ROOTFS/proc' 2>/dev/null || true" RETURN
    sudo chroot "$ROOTFS" /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin DEBIAN_FRONTEND=noninteractive \
        sh -c "apt-get update && apt-get install -y --no-install-recommends $pkgs && apt-get clean"
}

# Usuwa dane sandboxa (konta, klucze, demon envd, wpisy E2B) z kopii hosta.
rootfs_sanitize_host() {
    sudo rm -f "$ROOTFS"/etc/ssh/ssh_host_* "$ROOTFS"/etc/nftables.conf
    sudo rm -f "$ROOTFS"/etc/inittab
    sudo sed -i -E '/^user[[:space:]]/d' "$ROOTFS/etc/sudoers"
    sudo rm -f "$ROOTFS/etc/profile.d/prompt.sh" "$ROOTFS/etc/profile.d/shell.sh"
    sudo rm -rf "$ROOTFS/etc/systemd/system/sshd.service"
}

rootfs_finalize() {
    local src="$1"
    local chroot_env=(/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin LC_ALL=C)

    if [ "$src" = host ]; then
        rootfs_sanitize_host
    fi

    log "Nakladka OneMax (branding, siec, uslugi)"
    sudo cp -a "$REPO/os/rootfs/overlay/." "$ROOTFS/"
    sudo rm -f "$ROOTFS/etc/os-release"
    sudo ln -s ../usr/lib/os-release "$ROOTFS/etc/os-release"
    echo onemax | sudo tee "$ROOTFS/etc/hostname" >/dev/null
    sudo sh -c ": > '$ROOTFS/etc/machine-id'"
    # DNS: systemd-resolved, jesli jest w systemie; w przeciwnym razie statyczne resolvery.
    local have_resolved=0
    if [ -e "$ROOTFS/usr/lib/systemd/system/systemd-resolved.service" ]; then
        have_resolved=1
        sudo ln -sfn ../run/systemd/resolve/stub-resolv.conf "$ROOTFS/etc/resolv.conf"
    else
        printf 'nameserver 1.1.1.1\nnameserver 9.9.9.9\n' | sudo tee "$ROOTFS/etc/resolv.conf" >/dev/null
    fi
    if [ -e "$ROOTFS/usr/share/zoneinfo/Europe/Warsaw" ]; then
        sudo ln -sfn /usr/share/zoneinfo/Europe/Warsaw "$ROOTFS/etc/localtime"
        echo Europe/Warsaw | sudo tee "$ROOTFS/etc/timezone" >/dev/null
    fi
    sudo install -d -m 0755 "$ROOTFS/usr/share/onemax" "$ROOTFS/usr/share/plymouth/themes"
    sudo install -m 0644 "$REPO/branding/onemax-logo.png" "$ROOTFS/usr/share/onemax/logo.png"
    sudo rm -rf "$ROOTFS/usr/share/plymouth/themes/onemax"
    sudo cp -a "$REPO/boot/plymouth/onemax" "$ROOTFS/usr/share/plymouth/themes/onemax"
    local commit
    commit=$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo "nieznany")
    {
        echo "OneMax $VERSION"
        echo "Jadro: Linux $KVER (konfiguracja: x86_64_defconfig + os/kernel/onemax.config)"
        echo "Baza systemu: Debian 12 (bookworm), zrodlo rootfs: $src"
        echo "Repozytorium: commit $commit"
        echo "Zbudowano: $(date -u '+%Y-%m-%d %H:%M UTC')"
        echo "Plymouth: motyw onemax jest w systemie, ale pakiet plymouth nie jest zainstalowany"
    } | sudo tee "$ROOTFS/usr/share/onemax/build-info.txt" >/dev/null

    sudo install -d -m 0755 "$ROOTFS"/proc "$ROOTFS"/sys "$ROOTFS"/dev "$ROOTFS"/run "$ROOTFS"/boot \
        "$ROOTFS"/mnt "$ROOTFS"/media "$ROOTFS"/srv "$ROOTFS"/home "$ROOTFS"/var/log "$ROOTFS"/var/lib/systemd
    sudo install -d -m 0700 "$ROOTFS/root"
    sudo install -d -m 1777 "$ROOTFS/tmp" "$ROOTFS/var/tmp"
    sudo install -d "$ROOTFS/var/cache/apt/archives/partial" "$ROOTFS/var/lib/apt/lists/partial"

    log "Konta: onemax (sudo), konto root zablokowane"
    if [ "$src" = host ]; then
        sudo chroot "$ROOTFS" "${chroot_env[@]}" userdel node 2>/dev/null || true
        sudo chroot "$ROOTFS" "${chroot_env[@]}" userdel user 2>/dev/null || true
        sudo chroot "$ROOTFS" "${chroot_env[@]}" groupdel node 2>/dev/null || true
        sudo chroot "$ROOTFS" "${chroot_env[@]}" groupdel user 2>/dev/null || true
        sudo rm -f "$ROOTFS/etc/passwd-" "$ROOTFS/etc/group-" "$ROOTFS/etc/shadow-" "$ROOTFS/etc/gshadow-"
    fi
    if ! sudo chroot "$ROOTFS" "${chroot_env[@]}" id onemax >/dev/null 2>&1; then
        sudo chroot "$ROOTFS" "${chroot_env[@]}" useradd -m -u 1000 -s /bin/bash -G sudo onemax
    fi
    echo "onemax:$ONEMAX_PASSWORD" | sudo chroot "$ROOTFS" "${chroot_env[@]}" chpasswd
    sudo chroot "$ROOTFS" "${chroot_env[@]}" passwd -l root >/dev/null
    for g in adm audio video plugdev netdev; do
        sudo chroot "$ROOTFS" "${chroot_env[@]}" usermod -aG "$g" onemax 2>/dev/null || true
    done

    log "Uslugi systemd (offline, systemctl --root)"
    sudo systemctl --root="$ROOTFS" enable systemd-networkd.service onemax-firstboot.service
    if [ "$have_resolved" = 1 ]; then
        sudo systemctl --root="$ROOTFS" enable systemd-resolved.service
    fi
    sudo systemctl --root="$ROOTFS" disable ssh.service ssh.socket nftables.service rpcbind.service rpcbind.socket nfs-client.target 2>/dev/null || true

    if [ "$src" = host ]; then
        sudo rm -f "$ROOTFS/usr/local/share/ca-certificates/e2b-ca.crt"
        sudo chroot "$ROOTFS" "${chroot_env[@]}" update-ca-certificates --fresh >/dev/null 2>&1 || true
    fi

    log "Sprzatanie i kontrola"
    sudo rm -rf "$ROOTFS"/var/cache/apt/archives/*.deb "$ROOTFS"/var/lib/apt/lists/* \
        "$ROOTFS"/var/log/* "$ROOTFS"/tmp/* "$ROOTFS"/var/tmp/* "$ROOTFS"/root/.bash_history 2>/dev/null || true
    sudo install -d "$ROOTFS/var/lib/apt/lists/partial" "$ROOTFS/var/cache/apt/archives/partial"
    [ -x "$ROOTFS/usr/lib/systemd/systemd" ] || die "w rootfs brak systemd"
    [ -e "$ROOTFS/usr/lib/systemd/system/getty@.service" ] || die "w rootfs brak getty@.service"
    # Tokeny GitHub w calym rootfs; klucze PEM tylko w /etc i /var (dokumentacja npm zawiera przyklady).
    if sudo grep -rIlqE 'ghp_[A-Za-z0-9]{30,}|gho_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}' "$ROOTFS" 2>/dev/null; then
        die "w rootfs znaleziono token GitHub (sprawdz: sudo grep -rIlE 'ghp_|gho_|github_pat_' $ROOTFS)"
    fi
    if sudo grep -rIlqE -- '-----BEGIN (RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----' "$ROOTFS/etc" "$ROOTFS/var" 2>/dev/null; then
        die "w rootfs w /etc lub /var znaleziono klucz prywatny"
    fi
    echo "rootfs gotowy: $(sudo du -sh "$ROOTFS" | cut -f1), systemd: $(sudo chroot "$ROOTFS" /usr/bin/env -i PATH=/usr/bin:/bin systemctl --version | head -1)"
}

stage_rootfs() {
    need sudo
    check_rootfs_path
    local src="$ROOTFS_SOURCE"
    if [ -z "$src" ]; then
        if command -v debootstrap >/dev/null 2>&1; then src=debootstrap; elif [ -f /etc/debian_version ]; then src=host; else die "ustaw ROOTFS_SOURCE=host lub debootstrap"; fi
    fi
    log "Rootfs OneMax z: $src (wymaga sudo)"
    sudo rm -rf "$ROOTFS"
    sudo install -d -m 0755 "$ROOTFS"
    case "$src" in
        host) rootfs_copy_host ;;
        debootstrap) rootfs_debootstrap ;;
        *) die "ROOTFS_SOURCE=$src: oczekiwano host albo debootstrap" ;;
    esac
    rootfs_finalize "$src"
}

stage_squashfs() {
    check_rootfs_path
    [ -d "$ROOTFS/usr" ] || die "najpierw: scripts/build-os.sh rootfs"
    log "rootfs -> squashfs (gzip, 1 MiB, sudo)"
    # shellcheck disable=SC2024  # log zapisuje uzytkownik; sudo dziedziczy deskryptor
    sudo "$TOOLS/bin/mksquashfs" "$ROOTFS" "$OUTW/rootfs.squashfs" -comp gzip -b 1M -all-root -noappend \
        -no-progress -processors "$JOBS" >"$LOGS/mksquashfs.log" 2>&1 || die "mksquashfs (zob. $LOGS/mksquashfs.log)"
    sudo chown "$(id -u):$(id -g)" "$OUTW/rootfs.squashfs"
    log "squashfs: $(stat -c %s "$OUTW/rootfs.squashfs") bajtow"
}

stage_initramfs() {
    local d="$BUILD/initramfs"
    log "initramfs (busybox + os/initramfs/init)"
    rm -rf "$d"
    mkdir -p "$d"/{bin,sbin,etc,proc,sys,dev,run,tmp,newroot,medium,lower,rw}
    cp "$BUSYBOX" "$d/bin/busybox"
    chmod 0755 "$d/bin/busybox"
    install -m 0755 "$REPO/os/initramfs/init" "$d/init"
    (cd "$d" && find . | "$BUSYBOX" cpio -o -H newc 2>/dev/null | gzip -9 -n) > "$OUTW/initramfs-onemax.cpio.gz"
    log "initramfs: $(stat -c %s "$OUTW/initramfs-onemax.cpio.gz") bajtow"
}

stage_iso() {
    log "Obraz ISO (El Torito: BIOS + UEFI, pycdlib)"
    "$PY" "$REPO/scripts/make-iso.py" \
        --kernel "$OUTW/vmlinuz-onemax" \
        --initrd "$OUTW/initramfs-onemax.cpio.gz" \
        --squashfs "$OUTW/rootfs.squashfs" \
        --limine-dir "$LIMINE_DIR" \
        --conf "$REPO/os/boot/limine.conf" \
        --background "$REPO/boot/grub/background.png" \
        --label "ONEMAX_${VERSION//./_}" \
        --out "$OUTW/onemax-$VERSION.iso"
}

stage_bios() {
    check_rootfs_path
    log "Obraz dysku BIOS (MBR + ext4, limine bios-install, sudo)"
    sudo "$PY" "$REPO/scripts/make-bios-image.py" \
        --rootfs "$ROOTFS" \
        --work "$BUILD/bios-tree" \
        --kernel "$OUTW/vmlinuz-onemax" \
        --initrd "$OUTW/initramfs-onemax.cpio.gz" \
        --limine-dir "$LIMINE_DIR" \
        --limine "$TOOLS/bin/limine" \
        --conf "$REPO/os/boot/limine.conf" \
        --background "$REPO/boot/grub/background.png" \
        --out "$OUTW/onemax-$VERSION-bios.img"
    sudo chown "$(id -u):$(id -g)" "$OUTW/onemax-$VERSION-bios.img"
}

stage_release() {
    log "Kopia wynikow do $OUT"
    mkdir -p "$OUT"
    cp "$OUTW/onemax-$VERSION.iso" "$OUTW/onemax-$VERSION-bios.img" "$OUT/"
    (cd "$OUT" && sha256sum "onemax-$VERSION.iso" "onemax-$VERSION-bios.img" > SHA256SUMS)
    cat "$OUT/SHA256SUMS"
}

main() {
    local cmd="${1:-help}"
    case "$cmd" in
        all)
            stage_tools
            ( stage_kernel )
            stage_kernel_build
            stage_rootfs
            stage_squashfs
            stage_initramfs
            stage_iso
            stage_bios
            stage_release
            ;;
        tools) stage_tools ;;
        kernel) stage_tools; stage_kernel; stage_kernel_build ;;
        rootfs) stage_rootfs ;;
        squashfs) stage_squashfs ;;
        initramfs) stage_initramfs ;;
        iso) stage_iso ;;
        bios) stage_bios ;;
        release) stage_release ;;
        help|-h|--help) sed -n '2,25p' "${BASH_SOURCE[0]}" ;;
        *) die "nieznany etap: $cmd (zob. scripts/build-os.sh help)" ;;
    esac
}

main "$@"
