"""Generate all Homey app/driver PNG images and update the driver SVG icon."""
import struct, zlib, os, math

BASE = os.path.dirname(os.path.abspath(__file__))

# ── Brand colours (Axle: black/white with blue accent) ───────────────────────
BG       = (15,  15,  15)   # near-black background
ACCENT   = (59, 130, 246)   # blue #3B82F6
WHITE    = (255, 255, 255)
LGREY    = (180, 180, 180)


def write_png(path, pixels, w, h):
    """Write an RGB PNG from a flat list of (r,g,b) tuples."""
    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = b''
    for y in range(h):
        raw += b'\x00'  # filter byte
        for x in range(w):
            r, g, b = pixels[y * w + x]
            raw += bytes([r, g, b])

    sig   = b'\x89PNG\r\n\x1a\n'
    ihdr  = chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
    idat  = chunk(b'IDAT', zlib.compress(raw, 6))
    iend  = chunk(b'IEND', b'')

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(sig + ihdr + idat + iend)
    print(f'  wrote {path}  ({w}×{h})')


def lerp_colour(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def make_icon(size):
    """
    Square icon: dark bg, rounded-corner feel, bold lightning bolt in white,
    small blue accent dot at top-right.
    """
    w = h = size
    cx, cy = w / 2, h / 2
    pixels = []

    # bolt polygon (in normalised 0-1 coords, centred at 0.5,0.5)
    # A simple chevron-bolt shape
    bolt = [
        (0.585, 0.08),   # top-right
        (0.38,  0.48),   # mid-left upper
        (0.52,  0.48),   # mid-right upper
        (0.415, 0.92),   # bottom-left
        (0.62,  0.52),   # mid-right lower
        (0.48,  0.52),   # mid-left lower
    ]

    def point_in_polygon(px, py, poly):
        n = len(poly)
        inside = False
        j = n - 1
        for i in range(n):
            xi, yi = poly[i][0] * w, poly[i][1] * h
            xj, yj = poly[j][0] * w, poly[j][1] * h
            if ((yi > py) != (yj > py)) and (px < (xj - xi) * (py - yi) / (yj - yi + 1e-9) + xi):
                inside = not inside
            j = i
        return inside

    # accent circle position (top-right area)
    acc_cx = w * 0.75
    acc_cy = h * 0.18
    acc_r  = w * 0.09

    corner_r = w * 0.18  # rounded-corner radius for background

    for y in range(h):
        for x in range(w):
            # rounded rect mask (soft)
            dx = max(corner_r - x, 0, x - (w - 1 - corner_r))
            dy = max(corner_r - y, 0, y - (h - 1 - corner_r))
            if math.sqrt(dx*dx + dy*dy) > corner_r:
                pixels.append((255, 255, 255))  # outside → white (transparent equiv)
                continue

            # subtle radial gradient on background
            dist = math.sqrt((x - cx)**2 + (y - cy)**2) / (w * 0.7)
            bg = lerp_colour(BG, (30, 30, 30), min(dist, 1.0))

            # bolt
            if point_in_polygon(x + 0.5, y + 0.5, bolt):
                pixels.append(WHITE)
                continue

            # accent dot
            if math.sqrt((x - acc_cx)**2 + (y - acc_cy)**2) < acc_r:
                pixels.append(ACCENT)
                continue

            pixels.append(bg)

    return pixels, w, h


def make_large(size):
    """
    Landscape/square promo image: dark bg, centred bolt, 'AXLE VPP' label area.
    For large/xlarge where text isn't actually rendered, we add a horizontal
    accent bar at the bottom and a subtle grid pattern.
    """
    w = h = size
    cx, cy = w / 2, h * 0.46
    pixels = []

    bolt = [
        (0.565, 0.12),
        (0.36,  0.50),
        (0.50,  0.50),
        (0.435, 0.88),
        (0.64,  0.50),
        (0.50,  0.50),
    ]

    def point_in_polygon(px, py, poly):
        n = len(poly)
        inside = False
        j = n - 1
        for i in range(n):
            xi, yi = poly[i][0] * w, poly[i][1] * h
            xj, yj = poly[j][0] * w, poly[j][1] * h
            if ((yi > py) != (yj > py)) and (px < (xj - xi) * (py - yi) / (yj - yi + 1e-9) + xi):
                inside = not inside
            j = i
        return inside

    bar_top = int(h * 0.88)
    bar_h   = max(4, int(h * 0.018))
    grid_sp = max(1, int(w * 0.07))

    for y in range(h):
        for x in range(w):
            # subtle grid
            on_grid = (x % grid_sp < max(1, int(w * 0.004))) or (y % grid_sp < max(1, int(h * 0.004)))

            dist = math.sqrt((x - cx)**2 + (y - cy)**2) / (w * 0.8)
            bg = lerp_colour(BG, (25, 25, 25), min(dist, 1.0))

            if on_grid:
                bg = lerp_colour(bg, (40, 40, 40), 0.6)

            # accent bar
            if bar_top <= y < bar_top + bar_h:
                t = (x / w)
                pixels.append(lerp_colour(ACCENT, (100, 180, 255), t))
                continue

            # bolt (slightly larger relative to canvas for promo images)
            bx = (x / w - 0.5) * 1.0 + 0.5
            by = (y / h - 0.46) * 1.0 + 0.5
            if 0 < bx < 1 and 0 < by < 1:
                if point_in_polygon(bx * w, by * h, bolt):
                    pixels.append(WHITE)
                    continue

            pixels.append(bg)

    return pixels, w, h


# ── SVG icon (driver) ─────────────────────────────────────────────────────────
ICON_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1a1a1a"/>
      <stop offset="100%" stop-color="#0f0f0f"/>
    </linearGradient>
  </defs>
  <!-- Background -->
  <rect width="100" height="100" rx="20" fill="url(#bg)"/>
  <!-- Accent dot -->
  <circle cx="74" cy="22" r="8" fill="#3B82F6"/>
  <!-- Lightning bolt -->
  <polygon points="58,8 36,50 50,50 42,92 64,50 50,50"
           fill="#ffffff"/>
</svg>
"""

# ── Generate everything ───────────────────────────────────────────────────────
print('Generating app images…')
for size, name in [(75, 'small'), (500, 'large'), (1000, 'xlarge')]:
    pix, w, h = (make_icon if size == 75 else make_large)(size)
    write_png(f'{BASE}/assets/images/{name}.png', pix, w, h)

print('Generating driver images…')
for size, name in [(75, 'small'), (500, 'large'), (1000, 'xlarge')]:
    pix, w, h = (make_icon if size == 75 else make_large)(size)
    write_png(f'{BASE}/drivers/axle_vpp_account/assets/images/{name}.png', pix, w, h)

print('Writing driver icon.svg…')
svg_path = f'{BASE}/drivers/axle_vpp_account/assets/icon.svg'
with open(svg_path, 'w') as f:
    f.write(ICON_SVG)
print(f'  wrote {svg_path}')

print('Done.')
