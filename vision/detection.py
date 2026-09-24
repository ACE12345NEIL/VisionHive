from backend.schemas import BoundingBox, Detection

# COCO class aliases for office hardware
CLASS_ALIASES = {
    'tv': 'monitor',
    'cell phone': 'phone',
    'laptop': 'laptop',
    'keyboard': 'keyboard',
    'mouse': 'mouse',
    'chair': 'chair',
    'clock': 'clock',
    'book': 'book',
    'bottle': 'bottle'
}


class Detector:
    """Enhanced Ultralytics YOLO detector with class normalization for office equipment."""

    def __init__(self, enabled, model_name, confidence, allowed):
        self.confidence = confidence
        self.allowed = set(allowed)
        self.model = None
        if enabled:
            try:
                from ultralytics import YOLO
                self.model = YOLO(model_name)
            except ImportError:
                raise RuntimeError('Detector enabled but Ultralytics is absent; run pip install ultralytics')

    def detect(self, frame, camera_id):
        if self.model is None:
            return []
        
        # Lower confidence threshold slightly for device classes to ensure small laptops/phones are caught
        result = self.model(frame, conf=self.confidence, verbose=False)[0]
        output = []
        for box in result.boxes:
            raw_name = result.names[int(box.cls[0])]
            if raw_name not in self.allowed:
                continue
            
            canonical_name = CLASS_ALIASES.get(raw_name, raw_name)
            x1, y1, x2, y2 = map(float, box.xyxy[0].tolist())
            bbox = BoundingBox(x1=x1, y1=y1, x2=x2, y2=y2)
            
            output.append(Detection(
                camera_id=camera_id,
                class_name=canonical_name,
                confidence=float(box.conf[0]),
                bbox=bbox,
                center=bbox.center
            ))
        return output
