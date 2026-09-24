from __future__ import annotations
import cv2
import numpy as np
import logging
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger('visionhive.vision.homography')

# Default 4-point homography mappings from 960x540 camera pixel space to 8.0m x 6.0m metric room space
DEFAULT_CALIBRATIONS = {
    'camera-1': {
        'src_points': [[100, 100], [860, 100], [860, 480], [100, 480]],
        'dst_points': [[0.0, 0.0], [4.0, 0.0], [4.0, 3.0], [0.0, 3.0]]  # NW Zone 1
    },
    'camera-2': {
        'src_points': [[120, 80], [840, 80], [880, 500], [80, 500]],
        'dst_points': [[4.0, 0.0], [8.0, 0.0], [8.0, 3.0], [4.0, 3.0]]  # NE Zone 2
    },
    'camera-3': {
        'src_points': [[90, 90], [870, 90], [850, 490], [110, 490]],
        'dst_points': [[0.0, 3.0], [4.0, 3.0], [4.0, 6.0], [0.0, 6.0]]  # SW Zone 3
    },
    'camera-4': {
        'src_points': [[100, 100], [860, 100], [860, 480], [100, 480]],
        'dst_points': [[4.0, 3.0], [8.0, 3.0], [8.0, 6.0], [4.0, 6.0]]  # SE Zone 4
    }
}


class HomographyMapper:
    """
    3D/2D Spatial Transformation & Camera Homography Calibration Engine.
    Maps 2D pixel coordinates (u, v) from camera views to 2D/3D floorplan room coordinates (X_m, Y_m).
    """

    def __init__(self):
        self.matrices: Dict[str, np.ndarray] = {}
        self._initialize_default_matrices()

    def _initialize_default_matrices(self):
        for cam_id, config in DEFAULT_CALIBRATIONS.items():
            src = np.array(config['src_points'], dtype=np.float32)
            dst = np.array(config['dst_points'], dtype=np.float32)
            h_matrix, _ = cv2.findHomography(src, dst)
            if h_matrix is not None:
                self.matrices[cam_id] = h_matrix

    def set_calibration(self, camera_id: str, src_points: List[List[float]], dst_points: List[List[float]]) -> bool:
        """Sets custom 4-point homography calibration for a camera."""
        if len(src_points) < 4 or len(dst_points) < 4:
            return False
        src = np.array(src_points[:4], dtype=np.float32)
        dst = np.array(dst_points[:4], dtype=np.float32)
        h_matrix, _ = cv2.findHomography(src, dst)
        if h_matrix is not None:
            self.matrices[camera_id] = h_matrix
            return True
        return False

    def pixel_to_room(self, camera_id: str, px: float, py: float) -> Tuple[float, float]:
        """Transforms camera pixel coordinates (px, py) to room metric coordinates (x_m, y_m)."""
        matrix = self.matrices.get(camera_id)
        if matrix is None:
            # Linear scaling fallback if homography matrix not set for this camera
            return round((px / 960.0) * 8.0, 2), round((py / 540.0) * 6.0, 2)

        point = np.array([[[px, py]]], dtype=np.float32)
        transformed = cv2.perspectiveTransform(point, matrix)
        rx = float(transformed[0][0][0])
        ry = float(transformed[0][0][1])
        return round(rx, 2), round(ry, 2)

    def get_status(self) -> Dict[str, Any]:
        """Returns calibration status for all registered cameras."""
        return {
            'registered_cameras': list(self.matrices.keys()),
            'status': 'calibrated',
            'method': '4_point_planar_homography'
        }
