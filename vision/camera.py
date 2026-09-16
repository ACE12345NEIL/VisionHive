import asyncio, time
from pathlib import Path
import cv2
from backend.schemas import CameraFrameResult
from .preprocessing import preprocess, resize

latest_jpegs = {}

def cache_preview(camera_id, frame, tracks):
    preview=frame.copy()
    for track in tracks:
        box=track.bbox
        cv2.rectangle(preview,(int(box.x1),int(box.y1)),(int(box.x2),int(box.y2)),(70,230,180),2)
        cv2.putText(preview,f'#{track.id.split(":")[-1]} {track.activity.name.lower()}',(int(box.x1),max(18,int(box.y1)-6)),cv2.FONT_HERSHEY_SIMPLEX,.5,(70,230,180),2)
    ok, encoded=cv2.imencode('.jpg',preview,[cv2.IMWRITE_JPEG_QUALITY,75])
    if ok: latest_jpegs[camera_id]=encoded.tobytes()

class CameraWorker:
    def __init__(self,camera,settings,detector,tracker,motion,on_result,inference_lock):
        self.camera,self.settings,self.detector,self.tracker,self.motion,self.on_result,self.inference_lock=camera,settings,detector,tracker,motion,on_result,inference_lock; self.running=False
    async def run(self):
        if self.camera.source_type=='images':
            await self._run_images(); return
        source=int(self.camera.source) if self.camera.source_type=='webcam' else self.camera.source
        cap=cv2.VideoCapture(source); self.running=True; period=1/self.settings['target_fps']; last=0
        if not cap.isOpened(): return
        while self.running:
            ok,frame=cap.read()
            if not ok: break
            now=time.monotonic(); delay=period-(now-last)
            if delay>0: await asyncio.sleep(delay)
            last=time.monotonic(); frame=resize(frame,self.settings['width']); processed=preprocess(frame,self.settings['preprocessing'])
            detector_frame=cv2.cvtColor(processed,cv2.COLOR_GRAY2BGR) if processed.ndim==2 else processed
            async with self.inference_lock:
                detections=await asyncio.to_thread(self.detector.detect,detector_frame,self.camera.id)
            tracks=self.motion.analyze(detector_frame,self.tracker.update(detections))
            cache_preview(self.camera.id,detector_frame,tracks)
            await self.on_result(CameraFrameResult(camera_id=self.camera.id,fps=round(1/max(time.monotonic()-now,.001),1),frame_size=(frame.shape[1],frame.shape[0]),detections=detections,tracks=tracks))
            await asyncio.sleep(0)
        cap.release(); self.running=False
    async def _run_images(self):
        paths=sorted([p for p in Path(self.camera.source).iterdir() if p.suffix.lower() in {'.jpg','.jpeg','.png','.bmp'}])
        self.running=True
        for path in paths:
            if not self.running: break
            frame=cv2.imread(str(path))
            if frame is None: continue
            frame=resize(frame,self.settings['width']); processed=preprocess(frame,self.settings['preprocessing'])
            detector_frame=cv2.cvtColor(processed,cv2.COLOR_GRAY2BGR) if processed.ndim==2 else processed
            async with self.inference_lock:
                detections=await asyncio.to_thread(self.detector.detect,detector_frame,self.camera.id)
            tracks=self.motion.analyze(detector_frame,self.tracker.update(detections))
            cache_preview(self.camera.id,detector_frame,tracks)
            await self.on_result(CameraFrameResult(camera_id=self.camera.id,fps=self.settings['target_fps'],frame_size=(frame.shape[1],frame.shape[0]),detections=detections,tracks=tracks))
            await asyncio.sleep(1/self.settings['target_fps'])
        self.running=False
    def stop(self): self.running=False
