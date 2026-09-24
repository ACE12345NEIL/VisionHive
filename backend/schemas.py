from __future__ import annotations
from datetime import datetime, timezone
from enum import IntEnum
from typing import Literal
from pydantic import BaseModel, Field

def utcnow() -> datetime: return datetime.now(timezone.utc)
class Point(BaseModel):
    x: float
    y: float
class BoundingBox(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float
    @property
    def center(self) -> Point: return Point(x=(self.x1+self.x2)/2,y=(self.y1+self.y2)/2)
class Zone(BaseModel):
    id: str
    name: str
    polygon: list[Point]
class Room(BaseModel):
    id: str
    name: str
    width_m: float
    height_m: float
    zones: list[Zone]
class Person(BaseModel):
    id: str
    camera_id: str
    position: Point
    velocity_px_s: Point = Field(default_factory=lambda: Point(x=0,y=0))
    trajectory: list[Point] = Field(default_factory=list)
    first_seen: datetime = Field(default_factory=utcnow)
    last_seen: datetime = Field(default_factory=utcnow)
class Device(BaseModel):
    id: str
    device_type: str
    position: Point|None=None
    estimated_power_w: float|None=None
    is_on: bool|None=None
class Light(BaseModel):
    id: str
    position: Point|None=None
    estimated_power_w: float|None=None
    is_on: bool=True
class Window(BaseModel): id: str; is_open: bool=False
class Door(BaseModel): id: str; is_open: bool=False
class HVAC(BaseModel): id: str='hvac-01'; is_on: bool=False; setpoint_c: float=24
class Environment(BaseModel):
    timestamp: datetime=Field(default_factory=utcnow)
    indoor_temperature: float|None=None
    indoor_humidity: float|None=None
    indoor_co2: float|None=None
    indoor_light: float|None=None
    occupancy: int|None=None
    source: Literal['observation','historical','simulated','prediction']='observation'
class Detection(BaseModel):
    camera_id: str
    class_name: str
    confidence: float
    bbox: BoundingBox
    center: Point
    timestamp: datetime=Field(default_factory=utcnow)
class ActivityLevel(IntEnum): STATIONARY=0; LOW=1; MEDIUM=2; HIGH=3
class Track(Person):
    activity: ActivityLevel=ActivityLevel.STATIONARY
    motion_score: float=0
    bbox: BoundingBox
class CameraFrameResult(BaseModel):
    camera_id: str
    timestamp: datetime=Field(default_factory=utcnow)
    fps: float=0
    frame_size: tuple[int,int]
    detections: list[Detection]=Field(default_factory=list)
    tracks: list[Track]=Field(default_factory=list)

class HVACConfigUpdate(BaseModel):
    system_type: str | None = None
    target_setpoint_c: float | None = None
    cooling_capacity_w: float | None = None
    max_airflow_cfm_per_vent: float | None = None
    supply_air_temp_c: float | None = None
    zone_vent_counts: dict[str, int] | None = None

