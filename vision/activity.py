import cv2
import numpy as np
from backend.schemas import ActivityLevel

class MotionAnalyzer:
    def __init__(self): self.previous_gray=None
    def analyze(self,frame,tracks):
        gray=cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY); flow_score=0.0
        if self.previous_gray is not None:
            flow=cv2.calcOpticalFlowFarneback(self.previous_gray,gray,None,.5,3,15,3,5,1.2,0)
            flow_score=float(np.mean(cv2.magnitude(flow[...,0],flow[...,1])))
        self.previous_gray=gray
        for t in tracks:
            displacement=0 if len(t.trajectory)<2 else float(np.hypot(t.trajectory[-1].x-t.trajectory[-2].x,t.trajectory[-1].y-t.trajectory[-2].y))
            score=displacement+min(flow_score*4,12); t.motion_score=round(score,2)
            t.activity=ActivityLevel.HIGH if score>=18 else ActivityLevel.MEDIUM if score>=8 else ActivityLevel.LOW if score>=2 else ActivityLevel.STATIONARY
        return tracks
