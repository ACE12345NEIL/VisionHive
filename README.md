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

## Stages Implemented (Stages 1 – 18)

1. **Project Foundation**: FastAPI backend, WebSocket streaming engine, SQLite event persistence, domain schemas, 4-zone virtual room coordinate system.
2. **Image & Video Input**: Multi-source OpenCV camera workers (files, webcams, image sequences), frame resizing, FPS throttling, and buffer management.
3. **Person & Object Detection**: Standardized detection interfaces supporting Ultralytics YOLO with fallback detection support.
4. **Person Tracking**: Per-camera centroid tracker maintaining identity IDs, positions, velocity, trajectory, and bounding boxes.
5. **Activity & Motion Analysis**: Farnebäck optical flow, frame differencing, box displacement, temporal smoothing, and 0–3 activity scale.
6. **Multi-Camera Fusion**: Spatial overlap fusion mapping camera tracks into a unified 3D/2D room coordinate space.
7. **Thermal-Zone Assignment**: Zone assignment engine tracking occupant counts, person IDs, activity levels, device loads, lighting loads, and indoor environmental conditions per zone.
8. **Device & Lighting Analysis**: Equipment tracking (PCs, laptops, monitors, servers, machines, lights) with configurable power assumption tables (`config/device_power.json`).
9. **Environmental Data**: Integration of indoor environmental telemetry (temperature, humidity, CO₂, lighting, occupancy).
10. **Outdoor Weather**: Live weather integration using Open-Meteo API and historical weather dataset support.
11. **HVAC Data & Behaviour**: Ingestion of HVAC operational datasets (`hvac_data_cleaned.parquet`) extracting relationships between damper states, power consumption, supply/outlet temperatures, and outdoor conditions. Configurable HVAC system setup (`config/hvac_config.json`).
12. **Transparent Heat-Load Model**: Zone-by-zone heat load calculator computing human metabolic heat, device heat, lighting load, solar heat gain, wall conduction, window heat transfer, and door infiltration effects.
13. **Thermal Response Model**: Physics-inspired zone dynamic thermal differential equations modeling temperature changes over time, inter-zone wall heat coupling, and HVAC cooling capacities.
14. **Unified Project Dataset Builder**: Time-series dataset synthesizer combining occupancy, device power, weather, HVAC states, and target future temperatures ($T_{+15m}$, $T_{+30m}$, $T_{+60m}$).
15. **Machine Learning Thermal Models**: Multi-model ML pipeline evaluating Random Forest, Gradient Boosting, XGBoost, and Ridge models to predict future room temperatures.
16. **Energy Prediction Model**: Power and kWh energy prediction model estimating active HVAC power and total room energy consumption.
17. **HVAC Control Engine & Vent Valve Optimizer**: Intelligent decision engine computing dynamic setpoints, AC ON/OFF status, fan speed, airflow CFM, **Overall Zone Valve Opening Percentage (0–100%)**, and **Individual Vent Valve Opening %** for every vent installed in each zone.
18. **Real-Time Integration & Automated Vision Sensing**: 
    - 100% automated computer vision sunlight glare & window infiltration detection (no manual selection).
    - High-visibility bounding box preview renderer with filled label background pills.
    - WebSocket live telemetry broadcasting to web dashboard UI.

---

## Pending Stages (Stages 19 – 25)

- **Stage 19 — Performance Optimization**: Video stream latency reduction, WebSocket frame payload compression, and ML inference thread tuning.
- **Stage 20 — Final Simulation Engine**: Fast-forward simulation sandbox allowing users to simulate hours of thermal dynamics across accelerated time steps.
- **Stage 21 — Digital Twin**: Interactive 2D/3D spatial model visualizing real-time occupant markers, heat maps, and airflow vectors.
- **Stage 22 — What-If Scenario Analysis**: Interactive scenario tester (e.g., *"What happens if 10 people enter Zone 1 during a 35°C heatwave?"*).
- **Stage 23 — Digital Twin Scenario Comparison**: Side-by-side comparison of different energy-saving vs. comfort-maximizing control policies.
- **Stage 24 — Final Frontend**: Full UI design polish, executive reporting dashboard, and theme refinements.
- **Stage 25 — Final Evaluation**: Comprehensive system benchmarking and performance evaluation.

