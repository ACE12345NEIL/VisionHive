from backend.schemas import BoundingBox, Detection

class Detector:
    """Optional Ultralytics YOLO adapter. It never fabricates detections if disabled."""
    def __init__(self, enabled, model_name, confidence, allowed):
        self.confidence,self.allowed,self.model=confidence,set(allowed),None
        if enabled:
            try:
                from ultralytics import YOLO
                self.model=YOLO(model_name)
            except ImportError: raise RuntimeError('Detector enabled but Ultralytics is absent; run pip install ultralytics')
    def detect(self,frame,camera_id):
        if self.model is None: return []
        result=self.model(frame,conf=self.confidence,verbose=False)[0]; output=[]
        for box in result.boxes:
            name=result.names[int(box.cls[0])]
            if name not in self.allowed: continue
            x1,y1,x2,y2=map(float,box.xyxy[0].tolist()); bbox=BoundingBox(x1=x1,y1=y1,x2=x2,y2=y2)
            output.append(Detection(camera_id=camera_id,class_name=name,confidence=float(box.conf[0]),bbox=bbox,center=bbox.center))
        return output
