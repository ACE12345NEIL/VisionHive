from __future__ import annotations
import csv
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
DATASETS={
 'room-occupancy-detection':ROOT/'data/raw/room-occupancy-detection/Occupancy.csv',
 'room-occupancy-estimation':ROOT/'data/raw/room-occupancy-estimation/room occupancy.csv'
}
ALIASES={'indoor_temperature':['temperature','Temperature'],'indoor_humidity':['humidity','Humidity'],'indoor_co2':['co2','CO2'],'indoor_light':['light','Light'],'occupancy':['occupancy','Occupancy','Room_Occupancy_Count']}

def _number(value):
    try: return float(value)
    except (TypeError,ValueError): return None

def normalise(row: dict) -> dict:
    result={'timestamp':datetime.now(timezone.utc).isoformat(),'indoor_temperature':None,'indoor_humidity':None,'indoor_co2':None,'indoor_light':None,'occupancy':None,'source':'historical_dataset'}
    for output,names in ALIASES.items():
        for name in names:
            if name in row: result[output]=_number(row[name]); break
    if 'time' in row: result['timestamp']=row['time']
    elif 'Date' in row and 'Time' in row: result['timestamp']=f"{row['Date']} {row['Time']}"
    return result

def latest_from(dataset_id: str) -> dict:
    path=DATASETS.get(dataset_id)
    if not path or not path.exists(): raise FileNotFoundError(f'Dataset not found: {dataset_id}')
    with path.open(encoding='utf-8-sig',newline='') as file:
        row=None
        for row in csv.DictReader(file): pass
    if row is None: raise ValueError('Dataset is empty')
    return normalise(row)
