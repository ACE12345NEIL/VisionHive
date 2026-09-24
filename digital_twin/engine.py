"""
Stage 21 — Digital Twin Engine.
Generates comprehensive 2D/3D spatial room model representing real-time:
  - 3D physical room architecture (walls, zones, doors, windows, ceiling)
  - Interactive occupant markers with 3D positions, activity levels & metabolic heat plumes
  - Real-time spatial thermal heat map grid (interpolating zone temps, human metabolic heat, device loads, solar infiltration, and HVAC cooling plumes)
  - 2D/3D airflow vector field (velocity vectors emanating from active supply vents toward central return air intake)
  - HVAC vent states, valve opening %, CFM allocation, and supply air temperature
"""
from __future__ import annotations

import math
import logging
from typing import Any, Dict, List, Optional
from backend.room import virtual_room
from hvac.data import load_hvac_config

logger = logging.getLogger('visionhive.digital_twin')

# Default physical room dimensions
ROOM_WIDTH_M = 8.0
ROOM_LENGTH_M = 6.0
ROOM_HEIGHT_M = 3.0

# Physical coordinates for vents in 3D (x, y, z=2.8m ceiling)
ZONE_VENT_POSITIONS = {
    'zone-1': [{'id': 'vent-1-1', 'x': 1.5, 'y': 1.2, 'z': 2.8}, {'id': 'vent-1-2', 'x': 3.0, 'y': 2.0, 'z': 2.8}],
    'zone-2': [{'id': 'vent-2-1', 'x': 5.0, 'y': 1.2, 'z': 2.8}, {'id': 'vent-2-2', 'x': 6.5, 'y': 2.0, 'z': 2.8}],
    'zone-3': [{'id': 'vent-3-1', 'x': 1.5, 'y': 4.2, 'z': 2.8}, {'id': 'vent-3-2', 'x': 3.0, 'y': 5.0, 'z': 2.8}],
    'zone-4': [{'id': 'vent-4-1', 'x': 5.0, 'y': 4.2, 'z': 2.8}, {'id': 'vent-4-2', 'x': 6.5, 'y': 5.0, 'z': 2.8}],
}

# Central return air grille at ceiling
RETURN_AIR_GRILLE = {'id': 'return-grille-1', 'x': 4.0, 'y': 3.0, 'z': 3.0, 'size_m': 0.8}

# Physical architectural apertures
ARCHITECTURAL_ELEMENTS = {
    'windows': [
        {'id': 'win-1', 'zone_id': 'zone-1', 'wall': 'north', 'x1': 1.0, 'y1': 0.0, 'x2': 3.5, 'y2': 0.0, 'z_bottom': 1.0, 'z_top': 2.3, 'width_m': 2.5},
        {'id': 'win-2', 'zone_id': 'zone-2', 'wall': 'north', 'x1': 4.5, 'y1': 0.0, 'x2': 7.0, 'y2': 0.0, 'z_bottom': 1.0, 'z_top': 2.3, 'width_m': 2.5},
        {'id': 'win-3', 'zone_id': 'zone-3', 'wall': 'west',  'x1': 0.0, 'y1': 3.8, 'x2': 0.0, 'y2': 5.2, 'z_bottom': 1.0, 'z_top': 2.3, 'width_m': 1.4},
        {'id': 'win-4', 'zone_id': 'zone-4', 'wall': 'south', 'x1': 4.8, 'y1': 6.0, 'x2': 6.8, 'y2': 6.0, 'z_bottom': 1.0, 'z_top': 2.3, 'width_m': 2.0},
    ],
    'doors': [
        {'id': 'door-1', 'zone_id': 'zone-1', 'wall': 'west', 'x1': 0.0, 'y1': 1.0, 'x2': 0.0, 'y2': 2.0, 'z_bottom': 0.0, 'z_top': 2.1, 'width_m': 1.0},
        {'id': 'door-2', 'zone_id': 'zone-4', 'wall': 'east', 'x1': 8.0, 'y1': 4.2, 'x2': 8.0, 'y2': 5.2, 'z_bottom': 0.0, 'z_top': 2.1, 'width_m': 1.0},
    ],
    'workstations': [
        {'id': 'desk-1', 'zone_id': 'zone-1', 'x': 1.8, 'y': 1.6, 'width_m': 1.4, 'length_m': 0.8},
        {'id': 'desk-2', 'zone_id': 'zone-2', 'x': 5.8, 'y': 1.6, 'width_m': 1.4, 'length_m': 0.8},
        {'id': 'desk-3', 'zone_id': 'zone-3', 'x': 1.8, 'y': 4.4, 'width_m': 1.4, 'length_m': 0.8},
        {'id': 'desk-4', 'zone_id': 'zone-4', 'x': 5.8, 'y': 4.4, 'width_m': 1.4, 'length_m': 0.8},
    ]
}


