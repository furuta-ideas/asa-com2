"""Asa-Com2 手書き認識CNNの学習データ生成
   ・筆画テンプレートを「人が指で書いたように」崩してラスタライズ
   ・日本語フォントの字形をレンダリング（印刷字形の多様性）
   いずれも、アプリが認識時に行うのと同じ正規化（外接矩形→正方形へ収める）で 48x48 にする。
"""
import json, math, random, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

SIZE = 48
MARGIN = 4
FONTS = [
    "/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf",
    "/usr/share/fonts/opentype/ipafont-gothic/ipagp.ttf",
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
    "/usr/share/fonts/opentype/unifont/unifont_jp.otf",
]

RAW = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "templates.json"))
CLASSES = sorted({r["ch"] for r in RAW}, key=lambda c: "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンー0123456789".index(c))
CIDX = {c: i for i, c in enumerate(CLASSES)}


# ---------- 筆跡（点列）を作る ----------
def tpl_strokes(rec):
    out = []
    for f in rec["s"]:
        out.append([(f[i], f[i + 1]) for i in range(0, len(f), 2)])
    return out


def densify(stroke, step=2.0):
    pts = []
    for i in range(len(stroke) - 1):
        (x0, y0), (x1, y1) = stroke[i], stroke[i + 1]
        d = math.hypot(x1 - x0, y1 - y0)
        n = max(2, int(d / step))
        for k in range(n):
            t = k / n
            pts.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t))
    pts.append(stroke[-1])
    return pts


def distort(strokes, sev=1.0, rng=random):
    """人の手で書いたときの崩れ：回転・縦横の伸縮・傾き・手のふるえ・書き始め終わりの欠け・画のずれ"""
    rot = rng.uniform(-1, 1) * 14 * sev * math.pi / 180
    sx = rng.uniform(1 - .26 * sev, 1 + .26 * sev)
    sy = rng.uniform(1 - .26 * sev, 1 + .26 * sev)
    sh = rng.uniform(-1, 1) * .22 * sev
    wob = rng.uniform(0, 5.5) * sev
    jit = 1.8 * sev
    ph1, ph2 = rng.uniform(0, 6.28), rng.uniform(0, 6.28)
    fr1, fr2 = rng.uniform(.8, 2.6), rng.uniform(.8, 2.6)
    out = []
    for st in strokes:
        pts = densify(st)
        # 画ごとの位置ずれ（画がそろわない）
        ox, oy = rng.uniform(-1, 1) * 5 * sev, rng.uniform(-1, 1) * 5 * sev
        cut0 = int(rng.uniform(0, .10 * sev) * len(pts))
        cut1 = int(rng.uniform(0, .10 * sev) * len(pts))
        ext = rng.uniform(0, .10 * sev)      # 書き過ぎ（はみ出し）
        seg = pts[cut0:len(pts) - cut1] if len(pts) - cut0 - cut1 > 3 else pts
        if ext > 0 and len(seg) > 3:
            (ax, ay), (bx, by) = seg[-2], seg[-1]
            seg = seg + [(bx + (bx - ax) * ext * 20, by + (by - ay) * ext * 20)]
        np_ = []
        n = len(seg)
        for i, (x, y) in enumerate(seg):
            u = i / max(1, n - 1)
            x, y = x - 50 + ox, y - 50 + oy
            x += math.sin(u * 6.28 * fr1 + ph1) * wob
            y += math.sin(u * 6.28 * fr2 + ph2) * wob
            x += sh * y
            X = (x * math.cos(rot) - y * math.sin(rot)) * sx
            Y = (x * math.sin(rot) + y * math.cos(rot)) * sy
            np_.append((X + 50 + rng.uniform(-jit, jit), Y + 50 + rng.uniform(-jit, jit)))
        out.append(np_)
    return out


