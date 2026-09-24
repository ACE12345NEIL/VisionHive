# VisionHive — Intelligent Multi-Camera Occupancy & HVAC Control System

VisionHive is an autonomous, software-only computer vision and machine learning platform designed to monitor room occupancy, analyze thermal heat loads, forecast future zone temperatures, and optimize **HVAC damper/valve opening percentages** for energy efficiency and occupant comfort.

---

## Quick Start

### 1. Environment Setup
```powershell
# Create & activate virtual environment
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# Install requirements
pip install -r requirements.txt
```

### 2. Run Backend Server
```powershell
uvicorn backend.main:app --reload
```
Open **`http://127.0.0.1:8000`** in your browser to access the live dashboard.

---

## Stages Implemented (Stages 1 – 19) ✅

| Stage | Title | Description |
|-------|-------|-------------|
| 1 | **Project Foundation** | FastAPI backend, WebSocket streaming engine, SQLite event persistence, domain schemas, 4-zone virtual room coordinate system. |
| 2 | **Image & Video Input** | Multi-source OpenCV camera workers (files, webcams, image sequences), frame resizing, FPS throttling, and buffer management. |
| 3 | **Person & Object Detection** | Standardized detection interfaces supporting Ultralytics YOLO with fallback detection support. |
| 4 | **Person Tracking** | Per-camera centroid tracker maintaining identity IDs, positions, velocity, trajectory, and bounding boxes. |
| 5 | **Activity & Motion Analysis** | Farnebäck optical flow, frame differencing, box displacement, temporal smoothing, and 0–3 activity scale. |
| 6 | **Multi-Camera Fusion** | Spatial overlap fusion mapping camera tracks into a unified 3D/2D room coordinate space. |
| 7 | **Thermal-Zone Assignment** | Zone assignment engine tracking occupant counts, person IDs, activity levels, device loads, lighting loads, and indoor environmental conditions per zone. |
| 8 | **Device & Lighting Analysis** | Equipment tracking (PCs, laptops, monitors, servers, machines, lights) with configurable power assumption tables (`config/device_power.json`). |
| 9 | **Environmental Data** | Integration of indoor environmental telemetry (temperature, humidity, CO₂, lighting, occupancy). |
| 10 | **Outdoor Weather** | Live weather integration using Open-Meteo API and historical weather dataset support. |
| 11 | **HVAC Data & Behaviour** | Ingestion of HVAC operational datasets (`hvac_data_cleaned.parquet`) extracting relationships between damper states, power consumption, supply/outlet temperatures, and outdoor conditions. Configurable HVAC system setup (`config/hvac_config.json`). |
| 12 | **Transparent Heat-Load Model** | Zone-by-zone heat load calculator computing human metabolic heat, device heat, lighting load, solar heat gain, wall conduction, window heat transfer, and door infiltration effects. |
| 13 | **Thermal Response Model** | Physics-inspired zone dynamic thermal differential equations modeling temperature changes over time, inter-zone wall heat coupling, and HVAC cooling capacities. |
| 14 | **Unified Project Dataset Builder** | Time-series dataset synthesizer combining occupancy, device power, weather, HVAC states, and target future temperatures ($T_{+15m}$, $T_{+30m}$, $T_{+60m}$). |
| 15 | **Machine Learning Thermal Models** | Multi-model ML pipeline evaluating Random Forest, Gradient Boosting, XGBoost, and Ridge models to predict future room temperatures. |
| 16 | **Energy Prediction Model** | Power and kWh energy prediction model estimating active HVAC power and total room energy consumption. |
| 17 | **HVAC Control Engine & Vent Valve Optimizer** | Intelligent decision engine computing dynamic setpoints, AC ON/OFF status, fan speed, airflow CFM, **Overall Zone Valve Opening Percentage (0–100%)**, and **Individual Vent Valve Opening %** for every vent installed in each zone. |
| 18 | **Real-Time Integration & Automated Vision Sensing** | 100% automated computer vision sunlight glare & window infiltration detection (no manual selection). High-visibility bounding box preview renderer with filled label background pills. WebSocket live telemetry broadcasting to web dashboard UI. |
| 19 | **Performance Optimization** | Vision pipeline latency profiling (`VisionPerformanceProfiler`), per-frame processing & YOLO inference timer instrumentation, occupancy heatmap generation via homography-mapped pixel coordinates, FPS tracking, and live performance metrics endpoint (`/api/vision/performance`). |
| 20 | **Fast-Forward Simulation Engine** | Accelerated time-step simulation engine (`simulation/engine.py`) running up to 24 hours of room thermal dynamics in seconds. Physics ODE integrator with 1-minute timesteps, proportional HVAC valve control, inter-zone thermal coupling, diurnal solar/weather models, occupancy schedules, and energy accumulation. REST endpoint `POST /api/simulation/run`. Interactive frontend panel with Chart.js temperature timeline and per-zone summary cards (avg/peak/min temp, energy kWh, comfort %). |

---

## Pending Stages (Stages 21 – 25)

> **Note:** README is updated at the completion of every stage.

| Stage | Title | Description |
|-------|-------|-------------|
| 21 | **Digital Twin** | Interactive 2D/3D visual spatial model representing real-time occupant markers, heat maps, and airflow vectors. |
| 22 | **What-If Scenario Analysis** | Interactive scenario tester (e.g., *"What if 10 extra people enter Zone 1 during a 35°C heatwave?"*). |
| 23 | **Digital Twin Scenario Comparison** | Side-by-side comparison matrix of different energy-saving vs. comfort-maximizing HVAC policies. |
| 24 | **Final Frontend** | Full UI design polish, executive reporting dashboard, and theme refinements. |
| 25 | **Final Evaluation** | End-to-end system benchmarking and performance evaluation metrics. |

