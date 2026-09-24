from __future__ import annotations
import asyncio
import time
import cv2
from pathlib import Path
from backend.schemas import CameraFrameResult
from .preprocessing import preprocess, resize

latest_jpegs = {}
latest_frames = {}


# Vibrant Color Palette for Bounding Boxes (BGR format)
COLOR_PERSON = (50, 240, 140)     # Mint / Neon Green
COLOR_LAPTOP = (0, 225, 255)     # Bright Yellow
COLOR_MONITOR = (255, 215, 0)    # Cyan / Sky Blue
COLOR_PHONE = (0, 165, 255)      # Light Orange
COLOR_LIGHT = (0, 245, 255)      # Gold / Warm Amber
COLOR_OTHER = (255, 100, 220)    # Magenta


def draw_labeled_box(img, x1, y1, x2, y2, label, color, thickness=2):
    """Draws crisp bounding box rectangle with solid filled label pill for maximum visibility."""
    x1, y1, x2, y2 = int(x1), int(y1), int(x2), int(y2)
    
    # 1. Main Bounding Box Rectangle
    cv2.rectangle(img, (x1, y1), (x2, y2), color, thickness)
    
    # 2. Filled Background Pill for Label Text
    font = cv2.FONT_HERSHEY_SIMPLEX
    font_scale = 0.45
    font_thickness = 1
    (text_w, text_h), baseline = cv2.getTextSize(label, font, font_scale, font_thickness)
    
    label_y1 = max(0, y1 - text_h - 8)
    label_y2 = max(text_h + 8, y1)
    
    # Fill solid background box matching color for high contrast
    cv2.rectangle(img, (x1, label_y1), (x1 + text_w + 8, label_y2), color, -1)
    # Contrast black text inside label pill
    cv2.putText(img, label, (x1 + 4, label_y2 - 4), font, font_scale, (0, 0, 0), font_thickness, cv2.LINE_AA)


def cache_preview(camera_id, frame, detections, tracks):
    """Generates preview JPEG with high-visibility labeled bounding boxes for both people and equipment."""
    preview = frame.copy()
    
    # 1. Draw equipment, displays, and lights detections
    for det in detections:
        if det.class_name == 'person':
            continue
        box = det.bbox
        c_name = det.class_name.lower()
        
        if 'laptop' in c_name:
            color = COLOR_LAPTOP
        elif 'monitor' in c_name or 'tv' in c_name or 'screen' in c_name:
            color = COLOR_MONITOR
        elif 'phone' in c_name:
            color = COLOR_PHONE
        elif 'light' in c_name:
            color = COLOR_LIGHT
        else:
            color = COLOR_OTHER

        label_text = f'{det.class_name} {int(det.confidence * 100)}%'
        draw_labeled_box(preview, box.x1, box.y1, box.x2, box.y2, label_text, color, thickness=2)

    # 2. Draw tracked occupants/people
    for track in tracks:
        box = track.bbox
        track_num = track.id.split(":")[-1]
        label_text = f'#{track_num} {track.activity.name.lower()}'
        draw_labeled_box(preview, box.x1, box.y1, box.x2, box.y2, label_text, COLOR_PERSON, thickness=2)

    latest_frames[camera_id] = frame
    ok, encoded = cv2.imencode('.jpg', preview, [cv2.IMWRITE_JPEG_QUALITY, 80])
    if ok:
        latest_jpegs[camera_id] = encoded.tobytes()



class CameraWorker:
    def __init__(self, camera, settings, detector, tracker, motion, on_result, inference_lock):
        self.camera = camera
        self.settings = settings
        self.detector = detector
        self.tracker = tracker
        self.motion = motion
        self.on_result = on_result
        self.inference_lock = inference_lock
        self.running = False

    async def run(self):
        if self.camera.source_type == 'images':
            await self._run_images()
            return
        source = int(self.camera.source) if self.camera.source_type == 'webcam' else self.camera.source
        cap = cv2.VideoCapture(source)
        self.running = True
        period = 1 / self.settings['target_fps']
        last = 0
        if not cap.isOpened():
            return
        while self.running:
            ok, frame = cap.read()
            if not ok:
                # Loop video files cleanly when reaching EOF
                if self.camera.source_type == 'video':
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    ok, frame = cap.read()
                    if not ok:
                        break
                else:
                    break
            now = time.monotonic()
            delay = period - (now - last)
            if delay > 0:
                await asyncio.sleep(delay)
            last = time.monotonic()
            frame = resize(frame, self.settings['width'])
            processed = preprocess(frame, self.settings['preprocessing'])
            detector_frame = cv2.cvtColor(processed, cv2.COLOR_GRAY2BGR) if processed.ndim == 2 else processed
            async with self.inference_lock:
                detections = await asyncio.to_thread(self.detector.detect, detector_frame, self.camera.id)
            tracks = self.motion.analyze(detector_frame, self.tracker.update(detections))
            
            # Cache preview with high-visibility labeled bounding boxes
            cache_preview(self.camera.id, detector_frame, detections, tracks)
            
            await self.on_result(CameraFrameResult(
                camera_id=self.camera.id,
                fps=round(1 / max(time.monotonic() - now, .001), 1),
                frame_size=(frame.shape[1], frame.shape[0]),
                detections=detections,
                tracks=tracks
            ))
            await asyncio.sleep(0)
        cap.release()
        self.running = False

    async def _run_images(self):
        paths = sorted([p for p in Path(self.camera.source).iterdir() if p.suffix.lower() in {'.jpg', '.jpeg', '.png', '.bmp'}])
        self.running = True
        for path in paths:
            if not self.running:
                break
            frame = cv2.imread(str(path))
            if frame is None:
                continue
            frame = resize(frame, self.settings['width'])
            processed = preprocess(frame, self.settings['preprocessing'])
            detector_frame = cv2.cvtColor(processed, cv2.COLOR_GRAY2BGR) if processed.ndim == 2 else processed
            async with self.inference_lock:
                detections = await asyncio.to_thread(self.detector.detect, detector_frame, self.camera.id)
            tracks = self.motion.analyze(detector_frame, self.tracker.update(detections))
            cache_preview(self.camera.id, detector_frame, detections, tracks)
            await self.on_result(CameraFrameResult(
                camera_id=self.camera.id,
                fps=self.settings['target_fps'],
                frame_size=(frame.shape[1], frame.shape[0]),
                detections=detections,
                tracks=tracks
            ))
            await asyncio.sleep(1 / self.settings['target_fps'])
        self.running = False

    def stop(self):
        self.running = False
