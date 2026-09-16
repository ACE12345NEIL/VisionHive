from __future__ import annotations
import json
from pathlib import Path
from backend.camera_zones import load_assignments
from backend.room import virtual_room

ROOT=Path(__file__).resolve().parents[1]

class ZoneStateManager:
    """Maps observations into zone state. Camera coverage assignments are an explicit fallback."""
    def __init__(self): self.latest={}; self.environment={}; self.state={'zones':[],'assignment_method':'camera_coverage'}
    def set_environment(self, environment): self.environment=environment
    def _assets(self): return json.loads((ROOT/'config/device_power.json').read_text())
    @staticmethod
    def _zone_at(point, room):
        for zone in room.zones:
            xs=[p.x for p in zone.polygon]; ys=[p.y for p in zone.polygon]
            if min(xs)<=point['x']<=max(xs) and min(ys)<=point['y']<=max(ys): return zone.id
        return None
    def update(self, frame_result, fusion_state):
        self.latest[frame_result.camera_id]=frame_result
        room=virtual_room(); assets=self._assets(); assignments=load_assignments(); powers=assets['power_assumptions_w']; mapping=assets['class_to_device_type']
        zones={zone.id:{'zone_id':zone.id,'name':zone.name,'people_count':0,'person_ids':[],'activity_levels':{'stationary':0,'low':0,'medium':0,'high':0},'device_counts':{},'device_load_w':0.0,'light_count':0,'lighting_load_w':0.0,'temperature_c':self.environment.get('indoor_temperature'),'humidity_pct':self.environment.get('indoor_humidity')} for zone in room.zones}
        for person in fusion_state['people']:
            zone_id=self._zone_at(person['room_position_m'],room) if person['room_position_m'] else None
            if not zone_id:
                covered={assignments.get(camera) for camera in person['camera_ids']} - {None}
                zone_id=covered.pop() if len(covered)==1 else None
            if zone_id:
                zone=zones[zone_id]; zone['people_count']+=1; zone['person_ids'].append(person['id'])
                for camera_id,track_id in zip(person['camera_ids'],person['source_track_ids']):
                    camera=self.latest.get(camera_id)
                    track=next((t for t in camera.tracks if t.id==track_id),None) if camera else None
                    if track: zone['activity_levels'][track.activity.name.lower()]+=1; break
        for camera_id,frame in self.latest.items():
            zone_id=assignments.get(camera_id)
            if not zone_id: continue
            zone=zones[zone_id]
            for detection in frame.detections:
                device_type=mapping.get(detection.class_name)
                if not device_type: continue
                zone['device_counts'][device_type]=zone['device_counts'].get(device_type,0)+1
                zone['device_load_w']+=powers.get(device_type,0)
        for device in assets.get('manual_devices',[]):
            if device.get('is_on') and device.get('zone_id') in zones:
                zone=zones[device['zone_id']]; kind=device['device_type']; zone['device_counts'][kind]=zone['device_counts'].get(kind,0)+1; zone['device_load_w']+=device.get('power_w',powers.get(kind,0))
        for light in assets.get('lights',[]):
            if light.get('is_on') and light.get('zone_id') in zones:
                zone=zones[light['zone_id']]; zone['light_count']+=1; zone['lighting_load_w']+=light.get('power_w',powers['light'])
        for zone in zones.values(): zone['device_load_w']=round(zone['device_load_w'],1); zone['lighting_load_w']=round(zone['lighting_load_w'],1)
        self.state={'zones':list(zones.values()),'assignment_method':'homography_or_camera_coverage','power_assumptions_note':assets['notes']}
        return self.state
