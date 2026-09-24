"""
Stage 22 — What-If Scenario Analysis Engine.

Enables interactive hypothetical scenario testing:
  - "What if 10 extra people enter Zone 1 during a 38°C heatwave?"
  - "What if windows are left open in Zone 3 while AC is running?"
  - "What if server equipment load in Zone 2 spikes by 1200 W?"
  - "What if HVAC setpoint is raised to 24.5°C (Eco Mode) vs 18.0°C (Aggressive Cooling)?"

Computes baseline vs scenario comparisons:
  - Energy consumption delta (kWh & %)
  - Peak & average temperature deltas (°C)
  - Occupant thermal comfort degradation %
  - Zone risk classification (Thermal Stress, Overcooling, Normal)
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional
from simulation.engine import run_simulation
from backend.camera_zones import load_assignments

logger = logging.getLogger('visionhive.simulation.whatif')

# ── Preset What-If Scenarios ─────────────────────────────────────────────────
PRESET_SCENARIOS: Dict[str, Dict[str, Any]] = {
    'heatwave_surge': {
        'name': '🔥 Heatwave Occupancy Surge',
        'description': '10 extra occupants surge into Zone 1 during a 38°C outdoor heatwave (900 W/m² peak solar).',
        'hours': 24,
        'outdoor_temp_min': 26.0,
        'outdoor_temp_max': 38.0,
        'peak_solar_w_m2': 900.0,
        'activity_level': 'high',
        'extra_occupants': {'zone-1': 10},
        'hvac_setpoint_c': 22.0,
        'ac_enabled': True,
        'window_open_zones': []
    },
    'open_windows': {
        'name': '🪟 Infiltration (Open Windows)',
        'description': 'Perimeter windows left open in Zone 3 during a 34°C summer afternoon.',
        'hours': 24,
        'outdoor_temp_min': 24.0,
        'outdoor_temp_max': 34.0,
        'peak_solar_w_m2': 650.0,
        'activity_level': 'low',
        'extra_occupants': {},
        'hvac_setpoint_c': 22.0,
        'ac_enabled': True,
        'window_open_zones': ['zone-3', 'zone-1']
    },
    'server_spike': {
        'name': '⚡ Server Equipment Load Spike',
        'description': 'Server racks and equipment heat load in Zone 2 spike by +1200 W continuous.',
        'hours': 24,
        'outdoor_temp_min': 22.0,
        'outdoor_temp_max': 30.0,
        'peak_solar_w_m2': 500.0,
        'activity_level': 'low',
        'extra_occupants': {},
        'device_loads_w_add': {'zone-2': 1200.0},
        'hvac_setpoint_c': 22.0,
        'ac_enabled': True,
        'window_open_zones': []
    },
    'eco_setpoint': {
        'name': '🌱 Eco Mode Setpoint Optimization',
        'description': 'HVAC setpoint raised to 24.5°C eco mode vs baseline 22.0°C.',
        'hours': 24,
        'outdoor_temp_min': 24.0,
        'outdoor_temp_max': 35.0,
        'peak_solar_w_m2': 700.0,
        'activity_level': 'low',
        'extra_occupants': {},
        'hvac_setpoint_c': 24.5,
        'ac_enabled': True,
        'window_open_zones': []
    },
    'extreme_cooling': {
        'name': '❄️ Aggressive Overcooling (18°C)',
        'description': 'Aggressive cooling setpoint set to 18.0°C during peak summer load.',
        'hours': 24,
        'outdoor_temp_min': 24.0,
        'outdoor_temp_max': 36.0,
        'peak_solar_w_m2': 750.0,
        'activity_level': 'medium',
        'extra_occupants': {},
        'hvac_setpoint_c': 18.0,
        'ac_enabled': True,
        'window_open_zones': []
    }
}


def run_what_if_scenario(
    preset_key: str = 'heatwave_surge',
    custom_config: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Executes a What-If scenario analysis by running a Baseline simulation
    and a Hypothetical Scenario simulation side-by-side.
    """
    assignments = load_assignments()
    active_zone_ids = sorted({z for z in assignments.values() if z}) or ['zone-1', 'zone-4']

    # Get preset parameters
    preset = dict(PRESET_SCENARIOS.get(preset_key, PRESET_SCENARIOS['heatwave_surge']))
    if custom_config:
        preset.update(custom_config)

    hours = int(preset.get('hours', 24))
    hvac_setpoint = float(preset.get('hvac_setpoint_c', 22.0))
    t_min = float(preset.get('outdoor_temp_min', 22.0))
    t_max = float(preset.get('outdoor_temp_max', 35.0))
    solar = float(preset.get('peak_solar_w_m2', 600.0))
    activity = str(preset.get('activity_level', 'low'))
    ac_on = bool(preset.get('ac_enabled', True))
    window_open_zones = list(preset.get('window_open_zones', []))

    # 1. Run Baseline Simulation (Default baseline conditions)
    baseline_res = run_simulation(
        hours=hours,
        outdoor_temp_min=22.0,
        outdoor_temp_max=32.0,
        peak_solar_w_m2=550.0,
        hvac_setpoint_c=22.0,
        ac_enabled=True,
        window_open_zones=[],
        activity_level='low',
        active_zone_ids=active_zone_ids
    )

    # 2. Build Scenario Occupancy & Device Load Schedules
    extra_ppl = preset.get('extra_occupants', {})
    base_schedule = [0]*8 + [3]*9 + [0]*7
    scen_occupancy = {}
    
    # Fallback to active_zone_ids[0] if preset zone is inactive
    unmapped_ppl = sum(count for zid, count in extra_ppl.items() if zid not in active_zone_ids)
    
    for idx, zid in enumerate(active_zone_ids):
        add_ppl = extra_ppl.get(zid, 0)
        if idx == 0:
            add_ppl += unmapped_ppl
        scen_occupancy[zid] = [p + add_ppl for p in base_schedule]

    dev_add = preset.get('device_loads_w_add', {})
    unmapped_dev = sum(w for zid, w in dev_add.items() if zid not in active_zone_ids)
    scen_device_loads = {}
    for idx, zid in enumerate(active_zone_ids):
        add_w = dev_add.get(zid, 0.0)
        if idx == 0:
            add_w += unmapped_dev
        scen_device_loads[zid] = 200.0 + add_w

    # 3. Run Hypothetical Scenario Simulation
    scenario_res = run_simulation(
        hours=hours,
        occupancy_schedule=scen_occupancy,
        device_loads_w=scen_device_loads,
        outdoor_temp_min=t_min,
        outdoor_temp_max=t_max,
        peak_solar_w_m2=solar,
        hvac_setpoint_c=hvac_setpoint,
        ac_enabled=ac_on,
        window_open_zones=window_open_zones,
        activity_level=activity,
        active_zone_ids=active_zone_ids
    )

    # 4. Calculate Comparison Metrics & Deltas
    base_kwh = baseline_res['total_energy_kwh']
    scen_kwh = scenario_res['total_energy_kwh']
    kwh_delta = round(scen_kwh - base_kwh, 3)
    kwh_pct_delta = round((kwh_delta / max(0.001, base_kwh)) * 100.0, 1)

    zone_comparisons: Dict[str, Dict[str, Any]] = {}
    zone_risk_levels: Dict[str, str] = {}

    for zid in active_zone_ids:
        b_sum = baseline_res['summary'].get(zid, {})
        s_sum = scenario_res['summary'].get(zid, {})

        avg_t_delta = round(s_sum.get('avg_temp_c', 22.0) - b_sum.get('avg_temp_c', 22.0), 2)
        max_t_delta = round(s_sum.get('max_temp_c', 22.0) - b_sum.get('max_temp_c', 22.0), 2)
        comfort_delta = round(s_sum.get('comfort_pct', 100.0) - b_sum.get('comfort_pct', 100.0), 1)

        # Risk Classification
        max_t = s_sum.get('max_temp_c', 22.0)
        comfort_pct = s_sum.get('comfort_pct', 100.0)

        if max_t > hvac_setpoint + 3.0 or comfort_pct < 60.0:
            risk = 'HIGH_THERMAL_STRESS'
        elif max_t < hvac_setpoint - 2.5:
            risk = 'OVERCOOLING'
        elif comfort_pct < 85.0:
            risk = 'COMFORT_DEGRADATION'
        else:
            risk = 'NORMAL'

        zone_risk_levels[zid] = risk

        zone_comparisons[zid] = {
            'baseline': b_sum,
            'scenario': s_sum,
            'deltas': {
                'avg_temp_c_delta': avg_t_delta,
                'max_temp_c_delta': max_t_delta,
                'comfort_pct_delta': comfort_delta,
                'energy_kwh_delta': round(s_sum.get('total_energy_kwh', 0) - b_sum.get('total_energy_kwh', 0), 3)
            },
            'risk_level': risk
        }

    # 5. Build Downsampled Side-by-Side Timeline Points
    timeline_comparison = []
    base_timeline = baseline_res['timeline']
    scen_timeline = scenario_res['timeline']

    for i in range(min(len(base_timeline), len(scen_timeline))):
        b_step = base_timeline[i]
        s_step = scen_timeline[i]

        step_cmp = {
            'minute': b_step['minute'],
            'hour': b_step['hour'],
            'outdoor_temp_baseline': b_step['outdoor_temp_c'],
            'outdoor_temp_scenario': s_step['outdoor_temp_c'],
            'zones': {}
        }

        for zid in active_zone_ids:
            step_cmp['zones'][zid] = {
                'baseline_temp_c': b_step['zones'].get(zid, {}).get('temp_c'),
                'scenario_temp_c': s_step['zones'].get(zid, {}).get('temp_c'),
                'baseline_valve_pct': b_step['zones'].get(zid, {}).get('valve_pct'),
                'scenario_valve_pct': s_step['zones'].get(zid, {}).get('valve_pct'),
            }

        timeline_comparison.append(step_cmp)

    return {
        'preset_used': preset_key,
        'scenario_info': {
            'name': preset.get('name', 'Custom Scenario'),
            'description': preset.get('description', 'User custom configuration'),
            'active_zones': active_zone_ids,
            'config': preset
        },
        'kpi_summary': {
            'baseline_energy_kwh': base_kwh,
            'scenario_energy_kwh': scen_kwh,
            'energy_delta_kwh': kwh_delta,
            'energy_delta_pct': kwh_pct_delta,
            'overall_risk_summary': zone_risk_levels
        },
        'zone_comparisons': zone_comparisons,
        'timeline_comparison': timeline_comparison
    }
