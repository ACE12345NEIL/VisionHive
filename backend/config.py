from __future__ import annotations
import json
from pathlib import Path
from pydantic import BaseModel
ROOT = Path(__file__).resolve().parents[1]
class CameraConfig(BaseModel):
    id: str; name: str; source_type: str = "video"; source: str; enabled: bool = True
class Settings(BaseModel):
    room: dict; processing: dict; detector: dict; tracker: dict
def load_settings() -> Settings: return Settings.model_validate(json.loads((ROOT / "config/settings.json").read_text()))
def load_cameras() -> list[CameraConfig]:
    path = ROOT / "config/cameras.json"
    return [] if not path.exists() else [CameraConfig.model_validate(x) for x in json.loads(path.read_text())]
settings = load_settings()
