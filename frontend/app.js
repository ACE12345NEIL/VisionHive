const status = document.querySelector('#status');
const cameras = document.querySelector('#cameras');
const zones = document.querySelector('#zones');
const fusionStatus = document.querySelector('#fusion-status');
const environmentStatus = document.querySelector('#environment-status');
const hvacPowerBadge = document.querySelector('#hvac-power-badge');
const hvacValveCards = document.querySelector('#hvac-valve-cards');
const thermalPredictionsCards = document.querySelector('#thermal-predictions-cards');
const trainMlBtn = document.querySelector('#train-ml-btn');
const ventSelectorsGrid = document.querySelector('#vent-selectors-grid');

const labels = ['Stationary', 'Low', 'Medium', 'High'];
const cards = new Map();
let assignments = {};
let hvacConfig = {};

const ZONE_NAMES = {
  'zone-1': 'Zone 1 (North West)',
  'zone-2': 'Zone 2 (North East)',
  'zone-3': 'Zone 3 (South West)',
  'zone-4': 'Zone 4 (South East)'
};

function updateCamerasLayout() {
  const cameraElements = Array.from(cameras.querySelectorAll('.camera'));
  const count = cameraElements.length;

  cameras.classList.remove('layout-2', 'layout-quadrant');

  if (count === 2) {
    cameras.classList.add('layout-2');
    cameraElements.forEach(el => el.style.gridArea = 'auto');
  } else if (count >= 3) {
    cameras.classList.add('layout-quadrant');
    cameraElements.forEach(el => {
      const select = el.querySelector('select');
      const zid = select ? select.value : '';
      if (zid === 'zone-1') el.style.gridArea = '1 / 1';       // North West (top-left)
      else if (zid === 'zone-2') el.style.gridArea = '1 / 2';  // North East (top-right)
      else if (zid === 'zone-3') el.style.gridArea = '2 / 1';  // South West (bottom-left)
      else if (zid === 'zone-4') el.style.gridArea = '2 / 2';  // South East (bottom-right)
      else el.style.gridArea = 'auto';
    });
  }
}