---

## Feature Categorization by Domain

### 1. Image / Video Processing & Computer Vision
- [x] Multi-source OpenCV video ingestion (files, webcams, image sequences)
- [x] Frame resizing, FPS throttling, and motion preprocessing
- [x] Object & Person Detection via Ultralytics YOLO
- [x] Per-Camera Centroid Tracking with trajectory & velocity vectors
- [x] Motion & Activity Analysis (Farnebäck optical flow & temporal smoothing)
- [x] Spatial Multi-Camera Fusion & Overlap Resolution
- [x] High-Visibility Bounding Boxes with solid background text pills
- [x] Computer Vision Equipment Detection (Laptops, Monitors, Phones, Chairs)
- [x] Automated Computer Vision Window Open & Sunlight Infiltration Detection
- [ ] *[Future Scope]* Camera Homography Calibration Wizard & 3D Extrinsic Pose Estimation
- [ ] *[Future Scope]* Automated Visual Anomaly / Intrusion Detection

### 2. HVAC & Building Management System (BMS)
- [x] HVAC Operational Dataset Ingestion (`hvac_data_cleaned.parquet`)
- [x] Configurable HVAC System Architecture (VAV, Chilled Water FCU, VRF Multi-Split)
- [x] Zone-Level Transparent Heat-Load Engine (Human, Device, Lighting, Solar, Wall, Window, Door)
- [x] Live Open-Meteo Outdoor Weather API Integration
- [x] Dynamic Zone Valve Opening Percentage Calculation (0–100%)
- [x] Per-Vent Valve Opening Modulation & Airflow CFM Allocation
- [x] AC ON / STANDBY State Switching & Fan Speed Control
- [x] Non-Hardcoded Zone Lighting Configuration (Fixture count & Wattage rating)
- [ ] *[Future Scope]* BACnet / Modbus Hardware Protocol Gateway Integration
- [ ] *[Future Scope]* Multi-Chiller Plant Optimization & Supply Air Temperature Reset Strategies

### 3. Machine Learning (ML)
- [x] Time-Series Unified Project Dataset Generator (`unified_project_dataset.csv`)
- [x] Multi-Model Thermal Prediction Pipeline (XGBoost, Random Forest, Gradient Boosting, Ridge)
- [x] Multi-Horizon Future Temperature Forecasting ($T_{+15m}$, $T_{+30m}$, $T_{+60m}$)
- [x] Model Evaluation Suite (RMSE, MAE, $R^2$ metrics comparison)
- [x] Active HVAC Power & Energy Consumption Model ($W$ and $kWh$)
- [ ] *[Future Scope]* Deep Reinforcement Learning (DRL) HVAC Controller (PPO / SAC algorithm)
- [ ] *[Future Scope]* Automated Online Model Retraining & Concept Drift Detection

### 4. Digital Twin & Simulation
- [x] Physics-Inspired Zone Dynamic Thermal Response Model ($\frac{dT}{dt}$ differential ODEs)
- [x] Inter-Zone Wall Thermal Coupling Exchange Model
- [x] 2D Grid Room Occupancy & Zone Status Dashboard
- [ ] *[Future Scope]* Stage 20 — Fast-Forward Time-Step Simulation Engine (Simulating hours in seconds)
- [ ] *[Future Scope]* Stage 21 — Interactive 2D/3D Spatial Digital Twin with Airflow Vector Fields
- [ ] *[Future Scope]* Stage 22 — Interactive "What-If" Scenario Analysis Engine
- [ ] *[Future Scope]* Stage 23 — Side-by-Side Digital Twin Scenario Comparison Matrix
