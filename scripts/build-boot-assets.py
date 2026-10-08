#!/usr/bin/env python3
"""Generuje wszystkie zasoby logo bootowania OneMax.

Z zaakceptowanego surowego obrazu (branding/source/) powstają:

  branding/onemax-logo.png        przezroczyste logo, master (2x)
  boot/plymouth/onemax/*.png      zasoby motywu Plymouth
  boot/grub/background.png        tło menu GRUB (1920x1080)
  boot/preview/*.png              poglądowy podgląd ekranu startowego

Wymagane pakiety: pip install pillow numpy
Uruchomienie z korzenia repozytorium: python3 scripts/build-boot-assets.py

Stałe układu (LOGO_*, BAR_*, LOCK_*, DOT_*) muszą być zgodne z plikiem
boot/plymouth/onemax/onemax.script, bo podgląd ma odzwierciedlać ekran Plymouth.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = ROOT / "branding" / "source" / "onemax-logo-selected-raw.png"

# Kolory marki. Cyjan to mediana z zaakceptowanego obrazu.
WHITE = np.array([255.0, 255.0, 255.0])
CYAN = np.array([0.0, 184.0, 238.0])
CYAN_RGB = (0, 184, 238)

# Tło wygenerowanego obrazu nie jest czysto czarne (wartości 0-6).
BLACK_POINT = 6.0

# Układ ekranu startowego (ułamki rozdzielczości; rozmiary w px przy 1080p).
REF_W, REF_H = 1920, 1080
LOGO_WIDTH = 0.36
LOGO_CENTER_Y = 0.42
BAR_WIDTH = 0.22
BAR_Y = 0.70
BAR_HEIGHT = 10
LOCK_SIZE = 64
LOCK_GAP = 24
DOT_SIZE = 14
DOT_SPACING = 1.8
PREVIEW_PROGRESS = 0.62
PREVIEW_DOTS = 7

# Tło GRUB.
GRUB_LOGO_WIDTH = 0.30
GRUB_LOGO_CENTER_Y = 0.20


def decompose(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Rozkłada obraz RGB na pokrycie białym i cyjanem (przy czarnym tle).

    Każdy piksel przypisujemy do koloru, który lepiej go opisuje. Dzięki temu
    krawędzie antyaliasingu zachowują prawidłowe kolory po przezroczystości.
    """
    p = np.clip((rgb - BLACK_POINT) * (255.0 / (255.0 - BLACK_POINT)), 0.0, 255.0)
    cover_c = (p @ CYAN) / (CYAN @ CYAN)
    cover_w = p.mean(axis=2) / 255.0
    err_c = np.linalg.norm(p - cover_c[..., None] * CYAN, axis=2)
    err_w = np.linalg.norm(p - cover_w[..., None] * WHITE, axis=2)
    is_cyan = err_c < err_w
    a_c = np.where(is_cyan, np.clip(cover_c, 0.0, 1.0), 0.0)
    a_w = np.where(is_cyan, 0.0, np.clip(cover_w, 0.0, 1.0))
    return a_w, a_c


def crop_to_content(a_w: np.ndarray, a_c: np.ndarray, margin: int = 8):
    alpha = np.maximum(a_w, a_c)
    ys, xs = np.nonzero(alpha > 0.03)
    top = max(int(ys.min()) - margin, 0)
    bottom = min(int(ys.max()) + margin + 1, alpha.shape[0])
    left = max(int(xs.min()) - margin, 0)
    right = min(int(xs.max()) + margin + 1, alpha.shape[1])
    return a_w[top:bottom, left:right], a_c[top:bottom, left:right]


