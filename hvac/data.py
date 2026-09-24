from __future__ import annotations
import json
import logging
from pathlib import Path
from typing import Any, Dict, Optional
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
HVAC_CONFIG_PATH = ROOT / 'config' / 'hvac_config.json'
PARQUET_DATASET_PATH = ROOT / 'data' / 'raw' / 'hvac-power' / 'hvac_data_cleaned.parquet'

logger = logging.getLogger('visionhive.hvac.data')


def load_hvac_config() -> Dict[str, Any]:
    """Loads HVAC system configuration including specifications and zone vent counts."""
    if not HVAC_CONFIG_PATH.exists():
        default_config = {
            "system_type": "Variable Air Volume (VAV) with Zone Dampers/Valves",
            "cooling_capacity_w": 12000.0,
            "max_airflow_cfm_per_vent": 150.0,
            "supply_air_temp_c": 14.0,
            "min_valve_opening_pct": 10.0,
            "max_valve_opening_pct": 100.0,
            "target_setpoint_c": 22.0,
            "comfort_range_min_c": 21.0,
            "comfort_range_max_c": 24.0,
            "default_fan_speed": "auto",
            "default_ac_mode": "cool",
            "zone_vent_counts": {
                "zone-1": 2,
                "zone-2": 2,
                "zone-3": 2,
                "zone-4": 2
            }
        }
        HVAC_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        HVAC_CONFIG_PATH.write_text(json.dumps(default_config, indent=2))
        return default_config
    try:
        return json.loads(HVAC_CONFIG_PATH.read_text())
    except Exception as e:
        logger.error(f"Error loading hvac_config.json: {e}")
        return {}


def save_hvac_config(config: Dict[str, Any]) -> Dict[str, Any]:
    """Updates and saves HVAC system configuration."""
    current = load_hvac_config()
    current.update(config)
    HVAC_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    HVAC_CONFIG_PATH.write_text(json.dumps(current, indent=2))
    return current


def load_raw_hvac_dataframe() -> pd.DataFrame:
    """Loads cleaned HVAC operational dataset from raw storage."""
    if PARQUET_DATASET_PATH.exists():
        try:
            df = pd.read_parquet(PARQUET_DATASET_PATH)
            return df
        except Exception as e:
            logger.error(f"Failed to read parquet HVAC dataset: {e}")
    
    # Fallback synthetic dataset if parquet isn't readable
    timestamps = pd.date_range("2026-01-01", periods=1000, freq="15min")
    return pd.DataFrame({
        "timestamp": timestamps.astype(str),
        "on_off": [1] * 1000,
        "damper": [50.0] * 1000,
        "active_power": [2500.0] * 1000,
        "active_energy": [625.0] * 1000,
        "ambient_humidity": [50.0] * 1000,
        "outside_temp": [28.0] * 1000,
        "inlet_temp": [24.0] * 1000,
        "outlet_temp": [16.0] * 1000,
        "summer_SP_temp": [22.0] * 1000,
        "ambient_temp": [23.5] * 1000
    })


def get_hvac_dataset_stats() -> Dict[str, Any]:
    """Extracts summary statistics and behavioral insights from HVAC dataset (Stage 11)."""
    df = load_raw_hvac_dataframe()
    stats = {
        "record_count": len(df),
        "columns": df.columns.tolist(),
    }
    numeric_cols = df.select_dtypes(include=['number']).columns
    summary = {}
    for col in numeric_cols:
        summary[col] = {
            "mean": float(df[col].mean()) if not df[col].isnull().all() else 0.0,
            "min": float(df[col].min()) if not df[col].isnull().all() else 0.0,
            "max": float(df[col].max()) if not df[col].isnull().all() else 0.0,
        }
    stats["summary"] = summary
    return stats
