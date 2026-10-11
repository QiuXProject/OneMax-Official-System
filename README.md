# OneMax-Official-System

System operacyjny OneMax oparty na Linuksie.

## System OneMax 0.1 (ISO i obraz BIOS do maszyny wirtualnej)

- `os/`: opis systemu: jądro Linux 6.1.158 z logo OneMax, Debian 12 (bookworm), initramfs, menu Limine.
- `scripts/build-os.sh`: buduje cały system (`scripts/build-os.sh all`). Wyniki trafiają do `~/onemax-release/`:
  `onemax-0.1.iso` (BIOS i UEFI) oraz `onemax-0.1-bios.img` (dysk BIOS).
- Instrukcja uruchomienia w VirtualBox i lista kontrolna testu: [os/README.md](os/README.md).

## SandGlitch: gra VR na Meta Quest (Unity)

Docelowa wersja **SandGlitch** to prawdziwa gra VR na **Meta Quest** zbudowana w
**Unity** (`game-unity/`). Jest w pełni VR-only — nie ma żadnego trybu PC, myszy ani
klawiatury. Zawiera intro/logo, menu startowe w przestrzeni VR (start wyłącznie przez
wycelowanie kontrolerem i trigger), fizykę z chwytaniem i rzucaniem, niszczalne
obiekty, manekiny z ragdollem, stylizowaną krew oraz fale przeciwników.

- Kod rozgrywki i konfiguracja projektu: [game-unity/](game-unity/)
- Przewodnik budowy APK na Questa krok po kroku: [game-unity/SETUP_GUIDE.md](game-unity/SETUP_GUIDE.md)

W katalogu `game/` pozostawiono wcześniejszy prototyp WebXR (przeglądarkowy) — to nie
jest docelowy produkt dla Questa, tylko materiał pomocniczy.

```bash
# tylko prototyp WebXR (opcjonalnie)
cd game
npm install
npm run dev
```

Gra ma własną pętlę fizyki (grawitacja, impulsy, tarcie, odbicia, kolizje obiektów), rzucane i rozwalane skrzynie, beczki oraz ścianę z odłamkami. Glitch-dummy mają ragdoll z osobnymi kończynami; trafienia uruchamiają stylizowane czerwone cząsteczki i plamy, bez zewnętrznych assetów.

## Logo bootowania

- `branding/`: logo marki (źródło i master przezroczysty).
- `boot/`: motyw Plymouth (ekran startowy z paskiem postępu i promptem LUKS) oraz tło menu GRUB.
- `scripts/build-boot-assets.py`: generuje wszystkie zasoby PNG z logo.
- `scripts/install-boot-logo.sh`: instaluje logo w systemie (wymaga roota).

Szczegóły, podgląd i instrukcja testowania w VM: [boot/README.md](boot/README.md).
