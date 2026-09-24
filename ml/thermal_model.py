from __future__ import annotations
import joblib
import logging
from pathlib import Path
from typing import Any, Dict, Tuple
import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split
from xgboost import XGBRegressor

from data.dataset_builder import load_unified_dataset

ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / 'data' / 'models'
THERMAL_MODEL_PATH = MODEL_DIR / 'thermal_ml_model.joblib'

logger = logging.getLogger('visionhive.ml.thermal_model')

FEATURE_COLUMNS = [
    'zone_temperature',
    'zone_humidity',
    'people_count',
    'activity_level',
    'human_heat_load_w',
    'device_heat_load_w',
    'light_load_w',
    'outdoor_temperature',
    'outdoor_humidity',
    'solar_radiation',
    'wind_speed',
    'ac_state',
    'ac_setpoint',
    'damper_valve_opening_pct',
    'vent_count'
]


def train_thermal_models() -> Dict[str, Any]:
    """
    Stage 15 — Machine Learning Model Training.
    Trains Random Forest, Gradient Boosting, XGBoost, and Ridge models
    to predict 15m, 30m, and 60m future zone temperatures.
    """
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    df = load_unified_dataset()

    X = df[FEATURE_COLUMNS].copy()
    y_15 = df['temperature_15min_future']
    y_30 = df['temperature_30min_future']
    y_60 = df['temperature_60min_future']

    X_train, X_test, y_train_15, y_test_15 = train_test_split(X, y_15, test_size=0.2, random_state=42)
    _, _, y_train_30, y_test_30 = train_test_split(X, y_30, test_size=0.2, random_state=42)
    _, _, y_train_60, y_test_60 = train_test_split(X, y_60, test_size=0.2, random_state=42)

    candidate_models = {
        'XGBoost': XGBRegressor(n_estimators=100, max_depth=5, learning_rate=0.08, random_state=42),
        'RandomForest': RandomForestRegressor(n_estimators=100, max_depth=10, random_state=42),
        'GradientBoosting': GradientBoostingRegressor(n_estimators=100, max_depth=5, random_state=42),
        'Ridge': Ridge(alpha=1.0)
    }

    evaluations = {}
    best_models = {}

    for target_name, y_tr, y_te in [
        ('15min', y_train_15, y_test_15),
        ('30min', y_train_30, y_test_30),
        ('60min', y_train_60, y_test_60)
    ]:
        best_name = None
        best_rmse = float('inf')
        best_model_obj = None

        evaluations[target_name] = {}

        for name, model_cls in candidate_models.items():
            model = clone(model_cls)
            model.fit(X_train, y_tr)

            preds = model.predict(X_test)

            rmse = float(np.sqrt(mean_squared_error(y_te, preds)))
            mae = float(mean_absolute_error(y_te, preds))
            r2 = float(r2_score(y_te, preds))

            evaluations[target_name][name] = {
                'rmse': round(rmse, 4),
                'mae': round(mae, 4),
                'r2': round(r2, 4)
            }

            if rmse < best_rmse:
                best_rmse = rmse
                best_name = name
                best_model_obj = model

        best_models[target_name] = {
            'algorithm': best_name,
            'model': best_model_obj,
            'rmse': round(best_rmse, 4)
        }

    # Save artifacts
    artifact = {
        'feature_columns': FEATURE_COLUMNS,
        'best_models': {
            '15min': best_models['15min']['model'],
            '30min': best_models['30min']['model'],
            '60min': best_models['60min']['model']
        },
        'metadata': {
            'best_algorithms': {k: v['algorithm'] for k, v in best_models.items()},
            'evaluations': evaluations
        }
    }

    joblib.dump(artifact, THERMAL_MODEL_PATH)
    logger.info(f"Saved thermal ML models to {THERMAL_MODEL_PATH}")
    return evaluations


def predict_future_temperatures(input_features: Dict[str, Any]) -> Dict[str, float]:
    """Uses trained ML models to predict 15m, 30m, and 60m future temperatures."""
    if not THERMAL_MODEL_PATH.exists():
        # Fallback physics calculation if models haven't been trained yet
        t_curr = input_features.get('zone_temperature', 22.0)
        h_load = input_features.get('human_heat_load_w', 0.0) + input_features.get('device_heat_load_w', 0.0)
        v_open = input_features.get('damper_valve_opening_pct', 30.0)
        net_w = h_load - (v_open * 20.0)
        dt = net_w / 450000.0
        return {
            'temp_15min_future': round(t_curr + dt * 900.0, 2),
            'temp_30min_future': round(t_curr + dt * 1800.0, 2),
            'temp_60min_future': round(t_curr + dt * 3600.0, 2),
            'model_source': 'physics_fallback'
        }

    try:
        artifact = joblib.load(THERMAL_MODEL_PATH)
        row = [input_features.get(col, 0.0) for col in FEATURE_COLUMNS]
        X_df = pd.DataFrame([row], columns=FEATURE_COLUMNS)

        p15 = float(artifact['best_models']['15min'].predict(X_df)[0])
        p30 = float(artifact['best_models']['30min'].predict(X_df)[0])
        p60 = float(artifact['best_models']['60min'].predict(X_df)[0])

        return {
            'temp_15min_future': round(p15, 2),
            'temp_30min_future': round(p30, 2),
            'temp_60min_future': round(p60, 2),
            'model_source': 'ml_ensemble'
        }
    except Exception as e:
        logger.error(f"Error executing ML inference: {e}")
        t_curr = input_features.get('zone_temperature', 22.0)
        return {
            'temp_15min_future': round(t_curr, 2),
            'temp_30min_future': round(t_curr, 2),
            'temp_60min_future': round(t_curr, 2),
            'model_source': 'error_fallback'
        }
