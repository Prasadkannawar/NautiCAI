"""
NautiCAI FastAPI Backend
Runs YOLOv8 inference on uploaded images/videos and saves results to Supabase.
Start with: uvicorn api:app --reload --port 8000
"""

import os
import io
import uuid
import time
import random
import base64
import tempfile
import cv2
import numpy as np
from datetime import datetime
from pathlib import Path

# ── Torch safe loading fix — MUST run before ultralytics import ──
import torch

_orig_torch_load = torch.load
def _safe_load(*args, **kw):
    kw["weights_only"] = False
    return _orig_torch_load(*args, **kw)
torch.load = _safe_load

from fastapi import FastAPI, File, UploadFile, HTTPException
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from ultralytics import YOLO
from supabase import create_client
from dotenv import load_dotenv

# Optional direct Postgres insert (enterprise contact form)
try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
except Exception:
    psycopg2 = None


# ── Config ──────────────────────────────────────────────
load_dotenv()
SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "").strip()
POSTGRES_DSN = os.getenv("POSTGRES_DSN") or os.getenv("DATABASE_URL")

MODEL_PATH = os.path.join(os.path.dirname(__file__), "best.pt")

# Model training metrics (from FinalUI/app.py)
MODEL_METRICS = {
    "precision": 0.886,
    "recall":    0.844,
    "map50":     0.882,
    "map5095":   0.782,
}

# Class colour map for bounding boxes (BGR for OpenCV)
CLASS_COLORS_BGR = {
    "corrosion":      (60,  76,  231),   # red
    "marine growth":  (0,  165,  240),   # amber
    "debris":         (34, 126,  230),   # orange
    "healthy surface":(176, 200,  0),    # teal
    "healthy":        (176, 200,  0),
}
DEFAULT_COLOR_BGR = (0, 200, 176)

# ── App setup ────────────────────────────────────────────
app = FastAPI(title="NautiCAI Detection API", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Load model once at startup ────────────────────────────
print(f"Loading YOLO model from {MODEL_PATH} ...")
model = YOLO(MODEL_PATH)
print("Model loaded ✓")

# ── Supabase client ───────────────────────────────────────
try:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    print("Supabase connected ✓")
except Exception as e:
    print(f"Supabase connection warning: {e}")
    supabase = None


# ── Helper: get box colour ────────────────────────────────
def get_color(class_name: str):
    key = class_name.lower().strip()
    return CLASS_COLORS_BGR.get(key, DEFAULT_COLOR_BGR)


# ── Helper: draw boxes on image (OpenCV) ─────────────────
def draw_boxes(image_bgr: np.ndarray, detections: list) -> np.ndarray:
    img = image_bgr.copy()
    H, W = img.shape[:2]

    for det in detections:
        x1, y1, x2, y2 = int(det["x1"]), int(det["y1"]), int(det["x2"]), int(det["y2"])
        label = det["class_name"]
        conf  = det["confidence"]
        color = get_color(label)

        # Bounding box
        cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)

        # Corner markers (Anduril-style)
        cs = 12
        for (cx, cy, dx, dy) in [
            (x1, y1,  cs,  cs), (x2, y1, -cs,  cs),
            (x1, y2,  cs, -cs), (x2, y2, -cs, -cs),
        ]:
            cv2.line(img, (cx, cy), (cx + dx, cy), color, 3)
            cv2.line(img, (cx, cy), (cx, cy + dy), color, 3)

        # Label background + text
        tag = f"{label}  {conf:.0%}"
        font = cv2.FONT_HERSHEY_SIMPLEX
        scale, thick = 0.48, 1
        (tw, th), _ = cv2.getTextSize(tag, font, scale, thick)
        lx, ly = x1, max(y1 - 6, th + 4)
        cv2.rectangle(img, (lx, ly - th - 4), (lx + tw + 10, ly + 2), color, -1)
        cv2.putText(img, tag, (lx + 5, ly - 2), font, scale,
                    (10, 10, 10), thick, cv2.LINE_AA)

    # Detection count overlay
    count_label = f"{len(detections)} detection{'s' if len(detections) != 1 else ''} found"
    (cw, ch), _ = cv2.getTextSize(count_label, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
    cv2.rectangle(img, (W - cw - 20, H - ch - 16), (W - 4, H - 4), (6, 19, 32), -1)
    cv2.putText(img, count_label, (W - cw - 14, H - 8),
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 200, 176), 1, cv2.LINE_AA)

    return img


