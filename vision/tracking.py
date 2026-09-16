from dataclasses import dataclass, field
from datetime import datetime, timezone
from math import hypot
from backend.schemas import BoundingBox, Detection, Point, Track

@dataclass
class State:
    track_id:int; center:Point; bbox:BoundingBox; first_seen:datetime; last_seen:datetime
    trajectory:list[Point]=field(default_factory=list); missed:int=0

class CentroidTracker:
    """Per-camera deterministic tracker; the adapter point for ByteTrack/BoT-SORT."""
    def __init__(self,max_distance=100,max_missing=20,trajectory_size=40):
        self.max_distance,self.max_missing,self.trajectory_size=max_distance,max_missing,trajectory_size; self.next_id=1; self.states={}
    def update(self,detections):
        people=[d for d in detections if d.class_name=='person']; now=datetime.now(timezone.utc); unmatched=set(range(len(people)))
        for state in self.states.values():
            idx=min(unmatched,key=lambda i:hypot(state.center.x-people[i].center.x,state.center.y-people[i].center.y),default=None)
            if idx is not None and hypot(state.center.x-people[idx].center.x,state.center.y-people[idx].center.y)<=self.max_distance:
                d=people[idx]; state.center,state.bbox,state.last_seen,state.missed=d.center,d.bbox,now,0; state.trajectory=(state.trajectory+[d.center])[-self.trajectory_size:]; unmatched.remove(idx)
            else: state.missed+=1
        self.states={k:v for k,v in self.states.items() if v.missed<=self.max_missing}
        for idx in unmatched:
            d=people[idx]; self.states[self.next_id]=State(self.next_id,d.center,d.bbox,now,now,[d.center]); self.next_id+=1
        camera_id=people[0].camera_id if people else ''
        return [Track(id=f'{camera_id}:{s.track_id}',camera_id=camera_id,position=s.center,bbox=s.bbox,trajectory=s.trajectory,first_seen=s.first_seen,last_seen=s.last_seen) for s in self.states.values() if not s.missed]