def _apply_layout_overrides() -> None:
    """
    Load config/room_layout.json and patch ZONE_VENT_POSITIONS + ARCHITECTURAL_ELEMENTS
    with any saved drag-and-drop overrides. Called once at module import.
    """
    import json as _json
    import pathlib as _pathlib
    layout_path = _pathlib.Path(__file__).parent.parent / 'config' / 'room_layout.json'
    if not layout_path.exists():
        return
    try:
        layout = _json.loads(layout_path.read_text())
    except Exception:
        return

    # Patch vent positions
    vent_overrides = layout.get('vents', {})
    for zone_vents in ZONE_VENT_POSITIONS.values():
        for vent in zone_vents:
            if vent['id'] in vent_overrides:
                ov = vent_overrides[vent['id']]
                vent['x'] = ov.get('x', vent['x'])
                vent['y'] = ov.get('y', vent['y'])

    # Patch window positions
    win_overrides = layout.get('windows', {})
    for win in ARCHITECTURAL_ELEMENTS.get('windows', []):
        if win['id'] in win_overrides:
            ov = win_overrides[win['id']]
            for k in ('x1', 'y1', 'x2', 'y2'):
                if k in ov:
                    win[k] = ov[k]

    # Patch door positions
    door_overrides = layout.get('doors', {})
    for door in ARCHITECTURAL_ELEMENTS.get('doors', []):
        if door['id'] in door_overrides:
            ov = door_overrides[door['id']]
            for k in ('x1', 'y1', 'x2', 'y2'):
                if k in ov:
                    door[k] = ov[k]

    # Patch workstation positions
    desk_overrides = layout.get('workstations', {})
    for desk in ARCHITECTURAL_ELEMENTS.get('workstations', []):
        if desk['id'] in desk_overrides:
            ov = desk_overrides[desk['id']]
            desk['x'] = ov.get('x', desk['x'])
            desk['y'] = ov.get('y', desk['y'])


_apply_layout_overrides()



