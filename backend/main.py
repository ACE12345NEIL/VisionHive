from __future__ import annotations
import asyncio, json, logging
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, WebSocket
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from backend.config import load_cameras, settings
from backend.database import initialize, save_event
from backend.realtime import manager
from backend.room import virtual_room
from backend.camera_zones import load_assignments, set_assignment
from vision.activity import MotionAnalyzer
from vision.camera import CameraWorker, latest_jpegs
from vision.detection import Detector
from vision.tracking import CentroidTracker
from vision.fusion import CameraFusion
from thermal.zones import ZoneStateManager
from environment.indoor import latest_from
from environment.weather import current_weather, location, set_location

logging.basicConfig(level=logging.INFO,format='%(asctime)s %(levelname)s %(name)s: %(message)s')
log=logging.getLogger('visionhive')
ROOT=Path(__file__).resolve().parents[1]
workers=[]
fusion_engine=CameraFusion()
zone_manager=ZoneStateManager()

async def publish(result):
    payload=result.model_dump(mode='json'); save_event(result.camera_id,'frame_summary',json.dumps(payload))
    fused=fusion_engine.update(result); zones=zone_manager.update(result,fused)
    await manager.broadcast({'type':'camera_frame_result','data':payload})
    await manager.broadcast({'type':'fusion_state','data':fused})
    await manager.broadcast({'type':'zone_state','data':zones})

@asynccontextmanager
async def lifespan(app):
    initialize(); detector=Detector(settings.detector['enabled'],settings.detector['model'],settings.detector['confidence'],settings.detector['classes'])
    inference_lock=asyncio.Lock()
    for camera in filter(lambda c:c.enabled,load_cameras()):
        worker=CameraWorker(camera,settings.processing,detector,CentroidTracker(**{'max_distance':settings.tracker['max_distance_px'],'max_missing':settings.tracker['max_missing_frames'],'trajectory_size':settings.tracker['trajectory_size']}),MotionAnalyzer(),publish,inference_lock)
        workers.append(worker); asyncio.create_task(worker.run())
    log.info('Started with %d enabled cameras',len(workers)); yield
    for worker in workers: worker.stop()

app=FastAPI(title='VisionHive',version='0.1.0',lifespan=lifespan)
app.mount('/frontend', StaticFiles(directory=ROOT/'frontend'), name='frontend')

@app.get('/')
def dashboard(): return FileResponse(ROOT/'frontend/index.html')
@app.get('/api/health')
def health(): return {'status':'ok','enabled_cameras':len(workers),'detector_enabled':settings.detector['enabled']}
@app.get('/api/room')
def room(): return virtual_room()
@app.get('/api/cameras')
def cameras(): return [c.model_dump() for c in load_cameras()]
@app.get('/api/fusion')
def fusion_state(): return fusion_engine.last_state
@app.get('/api/zones/state')
def zones_state(): return zone_manager.state
@app.get('/api/device-power')
def device_power(): return json.loads((ROOT/'config/device_power.json').read_text())
@app.get('/api/environment/indoor/{dataset_id}')
def indoor_environment(dataset_id: str):
    try:
        values=latest_from(dataset_id); zone_manager.set_environment(values); return values
    except (FileNotFoundError,ValueError) as exc: return Response(str(exc),status_code=404)
@app.get('/api/location')
def room_location(): return location()
@app.put('/api/location')
async def update_room_location(payload: dict):
    try: return await asyncio.to_thread(set_location,payload.get('query',''))
    except ValueError as exc: return Response(str(exc),status_code=400)
@app.get('/api/weather/current')
async def weather_current():
    try: return await asyncio.to_thread(current_weather)
    except ValueError as exc: return Response(str(exc),status_code=400)
@app.get('/api/camera-zones')
def camera_zones(): return load_assignments()
@app.put('/api/camera-zones/{camera_id}')
def set_camera_zone(camera_id: str, payload: dict):
    try: return set_assignment(camera_id,payload.get('zone_id'))
    except ValueError as exc: return Response(str(exc),status_code=400)
@app.get('/api/cameras/{camera_id}/frame.jpg')
def camera_frame(camera_id: str):
    image=latest_jpegs.get(camera_id)
    return Response(content=image,media_type='image/jpeg',headers={'Cache-Control':'no-store'}) if image else Response(status_code=204)
@app.get('/api/datasets')
def datasets(): return json.loads((ROOT/'config/dataset_registry.json').read_text())
@app.websocket('/ws/live')
async def live(ws:WebSocket):
    await manager.connect(ws); await ws.send_json({'type':'room','data':virtual_room().model_dump(mode='json')})
    try:
        while True: await ws.receive_text()
    except Exception: manager.disconnect(ws)
