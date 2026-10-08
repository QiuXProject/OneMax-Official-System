# OneMax 0.1: system oparty na Linuksie

Ten katalog opisuje system OneMax 0.1: jądro Linuksa, system Debian 12 (bookworm) z konfiguracją OneMax,
initramfs, bootloader i obrazy do uruchomienia w maszynie wirtualnej.

Wybór bazy: **Debian 12**. Ma systemd i apt, więc pakiety dodaje się zwykłym `apt install`. Dostęp do mirrorów Debiana
był zablokowany w środowisku, w którym powstał ten system, dlatego obraz powstał z pakietów Debiana 12 zainstalowanych
w tym środowisku (zob. "Ograniczenia").

## Co powstaje

Po `scripts/build-os.sh all` w katalogu `~/onemax-release/` (zmienna `ONEMAX_OUT`):

| Plik | Co to jest |
|---|---|
| `onemax-0.1.iso` | Obraz płyty. Uruchamia się w trybie BIOS i UEFI. System działa z pamięci (live); zmiany znikają po wyłączeniu. |
| `onemax-0.1-bios.img` | Surowy obraz dysku (MBR + ext4) z zainstalowanym systemem, uruchamiany w trybie BIOS. Zmiany są trwałe. |
| `SHA256SUMS` | Sumy kontrolne obu plików. |

Zawartość systemu:

- jądro Linux 6.1.158 (`6.1.158-onemax`) z logo OneMax wyświetlanym na konsoli framebuffer,
- Debian 12: systemd 252, apt, sudo, gcc, git, python3, Node.js (z kopii, zob. "Ograniczenia"),
- konto `onemax` (domyślne hasło `onemax`, zmień poleceniem `passwd`), konto root zablokowane,
- sieć przez DHCP (systemd-networkd), strefa czasowa Europe/Warsaw, klucze SSH tworzone przy pierwszym uruchomieniu,
  sshd wyłączony (włączenie: `sudo systemctl enable --now ssh`),
- menu Limine z tłem z logo: wpis normalny, wpis `verbose` (więcej komunikatów) i wpis z powłoką diagnostyczną
  przed startem systemu.

## Jak uruchomić w VirtualBox

**Wariant 1: ISO** (najprostszy, system działa z pamięci):

1. Nowa maszyna: Typ *Linux*, Wersja *Debian (64-bit)*, RAM 4096 MB, 2 procesory.
2. Nie dodawaj dysku. W pamięci masowej dodaj napęd optyczny i wskaż `onemax-0.1.iso`.
3. Uruchom. Zaloguj się: `onemax` / `onemax`.

**Wariant 2: obraz BIOS** (zmiany są zapisywane na dysku):

1. Na komputerze z VirtualBox zamień obraz na format VDI:
   `VBoxManage convertfromraw onemax-0.1-bios.img onemax-0.1.vdi --format VDI`
2. Nowa maszyna: Linux, Debian (64-bit), 4096 MB RAM, 2 procesory. Firmware zostaw jako **BIOS** (domyślnie).
3. Dodaj dysk SATA i wskaż `onemax-0.1.vdi`. Uruchom.

**QEMU** (Linux): `qemu-system-x86_64 -m 4096 -smp 2 -cdrom onemax-0.1.iso` albo
`qemu-system-x86_64 -m 4096 -smp 2 -drive file=onemax-0.1-bios.img,format=raw`.

## Lista kontrolna przy pierwszym teście

1. Menu Limine z tłem OneMax (ok. 5 s, potem start wybranego wpisu).
2. Logo OneMax w lewym górnym rogu konsoli, zanim pojawi się tekst. Brak logo oznacza brak framebuffera
   (wybierz EFI albo kartę VMSVGA w VirtualBox).
3. Komunikaty `onemax-init:` (widać w wpisie `verbose`): `uklad live na /dev/sr0` dla ISO albo
   `uklad zainstalowany na /dev/sda1` dla obrazu BIOS.
4. Ekran logowania `OneMax 0.1 (Debian 12 bookworm)` na tty1.
5. Po zalogowaniu: `ip -4 a` (adres z DHCP), `ping -c 3 9.9.9.9`, `sudo apt update`.

Jeśli coś nie działa, uruchom wpis z powłoką diagnostyczną i zgłoś, który krok zawodzi oraz komunikaty `onemax-init:`.

## Budowanie

Wymagania (Debian 12, Ubuntu 22.04+):

```
sudo apt install build-essential bc busybox-static libssl-dev python3-venv e2fsprogs curl
scripts/build-os.sh all
```

- Etapy: `tools`, `kernel`, `rootfs`, `squashfs`, `initramfs`, `iso`, `bios`, `release`. Każdy można uruchomić osobno.
- Etapy `rootfs`, `squashfs`, `bios` działają z `sudo` (bez hasła w tym środowisku).
- Czas: kompilacja jądra 20-60 minut (zależnie od procesora), reszta kilka minut.
- Pliki pośrednie trafiają do `~/.cache/onemax-build` (można usunąć po zbudowaniu).

