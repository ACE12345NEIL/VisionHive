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
from backend.schemas import HVACConfigUpdate
from vision.activity import MotionAnalyzer
from vision.camera import CameraWorker, latest_jpegs
from vision.detection import Detector
from vision.tracking import CentroidTracker
from vision.fusion import CameraFusion
from vision.analytics import profiler
from thermal.zones import ZoneStateManager
from thermal.heat_load import calculate_all_zones_heat_load
from thermal.response import predict_zone_trajectories
from environment.indoor import latest_from
from environment.weather import current_weather, location, set_location
from hvac.data import get_hvac_dataset_stats, load_hvac_config, save_hvac_config
from hvac.control_engine import HVACControlEngine
from ml.thermal_model import train_thermal_models
from ml.energy_model import train_energy_model
from simulation.engine import run_simulation
from digital_twin.engine import digital_twin_engine

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(name)s: %(message)s')
log = logging.getLogger('visionhive')
ROOT = Path(__file__).resolve().parents[1]
workers = []
fusion_engine = CameraFusion()
zone_manager = ZoneStateManager()
hvac_engine = HVACControlEngine()


async def publish(result):
    payload = result.model_dump(mode='json')
    save_event(result.camera_id, 'frame_summary', json.dumps(payload))
    fused = fusion_engine.update(result)
    zones = zone_manager.update(result, fused)
    
    # Run HVAC evaluation
    try:
        weather_info = current_weather()
    except Exception:
        weather_info = {"outdoor_temperature": 25.0, "solar_radiation": 150.0}

    hvac_state = hvac_engine.evaluate_control(zones, weather_info)
    twin_state = digital_twin_engine.get_twin_state(zones, hvac_state, fused, weather_info)

    await manager.broadcast({'type': 'camera_frame_result', 'data': payload})
    await manager.broadcast({'type': 'fusion_state', 'data': fused})
    await manager.broadcast({'type': 'zone_state', 'data': zones})
    await manager.broadcast({'type': 'hvac_control_state', 'data': hvac_state})
    await manager.broadcast({'type': 'digital_twin_state', 'data': twin_state})


@asynccontextmanager
async def lifespan(app):
    initialize()
    detector = Detector(settings.detector['enabled'], settings.detector['model'], settings.detector['confidence'], settings.detector['classes'])
    inference_lock = asyncio.Lock()
    for camera in filter(lambda c: c.enabled, load_cameras()):
        worker = CameraWorker(camera, settings.processing, detector, CentroidTracker(**{'max_distance': settings.tracker['max_distance_px'], 'max_missing': settings.tracker['max_missing_frames'], 'trajectory_size': settings.tracker['trajectory_size']}), MotionAnalyzer(), publish, inference_lock)
        workers.append(worker)
        asyncio.create_task(worker.run())
    log.info('Started with %d enabled cameras', len(workers))
    yield
    for worker in workers:
        worker.stop()


app = FastAPI(title='VisionHive', version='0.1.0', lifespan=lifespan)
app.mount('/frontend', StaticFiles(directory=ROOT / 'frontend'), name='frontend')


@app.get('/')
def dashboard():
    return FileResponse(ROOT / 'frontend/index.html')

@app.get('/api/health')
def health():
    return {'status': 'ok', 'enabled_cameras': len(workers), 'detector_enabled': settings.detector['enabled']}

@app.get('/api/vision/performance')
def vision_performance():
    """Stage 19: Return vision pipeline performance metrics."""
    return profiler.get_metrics()

@app.post('/api/simulation/run')
async def run_simulation_api(payload: dict):
    """Stage 20: Fast-forward simulation. POST JSON body to configure scenario.
    Only simulates zones assigned to active cameras (same as Digital Twin & CCTV views).
    """
    from backend.camera_zones import load_assignments
    assignments = load_assignments()
    active_zone_ids = sorted({z for z in assignments.values() if z}) or None

    result = await asyncio.to_thread(
        run_simulation,
        hours=int(payload.get('hours', 24)),
        dt_seconds=float(payload.get('dt_seconds', 60.0)),
        initial_temps=payload.get('initial_temps'),
        occupancy_schedule=payload.get('occupancy_schedule'),
        device_loads_w=payload.get('device_loads_w'),
        lighting_loads_w=payload.get('lighting_loads_w'),
        outdoor_temp_min=float(payload.get('outdoor_temp_min', 22.0)),
        outdoor_temp_max=float(payload.get('outdoor_temp_max', 35.0)),
        peak_solar_w_m2=float(payload.get('peak_solar_w_m2', 600.0)),
        hvac_setpoint_c=float(payload.get('hvac_setpoint_c', 22.0)),
        ac_enabled=bool(payload.get('ac_enabled', True)),
        window_open_zones=payload.get('window_open_zones', []),
        activity_level=str(payload.get('activity_level', 'low')),
        active_zone_ids=active_zone_ids,
    )
    return result
 
@app.get('/api/digital-twin/state')
def get_digital_twin_state():
    """Stage 21: Returns real-time 2D/3D spatial Digital Twin model."""
    try:
        weather_info = current_weather()
    except Exception:
        weather_info = {"outdoor_temperature": 25.0, "solar_radiation": 150.0}
    hvac_state = hvac_engine.evaluate_control(zone_manager.state, weather_info)
    return digital_twin_engine.get_twin_state(
        zone_manager.state,
        hvac_state,
        fusion_engine.last_state,
        weather_info
    )