# ---------- 正規化してラスタライズ（アプリ側と同じ収め方） ----------
def render_strokes(strokes, width_ratio=None, rng=random):
    xs = [p[0] for st in strokes for p in st]
    ys = [p[1] for st in strokes for p in st]
    if not xs:
        return None
    w, h = max(xs) - min(xs), max(ys) - min(ys)
    scale = max(w, h, 1e-6)
    inner = SIZE - 2 * MARGIN
    k = inner / scale
    ox = MARGIN + (inner - w * k) / 2 - min(xs) * k
    oy = MARGIN + (inner - h * k) / 2 - min(ys) * k
    SS = 4                                     # スーパーサンプリングして滑らかに
    img = Image.new("L", (SIZE * SS, SIZE * SS), 255)
    d = ImageDraw.Draw(img)
    lw = (width_ratio if width_ratio else rng.uniform(.055, .16)) * SIZE * SS
    for st in strokes:
        pts = [((p[0] * k + ox) * SS, (p[1] * k + oy) * SS) for p in st]
        if len(pts) == 1:
            pts = pts * 2
        d.line(pts, fill=0, width=max(2, int(lw)), joint="curve")
        r = max(1, int(lw / 2))
        for p in (pts[0], pts[-1]):            # 丸い筆先
            d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=0)
    img = img.resize((SIZE, SIZE), Image.LANCZOS)
    return np.asarray(img, dtype=np.uint8)


def render_font(ch, font_path, rng=random):
    px = 140
    try:
        font = ImageFont.truetype(font_path, px)
    except Exception:
        return None
    img = Image.new("L", (px * 2, px * 2), 255)
    d = ImageDraw.Draw(img)
    d.text((px // 2, px // 2), ch, font=font, fill=0)
    if rng.random() < .5:                      # 太らせる／細らせる
        img = img.filter(ImageFilter.MinFilter(3) if rng.random() < .5 else ImageFilter.MaxFilter(3))
    a = np.asarray(img)
    ys, xs = np.where(a < 128)
    if len(xs) < 10:
        return None
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    crop = img.crop((x0, y0, x1 + 1, y1 + 1))
    w, h = crop.size
    scale = max(w, h)
    inner = SIZE - 2 * MARGIN
    nw, nh = max(1, int(w / scale * inner)), max(1, int(h / scale * inner))
    crop = crop.resize((nw, nh), Image.LANCZOS)
    out = Image.new("L", (SIZE, SIZE), 255)
    out.paste(crop, (MARGIN + (inner - nw) // 2, MARGIN + (inner - nh) // 2))
    return np.asarray(out, dtype=np.uint8)


def jitter_image(a, rng=random):
    """描いたあとの画像そのものを少し揺らす（平行移動・ぼけ）"""
    img = Image.fromarray(a)
    dx, dy = rng.randint(-2, 2), rng.randint(-2, 2)
    img = img.transform((SIZE, SIZE), Image.AFFINE, (1, 0, dx, 0, 1, dy), fillcolor=255)
    if rng.random() < .35:
        img = img.filter(ImageFilter.GaussianBlur(rng.uniform(.3, .9)))
    return np.asarray(img, dtype=np.uint8)


def build(per_class_stroke, per_class_font, seed=0, sev_lo=.4, sev_hi=1.25, fonts=None):
    rng = random.Random(seed)
    fonts = fonts if fonts is not None else FONTS
    by_char = {}
    for r in RAW:
        by_char.setdefault(r["ch"], []).append(tpl_strokes(r))
    X, Y = [], []
    for ch in CLASSES:
        variants = by_char[ch]
        for i in range(per_class_stroke):
            st = variants[i % len(variants)]
            sev = rng.uniform(sev_lo, sev_hi)
            img = render_strokes(distort(st, sev, rng), rng=rng)
            if img is None:
                continue
            X.append(jitter_image(img, rng)); Y.append(CIDX[ch])
        for i in range(per_class_font):
            fp = fonts[i % len(fonts)]
            img = render_font(ch, fp, rng)
            if img is None:
                continue
            X.append(jitter_image(img, rng)); Y.append(CIDX[ch])
    return np.stack(X), np.array(Y, dtype=np.int64)


if __name__ == "__main__":
    import time
    t = time.time()
    Xtr, Ytr = build(900, 60, seed=1)
    Xva, Yva = build(120, 12, seed=999, sev_lo=.5, sev_hi=1.5)
    np.savez_compressed("data.npz", Xtr=Xtr, Ytr=Ytr, Xva=Xva, Yva=Yva,
                        classes=np.array(CLASSES))
    print(f"train {Xtr.shape} val {Xva.shape}  {time.time()-t:.0f}s")
