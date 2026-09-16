from __future__ import annotations
import json
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

ROOT=Path(__file__).resolve().parents[1]; LOCATION=ROOT/'config/location.json'
def location(): return json.loads(LOCATION.read_text())
def _get(url):
    with urlopen(url,timeout=12) as response: return json.loads(response.read().decode())
def set_location(query: str):
    data=_get('https://geocoding-api.open-meteo.com/v1/search?'+urlencode({'name':query,'count':1,'language':'en','format':'json'}))
    if not data.get('results'): raise ValueError('Location not found. Include city and country, e.g. Pune, India.')
    match=data['results'][0]; value={'name':', '.join(x for x in [match['name'],match.get('admin1'),match.get('country')] if x),'latitude':match['latitude'],'longitude':match['longitude'],'timezone':match.get('timezone','auto')}
    LOCATION.write_text(json.dumps(value,indent=2)); return value
def current_weather():
    loc=location()
    if loc['latitude'] is None: raise ValueError('Set the room location first.')
    fields='temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_direction_10m,shortwave_radiation'
    data=_get('https://api.open-meteo.com/v1/forecast?'+urlencode({'latitude':loc['latitude'],'longitude':loc['longitude'],'current':fields,'timezone':loc['timezone']})); current=data['current']
    return {'timestamp':current['time'],'outdoor_temperature':current.get('temperature_2m'),'outdoor_humidity':current.get('relative_humidity_2m'),'rainfall':current.get('precipitation'),'wind_speed':current.get('wind_speed_10m'),'wind_direction':current.get('wind_direction_10m'),'solar_radiation':current.get('shortwave_radiation'),'source':'real_weather_api','location':loc}
