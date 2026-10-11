# OneMax-Official-System

System operacyjny OneMax oparty na Linuksie.

## QXTools — narzędzia audio w przeglądarce

- `web/qxtools/`: strona **QXTools** z konwerterem **MP3 → MIDI** i wirtualnym pianinem
  (tryby Łatwy / Średni / Profesjonalny, gra Auto i ręczna). Wszystko liczy się w przeglądarce.
- Uruchomienie: `cd web/qxtools && node scripts/serve.mjs 8080`.
- Testy (silnik transkrypcji, zapis MIDI, interfejs): `cd web/qxtools && npm install && npm test`.
- Szczegóły, struktura i ograniczenia: [web/qxtools/README.md](web/qxtools/README.md).

## System OneMax 0.1 (ISO i obraz BIOS do maszyny wirtualnej)

- `os/`: opis systemu: jądro Linux 6.1.158 z logo OneMax, Debian 12 (bookworm), initramfs, menu Limine.
- `scripts/build-os.sh`: buduje cały system (`scripts/build-os.sh all`). Wyniki trafiają do `~/onemax-release/`:
  `onemax-0.1.iso` (BIOS i UEFI) oraz `onemax-0.1-bios.img` (dysk BIOS).
- Instrukcja uruchomienia w VirtualBox i lista kontrolna testu: [os/README.md](os/README.md).

## Logo bootowania

- `branding/`: logo marki (źródło i master przezroczysty).
- `boot/`: motyw Plymouth (ekran startowy z paskiem postępu i promptem LUKS) oraz tło menu GRUB.
- `scripts/build-boot-assets.py`: generuje wszystkie zasoby PNG z logo.
- `scripts/install-boot-logo.sh`: instaluje logo w systemie (wymaga roota).

Szczegóły, podgląd i instrukcja testowania w VM: [boot/README.md](boot/README.md).
