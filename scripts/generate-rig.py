"""Build public/avatar/rig.json from the base portrait.

MediaPipe Face Landmarker supplies 478 landmarks. The face keeps MediaPipe's
triangulation. Extra anchors around the hair, neck, jacket and border stay in
the mesh so the head can turn while the jacket and the ERO logo stay put.
"""

import json
import math
import urllib.request
from pathlib import Path

import mediapipe as mp
from mediapipe.tasks.python import vision
from mediapipe.tasks.python.core.base_options import BaseOptions
from PIL import Image
from scipy.spatial import Delaunay

ROOT = Path(__file__).resolve().parents[1]
AVATAR = ROOT / "public" / "avatar"
MODEL = Path("/tmp/mp/face_landmarker.task")
MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"

UPPER_INNER = [191, 80, 81, 82, 13, 312, 311, 310, 415]
LOWER_INNER = [95, 88, 178, 87, 14, 317, 402, 318, 324]
MOUTH = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191]
EYE_LEFT = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]
EYE_RIGHT = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466]
LID_UPPER_LEFT = [246, 161, 160, 159, 158, 157, 173]
LID_LOWER_LEFT = [7, 163, 144, 145, 153, 154, 155]
LID_UPPER_RIGHT = [466, 388, 387, 386, 385, 384, 398]
LID_LOWER_RIGHT = [249, 390, 373, 374, 380, 381, 382]
BROW_INNER_LEFT = [55, 65, 52, 53, 107]
BROW_OUTER_LEFT = [70, 63, 105, 66, 46]
BROW_INNER_RIGHT = [285, 295, 282, 283, 336]
BROW_OUTER_RIGHT = [300, 293, 334, 296, 276]
CHEEK_LEFT = [50, 101, 118, 119, 120, 205, 187, 147]
CHEEK_RIGHT = [280, 330, 347, 348, 349, 425, 411, 376]
CHIN = [152, 148, 176, 149, 150, 136, 172, 377, 400, 378, 379, 365, 397, 175, 171, 396]
UPPER_LIP = [185, 40, 39, 37, 0, 267, 269, 270, 409, 191, 80, 81, 82, 13, 312, 311, 310, 415]
LOWER_LIP = [146, 91, 181, 84, 17, 314, 405, 321, 375, 95, 88, 178, 87, 14, 317, 402, 318, 324]
CORNER_LEFT = [61, 78, 146, 95]
CORNER_RIGHT = [291, 308, 375, 324]


def ensure_model():
    if MODEL.exists():
        return
    MODEL.parent.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(MODEL_URL, MODEL)


def detect(path):
    image = mp.Image.create_from_file(str(path))
    options = vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(MODEL)),
        num_faces=1,
    )
    landmarker = vision.FaceLandmarker.create_from_options(options)
    result = landmarker.detect(image)
    landmarker.close()
    if not result.face_landmarks:
        raise SystemExit(f"yüz bulunamadı: {path}")
    points = result.face_landmarks[0]
    return image.width, image.height, [(p.x, p.y, p.z) for p in points]


def triangles_from_edges(connections):
    tris = []
    for index in range(0, len(connections), 3):
        nodes = []
        for edge in connections[index : index + 3]:
            nodes.extend((edge.start, edge.end))
        unique = sorted(set(nodes))
        if len(unique) != 3:
            raise SystemExit("üçgen çözülemedi")
        tris.append(unique)
    return tris


def ordered_loop(connections):
    nxt = {}
    for edge in connections:
        nxt.setdefault(edge.start, []).append(edge.end)
    start = connections[0].start
    loop = [start]
    cursor = start
    seen = {start}
    while True:
        options = [item for item in nxt.get(cursor, []) if item not in seen]
        if not options:
            break
        cursor = options[0]
        loop.append(cursor)
        seen.add(cursor)
    return loop


def inside(point, polygon):
    x, y = point
    hit = False
    count = len(polygon)
    j = count - 1
    for i in range(count):
        yi, yj = polygon[i][1], polygon[j][1]
        xi, xj = polygon[i][0], polygon[j][0]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi):
            hit = not hit
        j = i
    return hit


