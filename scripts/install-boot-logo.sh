#!/usr/bin/env bash
# Instaluje logo bootowania OneMax w systemie Linux:
#   1. motyw Plymouth (ekran startowy, także prompt hasła LUKS),
#   2. tło menu GRUB (ekran wyboru systemu).
#
# Użycie (jako root, najlepiej w maszynie wirtualnej testowej):
#   sudo scripts/install-boot-logo.sh
#
# Skrypt zmienia /etc/default/grub (kopia: /etc/default/grub.onemax.bak), dopisuje
# "splash" do parametrów jądra i przebudowuje initramfs oraz konfigurację GRUB.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
theme_name="onemax"
theme_src="${repo_root}/boot/plymouth/${theme_name}"
theme_dst="/usr/share/plymouth/themes/${theme_name}"
grub_bg_src="${repo_root}/boot/grub/background.png"
grub_default="/etc/default/grub"

log() { printf '==> %s\n' "$*"; }
die() { printf 'BŁĄD: %s\n' "$*" >&2; exit 1; }

# --- Sprawdzenie wymagań (zanim cokolwiek zmienimy) --------------------------
[[ "${EUID}" -eq 0 ]] || die "uruchom skrypt jako root (sudo)."
command -v plymouth-set-default-theme >/dev/null 2>&1 \
    || die "brak plymouth-set-default-theme; zainstaluj pakiet plymouth."
[[ -f "${theme_src}/${theme_name}.plymouth" ]] || die "brak motywu w ${theme_src}."
[[ -f "${grub_bg_src}" ]] || die "brak tła GRUB: ${grub_bg_src}."

# Katalog GRUB: Fedora używa /boot/grub2, Debian/Ubuntu/Arch — /boot/grub.
grub_dir="/boot/grub"
if [[ -d /boot/grub2 && ! -d /boot/grub ]]; then
    grub_dir="/boot/grub2"
fi

has_grub=0
grub_regen=()
if [[ -f "${grub_default}" ]]; then
    has_grub=1
    if command -v update-grub >/dev/null 2>&1; then
        grub_regen=(update-grub)
    elif command -v grub-mkconfig >/dev/null 2>&1; then
        grub_regen=(grub-mkconfig -o "${grub_dir}/grub.cfg")
    elif command -v grub2-mkconfig >/dev/null 2>&1; then
        grub_regen=(grub2-mkconfig -o "${grub_dir}/grub.cfg")
    else
        die "jest ${grub_default}, ale brak update-grub ani grub-mkconfig."
    fi
fi

# --- 1. Plymouth -------------------------------------------------------------
log "Kopiuję motyw Plymouth do ${theme_dst}"
install -d -m 0755 "${theme_dst}"
install -m 0644 -t "${theme_dst}" "${theme_src}"/*

log "Ustawiam motyw '${theme_name}' jako domyślny i przebudowuję initramfs"
plymouth-set-default-theme -R "${theme_name}"

# --- 2. GRUB -----------------------------------------------------------------
if (( has_grub == 0 )); then
    log "Brak ${grub_default}: pomijam tło GRUB (np. systemd-boot)."
    log "Gotowe. Motyw Plymouth jest zainstalowany."
    exit 0
fi

log "Kopiuję tło GRUB do ${grub_dir}"
install -d -m 0755 "${grub_dir}"
install -m 0644 "${grub_bg_src}" "${grub_dir}/onemax-background.png"

if [[ ! -f "${grub_default}.onemax.bak" ]]; then
    cp -p "${grub_default}" "${grub_default}.onemax.bak"
    log "Zapisano kopię zapasową: ${grub_default}.onemax.bak"
fi

# Ustawia KLUCZ="wartość" w /etc/default/grub: zamienia istniejącą linię albo dopisuje nową.
set_grub_var() {
    local key="$1" value="$2"
    if grep -qE "^${key}=" "${grub_default}"; then
        sed -i -E "s|^${key}=.*|${key}=\"${value}\"|" "${grub_default}"
    else
        printf '%s="%s"\n' "${key}" "${value}" >> "${grub_default}"
    fi
}

set_grub_var GRUB_BACKGROUND "${grub_dir}/onemax-background.png"

# Parametr jądra "splash" włącza Plymouth. Bieżącą wartość odczytujemy tak jak GRUB,
# czyli przez źródłowanie pliku (to zwykły skrypt powłoki).
# shellcheck disable=SC1090
current_cmdline="$(. "${grub_default}" && printf '%s' "${GRUB_CMDLINE_LINUX_DEFAULT:-}")"
if [[ " ${current_cmdline} " != *" splash "* ]]; then
    set_grub_var GRUB_CMDLINE_LINUX_DEFAULT "${current_cmdline:+${current_cmdline} }splash"
fi

log "Przebudowuję konfigurację GRUB"
"${grub_regen[@]}"

log "Gotowe. Zrestartuj system (lub maszynę wirtualną), aby zobaczyć logo."