# ── Helper: image → base64 data URI ──────────────────────
def img_to_b64(image_bgr: np.ndarray) -> str:
    success, buf = cv2.imencode(".jpg", image_bgr, [cv2.IMWRITE_JPEG_QUALITY, 88])
    if not success:
        raise RuntimeError("Failed to encode image")
    return "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode()


# ── Helper: upload file bytes to Supabase storage ─────────
def upload_to_supabase(bucket: str, filename: str, data: bytes, content_type: str) -> str | None:
    if supabase is None:
        return None
    try:
        unique_name = f"{uuid.uuid4()}_{filename}"
        supabase.storage.from_(bucket).upload(
            unique_name, data,
            file_options={"content-type": content_type}
        )
        return supabase.storage.from_(bucket).get_public_url(unique_name)
    except Exception as e:
        print(f"Supabase upload error: {e}")
        return None


# ── Contact form model & helpers ─────────────────────────────────────────────
class ContactPayload(BaseModel):
    first_name: str
    last_name: str
    email: str
    company: str
    use_case: str
    message: str | None = ""


def insert_contact_postgres(payload: ContactPayload) -> bool:
    if not POSTGRES_DSN or psycopg2 is None:
        return False
    conn = None
    try:
        conn = psycopg2.connect(POSTGRES_DSN)
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                INSERT INTO enterprise_contacts
                (first_name, last_name, email, company, use_case, message)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    payload.first_name,
                    payload.last_name,
                    payload.email,
                    payload.company,
                    payload.use_case,
                    payload.message,
                ),
            )
        conn.commit()
        return True
    except Exception as e:
        print(f"Postgres insert error: {e}")
        return False
    finally:
        if conn is not None:
            conn.close()


# ══════════════════════════════════════════════════════════
#  ENDPOINT: POST /detect
# ══════════════════════════════════════════════════════════
@app.post("/detect")
async def detect(file: UploadFile = File(...)):
    """
    Accept an image or video, run YOLOv8 inference, return detections.
    Response JSON:
      detections: [ { class_name, confidence, x1, y1, x2, y2 } ]
      annotated_image: base64 data URI (JPEG)
      summary: { total, risk_level, avg_confidence, inference_time_ms }
      inspection_id: str
      model_metrics: { precision, recall, map50, map5095 }
    """
    # Validate
    allowed = {"image/jpeg", "image/png", "image/jpg", "image/webp",
               "video/mp4", "video/quicktime", "video/avi"}
    if file.content_type and file.content_type not in allowed:
        raise HTTPException(415, f"Unsupported file type: {file.content_type}")

    raw_bytes = await file.read()
    is_video  = file.content_type and file.content_type.startswith("video/")

    # ── Run inference ─────────────────────────────────────
    t0 = time.time()

    with tempfile.NamedTemporaryFile(
        suffix=Path(file.filename or "upload.jpg").suffix,
        delete=False
    ) as tmp:
        tmp.write(raw_bytes)
        tmp_path = tmp.name

    try:
        results = model.predict(
            source=tmp_path,
            conf=0.25,
            iou=0.45,
            save=False,
            verbose=False,
        )
    finally:
        os.unlink(tmp_path)

    inference_ms = round((time.time() - t0) * 1000, 1)

    # ── Parse detections ──────────────────────────────────
    # For video we take the first frame's result; for images just result[0]
    result = results[0]

    # Decode original image for drawing
    if is_video:
        nparr = np.frombuffer(raw_bytes, np.uint8)
        # try to get first frame
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as vf:
            vf.write(raw_bytes)
            vf_path = vf.name
        cap = cv2.VideoCapture(vf_path)
        ok, orig_frame = cap.read()
        cap.release()
        os.unlink(vf_path)
        if not ok:
            raise HTTPException(400, "Could not decode video frame")
        image_bgr = orig_frame
    else:
        nparr    = np.frombuffer(raw_bytes, np.uint8)
        image_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    detections = []
    if result.boxes is not None and len(result.boxes) > 0:
        boxes       = result.boxes
        cls_ids     = boxes.cls.cpu().numpy().astype(int)
        confs       = boxes.conf.cpu().numpy()
        xyxy        = boxes.xyxy.cpu().numpy()

        for i in range(len(cls_ids)):
            class_name = result.names[cls_ids[i]]
            detections.append({
                "class_name":  class_name,
                "confidence":  float(round(confs[i], 4)),
                "x1": float(xyxy[i][0]),
                "y1": float(xyxy[i][1]),
                "x2": float(xyxy[i][2]),
                "y2": float(xyxy[i][3]),
            })

    # ── Draw annotated image ──────────────────────────────
    annotated_bgr = draw_boxes(image_bgr, detections)
    annotated_b64 = img_to_b64(annotated_bgr)

    # ── Risk level ────────────────────────────────────────
    if detections:
        max_conf = max(d["confidence"] for d in detections)
        if max_conf > 0.85:
            risk = "HIGH"
        elif max_conf > 0.60:
            risk = "MEDIUM"
        else:
            risk = "LOW"
        avg_conf = round(sum(d["confidence"] for d in detections) / len(detections), 4)
    else:
        max_conf = 0.0
        avg_conf = 0.0
        risk = "SAFE"

    inspection_id = f"NCR-{datetime.now().strftime('%Y%m%d')}-{random.randint(1000,9999)}"

    # ── Save to Supabase (non-blocking, best-effort) ──────
    _, jpg_buf = cv2.imencode(".jpg", annotated_bgr)
    annotated_url = upload_to_supabase(
        "image_bucket", f"annotated_{inspection_id}.jpg",
        jpg_buf.tobytes(), "image/jpeg"
    )
    original_url = upload_to_supabase(
        "image_bucket", f"original_{inspection_id}.jpg",
        raw_bytes, file.content_type or "image/jpeg"
    )

    if supabase is not None:
        try:
            class_names = list(set(d["class_name"] for d in detections))
            supabase.table("inspections").insert({
                "inspection_id":       inspection_id,
                "file_name":           file.filename,
                "detected_classes":    class_names,
                "highest_confidence":  float(max_conf),
                "risk_level":          risk,
                "inference_time":      inference_ms / 1000,
                "precision":           MODEL_METRICS["precision"],
                "recall":              MODEL_METRICS["recall"],
                "map50":               MODEL_METRICS["map50"],
                "map5095":             MODEL_METRICS["map5095"],
                "image_url":           original_url,
                "annotated_image_url": annotated_url,
                "status":              "completed",
            }).execute()
        except Exception as e:
            print(f"Supabase DB insert error: {e}")

    # ── Response ──────────────────────────────────────────
    return JSONResponse({
        "inspection_id":   inspection_id,
        "detections":      detections,
        "annotated_image": annotated_b64,
        "summary": {
            "total":              len(detections),
            "risk_level":         risk,
            "avg_confidence":     avg_conf,
            "max_confidence":     float(max_conf),
            "inference_time_ms":  inference_ms,
        },
        "model_metrics": MODEL_METRICS,
        "timestamp":      datetime.now().isoformat(),
    })