---

## Feature Categorization by Domain

### Domain 1: Image / Video Processing & Computer Vision

| Feature | Status |
|---------|--------|
| Multi-source OpenCV Ingestion: Supports local video files, webcams, and image sequence directories | ✅ Implemented |
| Preprocessing & Motion Analysis: Resize, FPS throttling, frame differencing, and Farnebäck optical flow | ✅ Implemented |
| Object & Person Detection: Ultralytics YOLO adapter with confidence thresholding | ✅ Implemented |
| Per-Camera Person Tracking: Centroid tracker with unique ID tracking, velocity, and trajectory history | ✅ Implemented |
| Spatial Multi-Camera Fusion: Overlap mapping into a unified 3D/2D room coordinate space | ✅ Implemented |
| High-Visibility Preview Bounding Boxes: Thick colored rectangles with filled background text pills for occupants, laptops, monitors, phones, and lights | ✅ Implemented |
| Automated Window & Sunlight Infiltration Detection: Vision analysis of perimeter luminance glare and contrast | ✅ Implemented |
| Vision Pipeline Performance Profiling: Per-frame latency timers, FPS tracking, occupancy heatmap via homography mapping | ✅ Implemented (Stage 19) |
| Camera Homography Calibration Wizard | 🔮 Future Scope |
| Automated Visual Anomaly / Intrusion Detection | 🔮 Future Scope |

### Domain 2: HVAC & Building Management System (BMS)

| Feature | Status |
|---------|--------|
| HVAC Dataset Ingestion: Ingests `hvac_data_cleaned.parquet` to model damper vs. power relationships | ✅ Implemented |
| Configurable HVAC System Specs: Supports VAV, Chilled Water FCU, and VRF Multi-Split architectures | ✅ Implemented |
| Zone Heat-Load Model: Transparent calculation of human metabolic heat, device heat, lighting load, solar heat gain, wall conduction, window heat transfer, and door infiltration | ✅ Implemented |
| Live Weather Telemetry: Integrated with live Open-Meteo API (outdoor_temperature, solar_radiation, humidity) | ✅ Implemented |
| Dynamic Zone Valve Opening Percentage: Calculates overall valve opening (0–100%) based on heat load & target setpoint | ✅ Implemented |
| Per-Vent Valve Modulation & Airflow CFM: Individual valve percentage and CFM allocation for every vent in each active zone | ✅ Implemented |
| AC ON / STANDBY & Fan Speed Controller: Automated mode switching and fan speed selection | ✅ Implemented |
| Non-Hardcoded Zone Lighting Configuration: Configurable fixture count and wattage rating per zone | ✅ Implemented |

### Domain 3: Machine Learning (ML)

| Feature | Status |
|---------|--------|
| Unified Project Time-Series Dataset Builder: Synthesizes occupancy, heat load, weather, HVAC states, and future temperature targets into `unified_project_dataset.csv` | ✅ Implemented |
| Multi-Model Thermal Forecasting: Evaluates XGBoost, Random Forest, Gradient Boosting, and Ridge models | ✅ Implemented |
| Multi-Horizon Temperature Predictions: Predicts future zone temperatures at +15m, +30m, and +60m horizons | ✅ Implemented |
| Model Evaluation Metrics: Automated RMSE, MAE, and R² model comparison | ✅ Implemented |
| HVAC Power & Energy Prediction Model: Predicts active power (W) and energy consumption (kWh) | ✅ Implemented |
| Deep Reinforcement Learning (DRL) HVAC Controller (PPO / SAC) | 🔮 Future Scope |

### Domain 4: Digital Twin & Simulation

| Feature | Status |
|---------|--------|
| Physics Dynamic Thermal Response Model: Zone temperature ODE differential equations (dT/dt) | ✅ Implemented |
| Inter-Zone Wall Thermal Coupling: Heat transfer exchange between adjacent room quadrants | ✅ Implemented |
| 2D Live Grid Room Dashboard: Real-time quadrant occupancy, device load, and valve opening status | ✅ Implemented |
| Fast-Forward Accelerated Time-Step Simulation Engine: 1-min ODE steps, diurnal weather, occupancy schedules, HVAC auto-control, energy accumulation, Chart.js timeline (Stage 20) | ✅ Implemented |
| Interactive 3D/2D Spatial Digital Twin with Airflow Vector Fields (Stage 21) | 🔮 Future Scope |
| Interactive "What-If" Scenario Analysis Engine (Stage 22) | 🔮 Future Scope |
| Digital Twin Policy Comparison Matrix (Stage 23) | 🔮 Future Scope |

---

## Project Structure

```
VisionHive/
├── backend/          # FastAPI app, config, realtime WebSocket, schemas
├── vision/           # Camera workers, detection, tracking, fusion, analytics, homography
├── thermal/          # Zone state manager, heat-load calculator, thermal response
├── environment/      # Indoor telemetry & outdoor weather integration
├── hvac/             # HVAC config, dataset loader, control engine
├── ml/               # Thermal & energy prediction model pipelines
├── config/           # device_power.json, hvac_config.json, cameras.json, etc.
├── frontend/         # Web dashboard UI (HTML/CSS/JS)
├── data/             # HVAC datasets and generated project datasets
└── README.md
```

---

> **Update Policy:** This README is updated at the completion of every stage to reflect the latest implemented features and pending roadmap.
