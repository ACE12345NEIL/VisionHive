
// ─── Stage 20: Fast-Forward Simulation ──────────────────────────────────────
(function () {
  const form = document.getElementById('sim-form');
  const statusEl = document.getElementById('sim-status');
  const resultsEl = document.getElementById('sim-results');
  const summaryCardsEl = document.getElementById('sim-summary-cards');
  const runBtn = document.getElementById('sim-run-btn');
  let simChart = null;

  const ZONE_LABELS = {
    'zone-1': 'Zone 1 · NW',
    'zone-2': 'Zone 2 · NE',
    'zone-3': 'Zone 3 · SW',
    'zone-4': 'Zone 4 · SE',
  };

  const ZONE_COLORS = {
    'zone-1': '#38bdf8',
    'zone-2': '#fb923c',
    'zone-3': '#a78bfa',
    'zone-4': '#34d399',
  };

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    runBtn.disabled = true;
    runBtn.textContent = '⏳ Simulating…';
    statusEl.textContent = 'Running fast-forward simulation…';
    resultsEl.style.display = 'none';

    const payload = {
      hours: parseInt(document.getElementById('sim-hours').value),
      hvac_setpoint_c: parseFloat(document.getElementById('sim-setpoint').value),
      outdoor_temp_min: parseFloat(document.getElementById('sim-t-min').value),
      outdoor_temp_max: parseFloat(document.getElementById('sim-t-max').value),
      peak_solar_w_m2: parseFloat(document.getElementById('sim-solar').value),
      activity_level: document.getElementById('sim-activity').value,
      ac_enabled: document.getElementById('sim-ac').value === 'true',
    };

    try {
      const res = await fetch('/api/simulation/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      renderSimResults(data, payload.hvac_setpoint_c);
      statusEl.textContent = `✅ Simulated ${data.config_used.hours}h · ${data.config_used.steps_simulated.toLocaleString()} steps · Total Energy: ${data.total_energy_kwh} kWh`;
    } catch (err) {
      statusEl.textContent = `❌ Error: ${err.message}`;
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = '▶ Run Simulation';
    }
  });

  function renderSimResults(data, setpoint) {
    // Summary cards
    const zones = Object.entries(data.summary);
    summaryCardsEl.innerHTML = zones.map(([zid, s]) => `
      <div class="sim-zone-card" style="border-left: 3px solid ${ZONE_COLORS[zid] || '#64748b'}">
        <div class="sim-zone-title">${ZONE_LABELS[zid] || zid}</div>
        <div class="sim-zone-stat">Avg: <strong>${s.avg_temp_c}°C</strong></div>
        <div class="sim-zone-stat">Peak: <strong style="color:#f87171">${s.max_temp_c}°C</strong></div>
        <div class="sim-zone-stat">Min: <strong style="color:#34d399">${s.min_temp_c}°C</strong></div>
        <div class="sim-zone-stat">Energy: <strong>${s.total_energy_kwh} kWh</strong></div>
        <div class="sim-zone-stat">Comfort: <strong>${s.comfort_pct}%</strong></div>
      </div>
    `).join('');

    // Timeline chart
    const timeline = data.timeline;
    const labels = timeline.map(t => {
      const h = Math.floor(t.hour);
      const m = Math.round((t.hour - h) * 60);
      return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
    });

    const datasets = Object.keys(ZONE_LABELS).map(zid => ({
      label: ZONE_LABELS[zid],
      data: timeline.map(t => t.zones[zid]?.temp_c ?? null),
      borderColor: ZONE_COLORS[zid],
      backgroundColor: 'transparent',
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.4,
    }));

    // Setpoint line
    datasets.push({
      label: 'Setpoint',
      data: timeline.map(() => setpoint),
      borderColor: '#f59e0b',
      borderDash: [6, 3],
      borderWidth: 1.5,
      pointRadius: 0,
      tension: 0,
    });

    const ctx = document.getElementById('sim-chart').getContext('2d');
    if (simChart) simChart.destroy();
    simChart = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        animation: false,
        plugins: {
          legend: { labels: { color: '#cbd5e1', font: { size: 11 } } },
          tooltip: { mode: 'index', intersect: false },
        },
        scales: {
          x: {
            ticks: { color: '#64748b', maxTicksLimit: 12 },
            grid: { color: '#1e293b' },
          },
          y: {
            ticks: { color: '#64748b' },
            grid: { color: '#1e293b' },
            title: { display: true, text: 'Temperature (°C)', color: '#64748b' },
          },
        },
      },
    });

    resultsEl.style.display = 'block';
  }
})();
