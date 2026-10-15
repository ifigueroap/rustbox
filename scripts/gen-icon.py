#!/usr/bin/env python3
"""Draw the Rustbox app icon as a 1024px PNG."""

import struct
import zlib
from pathlib import Path


def chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def inside(x: int, y: int, left: int, top: int, right: int, bottom: int, radius: int) -> bool:
    cx = min(max(x, left + radius), right - radius)
    cy = min(max(y, top + radius), bottom - radius)
    dx = x - cx
    dy = y - cy
    return dx * dx + dy * dy <= radius * radius


def pixel(x: int, y: int) -> tuple[int, int, int, int]:
    if not inside(x, y, 48, 48, 976, 976, 188):
        return (0, 0, 0, 0)
    # Copper service rail.
    if x < 330 and inside(x, y, 48, 48, 976, 976, 188):
        for cy in (300, 512, 724):
            dx = x - 188
            dy = y - cy
            if dx * dx + dy * dy <= 48 * 48:
                return (28, 26, 23, 255)
        return (224, 163, 106, 255)
    if inside(x, y, 390, 170, 900, 854, 40):
        return (54, 49, 43, 255)
    return (28, 26, 23, 255)


def main() -> None:
    size = 1024
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            raw.extend(pixel(x, y))
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )
    dest = Path(__file__).resolve().parents[1] / "src-tauri" / "app-icon.png"
    dest.write_bytes(png)
    print(dest)


if __name__ == "__main__":
    main()
