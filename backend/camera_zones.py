from __future__ import annotations
import json
from pathlib import Path

PATH=Path(__file__).resolve().parents[1]/'config/camera_zones.json'
VALID={'zone-1','zone-2','zone-3','zone-4',None}

def load_assignments():
    return json.loads(PATH.read_text()) if PATH.exists() else {}

def set_assignment(camera_id: str, zone_id: str | None):
    if zone_id not in VALID: raise ValueError('Unknown zone')
    values=load_assignments(); values[camera_id]=zone_id
    PATH.write_text(json.dumps(values,indent=2))
    return values