# ══════════════════════════════════════════════════════════
#  ENDPOINT: GET /inspections
# ══════════════════════════════════════════════════════════
@app.get("/inspections")
async def get_inspections(limit: int = 20):
    if supabase is None:
        return JSONResponse({"inspections": [], "error": "Supabase not configured"})
    try:
        resp = (supabase.table("inspections")
                .select("*")
                .order("created_at", desc=True)
                .limit(limit)
                .execute())
        return JSONResponse({"inspections": resp.data or []})
    except Exception as e:
        return JSONResponse({"inspections": [], "error": str(e)})


# ── Health check ──────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "model": MODEL_PATH, "supabase": supabase is not None}


# ── Debug: verify loaded module and routes ───────────────────────────────────
@app.get("/debug/routes")
async def debug_routes():
    return {
        "file": __file__,
        "routes": [r.path for r in app.router.routes],
    }


# ── ENDPOINT: POST /contact ──────────────────────────────────────────────────
@app.post("/contact")
async def submit_contact(payload: ContactPayload):
    """
    Save enterprise contact form data.
    Writes to Supabase table and (optionally) to Postgres if POSTGRES_DSN is set.
    """
    supabase_ok = False
    if supabase is not None:
        try:
            supabase.table("enterprise_contacts").insert({
                "first_name": payload.first_name,
                "last_name": payload.last_name,
                "email": payload.email,
                "company": payload.company,
                "use_case": payload.use_case,
                "message": payload.message,
            }).execute()
            supabase_ok = True
        except Exception as e:
            print(f"Supabase contact insert error: {e}")

    postgres_ok = insert_contact_postgres(payload)

    if not supabase_ok and not postgres_ok:
        raise HTTPException(500, "Failed to save contact data")

    return {
        "status": "ok",
        "saved_supabase": supabase_ok,
        "saved_postgres": postgres_ok,
    }