def _resize_mask(a: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    img = Image.fromarray(np.round(a * 255).astype(np.uint8))
    return np.asarray(img.resize(size, Image.Resampling.LANCZOS), dtype=np.float64) / 255.0


def build_logo(a_w: np.ndarray, a_c: np.ndarray, scale: int = 2) -> Image.Image:
    """Skaluje maski pokrycia (nie gotowy obraz) i składa logo z dokładnymi kolorami."""
    h, w = a_w.shape
    size = (w * scale, h * scale)
    m_w = _resize_mask(a_w, size)
    m_c = _resize_mask(a_c, size)
    total = m_w + m_c
    alpha = np.clip(total, 0.0, 1.0)
    rgb = (m_w[..., None] * WHITE + m_c[..., None] * CYAN) / np.maximum(total, 1e-6)[..., None]
    out = np.dstack([np.clip(rgb, 0.0, 255.0), alpha * 255.0])
    return Image.fromarray(np.round(out).astype(np.uint8))


def _render(size: tuple[int, int], painter, factor: int = 4) -> Image.Image:
    """Rysuje w większej skali i zmniejsza, żeby uzyskać gładkie krawędzie."""
    w, h = size
    big = Image.new("RGBA", (w * factor, h * factor), (0, 0, 0, 0))
    painter(ImageDraw.Draw(big), factor)
    return big.resize(size, Image.Resampling.LANCZOS)


def bar_image(color: tuple[int, int, int, int]) -> Image.Image:
    w, h = 1200, 24

    def paint(d: ImageDraw.ImageDraw, f: int) -> None:
        d.rounded_rectangle((0, 0, w * f - 1, h * f - 1), radius=h * f // 2, fill=color)

    return _render((w, h), paint)


def lock_image() -> Image.Image:
    cyan = (*CYAN_RGB, 255)
    clear = (0, 0, 0, 0)

    def paint(d: ImageDraw.ImageDraw, f: int) -> None:
        def box(*v: float) -> list[float]:
            return [c * f for c in v]

        d.rounded_rectangle(box(80, 24, 176, 150), radius=48 * f, fill=cyan)    # łuk kłódki
        d.rounded_rectangle(box(98, 42, 158, 150), radius=30 * f, fill=clear)   # wnętrze łuku
        d.rounded_rectangle(box(44, 112, 212, 236), radius=26 * f, fill=cyan)   # korpus
        d.ellipse(box(113, 153, 143, 183), fill=clear)                          # dziurka na klucz
        d.rounded_rectangle(box(121, 172, 135, 206), radius=7 * f, fill=clear)  # szczelina

    return _render((256, 256), paint)


def dot_image() -> Image.Image:
    def paint(d: ImageDraw.ImageDraw, f: int) -> None:
        d.ellipse((4 * f, 4 * f, 124 * f, 124 * f), fill=(255, 255, 255, 255))

    return _render((128, 128), paint)


def _fit_width(img: Image.Image, width: int) -> Image.Image:
    # Ta sama zasada co w skrypcie Plymouth: wysokość z proporcji, obcięta w dół.
    height = int(img.height * width / img.width)
    return img.resize((width, height), Image.Resampling.LANCZOS)


def build_grub_background(logo: Image.Image) -> Image.Image:
    canvas = Image.new("RGBA", (REF_W, REF_H), (0, 0, 0, 255))
    small = _fit_width(logo, int(REF_W * GRUB_LOGO_WIDTH))
    x = int(REF_W / 2 - small.width / 2)
    y = int(REF_H * GRUB_LOGO_CENTER_Y - small.height / 2)
    canvas.alpha_composite(small, (x, y))
    return canvas.convert("RGB")


def render_splash(logo, track, fill, lock, dot, *, progress=None, password_dots=None):
    """Składa podgląd ekranu startowego w tym samym układzie co motyw Plymouth."""
    ui = REF_H / 1080
    canvas = Image.new("RGBA", (REF_W, REF_H), (0, 0, 0, 255))

    small_logo = _fit_width(logo, int(REF_W * LOGO_WIDTH))
    logo_x = int(REF_W / 2 - small_logo.width / 2)
    logo_y = int(REF_H * LOGO_CENTER_Y - small_logo.height / 2)
    canvas.alpha_composite(small_logo, (logo_x, logo_y))

    bar_w = int(REF_W * BAR_WIDTH)
    bar_h = max(4, int(BAR_HEIGHT * ui))
    bar_x = int(REF_W / 2 - bar_w / 2)
    bar_y = int(REF_H * BAR_Y)

    if password_dots is None:
        canvas.alpha_composite(track.resize((bar_w, bar_h), Image.Resampling.LANCZOS), (bar_x, bar_y))
        new_w = int(bar_w * (progress or 0.0))
        if new_w > 0:
            canvas.alpha_composite(fill.resize((new_w, bar_h), Image.Resampling.LANCZOS), (bar_x, bar_y))
    else:
        lock_size = int(LOCK_SIZE * ui)
        lock_x = int(REF_W / 2 - lock_size / 2)
        lock_y = int(bar_y - lock_size - LOCK_GAP * ui)
        canvas.alpha_composite(lock.resize((lock_size, lock_size), Image.Resampling.LANCZOS), (lock_x, lock_y))

        dot_size = max(6, int(DOT_SIZE * ui))
        spacing = int(dot_size * DOT_SPACING)
        start_x = REF_W / 2 - ((password_dots - 1) * spacing + dot_size) / 2
        dot_small = dot.resize((dot_size, dot_size), Image.Resampling.LANCZOS)
        for i in range(password_dots):
            canvas.alpha_composite(dot_small, (int(start_x + i * spacing), bar_y))

    return canvas.convert("RGB")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="surowy obraz logo (PNG)")
    args = parser.parse_args()

    raw = np.asarray(Image.open(args.source).convert("RGB"), dtype=np.float64)
    a_w, a_c = crop_to_content(*decompose(raw))
    logo = build_logo(a_w, a_c)

    track = bar_image((255, 255, 255, 40))
    fill = bar_image((*CYAN_RGB, 255))
    lock = lock_image()
    dot = dot_image()

    theme_dir = ROOT / "boot" / "plymouth" / "onemax"
    outputs = {
        ROOT / "branding" / "onemax-logo.png": logo,
        theme_dir / "logo.png": logo,
        theme_dir / "progress-track.png": track,
        theme_dir / "progress-fill.png": fill,
        theme_dir / "lock.png": lock,
        theme_dir / "dot.png": dot,
        ROOT / "boot" / "grub" / "background.png": build_grub_background(logo),
        ROOT / "boot" / "preview" / "plymouth-progress.png": render_splash(
            logo, track, fill, lock, dot, progress=PREVIEW_PROGRESS
        ),
        ROOT / "boot" / "preview" / "plymouth-password.png": render_splash(
            logo, track, fill, lock, dot, password_dots=PREVIEW_DOTS
        ),
    }

    for path, img in outputs.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        img.save(path, optimize=True)
        print(f"{path.relative_to(ROOT)}  {img.width}x{img.height}  {img.mode}")


if __name__ == "__main__":
    main()
