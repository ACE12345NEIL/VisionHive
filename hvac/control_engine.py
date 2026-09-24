from __future__ import annotations
import logging
from typing import Any, Dict, List, Optional

from hvac.data import load_hvac_config
from thermal.heat_load import calculate_all_zones_heat_load, calculate_zone_heat_load
from thermal.response import predict_zone_trajectories
from ml.thermal_model import predict_future_temperatures
from ml.energy_model import predict_energy_consumption

logger = logging.getLogger('visionhive.hvac.control_engine')


class HVACControlEngine:
    """
    Stage 17 — Intelligent HVAC Decision Layer & Valve Control Engine.
    Calculates dynamic setpoints, AC ON/OFF states, fan speeds,
    Zone Valve Opening %, and Individual Vent Valve Opening % for every HVAC vent.
    Accounts for per-zone window state (open heat gain) and dynamic lighting configurations.
    """

    def __init__(self):
        self.config = load_hvac_config()

    def update_config(self, new_config: Dict[str, Any]) -> Dict[str, Any]:
        """Updates runtime HVAC specs, vent counts, lighting configs, and window states."""
        self.config.update(new_config)
        return self.config

    def evaluate_control(
        self,
        zones_state: Dict[str, Any],
        weather_data: Optional[Dict[str, Any]] = None,
        window_state: str = "closed",
        door_state: str = "closed"
    ) -> Dict[str, Any]:
        """
        Runs full decision pipeline across all zones and returns HVAC recommendations & valve states.
        """
        # Load latest config
        self.config = load_hvac_config()
        sys_type = self.config.get("system_type", "Variable Air Volume (VAV) with Zone Dampers/Valves")
        target_sp = float(self.config.get("target_setpoint_c", 22.0))
        min_valve = float(self.config.get("min_valve_opening_pct", 10.0))
        max_valve = float(self.config.get("max_valve_opening_pct", 100.0))
        max_cfm_per_vent = float(self.config.get("max_airflow_cfm_per_vent", 150.0))
        vent_counts_config = self.config.get("zone_vent_counts", {})
        lighting_config = self.config.get("zone_lighting_config", {})
        window_states_config = self.config.get("zone_window_states", {})

        # Prepare zone objects with dynamic lighting configurations
        raw_zones = zones_state.get('zones', [])
        if not raw_zones:
            from backend.camera_zones import load_assignments
            assignments = load_assignments()
            assigned_zone_ids = {z for z in assignments.values() if z}
            names = ['North West', 'North East', 'South West', 'South East']
            all_default = [
                {'zone_id': f'zone-{i+1}', 'name': f'Zone {i+1} · {names[i]}', 'people_count': 0, 'device_load_w': 0, 'lighting_load_w': 0, 'temperature_c': 22.0, 'activity_levels': {}}
                for i in range(4)
            ]
            raw_zones = [z for z in all_default if z['zone_id'] in assigned_zone_ids] if assigned_zone_ids else all_default

        from vision.window_detector import detect_window_state_from_frame_and_telemetry

        zones_heat_load = []
        room_total_heat_load_w = 0.0

        for z in raw_zones:
            zid = z.get('zone_id', z.get('id', 'zone-1'))
            
            # 1. Dynamic Lighting calculation
            l_cfg = lighting_config.get(zid, {'light_count': 4, 'wattage_per_light': 18.0, 'is_on': True})
            l_count = int(l_cfg.get('light_count', 4))
            l_watt = float(l_cfg.get('wattage_per_light', 18.0))
            l_on = bool(l_cfg.get('is_on', True))
            computed_lighting_w = (l_count * l_watt) if l_on else 0.0
            
            z['light_count'] = l_count
            z['lighting_load_w'] = computed_lighting_w

            # 2. Automated Window Open/Closed Detector (Vision + Live Weather API)
            from vision.camera import latest_frames
            from backend.camera_zones import load_assignments

            cam_assignments = load_assignments()
            assigned_cam_id = next((c_id for c_id, z_id in cam_assignments.items() if z_id == zid), None)
            live_frame = latest_frames.get(assigned_cam_id) if assigned_cam_id else None

            outdoor_temp = weather_data.get('outdoor_temperature', 25.0) if weather_data else 25.0
            solar_rad = weather_data.get('solar_radiation', 150.0) if weather_data else 150.0
            indoor_temp = z.get('temperature_c', 22.0) or 22.0

            win_detection = detect_window_state_from_frame_and_telemetry(
                frame=live_frame,
                zone_id=zid,
                indoor_temp=indoor_temp,
                outdoor_temp=outdoor_temp,
                solar_rad=solar_rad
            )

            # Auto-detected window state (100% vision + weather telemetry, no hardcoding)
            z_win_state = win_detection['window_state']


            # Calculate Stage 12 transparent heat load for this zone
            z_load = calculate_zone_heat_load(z, weather_data, window_state=z_win_state, door_state=door_state)
            z_load['window_state'] = z_win_state
            z_load['window_detection_reason'] = win_detection.get('detection_reason', '')
            z_load['light_count'] = l_count
            z_load['lighting_heat_w'] = computed_lighting_w
            
            zones_heat_load.append(z_load)
            room_total_heat_load_w += z_load['total_heat_load_w']


        # Physics Trajectory (Stage 13)
        trajectories = predict_zone_trajectories(zones_heat_load, self.config)

        zone_controls = []
        total_cooling_req_w = 0.0
        active_zones_count = 0

        for z_load in zones_heat_load:
            zid = z_load['zone_id']
            z_name = z_load['zone_name']
            current_temp = z_load['zone_temperature_c']
            heat_w = z_load['total_heat_load_w']
            n_people = z_load['people_count']
            win_st = z_load['window_state']

            # Get vent count for this zone (default to 2 if not configured)
            n_vents = int(vent_counts_config.get(zid, 2))

            # ML Temperature Predictions (Stage 15)
            ml_input = {
                'zone_temperature': current_temp,
                'zone_humidity': z_load.get('zone_humidity_pct', 50.0),
                'people_count': n_people,
                'activity_level': 1.0 if n_people > 0 else 0.0,
                'human_heat_load_w': z_load['human_heat_w'],
                'device_heat_load_w': z_load['device_heat_w'],
                'light_load_w': z_load['lighting_heat_w'],
                'outdoor_temperature': z_load['outdoor_temperature_c'],
                'outdoor_humidity': weather_data.get('outdoor_humidity', 50.0) if weather_data else 50.0,
                'solar_radiation': weather_data.get('solar_radiation', 150.0) if weather_data else 150.0,
                'wind_speed': weather_data.get('wind_speed', 3.0) if weather_data else 3.0,
                'ac_state': 1,
                'ac_setpoint': target_sp,
                'damper_valve_opening_pct': 30.0,
                'vent_count': n_vents
            }
            ml_preds = predict_future_temperatures(ml_input)

            # Predict 30m temperature
            p30 = ml_preds['temp_30min_future']

            # 3. Dynamic Valve Opening Calculation algorithm (compounding heat load from open windows)
            temp_error = current_temp - target_sp
            future_error = p30 - target_sp

            # If window is open, add boost factor to load factor to counter incoming outdoor heat!
            window_boost = 0.35 if win_st == "open" else 0.0
            load_factor = max(0.0, heat_w / 600.0) + window_boost

            if temp_error > 2.0 or future_error > 2.5 or (win_st == "open" and temp_error > 0.5):
                # Urgent high heat load or open window entering heat
                raw_valve_pct = 85.0 + (temp_error * 10.0) + (load_factor * 15.0)
                ac_zone_state = True
                fan_speed = "high"
            elif temp_error > 0.5 or future_error > 0.8:
                # Moderate cooling needed
                raw_valve_pct = 40.0 + (temp_error * 20.0) + (load_factor * 20.0)
                ac_zone_state = True
                fan_speed = "medium"
            elif temp_error >= -0.5:
                # Comfort maintenance zone
                raw_valve_pct = 20.0 + (load_factor * 25.0)
                ac_zone_state = True if (n_people > 0 or heat_w > 200.0 or win_st == "open") else False
                fan_speed = "auto"
            else:
                # Zone is cooler than setpoint -> minimum valve opening
                raw_valve_pct = min_valve
                ac_zone_state = False
                fan_speed = "low"

            zone_valve_pct = round(max(min_valve, min(max_valve, raw_valve_pct)), 1)

            if not ac_zone_state and n_people == 0 and win_st != "open":
                zone_valve_pct = min_valve

            if ac_zone_state:
                active_zones_count += 1

            # Airflow CFM for whole zone
            total_zone_cfm = round(n_vents * max_cfm_per_vent * (zone_valve_pct / 100.0), 1)

            # 4. Individual Vent Valve Openings
            vent_valves = []
            for vent_idx in range(1, n_vents + 1):
                vent_valve_pct = zone_valve_pct
                vent_cfm = round(max_cfm_per_vent * (vent_valve_pct / 100.0), 1)
                vent_valves.append({
                    "vent_index": vent_idx,
                    "vent_label": f"Vent #{vent_idx}",
                    "valve_opening_pct": vent_valve_pct,
                    "airflow_cfm": vent_cfm,
                    "status": "OPEN" if vent_valve_pct > min_valve else "MINIMAL"
                })

            # Energy Prediction (Stage 16)
            energy_pred = predict_energy_consumption({
                'zone_temperature': current_temp,
                'outdoor_temperature': z_load['outdoor_temperature_c'],
                'people_count': n_people,
                'human_heat_load_w': z_load['human_heat_w'],
                'device_heat_load_w': z_load['device_heat_w'],
                'light_load_w': z_load['lighting_heat_w'],
                'ac_state': 1 if ac_zone_state else 0,
                'damper_valve_opening_pct': zone_valve_pct,
                'ac_setpoint': target_sp
            })

            zone_controls.append({
                'zone_id': zid,
                'zone_name': z_name,
                'current_temp_c': current_temp,
                'target_setpoint_c': target_sp,
                'heat_load_w': heat_w,
                'people_count': n_people,
                'window_state': win_st,
                'light_count': z_load['light_count'],
                'lighting_heat_w': z_load['lighting_heat_w'],
                'ac_state': "ON" if ac_zone_state else "STANDBY",
                'zone_valve_opening_pct': zone_valve_pct,
                'vent_count': n_vents,
                'total_zone_airflow_cfm': total_zone_cfm,
                'fan_speed': fan_speed,
                'louver_direction': "Swing 45°" if fan_speed == "high" else "Fixed 30°",
                'ml_predicted_temp_15m': ml_preds['temp_15min_future'],
                'ml_predicted_temp_30m': ml_preds['temp_30min_future'],
                'ml_predicted_temp_60m': ml_preds['temp_60min_future'],
                'vent_valves': vent_valves,
                'hvac_power_w': energy_pred['hvac_power_w']
            })

        system_ac_state = "ON" if active_zones_count > 0 else "STANDBY"
        total_hvac_power = sum(z['hvac_power_w'] for z in zone_controls)

        return {
            'system_architecture': sys_type,
            'system_ac_state': system_ac_state,
            'global_setpoint_c': target_sp,
            'active_zones_count': active_zones_count,
            'total_hvac_power_w': round(total_hvac_power, 1),
            'room_total_heat_load_w': round(room_total_heat_load_w, 1),
            'zone_controls': zone_controls
        }
