from __future__ import annotations
from typing import Any, Dict, List, Optional
import math
import logging

logger = logging.getLogger('visionhive.thermal.response')

# Thermal capacity of zone volume (Air + internal furniture/structure mass)
C_ZONE_J_PER_K = 450000.0  # Joules per Kelvin
C_P_AIR = 1005.0           # Specific heat capacity of air (J/kg*K)
RHO_AIR = 1.204            # Air density at sea level (kg/m3)
CFM_TO_M3S = 0.000471947   # Conversion factor CFM to m3/s
R_COUPLING_K_PER_W = 0.85  # Thermal resistance between adjacent zones (K/W)

# Inter-zone adjacency topology in 2x2 quadrant layout:
# Zone 1 (NW) adjacent to Zone 2 (NE) and Zone 3 (SW)
# Zone 2 (NE) adjacent to Zone 1 (NW) and Zone 4 (SE)
# Zone 3 (SW) adjacent to Zone 1 (NW) and Zone 4 (SE)
# Zone 4 (SE) adjacent to Zone 2 (NE) and Zone 3 (SW)
ZONE_ADJACENCY = {
    'zone-1': ['zone-2', 'zone-3'],
    'zone-2': ['zone-1', 'zone-4'],
    'zone-3': ['zone-1', 'zone-4'],
    'zone-4': ['zone-2', 'zone-3']
}


def compute_hvac_cooling_w(
    valve_opening_pct: float,
    vent_count: int,
    max_cfm_per_vent: float,
    current_temp_c: float,
    supply_temp_c: float,
    ac_state: bool = True,
    fan_speed: str = "auto"
) -> float:
    """Calculates HVAC thermal cooling power in Watts delivered to a zone."""
    if not ac_state or valve_opening_pct <= 0:
        return 0.0

    fan_mult = 1.2 if fan_speed == "high" else (0.8 if fan_speed == "low" else 1.0)
    effective_cfm = vent_count * max_cfm_per_vent * (valve_opening_pct / 100.0) * fan_mult
    airflow_m3s = effective_cfm * CFM_TO_M3S
    mass_flow_kg_s = airflow_m3s * RHO_AIR

    # Cooling capacity Q = m_dot * c_p * (T_zone - T_supply)
    delta_t = max(0.0, current_temp_c - supply_temp_c)
    cooling_w = mass_flow_kg_s * C_P_AIR * delta_t
    return cooling_w


def predict_temperature_step(
    zone_temps: Dict[str, float],
    heat_loads_w: Dict[str, float],
    valve_openings_pct: Dict[str, float],
    vent_counts: Dict[str, int],
    hvac_config: Dict[str, Any],
    ac_state: bool = True,
    dt_seconds: float = 900.0  # 15 minutes = 900 seconds
) -> Dict[str, float]:
    """
    Stage 13 — Physics-Inspired Thermal Response Step.
    Simulates room temperature state evolution after dt_seconds.
    """
    max_cfm = hvac_config.get('max_airflow_cfm_per_vent', 150.0)
    supply_temp = hvac_config.get('supply_air_temp_c', 14.0)
    fan_speed = hvac_config.get('default_fan_speed', 'auto')

    next_temps = {}

    for zone_id, current_temp in zone_temps.items():
        q_load = heat_loads_w.get(zone_id, 0.0)
        v_pct = valve_openings_pct.get(zone_id, 30.0)
        n_vents = vent_counts.get(zone_id, 2)

        # 1. HVAC cooling delivered
        q_cooling = compute_hvac_cooling_w(
            valve_opening_pct=v_pct,
            vent_count=n_vents,
            max_cfm_per_vent=max_cfm,
            current_temp_c=current_temp,
            supply_temp_c=supply_temp,
            ac_state=ac_state,
            fan_speed=fan_speed
        )

        # 2. Inter-zone thermal coupling heat exchange
        q_coupling = 0.0
        adjacent_ids = ZONE_ADJACENCY.get(zone_id, [])
        for adj_id in adjacent_ids:
            if adj_id in zone_temps:
                adj_temp = zone_temps[adj_id]
                # Heat flows from warm adjacent zone to cool zone
                q_coupling += (adj_temp - current_temp) / R_COUPLING_K_PER_W

        # Net thermal power balance (Watts = Joules / sec)
        q_net = q_load - q_cooling + q_coupling

        # Temperature change delta_T = (Q_net * dt) / C_zone
        delta_temp = (q_net * dt_seconds) / C_ZONE_J_PER_K
        next_temps[zone_id] = round(current_temp + delta_temp, 2)

    return next_temps


def predict_zone_trajectories(
    zones_heat_load: List[Dict[str, Any]],
    hvac_config: Dict[str, Any],
    valve_openings_pct: Optional[Dict[str, float]] = None,
    ac_state: bool = True
) -> Dict[str, Any]:
    """Generates 15-min, 30-min, and 60-min temperature trajectories for all zones."""
    zone_temps = {}
    heat_loads_w = {}
    vent_counts = hvac_config.get('zone_vent_counts', {'zone-1': 2, 'zone-2': 2, 'zone-3': 2, 'zone-4': 2})

    for z in zones_heat_load:
        zid = z['zone_id']
        zone_temps[zid] = z['zone_temperature_c']
        heat_loads_w[zid] = z['total_heat_load_w']

    if valve_openings_pct is None:
        # Default baseline valve opening
        valve_openings_pct = {zid: 30.0 for zid in zone_temps}

    # Step 1: +15 minutes (900 seconds)
    t_15 = predict_temperature_step(zone_temps, heat_loads_w, valve_openings_pct, vent_counts, hvac_config, ac_state, 900.0)

    # Step 2: +30 minutes (1800 seconds total)
    t_30 = predict_temperature_step(t_15, heat_loads_w, valve_openings_pct, vent_counts, hvac_config, ac_state, 900.0)

    # Step 3: +60 minutes (3600 seconds total - two additional 15 min steps)
    t_45 = predict_temperature_step(t_30, heat_loads_w, valve_openings_pct, vent_counts, hvac_config, ac_state, 900.0)
    t_60 = predict_temperature_step(t_45, heat_loads_w, valve_openings_pct, vent_counts, hvac_config, ac_state, 900.0)

    results = {}
    for zid in zone_temps:
        results[zid] = {
            'current_temp_c': zone_temps[zid],
            'temp_15min_future': t_15[zid],
            'temp_30min_future': t_30[zid],
            'temp_60min_future': t_60[zid]
        }
    return results
