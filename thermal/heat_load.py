from __future__ import annotations
from typing import Any, Dict, List, Optional
import logging

logger = logging.getLogger('visionhive.thermal.heat_load')

# Standard human activity metabolic rates (Watts)
HUMAN_METABOLIC_WATTS = {
    'stationary': 75.0,
    'low': 100.0,
    'medium': 140.0,
    'high': 180.0
}

# Thermal parameters per zone (default assumptions for 4 virtual quadrants)
ZONE_PHYSICAL_SPECS = {
    'zone-1': {'wall_area_m2': 12.0, 'window_area_m2': 2.5, 'has_door': True},   # North West
    'zone-2': {'wall_area_m2': 12.0, 'window_area_m2': 2.5, 'has_door': False},  # North East
    'zone-3': {'wall_area_m2': 12.0, 'window_area_m2': 1.5, 'has_door': False},  # South West
    'zone-4': {'wall_area_m2': 12.0, 'window_area_m2': 1.5, 'has_door': True}    # South East
}

U_VALUE_WALL = 0.45      # W/m2*K
U_VALUE_WINDOW = 2.80    # W/m2*K
SHGC_WINDOW = 0.55       # Solar Heat Gain Coefficient


def calculate_zone_heat_load(
    zone_data: Dict[str, Any],
    weather_data: Optional[Dict[str, Any]] = None,
    window_state: str = "closed",
    door_state: str = "closed"
) -> Dict[str, Any]:
    """
    Stage 12 — Transparent Heat-Load Model.
    Calculates detailed heat gain breakdown in Watts for a single thermal zone.
    """
    zone_id = zone_data.get('zone_id', 'zone-1')
    specs = ZONE_PHYSICAL_SPECS.get(zone_id, {'wall_area_m2': 12.0, 'window_area_m2': 2.0, 'has_door': False})

    # 1. Human Heat Load
    activity_levels = zone_data.get('activity_levels', {})
    human_heat_w = 0.0
    for activity_name, count in activity_levels.items():
        rate = HUMAN_METABOLIC_WATTS.get(activity_name.lower(), 100.0)
        human_heat_w += count * rate
    
    # Fallback if activity levels count is less than people_count
    total_active_counted = sum(activity_levels.values())
    people_count = zone_data.get('people_count', 0)
    if people_count > total_active_counted:
        human_heat_w += (people_count - total_active_counted) * HUMAN_METABOLIC_WATTS['low']

    # 2. Device Heat Load (from Stage 8 zone state)
    device_heat_w = float(zone_data.get('device_load_w', 0.0))

    # 3. Lighting Heat Load (from Stage 8 zone state)
    lighting_heat_w = float(zone_data.get('lighting_load_w', 0.0))

    # Weather variables
    outdoor_temp = weather_data.get('outdoor_temperature', 25.0) if weather_data else 25.0
    solar_rad = weather_data.get('solar_radiation', 150.0) if weather_data else 150.0
    zone_temp = zone_data.get('temperature_c') or 22.0

    delta_t = outdoor_temp - zone_temp

    # 4. Solar Heat Gain (W)
    window_factor = 1.0 if window_state == "open" else (0.8 if window_state == "closed" else 0.3)
    solar_heat_w = solar_rad * specs['window_area_m2'] * SHGC_WINDOW * window_factor

    # 5. Outdoor Heat Transfer (Wall Conduction) (W)
    outdoor_heat_transfer_w = specs['wall_area_m2'] * U_VALUE_WALL * delta_t

    # 6. Window Heat Gain (Conduction) (W)
    window_heat_gain_w = specs['window_area_m2'] * U_VALUE_WINDOW * delta_t

    # 7. Door Effects (Infiltration load when open) (W)
    door_effects_w = 150.0 if (specs['has_door'] and door_state == "open") else 0.0

    # Total Zone Heat Load
    total_heat_load_w = (
        human_heat_w +
        device_heat_w +
        lighting_heat_w +
        solar_heat_w +
        outdoor_heat_transfer_w +
        window_heat_gain_w +
        door_effects_w
    )

    return {
        'zone_id': zone_id,
        'zone_name': zone_data.get('name', zone_id),
        'human_heat_w': round(human_heat_w, 1),
        'device_heat_w': round(device_heat_w, 1),
        'lighting_heat_w': round(lighting_heat_w, 1),
        'solar_heat_w': round(solar_heat_w, 1),
        'outdoor_heat_transfer_w': round(outdoor_heat_transfer_w, 1),
        'window_heat_gain_w': round(window_heat_gain_w, 1),
        'door_effects_w': round(door_effects_w, 1),
        'total_heat_load_w': round(total_heat_load_w, 1),
        'people_count': people_count,
        'zone_temperature_c': round(zone_temp, 2),
        'outdoor_temperature_c': round(outdoor_temp, 2)
    }


def calculate_all_zones_heat_load(
    zones_state: Dict[str, Any],
    weather_data: Optional[Dict[str, Any]] = None,
    window_state: str = "closed",
    door_state: str = "closed"
) -> Dict[str, Any]:
    """Calculates heat load for all zones in the room."""
    zones = zones_state.get('zones', [])
    if not zones:
        from backend.camera_zones import load_assignments
        assignments = load_assignments()
        assigned_zone_ids = {z for z in assignments.values() if z}
        names = ['North West', 'North East', 'South West', 'South East']
        all_default = [
            {'zone_id': f'zone-{i+1}', 'name': f'Zone {i+1} · {names[i]}', 'people_count': 0, 'device_load_w': 0, 'lighting_load_w': 0, 'temperature_c': 22.0, 'activity_levels': {}}
            for i in range(4)
        ]
        zones = [z for z in all_default if z['zone_id'] in assigned_zone_ids] if assigned_zone_ids else all_default


    heat_loads = []
    room_total_w = 0.0
    for zone in zones:
        load = calculate_zone_heat_load(zone, weather_data, window_state, door_state)
        heat_loads.append(load)
        room_total_w += load['total_heat_load_w']

    return {
        'room_total_heat_load_w': round(room_total_w, 1),
        'zones_heat_load': heat_loads
    }