Zmienne środowiskowe (szczegóły w nagłówku `scripts/build-os.sh`):

| Zmienna | Domyślnie | Znaczenie |
|---|---|---|
| `ONEMAX_PASSWORD` | `onemax` | hasło konta `onemax` w obrazie (zmień przed publikacją) |
| `ROOTFS_SOURCE` | `debootstrap` jeśli jest, inaczej `host` | `host`: kopia pakietów z tego Debiana; `debootstrap`: czysty Debian z sieci |
| `ONEMAX_OUT` | `~/onemax-release` | katalog wynikowych plików |
| `ONEMAX_WORK` | `~/.cache/onemax-build` | katalog roboczy |
| `OPENSSL_INCLUDE` | `/usr/include` | katalog zawierający `openssl/` (nagłówki dla `certs/extract-cert`) |
| `BUSYBOX` | `/usr/bin/busybox` | statyczny busybox z apletem `bc` (dla initramfs i kompilacji jądra) |
| `JOBS` | liczba procesorów | liczba watków `make` |

## Struktura

- `os/kernel/onemax.config`: fragment konfiguracji jądra nakładany na `x86_64_defconfig` z Linuksa 6.1.158.
  Sterowniki AHCI, IDE, SCSI-CD i virtio, karty e1000 i PCnet, framebuffery EFI/VESA, DRM, USB, squashfs, overlayfs,
  logo jądra.
- `os/initramfs/init`: szuka płyty live (squashfs + overlay w RAM) albo partycji ext4 z systemem i przełącza na systemd.
- `os/boot/limine.conf`: menu Limine (ISO i obraz BIOS, ten sam plik).
- `os/rootfs/overlay/`: pliki OneMax nakładane na system (os-release, issue, motd, sieć, pierwsze uruchomienie SSH).
- `os/rootfs/packages.txt`: lista pakietów dla `ROOTFS_SOURCE=debootstrap`.
- `scripts/build-os.sh`: orkiestrator etapów.
- `scripts/make-kernel-logo.py`: logo dla jądra (PPM P3, paleta 224 kolorów).
- `scripts/make-iso.py`: ISO z El Torito (BIOS i UEFI) przez pycdlib, bez xorriso.
- `scripts/make-bios-image.py`: obraz dysku: MBR, ext4 i `limine bios-install`.

## Ograniczenia (stan 0.1)

- **Nie uruchomiono jeszcze systemu w maszynie wirtualnej.** Środowisko budowania nie ma KVM ani QEMU. Sprawdzono
  strukturę ISO (El Torito BIOS i UEFI, Rock Ridge), zawartość squashfs (overlay i `chroot`: systemd, konta, usługi,
  brak danych sandboxa), initramfs (gzip, cpio, składnia) i partycje obrazu. Pierwszy test w VM jest przed Tobą.
- **Brak Plymouth** (animowany ekran startowy z paskiem postępu i hasłem LUKS). Pakietu nie było w środowisku budowania.
  Motyw `boot/plymouth/onemax` jest kopiowany do systemu, ale nieaktywny. Logo pokazuje jądro i Limine.
- **Brak szyfrowania (LUKS) i instalatora.** Obraz dysku to gotowy system, nie instalator.
- **Domyślne hasło** `onemax`. Przed udostępnieniem ustaw `ONEMAX_PASSWORD`.
- **Moduły jądra nie są budowane.** Build obejmuje tylko `bzImage`, a sterowniki potrzebne do startu są wbudowane (`=y`).
  Katalog `/lib/modules` nie istnieje, więc doładowanie modułów nie zadziała.
- **Układ klawiatury w konsoli: US** (brak pakietu `kbd`).
- **Kopia pakietów** (`ROOTFS_SOURCE=host`): obraz zawiera to, co było zainstalowane w środowisku, m.in. Node.js, npm,
  gcc i git. Ścieżka `debootstrap` (czysty Debian z sieci) nie była testowana.
- **Źródła i sumy:** jądro (gregkh/linux v6.1.158), libelf (v0.194), zlib, squashfs-tools i Limine są pobierane
  z GitHuba przez HTTPS. Skrypt nie sprawdza sum SHA256 tych archiwów. Dodanie przypiętych sum to kolejny krok.
- **libelf i OpenSSL:** objtool wymaga libelf, a `certs/extract-cert` nagłówków OpenSSL. Skrypt buduje libelf ze źródeł.

## Zgłaszanie błędów

Przy problemie w VM podaj: który wpis menu, który krok zawodzi (menu, logo, initramfs, login, sieć) oraz
wynik `journalctl -b -p warning` po zalogowaniu.
