/**
 * VisionHive - Stage 22: What-If Scenario Analysis Engine
 */

(function () {
  'use strict';

  let whatIfChart = null;
  let currentPresets = [];
  let selectedPresetId = 'heatwave_surge';

  /* ── Init ───────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    const container = document.getElementById('whatif-preset-buttons');
    if (!container) return;

    // Load presets from backend
    try {
      const res = await fetch('/api/scenarios/presets');
      if (res.ok) {
        const raw = await res.json();
        // Each item has keys: id, name, description, ...
        currentPresets = raw;
        buildButtons();
      } else {
        console.warn('Presets fetch failed:', res.status);
      }
    } catch (err) {
      console.warn('Could not load presets:', err);
    }

    // Wire run button
    const runBtn = document.getElementById('whatif-run-btn');
    if (runBtn) runBtn.addEventListener('click', runScenario);
  }

  /* ── Build preset buttons ───────────────────────────── */
  function buildButtons() {
    const container = document.getElementById('whatif-preset-buttons');
    if (!container) return;
    container.innerHTML = '';

    currentPresets.forEach(preset => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = preset.name;
      btn.dataset.presetId = preset.id;
      // Start with correct active state
      btn.className = 'whatif-preset-btn' + (preset.id === selectedPresetId ? ' active' : '');
      btn.addEventListener('click', () => onSelectPreset(preset.id));
      container.appendChild(btn);
    });

    updateDesc();
  }

  function onSelectPreset(id) {
    selectedPresetId = id;
    // Update active class without re-rendering
    document.querySelectorAll('#whatif-preset-buttons .whatif-preset-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.presetId === id);
    });
    updateDesc();
  }

  function updateDesc() {
    const el = document.getElementById('whatif-preset-desc');
    if (!el) return;
    const preset = currentPresets.find(p => p.id === selectedPresetId);
    el.textContent = preset ? preset.description : '';
  }

  /* ── Run scenario ───────────────────────────────────── */
  async function runScenario() {
    const statusEl = document.getElementById('whatif-status');
    const runBtn = document.getElementById('whatif-run-btn');
    const resultsEl = document.getElementById('whatif-results');

    if (statusEl) statusEl.textContent = '⏳ Running baseline vs scenario simulation…';
    if (runBtn) { runBtn.disabled = true; runBtn.textContent = '⏳ Running…'; }

    try {
      const res = await fetch('/api/scenarios/what-if', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset_id: selectedPresetId })
      });

      const data = await res.json();

      if (!res.ok) {
        const msg = data.detail || JSON.stringify(data);
        if (statusEl) statusEl.textContent = `❌ Server error ${res.status}: ${msg}`;
        return;
      }

      if (!data.success) {
        if (statusEl) statusEl.textContent = `❌ Simulation error: ${data.error || 'unknown'}`;
        return;
      }

      if (statusEl) statusEl.textContent = `✅ Done: ${data.scenario_name}`;
      if (resultsEl) resultsEl.style.display = 'block';
      renderKPI(data);
      renderChart(data);

    } catch (err) {
      console.error('What-If error:', err);
      if (statusEl) statusEl.textContent = `❌ Network error — is the server running?`;
    } finally {
      if (runBtn) { runBtn.disabled = false; runBtn.textContent = '⚡ Run Scenario Simulation'; }
    }
  }

  /* ── Render KPI cards ───────────────────────────────── */
  function renderKPI(data) {
    const el = document.getElementById('whatif-kpi-cards');
    if (!el) return;

    const kpi = data.kpi_summary;
    const kwhSign = kpi.kwh_delta >= 0 ? '+' : '';
    const tmpSign = kpi.temp_delta >= 0 ? '+' : '';
    const kwhColor = kpi.kwh_delta > 0 ? '#fb7185' : '#34d399';
    const tmpColor = kpi.temp_delta > 0 ? '#f59e0b' : '#34d399';

    const riskColors = {
      HIGH_THERMAL_STRESS: '#fb7185',
      OVERCOOLING: '#38bdf8',
      COMFORT_DEGRADATION: '#f59e0b',
      NORMAL: '#34d399'
    };

    const riskRows = data.zone_comparisons.map(z => {
      const col = riskColors[z.risk_status] || '#94a3b8';
      const dSign = z.temp_delta >= 0 ? '+' : '';
      return `<div class="whatif-risk-chip" style="border-left:3px solid ${col}">
        <span class="chip-zone">${z.zone_id.toUpperCase()}</span>
        <span class="chip-temp">${z.scenario_avg_temp.toFixed(1)}°C (${dSign}${z.temp_delta.toFixed(1)}°C)</span>
        <span class="chip-status" style="color:${col}">${z.risk_status.replace(/_/g,' ')}</span>
      </div>`;
    }).join('');

    el.innerHTML = `
      <div class="sim-card">
        <div class="sim-card-title">HVAC Energy Impact</div>
        <div class="sim-card-val" style="color:${kwhColor}">${kwhSign}${kpi.kwh_delta.toFixed(1)} kWh</div>
        <div class="sim-card-sub">Baseline ${kpi.baseline_kwh.toFixed(1)} kWh → Scenario ${kpi.scenario_kwh.toFixed(1)} kWh (${kwhSign}${kpi.kwh_pct_change.toFixed(1)}%)</div>
      </div>
      <div class="sim-card">
        <div class="sim-card-title">Avg Zone Temp Delta</div>
        <div class="sim-card-val" style="color:${tmpColor}">${tmpSign}${kpi.temp_delta.toFixed(1)} °C</div>
        <div class="sim-card-sub">Baseline ${kpi.baseline_avg_temp.toFixed(1)}°C → Scenario ${kpi.scenario_avg_temp.toFixed(1)}°C</div>
      </div>
      <div class="sim-card">
        <div class="sim-card-title">Peak Thermal Stress</div>
        <div class="sim-card-val" style="color:#f59e0b">${kpi.scenario_max_temp.toFixed(1)} °C</div>
        <div class="sim-card-sub">Max zone peak (Δ${kpi.max_temp_delta >= 0 ? '+' : ''}${kpi.max_temp_delta.toFixed(1)}°C vs baseline)</div>
      </div>
      <div class="sim-card wide-card">
        <div class="sim-card-title">Zone Thermal Risk</div>
        <div class="whatif-risk-grid">${riskRows}</div>
      </div>`;
  }

  /* ── Render Chart ───────────────────────────────────── */
  function renderChart(data) {
    const canvas = document.getElementById('whatif-chart');
    if (!canvas) return;

    const tl = data.timeline_comparison;
    const labels = tl.hours.map(h => `${h}:00`);

    const palette = {
      'zone-3': { base: '#34d399', scen: '#f59e0b' },
      'zone-4': { base: '#818cf8', scen: '#fb7185' },
      'zone-1': { base: '#38bdf8', scen: '#f43f5e' },
      'zone-2': { base: '#a78bfa', scen: '#fb923c' }
    };

    const datasets = [];
    Object.entries(tl.zones).forEach(([zid, vals]) => {
      const col = palette[zid] || { base: '#94a3b8', scen: '#f43f5e' };
      datasets.push({
        label: `${zid.toUpperCase()} Baseline`,
        data: vals.baseline,
        borderColor: col.base,
        borderDash: [5, 4],
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.3
      });
      datasets.push({
        label: `${zid.toUpperCase()} Scenario`,
        data: vals.scenario,
        borderColor: col.scen,
        borderWidth: 2.5,
        pointRadius: 0,
        tension: 0.3
      });
    });

    if (whatIfChart) whatIfChart.destroy();
    whatIfChart = new Chart(canvas, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: '#94a3b8', font: { size: 11 } } },
          tooltip: {
            backgroundColor: 'rgba(13,21,22,.95)',
            titleColor: '#2dd4bf',
            bodyColor: '#e7f3f1',
            borderColor: 'rgba(45,212,191,.2)',
            borderWidth: 1
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(45,212,191,.05)' },
            ticks: { color: '#7f9997', font: { size: 10 }, maxTicksLimit: 13 }
          },
          y: {
            grid: { color: 'rgba(45,212,191,.05)' },
            ticks: { color: '#7f9997', font: { size: 10 } },
            title: { display: true, text: 'Temperature (°C)', color: '#7f9997' }
          }
        }
      }
    });
  }

})();
