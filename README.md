# VisionHive — stages 1–5

Working, software-only foundation for multi-camera occupancy and activity analysis.

## Run

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn backend.main:app --reload
```

Open `http://127.0.0.1:8000`. Add local video paths through `config/cameras.json`, then restart the server. The provided paths are deliberately git-ignored; datasets and videos belong in `data/raw/`.

## Stages implemented

1. FastAPI, WebSocket dashboard, SQLite persistence, configuration, logging, four-zone virtual room, and shared domain schemas.
2. Async multi-source OpenCV camera workers: video files, webcams, and image sequences; resizing, FPS throttling, buffering, and selectable preprocessing.
3. Standardized detections with optional Ultralytics YOLO integration and a graceful no-model fallback.
4. Per-camera centroid tracker preserving IDs, positions, velocity, trajectory, and detection timing. A production tracker adapter can replace it without changing messages.
5. Frame differencing, Farnebäck optical flow, box displacement, temporal smoothing, and a 0–3 activity scale.

Camera-to-camera identity fusion, zone assignment, thermal modelling, HVAC control, simulation, and digital twin are intentionally not implemented yet.
