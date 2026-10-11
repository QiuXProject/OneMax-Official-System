# OneMax-Official-System

System operacyjny OneMax oparty na Linuksie.

## System OneMax 0.1 (ISO i obraz BIOS do maszyny wirtualnej)

- `os/`: opis systemu: jądro Linux 6.1.158 z logo OneMax, Debian 12 (bookworm), initramfs, menu Limine.
- `scripts/build-os.sh`: buduje cały system (`scripts/build-os.sh all`). Wyniki trafiają do `~/onemax-release/`:
  `onemax-0.1.iso` (BIOS i UEFI) oraz `onemax-0.1-bios.img` (dysk BIOS).
- Instrukcja uruchomienia w VirtualBox i lista kontrolna testu: [os/README.md](os/README.md).

## SandGlitch: gra WebXR / VR

W katalogu `game/` znajduje się grywalny prototyp **SandGlitch** — prawdziwa scena WebXR uruchamiana w przeglądarce, z menu intro, logo, trybem desktop oraz wejściem do immersyjnego VR przez `VRButton`.

```bash
cd game
npm install
npm run dev
```

Gra ma własną pętlę fizyki (grawitacja, impulsy, tarcie, odbicia, kolizje obiektów), rzucane i rozwalane skrzynie, beczki oraz ścianę z odłamkami. Glitch-dummy mają ragdoll z osobnymi kończynami; trafienia uruchamiają stylizowane czerwone cząsteczki i plamy, bez zewnętrznych assetów. Sterowanie desktopowe i VR oraz wymagania opisano w [game/README.md](game/README.md).

## Logo bootowania

- `branding/`: logo marki (źródło i master przezroczysty).
- `boot/`: motyw Plymouth (ekran startowy z paskiem postępu i promptem LUKS) oraz tło menu GRUB.
- `scripts/build-boot-assets.py`: generuje wszystkie zasoby PNG z logo.
- `scripts/install-boot-logo.sh`: instaluje logo w systemie (wymaga roota).

Szczegóły, podgląd i instrukcja testowania w VM: [boot/README.md](boot/README.md).
