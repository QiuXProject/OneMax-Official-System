# OneMax-Official-System

System operacyjny OneMax oparty na Linuksie. Pierwszym elementem jest logo bootowania.

## Logo bootowania

- `branding/`: logo marki (źródło i master przezroczysty).
- `boot/`: motyw Plymouth (ekran startowy z paskiem postępu i promptem LUKS) oraz tło menu GRUB.
- `scripts/build-boot-assets.py`: generuje wszystkie zasoby PNG z logo.
- `scripts/install-boot-logo.sh`: instaluje logo w systemie (wymaga roota).

Szczegóły, podgląd i instrukcja testowania w VM: [boot/README.md](boot/README.md).