class DigitalTwinEngine:
    """
    Stage 21: Spatial Digital Twin Engine.
    Synthesizes physical room geometry, live occupant trajectories,
    thermal heat maps, and fluid airflow vector fields.
    """

    def __init__(self):
        self.width_m = ROOM_WIDTH_M
        self.length_m = ROOM_LENGTH_M
        self.height_m = ROOM_HEIGHT_M

    def compute_airflow_vector_field(
        self,
        vent_states: List[Dict[str, Any]],
        active_zone_ids: Optional[set] = None,
        nx: int = 12,
        ny: int = 9
    ) -> List[Dict[str, Any]]:
        """
        Computes 2D airflow velocity vectors across the room floor plan.
        Vectors model supply air discharge from active ceiling vents and suction
        towards the central return air grille only in active camera-assigned zones.
        """
        vectors = []
        rx = RETURN_AIR_GRILLE['x']
        ry = RETURN_AIR_GRILLE['y']

        xs = [self.width_m * (i + 0.5) / nx for i in range(nx)]
        ys = [self.length_m * (j + 0.5) / ny for j in range(ny)]

        for y in ys:
            for x in xs:
                zid = 'zone-1' if x < 4.0 and y < 3.0 else \
                      'zone-2' if x >= 4.0 and y < 3.0 else \
                      'zone-3' if x < 4.0 and y >= 3.0 else 'zone-4'

                if active_zone_ids and zid not in active_zone_ids:
                    continue

                vx = 0.0
                vy = 0.0

                # 1. Supply vent discharge flow
                for vent in vent_states:
                    cfm = vent.get('airflow_cfm', 0.0)
                    valve_pct = vent.get('valve_opening_pct', 0.0)
                    if valve_pct <= 0 or cfm <= 0:
                        continue

                    vx_vent = vent['x']
                    vy_vent = vent['y']
                    dx = x - vx_vent
                    dy = y - vy_vent
                    dist = math.hypot(dx, dy)
                    dist = max(dist, 0.4)  # prevent singularity

                    # Radial decay of jet velocity: v ~ cfm / dist^1.2
                    jet_speed = (cfm / 150.0) * 0.45 / (dist ** 1.1)
                    vx += (dx / dist) * jet_speed
                    vy += (dy / dist) * jet_speed

                # 2. Return air suction pull towards central grille
                dx_ret = rx - x
                dy_ret = ry - y
                dist_ret = math.hypot(dx_ret, dy_ret)
                dist_ret = max(dist_ret, 0.3)
                suction_speed = 0.15 / (dist_ret ** 0.8)
                vx += (dx_ret / dist_ret) * suction_speed
                vy += (dy_ret / dist_ret) * suction_speed

                speed = math.hypot(vx, vy)
                angle_deg = math.degrees(math.atan2(vy, vx)) % 360.0

                vectors.append({
                    'x': round(x, 2),
                    'y': round(y, 2),
                    'vx': round(vx, 3),
                    'vy': round(vy, 3),
                    'speed_mps': round(speed, 3),
                    'direction_deg': round(angle_deg, 1)
                })

        return vectors

    def compute_thermal_heatmap(
        self,
        zone_temps: Dict[str, float],
        occupants: List[Dict[str, Any]],
        vent_states: List[Dict[str, Any]],
        weather_info: Dict[str, Any],
        active_zone_ids: Optional[set] = None,
        nx: int = 16,
        ny: int = 12
    ) -> Dict[str, Any]:
        """
        Computes high-fidelity localized temperature distribution matrix across the room.
        Interpolates base zone temperatures, localized human metabolic heat plumes (+1°C),
        equipment heat, solar radiant warming, and HVAC cooling plumes only for active camera zones.
        """
        grid = []
        xs = [self.width_m * (i + 0.5) / nx for i in range(nx)]
        ys = [self.length_m * (j + 0.5) / ny for j in range(ny)]

        min_temp = 99.0
        max_temp = -99.0

        outdoor_temp = weather_info.get('outdoor_temperature', 25.0)
        solar_rad = weather_info.get('solar_radiation', 150.0)

        for y in ys:
            row = []
            for x in xs:
                # Determine baseline quadrant temperature
                zid = 'zone-1' if x < 4.0 and y < 3.0 else \
                      'zone-2' if x >= 4.0 and y < 3.0 else \
                      'zone-3' if x < 4.0 and y >= 3.0 else 'zone-4'

                if active_zone_ids and zid not in active_zone_ids:
                    row.append(None)
                    continue

                base_t = zone_temps.get(zid, 22.5)

                # Localized occupant metabolic heating plume (Gaussian decay ~0.8m)
                human_delta = 0.0
                for occ in occupants:
                    ox = occ.get('x', 2.0)
                    oy = occ.get('y', 2.0)
                    dist = math.hypot(x - ox, y - oy)
                    if dist < 1.6:
                        # Up to +1.2°C at occupant center
                        human_delta += 1.2 * math.exp(-(dist ** 2) / (2 * 0.5 ** 2))

                # Localized HVAC cooling plume under active vents
                cooling_delta = 0.0
                for vent in vent_states:
                    valve_pct = vent.get('valve_opening_pct', 0.0)
                    if valve_pct > 0:
                        vx = vent['x']
                        vy = vent['y']
                        dist_v = math.hypot(x - vx, y - vy)
                        if dist_v < 1.8:
                            # Cool down by up to 2.5°C directly below active vent
                            cooling_delta += (valve_pct / 100.0) * 2.2 * math.exp(-(dist_v ** 2) / (2 * 0.7 ** 2))

                # Exterior perimeter solar & wall conduction
                wall_delta = 0.0
                if y < 0.6 or y > 5.4 or x < 0.6 or x > 7.4:
                    wall_delta = (outdoor_temp - base_t) * 0.08 + (solar_rad / 800.0) * 0.4

                local_t = round(base_t + human_delta - cooling_delta + wall_delta, 2)
                row.append(local_t)
                min_temp = min(min_temp, local_t)
                max_temp = max(max_temp, local_t)

            grid.append(row)

        return {
            'nx': nx,
            'ny': ny,
            'min_temp_c': min_temp,
            'max_temp_c': max_temp,
            'grid': grid
        }

    def get_twin_state(
        self,
        zones_state: Dict[str, Any],
        hvac_state: Dict[str, Any],
        fusion_state: Optional[Dict[str, Any]] = None,
        weather_info: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Synthesizes the complete Digital Twin state snapshot.
        """
        weather_info = weather_info or {'outdoor_temperature': 25.0, 'solar_radiation': 150.0}
        hvac_cfg = load_hvac_config()
        supply_temp_c = float(hvac_cfg.get('supply_air_temp_c', 14.0))

        # 1. Build Zone State Lookup & active camera-assigned zones
        raw_zones = zones_state.get('zones', [])
        active_zone_ids = {z['zone_id'] for z in raw_zones} if raw_zones else set()
        if not active_zone_ids:
            from backend.camera_zones import load_assignments
            assignments = load_assignments()
            active_zone_ids = {z for z in assignments.values() if z}
        if not active_zone_ids:
            active_zone_ids = {'zone-1', 'zone-4'}

        zone_dict = {z['zone_id']: z for z in raw_zones}
        zone_temps = {
            f'zone-{i+1}': zone_dict.get(f'zone-{i+1}', {}).get('temperature_c', 22.0) or 22.0
            for i in range(4)
        }

        # 2. Extract Vent States from HVAC Control Engine ONLY for active zones
        hvac_recommendations = hvac_state.get('zone_recommendations', [])
        hvac_rec_map = {r['zone_id']: r for r in hvac_recommendations}

        vent_states = []
        for zid in active_zone_ids:
            vents = ZONE_VENT_POSITIONS.get(zid, [])
            rec = hvac_rec_map.get(zid, {})
            vent_details = rec.get('vent_details', [])
            valve_pct = float(rec.get('valve_opening_pct', 30.0))
            active_vents_count = rec.get('active_vents_count', len(vents))
            ac_state = rec.get('ac_state', 'ON')

            for idx, vent in enumerate(vents):
                # Retrieve individual vent CFM if available
                v_detail = vent_details[idx] if idx < len(vent_details) else {}
                cfm = v_detail.get('airflow_cfm', 75.0 if ac_state == 'ON' else 0.0)
                v_valve = v_detail.get('valve_opening_pct', valve_pct)

                vent_states.append({
                    'id': vent['id'],
                    'zone_id': zid,
                    'x': vent['x'],
                    'y': vent['y'],
                    'z': vent['z'],
                    'valve_opening_pct': round(v_valve, 1),
                    'airflow_cfm': round(cfm, 1),
                    'supply_air_temp_c': supply_temp_c,
                    'status': 'active' if ac_state == 'ON' and v_valve > 0 else 'idle'
                })

        # 3. Extract Real-Time Occupants with 3D Spatial Positions in active zones
        occupants = []
        fusion_people = (fusion_state or {}).get('people', [])
        if fusion_people:
            for idx, p in enumerate(fusion_people):
                pos = p.get('room_position_m')
                if pos:
                    x = max(0.4, min(self.width_m - 0.4, float(pos.get('x', 2.0))))
                    y = max(0.4, min(self.length_m - 0.4, float(pos.get('y', 2.0))))
                else:
                    # Place in default active zone quadrants
                    quad_x = [2.0, 6.0, 2.0, 6.0]
                    quad_y = [1.5, 1.5, 4.5, 4.5]
                    x = quad_x[idx % 4]
                    y = quad_y[idx % 4]

                zid = 'zone-1' if x < 4.0 and y < 3.0 else \
                      'zone-2' if x >= 4.0 and y < 3.0 else \
                      'zone-3' if x < 4.0 and y >= 3.0 else 'zone-4'

                if zid in active_zone_ids:
                    occupants.append({
                        'id': p.get('id', f'occ-{idx+1}'),
                        'x': round(x, 2),
                        'y': round(y, 2),
                        'z': 0.0,
                        'height_m': 1.75,
                        'zone_id': zid,
                        'activity': 'medium' if idx % 2 == 0 else 'low',
                        'metabolic_watts': 140.0 if idx % 2 == 0 else 100.0,
                        'cameras': p.get('camera_ids', [])
                    })
        else:
            # Check if zones have people count and create representative markers
            for z in raw_zones:
                zid = z['zone_id']
                if zid not in active_zone_ids:
                    continue
                p_cnt = z.get('people_count', 0)
                center_map = {
                    'zone-1': (2.0, 1.5),
                    'zone-2': (6.0, 1.5),
                    'zone-3': (2.0, 4.5),
                    'zone-4': (6.0, 4.5),
                }
                cx, cy = center_map.get(zid, (2.0, 1.5))
                for i in range(p_cnt):
                    ox = cx + (i * 0.7 - 0.35)
                    oy = cy + (i * 0.4 - 0.2)
                    occupants.append({
                        'id': f'occupant-z{zid[-1]}-{i+1}',
                        'x': round(ox, 2),
                        'y': round(oy, 2),
                        'z': 0.0,
                        'height_m': 1.75,
                        'zone_id': zid,
                        'activity': 'low',
                        'metabolic_watts': 100.0,
                        'cameras': []
                    })

        # 4. Compute Thermal Heatmap Matrix ONLY for active zones
        thermal_heatmap = self.compute_thermal_heatmap(
            zone_temps=zone_temps,
            occupants=occupants,
            vent_states=vent_states,
            weather_info=weather_info,
            active_zone_ids=active_zone_ids
        )

        # 5. Compute Airflow Vector Field ONLY for active zones
        airflow_vectors = self.compute_airflow_vector_field(
            vent_states=vent_states,
            active_zone_ids=active_zone_ids
        )

        # 6. Quadrant Geometry & Metadata
        all_quadrants = [
            {'id': 'zone-1', 'name': 'North West', 'bounds': {'x_min': 0.0, 'x_max': 4.0, 'y_min': 0.0, 'y_max': 3.0}, 'center': {'x': 2.0, 'y': 1.5, 'z': 1.5}},
            {'id': 'zone-2', 'name': 'North East', 'bounds': {'x_min': 4.0, 'x_max': 8.0, 'y_min': 0.0, 'y_max': 3.0}, 'center': {'x': 6.0, 'y': 1.5, 'z': 1.5}},
            {'id': 'zone-3', 'name': 'South West', 'bounds': {'x_min': 0.0, 'x_max': 4.0, 'y_min': 3.0, 'y_max': 6.0}, 'center': {'x': 2.0, 'y': 4.5, 'z': 1.5}},
            {'id': 'zone-4', 'name': 'South East', 'bounds': {'x_min': 4.0, 'x_max': 8.0, 'y_min': 3.0, 'y_max': 6.0}, 'center': {'x': 6.0, 'y': 4.5, 'z': 1.5}},
        ]
        zones_metadata = []
        for q in all_quadrants:
            zid = q['id']
            is_active = zid in active_zone_ids
            zones_metadata.append({
                'id': zid,
                'name': q['name'],
                'bounds': q['bounds'],
                'center': q['center'],
                'is_active': is_active,
                'status': 'monitored' if is_active else 'unmonitored',
                'temperature_c': zone_temps.get(zid, 22.0) if is_active else None,
                'target_setpoint_c': float(hvac_rec_map.get(zid, {}).get('target_setpoint_c', 22.0)) if is_active else None,
                'valve_opening_pct': float(hvac_rec_map.get(zid, {}).get('valve_opening_pct', 30.0)) if is_active else 0.0,
                'total_heat_load_w': float(hvac_rec_map.get(zid, {}).get('total_heat_load_w', 350.0)) if is_active else 0.0,
                'people_count': len([o for o in occupants if o['zone_id'] == zid]) if is_active else 0
            })

        return {
            'dimensions_m': {
                'width': self.width_m,
                'length': self.length_m,
                'height': self.height_m
            },
            'active_zone_ids': sorted(list(active_zone_ids)),
            'zones': zones_metadata,
            'occupants': occupants,
            'vents': vent_states,
            'return_grille': RETURN_AIR_GRILLE,
            'architecture': ARCHITECTURAL_ELEMENTS,
            'thermal_heatmap': thermal_heatmap,
            'airflow_vectors': airflow_vectors,
            'system_status': {
                'ac_state': hvac_state.get('system_status', {}).get('ac_state', 'ON'),
                'total_airflow_cfm': hvac_state.get('system_status', {}).get('total_airflow_cfm', 600.0),
                'total_hvac_power_w': hvac_state.get('system_status', {}).get('total_power_w', 2100.0),
                'stage_21_complete': True
            }
        }


# Global singleton instance
digital_twin_engine = DigitalTwinEngine()