def crop_teeth(path, landmarks, box):
    image = Image.open(path).convert("RGB")
    width, height = image.size
    xs = [landmarks[i][0] * width for i in UPPER_INNER + LOWER_INNER]
    ys = [landmarks[i][1] * height for i in UPPER_INNER + LOWER_INNER]
    top = min(landmarks[i][1] for i in UPPER_INNER) * height
    bottom = max(landmarks[i][1] for i in LOWER_INNER) * height
    pad_x = (max(xs) - min(xs)) * 0.08
    upper = image.crop((
        max(0, math.floor(min(xs) - pad_x)),
        max(0, math.floor(top - (bottom - top) * 0.15)),
        min(width, math.ceil(max(xs) + pad_x)),
        min(height, math.ceil(top + (bottom - top) * 0.42)),
    )).resize((256, 64), Image.Resampling.LANCZOS)
    box.paste(upper, (0, 0))


def main():
    ensure_model()
    width, height, landmarks = detect(AVATAR / "base.jpg")
    if len(landmarks) != 478:
        raise SystemExit(f"478 nokta bekleniyordu, {len(landmarks)} geldi")
    if landmarks[468][0] > landmarks[473][0]:
        raise SystemExit("iris sırası beklenenden farklı")

    face_tris = triangles_from_edges(vision.FaceLandmarksConnections.FACE_LANDMARKS_TESSELATION)
    oval = ordered_loop(vision.FaceLandmarksConnections.FACE_LANDMARKS_FACE_OVAL)
    outer_lip = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185]
    lip_poly = [(landmarks[i][0], landmarks[i][1]) for i in outer_lip]
    slit = (landmarks[13][1] + landmarks[14][1]) * 0.5
    lip_region = set(outer_lip)
    for index, point in enumerate(landmarks):
        if inside((point[0], point[1]), lip_poly):
            lip_region.add(index)
    lip_lower = {index for index in lip_region if landmarks[index][1] >= slit - 0.001}
    lip_upper = {index for index in lip_region if landmarks[index][1] < slit - 0.001}
    iris_left = landmarks[468]
    iris_right = landmarks[473]
    skin = []
    mouth_cover = []
    eye_holes = 0
    for tri in face_tris:
        nodes = set(tri)
        if nodes & lip_lower and nodes & lip_upper:
            mouth_cover.append(tri)
            continue
        skin.append(tri)

    nose = landmarks[1]
    oval_xy = [(landmarks[i][0], landmarks[i][1]) for i in oval]
    anchors = []

    def push(x, y, z, influence, role):
        anchors.append({"x": x, "y": y, "z": z, "influence": influence, "role": role})

    for step in range(16):
        t = step / 16
        push(t, 0, 0, 0, "border")
        push(t, 1, 0, 0, "border")
        push(0, t, 0, 0, "border")
        push(1, t, 0, 0, "border")
    for scale, influence in ((1.22, 0.96), (1.48, 0.62)):
        for index in oval:
            x, y, z = landmarks[index]
            push(
                min(0.98, max(0.02, nose[0] + (x - nose[0]) * scale)),
                min(0.72, max(0.02, nose[1] + (y - nose[1]) * scale)),
                z * 0.4,
                influence,
                "hair",
            )
    for y, influence in ((0.62, 0.42), (0.66, 0.18)):
        for step in range(9):
            push(0.30 + step * 0.05, y, 0.02, influence, "neck")
    for row in range(6):
        for col in range(8):
            push(0.12 + col * 0.11, 0.70 + row * 0.045, 0, 0, "jacket")

    # Drop anchors that land on top of a landmark or each other.
    kept = []
    occupied = [(p[0], p[1]) for p in landmarks]
    for anchor in anchors:
        if any(abs(anchor["x"] - x) < 0.008 and abs(anchor["y"] - y) < 0.008 for x, y in occupied):
            continue
        occupied.append((anchor["x"], anchor["y"]))
        kept.append(anchor)
    anchors = kept

    cloud = [(landmarks[i][0], landmarks[i][1]) for i in oval]
    cloud.extend((item["x"], item["y"]) for item in anchors)
    exterior = []
    if len(cloud) >= 4:
        mesh = Delaunay(cloud)
        oval_count = len(oval)
        for tri in mesh.simplices:
            pts = [cloud[int(v)] for v in tri]
            centroid = (sum(p[0] for p in pts) / 3, sum(p[1] for p in pts) / 3)
            if inside(centroid, oval_xy):
                continue
            mapped = []
            for vertex in tri:
                vertex = int(vertex)
                if vertex < oval_count:
                    mapped.append(oval[vertex])
                else:
                    mapped.append(478 + (vertex - oval_count))
            exterior.append(mapped)

    def fan(center, loop):
        out = []
        for index in range(len(loop)):
            out.extend((center, loop[index], loop[(index + 1) % len(loop)]))
        return out

    def order_ring(center, ring):
        cx, cy = landmarks[center][0], landmarks[center][1]
        return sorted(ring, key=lambda i: math.atan2(landmarks[i][1] - cy, landmarks[i][0] - cx))

    ring_left = order_ring(468, [469, 470, 471, 472])
    ring_right = order_ring(473, [474, 475, 476, 477])

    def fan_tris(center, loop):
        return [(center, loop[i], loop[(i + 1) % len(loop)]) for i in range(len(loop))]

    skin.extend(fan_tris(468, EYE_LEFT))
    skin.extend(fan_tris(473, EYE_RIGHT))
    mouth_cover.extend(fan_tris(13, outer_lip))

    teeth = Image.new("RGB", (256, 128), (90, 36, 40))
    for name, slot in (("viseme-a.jpg", 0), ("viseme-i.jpg", 64)):
        band = Image.new("RGB", (256, 64), (90, 36, 40))
        try:
            _, _, found = detect(AVATAR / "raw" / name)
            crop_teeth(AVATAR / "raw" / name, found, band)
        except Exception as error:
            print("diş karesi atlandı", name, error)
        teeth.paste(band, (0, slot))
    teeth.save(AVATAR / "teeth.png", optimize=True)

    influence = []
    chin_y = landmarks[152][1]
    for index, point in enumerate(landmarks):
        value = 1
        if index in CHIN or point[1] > chin_y - 0.01:
            value = 0.9
        influence.append(value)
    for anchor in anchors:
        influence.append(anchor["influence"])

    def rnd(value):
        return round(float(value), 5)

    rig = {
        "width": width,
        "height": height,
        "source": "mediapipe-face-landmarker",
        "landmarks": [[rnd(p[0]), rnd(p[1]), rnd(p[2])] for p in landmarks],
        "anchors": [[rnd(a["x"]), rnd(a["y"]), rnd(a["z"]), rnd(a["influence"]), a["role"]] for a in anchors],
        "influence": [rnd(v) for v in influence],
        "skin": [index for tri in skin + exterior for index in tri],
        "mouthCover": [index for tri in mouth_cover for index in tri],
        "eyeFans": [
            fan(468, EYE_LEFT),
            fan(473, EYE_RIGHT),
        ],
        "iris": [
            fan(468, ring_left),
            fan(473, ring_right),
        ],
        "mouth": MOUTH,
        "groups": {
            "upperLip": UPPER_LIP,
            "lowerLip": LOWER_LIP,
            "cornerLeft": CORNER_LEFT,
            "cornerRight": CORNER_RIGHT,
            "chin": CHIN,
            "lipLower": sorted(lip_lower),
            "hinge": [58, 288],
            "cheekLeft": CHEEK_LEFT,
            "cheekRight": CHEEK_RIGHT,
            "browInnerLeft": BROW_INNER_LEFT,
            "browOuterLeft": BROW_OUTER_LEFT,
            "browInnerRight": BROW_INNER_RIGHT,
            "browOuterRight": BROW_OUTER_RIGHT,
            "lidUpperLeft": LID_UPPER_LEFT,
            "lidLowerLeft": LID_LOWER_LEFT,
            "lidUpperRight": LID_UPPER_RIGHT,
            "lidLowerRight": LID_LOWER_RIGHT,
            "irisLeft": [468, *ring_left],
            "irisRight": [473, *ring_right],
            "outerLip": outer_lip,
            "nose": 1,
        },
        "stats": {
            "landmarks": 478,
            "anchors": len(anchors),
            "skinTriangles": len(skin),
            "exteriorTriangles": len(exterior),
            "eyeHoles": eye_holes,
            "mouthHoles": len(mouth_cover),
        },
    }
    (AVATAR / "rig.json").write_text(json.dumps(rig, separators=(",", ":")), encoding="utf-8")
    print(json.dumps(rig["stats"]))


if __name__ == "__main__":
    main()
