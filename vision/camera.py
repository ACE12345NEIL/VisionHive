from __future__ import annotations
import asyncio
import time
import cv2
from pathlib import Path
from backend.schemas import CameraFrameResult
from .preprocessing import preprocess, resize

latest_jpegs = {}


def cache_preview(camera_id, frame, detections, tracks):
    preview = frame.copy()
    
    # 1. Draw equipment & lights detections (Amber/Yellow bounding boxes)
    for det in detections:
        if det.class_name == 'person':
            continue
        box = det.bbox
        # Gold/Yellow for lights, Amber for devices
        color = (0, 230, 255) if 'light' in det.class_name.lower() else (0, 190, 255)
        cv2.rectangle(preview, (int(box.x1), int(box.y1)), (int(box.x2), int(box.y2)), color, 2)
        cv2.putText(
            preview,
            f'{det.class_name} {int(det.confidence * 100)}%',
            (int(box.x1), max(18, int(box.y1) - 6)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.45,
            color,
            2
        )

    # 2. Draw person tracks (Cyan/Mint bounding boxes)
    for track in tracks:
        box = track.bbox
        color = (70, 230, 180)
        cv2.rectangle(preview, (int(box.x1), int(box.y1)), (int(box.x2), int(box.y2)), color, 2)
        cv2.putText(
            preview,
            f'#{track.id.split(":")[-1]} {track.activity.name.lower()}',
            (int(box.x1), max(18, int(box.y1) - 6)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            color,
            2
        )

    ok, encoded = cv2.imencode('.jpg', preview, [cv2.IMWRITE_JPEG_QUALITY, 75])
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
                # Loop video files if reached EOF
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
            
            # Cache preview with BOTH device detections and person tracks
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