function cameraCard(id, name = id) {
  if (cards.has(id)) return cards.get(id);
  const element = document.createElement('div');
  element.className = 'camera';
  element.innerHTML = `
    <div class="camhead"><b>${name}</b><span class="fps">Waiting</span></div>
    <label class="zone-picker">Zone 
      <select>
        <option value="">Not assigned</option>
        <option value="zone-1">Zone 1 · North West</option>
        <option value="zone-2">Zone 2 · North East</option>
        <option value="zone-3">Zone 3 · South West</option>
        <option value="zone-4">Zone 4 · South East</option>
      </select>
    </label>
    <img class="preview" alt="${name} processed video">
    <strong class="count">0</strong> tracked people 
    <div class="tracks">Awaiting frames…</div>
    <div class="devices">Awaiting device detections…</div>
  `;
  const select = element.querySelector('select');
  select.value = assignments[id] || '';
  select.onchange = async () => {
    const zone_id = select.value || null;
    const response = await fetch(`/api/camera-zones/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zone_id })
    });
    if (response.ok) {
      assignments = await response.json();
      updateCamerasLayout();
      renderVentSelectors();
      fetchHvacControl();
    }
  };
  cameras.classList.remove('empty');
  cameras.append(element);
  const card = {
    element: element,
    image: element.querySelector('.preview'),
    fps: element.querySelector('.fps'),
    count: element.querySelector('.count'),
    tracks: element.querySelector('.tracks'),
    devices: element.querySelector('.devices'),
    loading: false,
    lastPreview: 0,
    url: null
  };
  cards.set(id, card);
  updateCamerasLayout();
  return card;
}

async function refreshPreview(id, card) {
  const now = Date.now();
  if (card.loading || now - card.lastPreview < 200) return;
  card.loading = true;
  try {
    const response = await fetch(`/api/cameras/${id}/frame.jpg?${now}`, { cache: 'no-store' });
    if (!response.ok) return;
    const nextUrl = URL.createObjectURL(await response.blob());
    const priorUrl = card.url;
    card.image.onload = () => { if (priorUrl) URL.revokeObjectURL(priorUrl); };
    card.image.src = nextUrl;
    card.url = nextUrl;
    card.lastPreview = now;
  } finally {
    card.loading = false;
  }
}

function renderZones(items) {
  zones.innerHTML = items.map(z => {
    const devCounts = Object.entries(z.device_counts || {}).map(([kind, count]) => `${kind}: ${count}`).join(' · ');
    return `
      <div class="zone">
        <b>${z.name}</b>
        <span>👥 ${z.people_count || 0} people · ${z.device_load_w || 0} W devices</span>
        <span>💡 ${z.light_count || 0} lights · ${z.lighting_load_w || 0} W</span>
        ${devCounts ? `<span>🖥️ Equipment: ${devCounts}</span>` : ''}
        <span>🏃 Activity: ${Object.entries(z.activity_levels || {}).filter(([, n]) => n).map(([a, n]) => `${n} ${a}`).join(' · ') || 'No activity observed'}</span>
      </div>
    `;
  }).join('');
}

// Dynamically render vent selectors ONLY for camera-assigned active zones
function renderVentSelectors() {
  const activeZoneIds = new Set(Object.values(assignments).filter(Boolean));
  const displayZoneIds = activeZoneIds.size > 0 ? Array.from(activeZoneIds) : ['zone-1', 'zone-2', 'zone-3', 'zone-4'];
  const vCounts = hvacConfig.zone_vent_counts || {};

  ventSelectorsGrid.innerHTML = displayZoneIds.map(zid => {
    const currentCount = vCounts[zid] || 2;
    return `
      <div class="vent-item">
        <label>${ZONE_NAMES[zid] || zid}</label>
        <select id="vents-${zid}" class="vent-dropdown" data-zone="${zid}">
          <option value="1" ${currentCount === 1 ? 'selected' : ''}>1 Vent</option>
          <option value="2" ${currentCount === 2 ? 'selected' : ''}>2 Vents</option>
          <option value="3" ${currentCount === 3 ? 'selected' : ''}>3 Vents</option>
          <option value="4" ${currentCount === 4 ? 'selected' : ''}>4 Vents</option>
          <option value="5" ${currentCount === 5 ? 'selected' : ''}>5 Vents</option>
        </select>
      </div>
    `;
  }).join('');
}

// Load & Save HVAC Specs and Vent Controls
async function loadHvacConfig() {
  try {
    const response = await fetch('/api/hvac/config');
    if (response.ok) {
      hvacConfig = await response.json();
      document.querySelector('#hvac-system-type').value = hvacConfig.system_type || '';
      document.querySelector('#hvac-setpoint').value = hvacConfig.target_setpoint_c || 22.0;
      document.querySelector('#hvac-supply-temp').value = hvacConfig.supply_air_temp_c || 14.0;
      renderVentSelectors();
    }
  } catch (e) {
    console.error('Error loading HVAC config:', e);
  }
}

document.querySelector('#hvac-config-form').onsubmit = async (e) => {
  e.preventDefault();
  const zoneVentCounts = { ...(hvacConfig.zone_vent_counts || {}) };
  document.querySelectorAll('.vent-dropdown').forEach(sel => {
    const zid = sel.dataset.zone;
    if (zid) zoneVentCounts[zid] = parseInt(sel.value, 10);
  });

  const payload = {
    system_type: document.querySelector('#hvac-system-type').value,
    target_setpoint_c: parseFloat(document.querySelector('#hvac-setpoint').value),
    supply_air_temp_c: parseFloat(document.querySelector('#hvac-supply-temp').value),
    zone_vent_counts: zoneVentCounts
  };
  const response = await fetch('/api/hvac/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (response.ok) {
    hvacConfig = await response.json();
    alert('HVAC specifications and zone vent configuration saved!');
    fetchHvacControl();
  }
};

// Render Live Valve Control & Per-Vent Openings
function renderHvacControl(data) {
  if (!data || !data.zone_controls) return;

  hvacPowerBadge.textContent = `${data.total_hvac_power_w} W HVAC Power (${data.system_ac_state})`;

  if (data.zone_controls.length === 0) {
    hvacValveCards.innerHTML = `<div class="empty-msg">No active camera video feeds assigned to thermal zones.</div>`;
    thermalPredictionsCards.innerHTML = `<div class="empty-msg">No active camera video feeds assigned to thermal zones.</div>`;
    return;
  }

  hvacValveCards.innerHTML = data.zone_controls.map(z => {
    const ventChips = (z.vent_valves || []).map(v => `
      <div class="vent-chip">
        <span>${v.vent_label}:</span>
        <strong>${v.valve_opening_pct}% Valve</strong>
        <span style="color:var(--text-dim);">(${v.airflow_cfm} CFM)</span>
      </div>
    `).join('');

    return `
      <div class="valve-card">
        <div class="valve-card-head">
          <h4>${z.zone_name} (${z.vent_count} Vents)</h4>
          <span class="valve-status-tag ${z.ac_state.toLowerCase()}">${z.ac_state}</span>
        </div>
        <div style="font-size:12px;color:var(--text-dim);margin-bottom:6px;">
          Temp: <b>${z.current_temp_c}°C</b> (Setpoint: ${z.target_setpoint_c}°C) · Heat Load: <b>${z.heat_load_w} W</b>
        </div>
        
        <div class="valve-bar-wrap">
          <div class="valve-bar-head">
            <span>Overall Zone Valve Opening</span>
            <span><strong>${z.zone_valve_opening_pct}%</strong> (${z.total_zone_airflow_cfm} Total CFM)</span>
          </div>
          <div class="valve-bar-bg">
            <div class="valve-bar-fill" style="width:${z.zone_valve_opening_pct}%;"></div>
          </div>
        </div>

        <div style="font-size:11px;color:var(--text-dim);margin-top:6px;">Individual Vent Valves:</div>
        <div class="vent-valves-list">
          ${ventChips}
        </div>
      </div>
    `;
  }).join('');

  // Thermal Predictions Cards
  thermalPredictionsCards.innerHTML = data.zone_controls.map(z => `
    <div class="prediction-card">
      <b>${z.zone_name} Predictions</b>
      <div>Current Temp: ${z.current_temp_c}°C</div>
      <div class="prediction-pills">
        <div class="pred-pill">+15m: <span>${z.ml_predicted_temp_15m}°C</span></div>
        <div class="pred-pill">+30m: <span>${z.ml_predicted_temp_30m}°C</span></div>
        <div class="pred-pill">+60m: <span>${z.ml_predicted_temp_60m}°C</span></div>
      </div>
    </div>
  `).join('');
}

async function fetchHvacControl() {
  try {
    const res = await fetch('/api/hvac/control');
    if (res.ok) {
      const data = await res.json();
      renderHvacControl(data);
    }
  } catch (e) {
    console.error('Error fetching HVAC control state:', e);
  }
}

// Initial Fetch
Promise.all([
  fetch('/api/cameras').then(r => r.json()),
  fetch('/api/camera-zones').then(r => r.json()),
  loadHvacConfig()
]).then(([items, zones]) => {
  assignments = zones;
  items.filter(c => c.enabled).forEach(c => cameraCard(c.id, c.name));
  updateCamerasLayout();
  renderVentSelectors();
  fetchHvacControl();
});

// Train ML Models Button Handler
trainMlBtn.onclick = async () => {
  trainMlBtn.disabled = true;
  trainMlBtn.textContent = 'Training ML Models...';
  try {
    const res = await fetch('/api/hvac/train-models', { method: 'POST' });
    const result = await res.json();
    alert('Thermal & Energy ML Models trained successfully!\nModels: Random Forest, Gradient Boosting, XGBoost evaluated.');
    fetchHvacControl();
  } catch (e) {
    alert('Model training failed: ' + e);
  } finally {
    trainMlBtn.disabled = false;
    trainMlBtn.textContent = 'Train ML Models';
  }
};

async function refreshWeather() {
  const response = await fetch('/api/weather/current');
  const value = await response.json();
  environmentStatus.textContent = response.ok ? `${value.location.name} · ${value.outdoor_temperature} °C outside · ${value.outdoor_humidity}% RH · wind ${value.wind_speed} km/h · solar ${value.solar_radiation ?? 'n/a'} W/m² · live API` : `Weather: ${value}`;
}

document.querySelector('#location-form').onsubmit = async event => {
  event.preventDefault();
  const query = document.querySelector('#location-query').value;
  const response = await fetch('/api/location', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });
  const value = await response.json();
  if (!response.ok) {
    environmentStatus.textContent = `Location: ${value}`;
    return;
  }
  environmentStatus.textContent = `Room location set to ${value.name} (${value.latitude}, ${value.longitude}). Loading weather…`;
  refreshWeather();
};

document.querySelector('#weather-refresh').onclick = refreshWeather;
document.querySelector('#indoor-load').onclick = async () => {
  const response = await fetch('/api/environment/indoor/room-occupancy-detection');
  const value = await response.json();
  environmentStatus.textContent = response.ok ? `Historical occupancy dataset · ${value.indoor_temperature} °C · ${value.indoor_humidity}% RH · CO₂ ${value.indoor_co2} · occupancy ${value.occupancy}` : `Indoor dataset: ${value}`;
};

// WebSocket Live Stream
const ws = new WebSocket(`ws://${location.host}/ws/live`);
ws.onopen = () => {
  status.textContent = 'Live';
  status.className = 'live';
  ws.send('ready');
};
ws.onclose = () => {
  status.textContent = 'Offline';
  status.className = 'offline';
};

ws.onmessage = e => {
  const message = JSON.parse(e.data);
  if (message.type === 'room') renderZones(message.data.zones.map(z => ({ ...z, people_count: 0, device_load_w: 0, light_count: 0, lighting_load_w: 0 })));
  if (message.type === 'zone_state') renderZones(message.data.zones);
  if (message.type === 'fusion_state') {
    const d = message.data;
    fusionStatus.textContent = `${d.people_count} distinct people · ${d.mode === 'unconfigured' ? 'no verified camera overlap configured' : d.mode.replace('_', ' ')} · ${d.people.filter(p => p.fusion_status === 'merged').length} cross-camera matches`;
  }
  if (message.type === 'camera_frame_result') {
    const data = message.data, card = cameraCard(data.camera_id), tracks = data.tracks, detections = data.detections;
    card.fps.textContent = `${data.fps} FPS`;
    card.count.textContent = tracks.length;
    card.tracks.innerHTML = tracks.map(t => `<span>#${t.id.split(':')[1]} · ${labels[t.activity]} · ${t.motion_score}px</span>`).join('') || 'No people detected';
    
    // Display detected equipment/devices (non-person classes)
    const deviceDetections = (detections || []).filter(d => d.class_name !== 'person');
    if (deviceDetections.length > 0) {
      const counts = {};
      deviceDetections.forEach(d => { counts[d.class_name] = (counts[d.class_name] || 0) + 1; });
      card.devices.innerHTML = Object.entries(counts).map(([cls, cnt]) => `<span>🖥️ ${cls} x${cnt}</span>`).join(' · ');
    } else {
      card.devices.innerHTML = '<span style="color:var(--text-faint);">No equipment detected</span>';
    }

    refreshPreview(data.camera_id, card);
  }
  if (message.type === 'hvac_control_state') {
    renderHvacControl(message.data);
  }
};