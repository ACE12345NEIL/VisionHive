import sqlite3
from pathlib import Path
from datetime import datetime
DB_PATH=Path(__file__).resolve().parents[1]/'data/database/visionhive.db'
def initialize():
    DB_PATH.parent.mkdir(parents=True,exist_ok=True)
    with sqlite3.connect(DB_PATH) as c:
        c.execute('CREATE TABLE IF NOT EXISTS camera_events(id INTEGER PRIMARY KEY, timestamp TEXT, camera_id TEXT, event_type TEXT, payload_json TEXT)')
def save_event(camera_id,event_type,payload_json):
    with sqlite3.connect(DB_PATH) as c:
        c.execute('INSERT INTO camera_events(timestamp,camera_id,event_type,payload_json) VALUES(?,?,?,?)',(datetime.now().isoformat(),camera_id,event_type,payload_json))