_LAYOUT_PATH = ROOT / 'config' / 'room_layout.json'

@app.get('/api/digital-twin/layout')
def get_layout():
    """Return current room element layout (positions in metres)."""
    try:
        return json.loads(_LAYOUT_PATH.read_text())
    except Exception:
        return {}

@app.post('/api/digital-twin/layout')
async def save_layout(payload: dict):
    """Save drag-and-drop room layout overrides to config/room_layout.json."""
    try:
        existing = json.loads(_LAYOUT_PATH.read_text()) if _LAYOUT_PATH.exists() else {}
        existing.update(payload)
        _LAYOUT_PATH.write_text(json.dumps(existing, indent=2))
        return {'saved': True}
    except Exception as exc:
        return {'saved': False, 'error': str(exc)}

@app.get('/api/room')
def room():
    return virtual_room()

@app.get('/api/cameras')
def cameras():
    return [c.model_dump() for c in load_cameras()]

@app.get('/api/fusion')
def fusion_state():
    return fusion_engine.last_state

@app.get('/api/zones/state')
def zones_state():
    return zone_manager.state

@app.get('/api/device-power')
def device_power():
    return json.loads((ROOT / 'config/device_power.json').read_text())

@app.get('/api/environment/indoor/{dataset_id}')
def indoor_environment(dataset_id: str):
    try:
        values = latest_from(dataset_id)
        zone_manager.set_environment(values)
        return values
    except (FileNotFoundError, ValueError) as exc:
        return Response(str(exc), status_code=404)

@app.get('/api/location')
def room_location():
    return location()

@app.put('/api/location')
async def update_room_location(payload: dict):
    try:
        return await asyncio.to_thread(set_location, payload.get('query', ''))
    except ValueError as exc:
        return Response(str(exc), status_code=400)

@app.get('/api/weather/current')
async def weather_current():
    try:
        return await asyncio.to_thread(current_weather)
    except ValueError as exc:
        return Response(str(exc), status_code=400)

@app.get('/api/camera-zones')
def camera_zones():
    return load_assignments()

@app.put('/api/camera-zones/{camera_id}')
def set_camera_zone(camera_id: str, payload: dict):
    try:
        return set_assignment(camera_id, payload.get('zone_id'))
    except ValueError as exc:
        return Response(str(exc), status_code=400)

@app.get('/api/cameras/{camera_id}/frame.jpg')
def camera_frame(camera_id: str):
    image = latest_jpegs.get(camera_id)
    return Response(content=image, media_type='image/jpeg', headers={'Cache-Control': 'no-store'}) if image else Response(status_code=204)

@app.get('/api/datasets')
def datasets():
    return json.loads((ROOT / 'config/dataset_registry.json').read_text())

# STAGES 11 - 17 HVAC ENDPOINTS
@app.get('/api/hvac/config')
def get_hvac_config_api():
    """Stage 11/17: Returns current HVAC specifications and vent count settings."""
    return load_hvac_config()

@app.put('/api/hvac/config')
def update_hvac_config_api(payload: HVACConfigUpdate):
    """Stage 11/17: Updates HVAC specifications and vent counts per zone."""
    data = payload.model_dump(exclude_unset=True)
    updated = save_hvac_config(data)
    hvac_engine.update_config(updated)
    return updated

@app.get('/api/hvac/data-summary')
def hvac_dataset_summary():
    """Stage 11: Returns summary statistics of the raw HVAC dataset."""
    return get_hvac_dataset_stats()

@app.get('/api/hvac/heat-load')
def get_heat_load_api():
    """Stage 12: Transparent zone-level heat-load calculation."""
    try:
        weather_info = current_weather()
    except Exception:
        weather_info = {"outdoor_temperature": 25.0, "solar_radiation": 150.0}
    return calculate_all_zones_heat_load(zone_manager.state, weather_info)

@app.get('/api/hvac/thermal-response')
def get_thermal_response_api():
    """Stage 13: Physics-inspired thermal response simulation."""
    heat_loads = get_heat_load_api()['zones_heat_load']
    return predict_zone_trajectories(heat_loads, load_hvac_config())

@app.post('/api/hvac/train-models')
def train_hvac_models_api():
    """Stage 15 & 16: Trains ML models for temperature & energy prediction."""
    thermal_eval = train_thermal_models()
    energy_eval = train_energy_model()
    return {
        "status": "success",
        "thermal_evaluation": thermal_eval,
        "energy_evaluation": energy_eval
    }

@app.get('/api/hvac/control')
def get_hvac_control_api():
    """Stage 17: HVAC control decisions and per-vent valve opening calculations."""
    try:
        weather_info = current_weather()
    except Exception:
        weather_info = {"outdoor_temperature": 25.0, "solar_radiation": 150.0}
    return hvac_engine.evaluate_control(zone_manager.state, weather_info)

@app.websocket('/ws/live')
async def live(ws: WebSocket):
    await manager.connect(ws)
    await ws.send_json({'type': 'room', 'data': virtual_room().model_dump(mode='json')})
    try:
        while True:
            await ws.receive_text()
    except Exception:
        manager.disconnect(ws)
