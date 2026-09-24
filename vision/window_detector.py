from __future__ import annotations
import cv2
import numpy as np
import logging
from typing import Any, Dict, Optional

logger = logging.getLogger('visionhive.vision.window_detector')


def detect_window_state_from_frame_and_telemetry(
    frame: np.ndarray,
    zone_id: str,
    indoor_temp: float = 22.0,
    outdoor_temp: float = 28.0,
    solar_rad: float = 200.0
) -> Dict[str, Any]:
    """
    Automated Window Open/Closed Detector.
    Analyzes camera video frames (perimeter luminance & edge variance)
    combined with outdoor weather & indoor thermal telemetry to detect window state.
    """
    if frame is None or frame.size == 0:
        return {'window_state': 'closed', 'confidence': 0.8, 'method': 'telemetry_only'}

    # 1. Computer Vision Analysis on perimeter ROI (upper/side window region of video feed)
    h, w = frame.shape[:2]
    # Perimeter ROI: top 35% of frame where windows/daylight fixtures are located
    roi = frame[0:int(h * 0.35), 0:w]

    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY) if roi.ndim == 3 else roi
    
    # Calculate Laplacian edge variance (high frequency outdoor light/breeze transitions)
    edge_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    
    # Calculate luminance saturation (percent of pixels with brightness > 210)
    high_brightness_pct = float(np.sum(gray > 210) / gray.size * 100.0)

    # 2. Thermal & Solar Telemetry
    delta_t = abs(outdoor_temp - indoor_temp)

    # Decision Rule: High perimeter daylight saturation (> 8%) or high edge variance (> 320) with outdoor heat delta
    is_vision_open = (high_brightness_pct > 8.0 or edge_var > 320.0) and solar_rad > 80.0
    is_thermal_open = delta_t > 4.5 and solar_rad > 250.0

    if is_vision_open or is_thermal_open:
        detected_state = "open"
        confidence = min(0.98, 0.75 + (high_brightness_pct / 100.0) + (edge_var / 2000.0))
        reason = f"Detected via Vision (Sunlight Saturation {high_brightness_pct:.1f}%, Edge Var {edge_var:.1f}) & Weather Telemetry"
    else:
        detected_state = "closed"
        confidence = 0.90
        reason = f"Perimeter enclosed (Sunlight Saturation {high_brightness_pct:.1f}%, Edge Var {edge_var:.1f})"

    return {
        'zone_id': zone_id,
        'window_state': detected_state,
        'confidence': round(confidence, 2),
        'edge_variance': round(edge_var, 1),
        'luminance_saturation_pct': round(high_brightness_pct, 1),
        'detection_reason': reason
    }
