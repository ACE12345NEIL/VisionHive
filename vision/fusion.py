from __future__ import annotations
import json
from datetime import datetime, timezone
from itertools import combinations
from math import hypot
from pathlib import Path
import cv2
import numpy as np
from backend.schemas import CameraFrameResult, Point, Track

ROOT=Path(__file__).resolve().parents[1]

class CameraFusion:
    """Conservative cross-camera identity fusion. No configured overlap means no merging."""
    def __init__(self):
        self.latest={}; self.last_state={'people_count':0,'people':[],'mode':'unconfigured'}
    def _config(self): return json.loads((ROOT/'config/camera_fusion.json').read_text())
    @staticmethod
    def _normalised(track: Track, size): return Point(x=track.position.x/size[0],y=track.position.y/size[1])
    @staticmethod
    def _project(track, matrix):
        point=np.array([[[track.position.x,track.position.y]]],dtype=np.float32)
        x,y=cv2.perspectiveTransform(point,np.array(matrix,dtype=np.float32))[0][0]
        return Point(x=float(x),y=float(y))
    def update(self,result: CameraFrameResult):
        self.latest[result.camera_id]=result
        now=datetime.now(timezone.utc); active=[]
        for camera,frame in self.latest.items():
            if (now-frame.timestamp).total_seconds()<=2: active += [(camera,track,frame.frame_size) for track in frame.tracks]
        parent=list(range(len(active)))
        def find(i):
            while parent[i]!=i: parent[i]=parent[parent[i]]; i=parent[i]
            return i
        def union(i,j):
            a,b=find(i),find(j)
            if a!=b: parent[b]=a
        config=self._config(); overlap={frozenset(x['cameras']):x for x in config.get('overlaps',[])}; homographies=config.get('homographies',{})
        methods=[]
        for i,j in combinations(range(len(active)),2):
            ca,ta,sa=active[i]; cb,tb,sb=active[j]
            rule=overlap.get(frozenset((ca,cb)))
            if not rule: continue
            if abs((ta.last_seen-tb.last_seen).total_seconds())>rule.get('max_time_difference_s',1.5): continue
            ha=ta.bbox.y2-ta.bbox.y1; hb=tb.bbox.y2-tb.bbox.y1
            if max(ha,hb)/max(min(ha,hb),1)>rule.get('max_height_ratio',1.4): continue
            if ca in homographies and cb in homographies:
                pa,pb=self._project(ta,homographies[ca]),self._project(tb,homographies[cb]); distance=hypot(pa.x-pb.x,pa.y-pb.y); threshold=rule.get('max_position_distance_m',0.8); method='homography'
            else:
                pa,pb=self._normalised(ta,sa),self._normalised(tb,sb); distance=hypot(pa.x-pb.x,pa.y-pb.y); threshold=rule.get('max_position_distance_normalized',0.12); method='normalised_overlap'
            if distance<=threshold: union(i,j); methods.append(method)
        groups={}
        for i,item in enumerate(active): groups.setdefault(find(i),[]).append(item)
        people=[]
        for members in groups.values():
            source_ids=sorted(t.id for _,t,_ in members); calibrated=[self._project(t,homographies[c]) for c,t,_ in members if c in homographies]
            position=Point(x=sum(p.x for p in calibrated)/len(calibrated),y=sum(p.y for p in calibrated)/len(calibrated)) if calibrated else None
            people.append({'id':'fused-'+('-'.join(source_ids)).replace(':','-'),'source_track_ids':source_ids,'camera_ids':sorted(c for c,_,_ in members),'room_position_m':position.model_dump() if position else None,'fusion_status':'merged' if len(members)>1 else 'single_camera'})
        self.last_state={'people_count':len(people),'people':people,'mode':'homography' if 'homography' in methods else 'normalised_overlap' if methods else 'unconfigured' if not overlap else 'no_matches'}
        return self.last_state
