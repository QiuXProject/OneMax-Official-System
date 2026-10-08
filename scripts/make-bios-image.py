#!/usr/bin/env python3
"""Tworzy surowy obraz dysku OneMax 0.1 z zainstalowanym systemem, uruchamiany w trybie BIOS.

Uklad: tablica MBR, jedna partycja ext4 (etykieta ONEMAX_ROOT) od sektora 2048 (1 MiB),
bootloader Limine zainstalowany poleceniem `limine bios-install`. Partycja zawiera
/boot/vmlinuz-onemax, /boot/initramfs-onemax.cpio.gz i /boot/limine/ (menu, stage 2, tlo).

Wymaga roota: drzewo plikow budujemy z hardlinkow do rootfs (cp -al), a mkfs.ext4 -d czyta
wlasciciela i uprawnienia. Uruchom: sudo python3 scripts/make-bios-image.py ...

Konwersja dla VirtualBox (na maszynie z VirtualBox):
    VBoxManage convertfromraw onemax-0.1-bios.img onemax-0.1.vdi --format VDI
"""

import argparse
import os
import shutil
import struct
import subprocess
import sys
from pathlib import Path

MIB = 1024 * 1024
SECTOR = 512
START_LBA = 2048  # 1 MiB: miejsce na MBR i kod Limine


def run(*cmd: str) -> None:
    subprocess.run(cmd, check=True)


def find_tool(name: str) -> str:
    for candidate in (shutil.which(name), f"/sbin/{name}", f"/usr/sbin/{name}"):
        if candidate and os.path.exists(candidate):
            return candidate
    raise SystemExit(f"BLAD: brak narzedzia {name}")


def copy(src: str, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dst)
    os.chmod(dst, 0o644)


def write_mbr(image: Path, start_lba: int, sectors: int) -> None:
    # Wpis partycji: status 0x80 (aktywna), typ 0x83 (Linux), adresowanie LBA.
    entry = struct.pack("<B3sB3sII", 0x80, b"\xfe\xff\xff", 0x83, b"\xfe\xff\xff", start_lba, sectors)
    mbr = bytearray(SECTOR)
    mbr[446:446 + 16] = entry
    mbr[510:512] = b"\x55\xaa"
    with open(image, "r+b") as f:
        f.seek(0)
        f.write(mbr)


def main() -> int:
    parser = argparse.ArgumentParser(description="Obraz dysku BIOS OneMax (MBR + ext4 + Limine).")
    parser.add_argument("--rootfs", required=True, help="katalog z systemem (rootfs)")
    parser.add_argument("--work", required=True, help="katalog roboczy na drzewo plikow")
    parser.add_argument("--kernel", required=True)
    parser.add_argument("--initrd", required=True)
    parser.add_argument("--limine-dir", required=True, help="katalog z plikami Limine v8.x-binary")
    parser.add_argument("--limine", required=True, help="binarka instalatora limine")
    parser.add_argument("--conf", required=True, help="limine.conf")
    parser.add_argument("--background", required=True, help="PNG tla menu")
    parser.add_argument("--spare-mib", type=int, default=2048, help="wolne miejsce w systemie (MiB)")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    if os.geteuid() != 0:
        print("BLAD: uruchom jako root (sudo)", file=sys.stderr)
        return 1

    work = Path(args.work)
    part_img = Path(str(work) + ".ext4")
    if work.exists():
        shutil.rmtree(work)
    if part_img.exists():
        part_img.unlink()

    # Drzewo plikow: hardlinki do rootfs (bez kopiowania danych), potem nowe pliki w /boot.
    run("cp", "-al", args.rootfs, str(work))
    boot = work / "boot"
    copy(args.kernel, boot / "vmlinuz-onemax")
    copy(args.initrd, boot / "initramfs-onemax.cpio.gz")
    copy(args.conf, boot / "limine" / "limine.conf")
    copy(os.path.join(args.limine_dir, "limine-bios.sys"), boot / "limine" / "limine-bios.sys")
    copy(args.background, boot / "limine" / "background.png")

    used = int(subprocess.run(["du", "-sb", str(work)], check=True, capture_output=True, text=True).stdout.split()[0])
    part_bytes = used + args.spare_mib * MIB
    part_bytes = (part_bytes + MIB - 1) // MIB * MIB  # pelne MiB

    mkfs = find_tool("mkfs.ext4")
    run("truncate", "-s", str(part_bytes), str(part_img))
    run(mkfs, "-q", "-F", "-L", "ONEMAX_ROOT", "-d", str(work), str(part_img))
    shutil.rmtree(work)

    total = START_LBA * SECTOR + part_bytes
    with open(args.out, "wb") as img:
        img.truncate(total)
    with open(args.out, "r+b") as img, open(part_img, "rb") as part:
        img.seek(START_LBA * SECTOR)
        shutil.copyfileobj(part, img, 16 * MIB)
    part_img.unlink()

    write_mbr(Path(args.out), START_LBA, part_bytes // SECTOR)
    run(args.limine, "bios-install", args.out)

    size = os.path.getsize(args.out)
    print(f"zapisano {args.out} (dysk {total // MIB} MiB, partycja ext4 {part_bytes // MIB} MiB, "
          f"plik {size // MIB} MiB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
