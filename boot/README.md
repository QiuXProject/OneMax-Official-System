# Logo bootowania OneMax

Logo OneMax pojawia się w dwóch miejscach podczas uruchamiania systemu opartego na Linuksie:

1. **Menu GRUB**: tło z logo w menu wyboru systemu (`boot/grub/background.png`).
2. **Ekran startowy Plymouth**: logo z paskiem postępu, zanim wystartuje pulpit. Obsługuje też prompt hasła LUKS (`boot/plymouth/onemax/`).

Logo producenta w BIOS/UEFI nie jest sterowane przez system i nie wchodzi w zakres tego katalogu.

## Podgląd

- `boot/preview/plymouth-progress.png`: ekran podczas startu.
- `boot/preview/plymouth-password.png`: ekran z pytaniem o hasło LUKS.

To symulacja wygenerowana Pillow, a nie zrzut z Plymouth. Rzeczywisty wygląd zależy od monitora i karty graficznej.

## Instalacja

Wymagane pakiety: `plymouth` oraz `grub` (dla tła menu). Najpierw przetestuj w maszynie wirtualnej.

```bash
sudo scripts/install-boot-logo.sh
sudo reboot
```

Skrypt:

1. kopiuje motyw do `/usr/share/plymouth/themes/onemax/`,
2. ustawia go jako domyślny i przebudowuje initramfs (`plymouth-set-default-theme -R onemax`),
3. kopiuje tło do `/boot/grub` (albo `/boot/grub2` na Fedorze) i ustawia `GRUB_BACKGROUND` w `/etc/default/grub`,
4. dopisuje `splash` do `GRUB_CMDLINE_LINUX_DEFAULT`,
5. przebudowuje konfigurację GRUB.

Przed zmianą `/etc/default/grub` skrypt zapisuje kopię: `/etc/default/grub.onemax.bak`.

**Cofnięcie zmian:** przywróć `/etc/default/grub` z kopii, uruchom `sudo update-grub` (albo `grub-mkconfig`), a następnie `sudo plymouth-set-default-theme -R details`. Na końcu usuń katalog `/usr/share/plymouth/themes/onemax`.

## Test w maszynie wirtualnej

Po restarcie sprawdź, czy:

- w menu GRUB widać tło z logo,
- zamiast tekstu startowego pojawia się logo z paskiem postępu,
- przy zaszyfrowanym dysku (LUKS) pojawia się kłódka z kropkami zamiast tekstu.

Jeśli motyw się nie uruchomi, zacznij od `journalctl -b | grep -i plymouth`.

## Źródło graficzne i generowanie zasobów

- `branding/source/onemax-logo-selected-raw.png`: zaakceptowany wariant logo (1024×1024, czarne tło). To jest źródło.
- `scripts/build-boot-assets.py`: z tego pliku generuje przezroczysty master `branding/onemax-logo.png` oraz wszystkie PNG w `boot/`.

```bash
pip install pillow numpy
python3 scripts/build-boot-assets.py
```

Stałe układu (proporcje logo, położenie paska i kłódki) są zapisane zarówno w skrypcie generującym, jak i w `onemax.script`. Po zmianie jednej strony zaktualizuj drugą.

## Struktura

```
branding/
  source/onemax-logo-selected-raw.png   źródło (zaakceptowany wariant)
  onemax-logo.png                       master przezroczysty (generowany)
boot/
  README.md
  grub/background.png                   tło GRUB 1920×1080 (generowane)
  plymouth/onemax/
    onemax.plymouth                     opis motywu
    onemax.script                       animacja, pasek postępu, prompt hasła
    *.png                               zasoby (generowane)
  preview/                              podglądy (generowane)
scripts/
  build-boot-assets.py                  generuje zasoby PNG z logo
  install-boot-logo.sh                  instaluje motyw i tło w systemie
```

## Ograniczenia

- Motyw nie używa tekstu, więc nie potrzebuje czcionek w initramfs.
- Prompt LUKS pojawi się tylko wtedy, gdy initramfs zawiera Plymouth oraz hook szyfrowania zgodny z Plymouth (na Arch np. `plymouth-encrypt`).
- Tło GRUB działa tylko w trybie graficznym. Jeśli menu pozostaje tekstowe, ustaw `GRUB_GFXMODE=auto` w `/etc/default/grub`.
- Tło to tylko obraz. Menu GRUB rysuje się w miejscu zależnym od wersji GRUB-a i rozdzielczości, więc jeśli wpisy nachodzą na logo, potrzebny będzie pełny motyw GRUB (`theme.txt`).
- `onemax.script` napisano według dokumentacji Plymouth, ale jeszcze nie uruchomiono go na prawdziwym ekranie. Przed wdrożeniem trzeba go przetestować w VM.
- Źródłowe logo ma 1024 px. Master ma 2× rozdzielczości, co wystarcza dla ekranów 4K. Ostrzejsza wersja wymagałaby źródła wektorowego (SVG).

## Kolejne kroki

- Pełny motyw GRUB (`theme.txt`) z własnym układem menu.
- Logo w samym jądrze Linuksa (ekran z pingwinem Tux, opcja `CONFIG_LOGO`).
- Ekran logowania (GDM/SDDM).
- Logo w instalatorze i obrazie ISO (isolinux/syslinux, GRUB dla UEFI).
