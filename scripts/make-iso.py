#!/usr/bin/env python3
"""Tworzy obraz ISO OneMax 0.1 z rozruchem BIOS i UEFI (El Torito), bez xorriso.

Uzywa pycdlib (pip install pycdlib). Bootloaderem jest Limine (pliki z gałęzi v8.x-binary):
  - BIOS: limine-bios-cd.bin (El Torito, no-emulation), limine-bios.sys w boot/limine
  - UEFI: limine-uefi-cd.bin (El Torito EFI, obraz FAT) oraz EFI/BOOT/BOOTX64.EFI

Uklad plyty (nazwy ISO9660 w formacie 8.3, dlugie nazwy w Rock Ridge i Joliet):
  /BOOT/VMLINUZ.;1          jadro                         (vmlinuz-onemax)
  /BOOT/INITRD.GZ;1         initramfs                     (initramfs-onemax.cpio.gz)
  /BOOT/LIMINE/LIMINE.CFG;1 menu Limine                   (limine.conf)
  /BOOT/LIMINE/LBIOS.SYS;1  Limine BIOS stage 2           (limine-bios.sys)
  /BOOT/LIMINE/LBIOSCD.BIN  El Torito BIOS                (limine-bios-cd.bin)
  /BOOT/LIMINE/LUEFICD.BIN  El Torito UEFI                (limine-uefi-cd.bin)
  /BOOT/LIMINE/BACKGRD.PNG  tlo menu                      (background.png)
  /EFI/BOOT/BOOTX64.EFI     Limine UEFI                   (BOOTX64.EFI)
  /LIVE/ROOTFS.SQU;1        system live (squashfs)        (rootfs.squashfs)

Uzycie:
  python3 scripts/make-iso.py --kernel vmlinuz --initrd initramfs.cpio.gz \\
      --squashfs rootfs.squashfs --limine-dir Limine-8.x-binary \\
      --conf os/boot/limine.conf --background boot/grub/background.png \\
      --label ONEMAX_0_1 --out onemax-0.1.iso
"""

import argparse
import os
import sys

import pycdlib

# (lokalny plik, sciezka ISO9660, nazwa Rock Ridge, sciezka Joliet)
FILES = [
    ("kernel", "/BOOT/VMLINUZ.;1", "vmlinuz-onemax", "/boot/vmlinuz-onemax"),
    ("initrd", "/BOOT/INITRD.GZ;1", "initramfs-onemax.cpio.gz", "/boot/initramfs-onemax.cpio.gz"),
    ("conf", "/BOOT/LIMINE/LIMINE.CFG;1", "limine.conf", "/boot/limine/limine.conf"),
    ("bios_sys", "/BOOT/LIMINE/LBIOS.SYS;1", "limine-bios.sys", "/boot/limine/limine-bios.sys"),
    ("bios_cd", "/BOOT/LIMINE/LBIOSCD.BIN;1", "limine-bios-cd.bin", "/boot/limine/limine-bios-cd.bin"),
    ("uefi_cd", "/BOOT/LIMINE/LUEFICD.BIN;1", "limine-uefi-cd.bin", "/boot/limine/limine-uefi-cd.bin"),
    ("background", "/BOOT/LIMINE/BACKGRD.PNG;1", "background.png", "/boot/limine/background.png"),
    ("bootx64", "/EFI/BOOT/BOOTX64.EFI;1", "BOOTX64.EFI", "/EFI/BOOT/BOOTX64.EFI"),
    ("squashfs", "/LIVE/ROOTFS.SQU;1", "rootfs.squashfs", "/live/rootfs.squashfs"),
]

DIRS = [
    ("/BOOT", "boot", "/boot"),
    ("/BOOT/LIMINE", "limine", "/boot/limine"),
    ("/EFI", "EFI", "/EFI"),
    ("/EFI/BOOT", "BOOT", "/EFI/BOOT"),
    ("/LIVE", "live", "/live"),
]


def main() -> int:
    parser = argparse.ArgumentParser(description="ISO OneMax (BIOS + UEFI, Limine, pycdlib).")
    parser.add_argument("--kernel", required=True)
    parser.add_argument("--initrd", required=True)
    parser.add_argument("--squashfs", required=True)
    parser.add_argument("--limine-dir", required=True, help="katalog z plikami Limine v8.x-binary")
    parser.add_argument("--conf", required=True, help="limine.conf")
    parser.add_argument("--background", required=True, help="PNG tla menu")
    parser.add_argument("--label", default="ONEMAX_0_1", help="etykieta wolumenu (max 32 znaki)")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    limine = args.limine_dir
    sources = {
        "kernel": args.kernel,
        "initrd": args.initrd,
        "conf": args.conf,
        "bios_sys": os.path.join(limine, "limine-bios.sys"),
        "bios_cd": os.path.join(limine, "limine-bios-cd.bin"),
        "uefi_cd": os.path.join(limine, "limine-uefi-cd.bin"),
        "background": args.background,
        "bootx64": os.path.join(limine, "BOOTX64.EFI"),
        "squashfs": args.squashfs,
    }
    for key, path in sources.items():
        if not os.path.isfile(path):
            print(f"BLAD: brak pliku ({key}): {path}", file=sys.stderr)
            return 1

    iso = pycdlib.PyCdlib()
    iso.new(joliet=True, rock_ridge="1.09", vol_ident=args.label[:32])

    for iso_dir, rr, joliet in DIRS:
        iso.add_directory(iso_dir, rr_name=rr, joliet_path=joliet)

    # Pliki sa czytane dopiero przy zapisie: pliki musza byc otwarte do write_fp.
    handles = []
    try:
        for key, iso_path, rr_name, joliet_path in FILES:
            fp = open(sources[key], "rb")
            handles.append(fp)
            length = os.fstat(fp.fileno()).st_size
            iso.add_fp(fp, length, iso_path, rr_name=rr_name, joliet_path=joliet_path)

        # El Torito: BIOS (no-emulation, 4 sektory, tablica informacji o dysku) i UEFI (obraz FAT).
        iso.add_eltorito("/BOOT/LIMINE/LBIOSCD.BIN;1", bootcatfile="/BOOT.CAT;1",
                         rr_bootcatname="boot.catalog", boot_load_size=4, boot_info_table=True)
        iso.add_eltorito("/BOOT/LIMINE/LUEFICD.BIN;1", efi=True)

        with open(args.out, "wb") as out:
            iso.write_fp(out)
    finally:
        iso.close()
        for fp in handles:
            fp.close()

    size = os.path.getsize(args.out)
    print(f"zapisano {args.out} ({size} bajtow, etykieta {args.label})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
