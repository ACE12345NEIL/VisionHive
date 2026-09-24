# VisionHive — Intelligent Multi-Camera Occupancy & HVAC Control System

Working foundation for multi-camera occupancy, activity analysis, thermal zone heat-load modeling, machine learning temperature forecasting, and dynamic HVAC valve control.

## Run

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn backend.main:app --reload
```

Open `http://127.0.0.1:8000`. Add local video paths through `config/cameras.json`, then restart the server. The provided paths are git-ignored; raw datasets and testing videos belong in `data/raw/`.

## Stages Implemented

1. **Project Foundation**: FastAPI backend, WebSocket streaming dashboard, SQLite persistence, domain schemas, four-zone virtual room setup.
2. **Image & Video Input**: Multi-source OpenCV camera workers (files, webcams, image sequences), frame resizing, FPS throttling, and buffer management.
3. **Person & Object Detection**: Standardized detection interfaces supporting Ultralytics YOLO with fallback detection support.
4. **Person Tracking**: Per-camera centroid tracker maintaining identity IDs, positions, velocity, trajectory, and bounding boxes.
5. **Activity & Motion Analysis**: Farnebäck optical flow, frame differencing, box displacement, temporal smoothing, and 0–3 activity scale.
6. **Multi-Camera Fusion**: Spatial overlap fusion mapping camera tracks into a unified 3D/2D room coordinate space.
7. **Thermal-Zone Assignment**: Zone assignment engine tracking occupant counts, person IDs, activity levels, device loads, lighting loads, and indoor environmental conditions per zone.
8. **Device & Lighting Analysis**: Equipment tracking (PCs, laptops, monitors, servers, machines, lights) with configurable power assumption tables.
9. **Environmental Data**: Integration of indoor environmental telemetry (temperature, humidity, CO₂, lighting, occupancy).
10. **Outdoor Weather**: Live weather integration using Open-Meteo API and historical weather dataset support.
11. **HVAC Data & Behaviour**: Ingestion of HVAC operational datasets (`hvac_data_cleaned.parquet`) extracting relationships between damper states, power consumption, supply/outlet temperatures, and outdoor conditions. Configurable HVAC system setup (`config/hvac_config.json`).
12. **Transparent Heat-Load Model**: Zone-by-zone heat load calculator computing human metabolic heat, device heat, lighting load, solar heat gain, wall conduction, window heat transfer, and door infiltration effects.
13. **Thermal Response Model**: Physics-inspired zone dynamic thermal differential equations modeling temperature changes over time, inter-zone wall heat coupling, and HVAC cooling capacities.
14. **Unified Project Dataset Builder**: Time-series dataset synthesizer combining occupancy, device power, weather, HVAC states, and target future temperatures ($T_{+15m}$, $T_{+30m}$, $T_{+60m}$).
15. **Machine Learning Thermal Models**: Multi-model ML pipeline evaluating Random Forest, Gradient Boosting, XGBoost, and Ridge models to predict future room temperatures.
16. **Energy Prediction Model**: Power and kWh energy prediction model estimating active HVAC power and total room energy consumption.
17. **HVAC Control Engine & Vent Valve Optimizer**: Intelligent decision engine computing dynamic setpoints, AC ON/OFF status, fan speed, airflow CFM, **Overall Zone Valve Opening Percentage (0–100%)**, and **Individual Vent Valve Opening %** for every vent installed in each zone.
18. **Real-Time Integration & Dashboard UI**: Full pipeline integration with live REST APIs and WebSocket broadcasting of HVAC valve controls, zone heat loads, and ML predictions directly to the web dashboard.
