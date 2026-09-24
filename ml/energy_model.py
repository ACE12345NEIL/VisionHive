from __future__ import annotations
import joblib
import logging
from pathlib import Path
from typing import Any, Dict
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from data.dataset_builder import load_unified_dataset

ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / 'data' / 'models'
ENERGY_MODEL_PATH = MODEL_DIR / 'energy_ml_model.joblib'

logger = logging.getLogger('visionhive.ml.energy_model')

ENERGY_FEATURES = [
    'zone_temperature',
    'outdoor_temperature',
    'people_count',
    'human_heat_load_w',
    'device_heat_load_w',
    'light_load_w',
    'ac_state',
    'damper_valve_opening_pct',
    'ac_setpoint'
]


def train_energy_model() -> Dict[str, Any]:
    """
    Stage 16 — Energy Prediction Model.
    Predicts active HVAC power consumption (W) and energy consumption (kWh).
    """
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    df = load_unified_dataset()

    X = df[ENERGY_FEATURES]
    y = df['hvac_power_w']

    model = RandomForestRegressor(n_estimators=100, max_depth=10, random_state=42)
    model.fit(X, y)

    artifact = {
        'features': ENERGY_FEATURES,
        'model': model
    }

    joblib.dump(artifact, ENERGY_MODEL_PATH)
    logger.info(f"Saved Energy ML model to {ENERGY_MODEL_PATH}")
    return {'status': 'trained', 'features': ENERGY_FEATURES}


def predict_energy_consumption(input_features: Dict[str, Any], duration_hours: float = 1.0) -> Dict[str, float]:
    """Predicts HVAC power (W), HVAC energy (kWh), and Total Room Energy (kWh)."""
    hvac_power_w = 50.0  # Standby
    
    if ENERGY_MODEL_PATH.exists():
        try:
            artifact = joblib.load(ENERGY_MODEL_PATH)
            row = [input_features.get(col, 0.0) for col in ENERGY_FEATURES]
            X_df = pd.DataFrame([row], columns=ENERGY_FEATURES)
            hvac_power_w = float(artifact['model'].predict(X_df)[0])
        except Exception as e:
            logger.error(f"Energy model prediction error: {e}")

    if hvac_power_w <= 50.0:
        # Fallback empirical estimate if model isn't trained
        ac_on = input_features.get('ac_state', 1)
        v_open = input_features.get('damper_valve_opening_pct', 30.0)
        hvac_power_w = (500.0 + v_open * 25.0) if ac_on else 50.0

    device_power_w = float(input_features.get('device_heat_load_w', 0.0))
    light_power_w = float(input_features.get('light_load_w', 0.0))
    total_power_w = hvac_power_w + device_power_w + light_power_w

    hvac_kwh = (hvac_power_w * duration_hours) / 1000.0
    total_room_kwh = (total_power_w * duration_hours) / 1000.0

    return {
        'hvac_power_w': round(hvac_power_w, 1),
        'device_power_w': round(device_power_w, 1),
        'lighting_power_w': round(light_power_w, 1),
        'total_room_power_w': round(total_power_w, 1),
        'hvac_energy_kwh': round(hvac_kwh, 3),
        'total_room_energy_kwh': round(total_room_kwh, 3)
    }
