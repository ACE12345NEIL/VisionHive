/**
 * Stage 21 — Digital Twin 2D/3D Visual Spatial Model & Interactive Layout Customizer.
 * Features:
 *  - High-Definition 1200x720 Canvas & 32x24 Heatmap Grid Resolution
 *  - Real-Time Continuous Point Inspection (hover anywhere to view live temperature & coordinates)
 *  - Auto Wall Snapping (drag doors/windows to North, South, East, West walls)
 *  - Endpoint Drag Resizing for Windows & Doors
 *  - Dynamic HVAC Vent Count Syncing (e.g. 5 vents per zone)
 *  - Add & Delete Windows / Doors with persistence (`room_layout.json`)
 *  - 1:1 Scaling Compensated Pointer Selection (Zero Offset)
 *  - Non-Overlapping Legend Placement (sit below canvas)
 */
(function() {
  const canvas = document.getElementById('digital-twin-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const tooltip = document.getElementById('twin-tooltip');

  // Layer & View States
  let viewMode = '2d';
  let showOccupants = true;
  let showHeatmap = true;
  let showVectors = true;
  let showElements = true;
  let animationFrameId = null;

  // State cache & local layout overrides
  let twinData = null;
  let hoveredObject = null;
  let selectedObject = null;
  let draggedObject = null;
  let resizeHandle = null; // 'handle1' or 'handle2'
  let dragOffsetM = { x: 0, y: 0 };
  let animTime = 0;

  let layoutCache = { vents: {}, windows: {}, doors: {} };

  // Airflow vector particles
  const MAX_PARTICLES = 120;
  const particles = [];
  for (let i = 0; i < MAX_PARTICLES; i++) {
    particles.push({
      x: 2.0, y: 1.5,
      age: Math.random() * 100,
      maxAge: 70 + Math.random() * 60,
      speedScale: 0.8 + Math.random() * 0.5
    });
  }

  function getThermalColor(tempC, alpha = 0.55) {
    const minT = 18.0;
    const maxT = 28.0;
    const ratio = Math.max(0, Math.min(1, (tempC - minT) / (maxT - minT)));

    let r, g, b;
    if (ratio < 0.2) {
      const t = ratio / 0.2;
      r = Math.round(30 + 10 * t); g = Math.round(100 + 100 * t); b = Math.round(230 + 20 * t);
    } else if (ratio < 0.4) {
      const t = (ratio - 0.2) / 0.2;
      r = Math.round(40 + 5 * t); g = Math.round(200 + 20 * t); b = Math.round(250 - 100 * t);
    } else if (ratio < 0.6) {
      const t = (ratio - 0.4) / 0.2;
      r = Math.round(45 + 175 * t); g = Math.round(220 + 20 * t); b = Math.round(150 - 110 * t);
    } else if (ratio < 0.8) {
      const t = (ratio - 0.6) / 0.2;
      r = Math.round(220 + 30 * t); g = Math.round(240 - 100 * t); b = Math.round(40 - 20 * t);
    } else {
      const t = (ratio - 0.8) / 0.2;
      r = Math.round(250); g = Math.round(140 - 90 * t); b = Math.round(20 + 10 * t);
    }
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function toScreen2D(x, y) {
    const marginX = 80;
    const marginY = 60;
    const availableW = canvas.width - marginX * 2;
    const availableH = canvas.height - marginY * 2;
    const scale = Math.min(availableW / 8.0, availableH / 6.0);
    const offsetX = (canvas.width - 8.0 * scale) / 2;
    const offsetY = (canvas.height - 6.0 * scale) / 2;
    return { x: offsetX + x * scale, y: offsetY + y * scale, scale: scale };
  }

  function toScreen3D(x, y, z = 0) {
    const scale = 62;
    const originX = canvas.width / 2;
    const originY = canvas.height / 2 + 45;
    const cos30 = 0.866;
    const sin30 = 0.5;

    const dx = x - 4.0;
    const dy = y - 3.0;

    const isoX = originX + (dx - dy) * cos30 * scale;
    const isoY = originY + (dx + dy) * sin30 * scale - z * scale * 1.05;
    return { x: isoX, y: isoY, scale: scale };
  }

  function getScreenCoords(x, y, z = 0) {
    return viewMode === '3d' ? toScreen3D(x, y, z) : toScreen2D(x, y);
  }

  function getCanvasMouseCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      mouseX: (e.clientX - rect.left) * scaleX,
      mouseY: (e.clientY - rect.top) * scaleY
    };
  }

  function screenToRoom2D(mouseX, mouseY) {
    const p0 = toScreen2D(0, 0);
    const p8 = toScreen2D(8.0, 6.0);
    const scale = (p8.x - p0.x) / 8.0;
    const rx = Math.max(0.0, Math.min(8.0, (mouseX - p0.x) / scale));
    const ry = Math.max(0.0, Math.min(6.0, (mouseY - p0.y) / scale));
    return { rx, ry, scale };
  }

  function distToSegment(px, py, x1, y1, x2, y2) {
    const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
    if (l2 === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
  }

  function getActiveZoneIds() {
    return new Set(twinData?.active_zone_ids || ['zone-1', 'zone-4']);
  }

  function applyLayoutOverridesToTwinData() {
    if (!twinData) return;
    if (twinData.vents) {
      twinData.vents.forEach(v => {
        if (layoutCache.vents[v.id]) {
          v.x = layoutCache.vents[v.id].x;
          v.y = layoutCache.vents[v.id].y;
        }
      });
    }
    if (twinData.architecture?.windows) {
      twinData.architecture.windows.forEach(w => {
        if (layoutCache.windows[w.id]) {
          w.x1 = layoutCache.windows[w.id].x1;
          w.y1 = layoutCache.windows[w.id].y1;
          w.x2 = layoutCache.windows[w.id].x2;
          w.y2 = layoutCache.windows[w.id].y2;
          if (layoutCache.windows[w.id].wall) w.wall = layoutCache.windows[w.id].wall;
          if (layoutCache.windows[w.id].zone_id) w.zone_id = layoutCache.windows[w.id].zone_id;
          if (layoutCache.windows[w.id].width_m) w.width_m = layoutCache.windows[w.id].width_m;
        }
      });
    }
    if (twinData.architecture?.doors) {
      twinData.architecture.doors.forEach(d => {
        if (layoutCache.doors[d.id]) {
          d.x1 = layoutCache.doors[d.id].x1;
          d.y1 = layoutCache.doors[d.id].y1;
          d.x2 = layoutCache.doors[d.id].x2;
          d.y2 = layoutCache.doors[d.id].y2;
          if (layoutCache.doors[d.id].wall) d.wall = layoutCache.doors[d.id].wall;
          if (layoutCache.doors[d.id].zone_id) d.zone_id = layoutCache.doors[d.id].zone_id;
          if (layoutCache.doors[d.id].width_m) d.width_m = layoutCache.doors[d.id].width_m;
        }
      });
    }
  }

  // ── Render 2D View ──────────────────────────────────────────────────────────
  function render2D() {
    const scale = toScreen2D(1, 0).scale;
    const p00 = toScreen2D(0, 0);
    const p86 = toScreen2D(8.0, 6.0);
    const roomW = p86.x - p00.x;
    const roomH = p86.y - p00.y;

    const activeZoneIds = getActiveZoneIds();

    ctx.fillStyle = '#060a0b';
    ctx.fillRect(p00.x, p00.y, roomW, roomH);

    if (showHeatmap && twinData && twinData.thermal_heatmap) {
      renderHeatmap2D(p00.x, p00.y, roomW, roomH);
    }

    renderQuadrants2D(activeZoneIds);

    ctx.strokeStyle = 'rgba(45, 212, 191, 0.25)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 6]);
    const pMidY1 = toScreen2D(0, 3.0);
    const pMidY2 = toScreen2D(8.0, 3.0);
    ctx.beginPath();
    ctx.moveTo(pMidY1.x, pMidY1.y);
    ctx.lineTo(pMidY2.x, pMidY2.y);
    ctx.stroke();

    const pMidX1 = toScreen2D(4.0, 0);
    const pMidX2 = toScreen2D(4.0, 6.0);
    ctx.beginPath();
    ctx.moveTo(pMidX1.x, pMidX1.y);
    ctx.lineTo(pMidX2.x, pMidX2.y);
    ctx.stroke();
    ctx.setLineDash([]);

    if (showElements) {
      renderArchitecture2D(scale, activeZoneIds);
    }

    if (showElements && twinData && twinData.vents) {
      renderVents2D(scale);
    }

    if (showVectors && twinData && twinData.airflow_vectors) {
      renderVectors2D();
      renderParticles2D(activeZoneIds);
    }

    if (showOccupants && twinData && twinData.occupants) {
      renderOccupants2D();
    }

    ctx.strokeStyle = 'rgba(45, 212, 191, 0.7)';
    ctx.lineWidth = 4.0;
    ctx.strokeRect(p00.x, p00.y, roomW, roomH);
  }

  function renderHeatmap2D(originX, originY, roomW, roomH) {
    const hm = twinData.thermal_heatmap;
    const nx = hm.nx;
    const ny = hm.ny;
    const cellW = roomW / nx;
    const cellH = roomH / ny;

    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const temp = hm.grid[j][i];
        if (temp === null || temp === undefined || temp < 0) continue;
        ctx.fillStyle = getThermalColor(temp, 0.55);
        ctx.fillRect(originX + i * cellW, originY + j * cellH, cellW + 0.8, cellH + 0.8);
      }
    }
  }

  function renderQuadrants2D(activeZoneIds) {
    const quadrants = [
      { id: 'zone-1', name: 'Zone 1 · North West', shortName: 'Zone 1 · NW', x: 0, y: 0, w: 4, h: 3 },
      { id: 'zone-2', name: 'Zone 2 · North East', shortName: 'Zone 2 · NE', x: 4, y: 0, w: 4, h: 3 },
      { id: 'zone-3', name: 'Zone 3 · South West', shortName: 'Zone 3 · SW', x: 0, y: 3, w: 4, h: 3 },
      { id: 'zone-4', name: 'Zone 4 · South East', shortName: 'Zone 4 · SE', x: 4, y: 3, w: 4, h: 3 },
    ];

    quadrants.forEach(q => {
      const pTopLeft = toScreen2D(q.x, q.y);
      const pBottomRight = toScreen2D(q.x + q.w, q.y + q.h);
      const qw = pBottomRight.x - pTopLeft.x;
      const qh = pBottomRight.y - pTopLeft.y;

      if (!activeZoneIds.has(q.id)) {
        ctx.fillStyle = 'rgba(6, 11, 12, 0.9)';
        ctx.fillRect(pTopLeft.x, pTopLeft.y, qw, qh);

        ctx.save();
        ctx.beginPath();
        ctx.rect(pTopLeft.x, pTopLeft.y, qw, qh);
        ctx.clip();
        ctx.strokeStyle = 'rgba(71, 85, 105, 0.15)';
        ctx.lineWidth = 1;
        for (let d = -qh; d < qw + qh; d += 18) {
          ctx.beginPath();
          ctx.moveTo(pTopLeft.x + d, pTopLeft.y);
          ctx.lineTo(pTopLeft.x + d + qh, pTopLeft.y + qh);
          ctx.stroke();
        }
        ctx.restore();

        ctx.fillStyle = 'rgba(100, 116, 139, 0.7)';
        ctx.font = '600 12px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`🔒 ${q.shortName}`, pTopLeft.x + qw / 2, pTopLeft.y + qh / 2 - 10);
        ctx.fillStyle = 'rgba(71, 85, 105, 0.85)';
        ctx.font = '500 11px Inter, sans-serif';
        ctx.fillText('[No Camera Assigned]', pTopLeft.x + qw / 2, pTopLeft.y + qh / 2 + 10);
      } else {
        ctx.strokeStyle = 'rgba(45, 212, 191, 0.45)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(pTopLeft.x + 1, pTopLeft.y + 1, qw - 2, qh - 2);

        const zInfo = twinData?.zones?.find(z => z.id === q.id);
        const tempStr = zInfo && zInfo.temperature_c ? ` (${zInfo.temperature_c}°C)` : '';
        ctx.fillStyle = '#2dd4bf';
        ctx.font = '600 12px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`🟢 ${q.shortName}${tempStr}`, pTopLeft.x + 14, pTopLeft.y + 24);
      }
    });
  }

  function renderArchitecture2D(scale, activeZoneIds) {
    // Windows
    const windows = twinData?.architecture?.windows || [];
    windows.forEach(w => {
      const isWindowActive = activeZoneIds.has(w.zone_id);
      const isSelected = (hoveredObject?.id === w.id || selectedObject?.id === w.id || draggedObject?.id === w.id);
      let p1 = toScreen2D(w.x1, w.y1);
      let p2 = toScreen2D(w.x2, w.y2);

      ctx.save();
      ctx.strokeStyle = isSelected ? '#38bdf8' : (isWindowActive ? '#0284c7' : 'rgba(71, 85, 105, 0.4)');
      ctx.lineWidth = isSelected ? 9 : (isWindowActive ? 6 : 4);
      if (isSelected) ctx.setLineDash([8, 4]);

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ctx.restore();

      // End Resize Handles when selected
      if (isSelected) {
        ctx.fillStyle = '#38bdf8';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;

        ctx.beginPath();
        ctx.arc(p1.x, p1.y, 7, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();

        ctx.beginPath();
        ctx.arc(p2.x, p2.y, 7, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      }

      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;
      ctx.fillStyle = isSelected ? '#38bdf8' : 'rgba(56, 189, 248, 0.9)';
      ctx.font = '600 11px Inter, sans-serif';
      ctx.textAlign = 'center';
      const labelText = isSelected ? `🪟 WINDOW ${w.id} (${w.wall.toUpperCase()}) ↔️` : `🪟 ${w.id}`;
      ctx.fillText(labelText, midX, midY - 12);
    });

    // Doors
    const doors = twinData?.architecture?.doors || [];
    doors.forEach(d => {
      const isDoorActive = activeZoneIds.has(d.zone_id);
      const isSelected = (hoveredObject?.id === d.id || selectedObject?.id === d.id || draggedObject?.id === d.id);
      let p1 = toScreen2D(d.x1, d.y1);
      let p2 = toScreen2D(d.x2, d.y2);

      ctx.save();
      ctx.strokeStyle = isSelected ? '#f59e0b' : (isDoorActive ? '#d97706' : 'rgba(71, 85, 105, 0.4)');
      ctx.lineWidth = isSelected ? 9 : (isDoorActive ? 6 : 4);
      if (isSelected) ctx.setLineDash([8, 4]);

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ctx.restore();

      // End Resize Handles when selected
      if (isSelected) {
        ctx.fillStyle = '#f59e0b';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;

        ctx.beginPath();
        ctx.arc(p1.x, p1.y, 7, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();

        ctx.beginPath();
        ctx.arc(p2.x, p2.y, 7, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      }

      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;
      ctx.fillStyle = isSelected ? '#f59e0b' : 'rgba(245, 158, 11, 0.9)';
      ctx.font = '600 11px Inter, sans-serif';
      ctx.textAlign = 'center';
      const labelText = isSelected ? `🚪 DOOR ${d.id} (${d.wall.toUpperCase()}) ↔️` : `🚪 ${d.id}`;
      ctx.fillText(labelText, midX, midY + 16);
    });
  }

  function renderVents2D(scale) {
    const ret = twinData.return_grille;
    if (ret) {
      const sp = toScreen2D(ret.x, ret.y);
      const rSize = 24;
      ctx.fillStyle = 'rgba(244, 63, 94, 0.2)';
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, rSize, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#f43f5e';
      ctx.font = '600 10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('RETURN', sp.x, sp.y + 3.5);
    }

    twinData.vents.forEach(v => {
      const sp = toScreen2D(v.x, v.y);
      const isActive = v.status === 'active' && v.valve_opening_pct > 0;
      const isSelected = (hoveredObject?.id === v.id || selectedObject?.id === v.id || draggedObject?.id === v.id);
      const ventRadius = isSelected ? 20 : 16;

      if (isSelected) {
        const pulse = Math.sin(animTime * 6) * 6;
        ctx.fillStyle = 'rgba(45, 212, 191, 0.35)';
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, ventRadius + 14 + pulse, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#2dd4bf';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, ventRadius + 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (isActive) {
        const pulse = Math.sin(animTime * 4) * 4;
        ctx.fillStyle = 'rgba(45, 212, 191, 0.15)';
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, ventRadius + 9 + pulse, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = isActive ? 'rgba(45, 212, 191, 0.35)' : 'rgba(71, 85, 105, 0.35)';
      ctx.strokeStyle = isSelected ? '#2dd4bf' : (isActive ? '#2dd4bf' : '#64748b');
      ctx.lineWidth = isSelected ? 3.5 : 2;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, ventRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(sp.x - 8, sp.y);
      ctx.lineTo(sp.x + 8, sp.y);
      ctx.moveTo(sp.x, sp.y - 8);
      ctx.lineTo(sp.x, sp.y + 8);
      ctx.stroke();

      ctx.fillStyle = isSelected ? '#2dd4bf' : '#e7f3f1';
      ctx.font = '600 10px Inter, sans-serif';
      ctx.textAlign = 'center';
      const labelStr = isSelected ? `🌀 VENT ${v.id}` : `${v.valve_opening_pct}%`;
      ctx.fillText(labelStr, sp.x, sp.y + ventRadius + 13);
      ctx.fillStyle = 'rgba(45, 212, 191, 0.9)';
      ctx.font = '500 9px Inter, sans-serif';
      ctx.fillText(`${v.airflow_cfm} CFM`, sp.x, sp.y + ventRadius + 24);
    });
  }

  function renderVectors2D() {
    const vectors = twinData.airflow_vectors;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
    ctx.fillStyle = 'rgba(56, 189, 248, 0.6)';
    ctx.lineWidth = 1.4;

    vectors.forEach(vec => {
      if (vec.speed_mps < 0.05) return;
      const p = toScreen2D(vec.x, vec.y);
      const arrowLen = Math.min(22, Math.max(7, vec.speed_mps * 32));
      const rad = (vec.direction_deg * Math.PI) / 180.0;
      const targetX = p.x + Math.cos(rad) * arrowLen;
      const targetY = p.y + Math.sin(rad) * arrowLen;

      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(targetX, targetY);
      ctx.stroke();

      const headLen = 5;
      ctx.beginPath();
      ctx.moveTo(targetX, targetY);
      ctx.lineTo(
        targetX - headLen * Math.cos(rad - Math.PI / 6),
        targetY - headLen * Math.sin(rad - Math.PI / 6)
      );
      ctx.lineTo(
        targetX - headLen * Math.cos(rad + Math.PI / 6),
        targetY - headLen * Math.sin(rad + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fill();
    });
  }

  function renderParticles2D(activeZoneIds) {
    particles.forEach(p => {
      const vxGrid = twinData.airflow_vectors || [];
      let vx = 0.05;
      let vy = 0.05;
      let minDist = 999;
      for (let i = 0; i < vxGrid.length; i++) {
        const v = vxGrid[i];
        const dist = (p.x - v.x) ** 2 + (p.y - v.y) ** 2;
        if (dist < minDist) {
          minDist = dist;
          vx = v.vx;
          vy = v.vy;
        }
      }

      p.x += vx * 0.12 * p.speedScale;
      p.y += vy * 0.12 * p.speedScale;
      p.age += 1;

      const pZone = p.x < 4.0 && p.y < 3.0 ? 'zone-1' :
                    p.x >= 4.0 && p.y < 3.0 ? 'zone-2' :
                    p.x < 4.0 && p.y >= 3.0 ? 'zone-3' : 'zone-4';

      if (p.x < 0.1 || p.x > 7.9 || p.y < 0.1 || p.y > 5.9 || p.age > p.maxAge || !activeZoneIds.has(pZone)) {
        const activeList = Array.from(activeZoneIds);
        const randZone = activeList.length > 0 ? activeList[Math.floor(Math.random() * activeList.length)] : 'zone-1';
        const bounds = {
          'zone-1': { x1: 0.5, x2: 3.5, y1: 0.5, y2: 2.5 },
          'zone-2': { x1: 4.5, x2: 7.5, y1: 0.5, y2: 2.5 },
          'zone-3': { x1: 0.5, x2: 3.5, y1: 3.5, y2: 5.5 },
          'zone-4': { x1: 4.5, x2: 7.5, y1: 3.5, y2: 5.5 },
        }[randZone] || { x1: 1, x2: 7, y1: 1, y2: 5 };

        p.x = bounds.x1 + Math.random() * (bounds.x2 - bounds.x1);
        p.y = bounds.y1 + Math.random() * (bounds.y2 - bounds.y1);
        p.age = 0;
      }

      const sp = toScreen2D(p.x, p.y);
      const alpha = Math.sin((p.age / p.maxAge) * Math.PI) * 0.7;
      ctx.fillStyle = `rgba(56, 189, 248, ${alpha})`;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function renderOccupants2D() {
    twinData.occupants.forEach(occ => {
      const sp = toScreen2D(occ.x, occ.y);
      const glow = Math.sin(animTime * 3) * 4;
      ctx.fillStyle = 'rgba(251, 146, 60, 0.2)';
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 18 + glow, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#fb923c';
      ctx.strokeStyle = '#060a0b';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#f8fafc';
      ctx.font = '600 9px Inter, sans-serif';
      ctx.textAlign = 'center';
      const numStr = occ.id.split('-').pop();
      ctx.fillText(`P${numStr}`, sp.x, sp.y + 3.5);

      ctx.fillStyle = '#fb923c';
      ctx.font = '600 10px Inter, sans-serif';
      ctx.fillText(`${occ.activity.toUpperCase()}`, sp.x, sp.y + 22);
    });
  }

  // ── Render 3D Isometric View ───────────────────────────────────────────────
  function render3D() {
    const p00 = toScreen3D(0, 0, 0);
    const p80 = toScreen3D(8.0, 0, 0);
    const p86 = toScreen3D(8.0, 6.0, 0);
    const p06 = toScreen3D(0, 6.0, 0);

    const activeZoneIds = getActiveZoneIds();

    const stepX = 1.0;
    const stepY = 1.0;
    for (let x = 0; x < 8.0; x += stepX) {
      for (let y = 0; y < 6.0; y += stepY) {
        const t1 = toScreen3D(x, y, 0);
        const t2 = toScreen3D(x + stepX, y, 0);
        const t3 = toScreen3D(x + stepX, y + stepY, 0);
        const t4 = toScreen3D(x, y + stepY, 0);

        const tileZone = x < 4.0 && y < 3.0 ? 'zone-1' :
                         x >= 4.0 && y < 3.0 ? 'zone-2' :
                         x < 4.0 && y >= 3.0 ? 'zone-3' : 'zone-4';

        if (!activeZoneIds.has(tileZone)) {
          ctx.fillStyle = 'rgba(6, 11, 12, 0.95)';
        } else {
          ctx.fillStyle = ((x / stepX + y / stepY) % 2 === 0) ? 'rgba(15, 23, 42, 0.7)' : 'rgba(30, 41, 59, 0.7)';
        }

        ctx.strokeStyle = 'rgba(51, 65, 85, 0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(t1.x, t1.y);
        ctx.lineTo(t2.x, t2.y);
        ctx.lineTo(t3.x, t3.y);
        ctx.lineTo(t4.x, t4.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }

    ctx.strokeStyle = 'rgba(45, 212, 191, 0.8)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(p00.x, p00.y);
    ctx.lineTo(p80.x, p80.y);
    ctx.lineTo(p86.x, p86.y);
    ctx.lineTo(p06.x, p06.y);
    ctx.closePath();
    ctx.stroke();

    const wallH = 2.5;
    const p00_top = toScreen3D(0, 0, wallH);
    const p80_top = toScreen3D(8.0, 0, wallH);
    const p86_top = toScreen3D(8.0, 6.0, wallH);
    const p06_top = toScreen3D(0, 6.0, wallH);

    ctx.strokeStyle = 'rgba(45, 212, 191, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(p00.x, p00.y); ctx.lineTo(p00_top.x, p00_top.y);
    ctx.moveTo(p80.x, p80.y); ctx.lineTo(p80_top.x, p80_top.y);
    ctx.moveTo(p86.x, p86.y); ctx.lineTo(p86_top.x, p86_top.y);
    ctx.moveTo(p06.x, p06.y); ctx.lineTo(p06_top.x, p06_top.y);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(45, 212, 191, 0.5)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(p00_top.x, p00_top.y);
    ctx.lineTo(p80_top.x, p80_top.y);
    ctx.lineTo(p86_top.x, p86_top.y);
    ctx.lineTo(p06_top.x, p06_top.y);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    if (showOccupants && twinData.occupants) {
      twinData.occupants.forEach(occ => {
        const base = toScreen3D(occ.x, occ.y, 0);
        const head = toScreen3D(occ.x, occ.y, 1.4);

        ctx.strokeStyle = '#fb923c';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(base.x, base.y);
        ctx.lineTo(head.x, head.y);
        ctx.stroke();

        ctx.fillStyle = '#fb923c';
        ctx.beginPath();
        ctx.arc(head.x, head.y, 8, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = '600 9px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(occ.id.split('-').pop(), head.x, head.y + 3);
      });
    }

    if (showElements && twinData.vents) {
      twinData.vents.forEach(v => {
        const p = toScreen3D(v.x, v.y, 2.4);
        ctx.fillStyle = v.status === 'active' ? 'rgba(45, 212, 191, 0.85)' : 'rgba(100, 116, 139, 0.5)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
        ctx.fill();

        if (v.status === 'active' && v.valve_opening_pct > 0) {
          const floorP = toScreen3D(v.x, v.y, 0);
          ctx.strokeStyle = 'rgba(45, 212, 191, 0.3)';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(floorP.x, floorP.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      });
    }
  }

  // ── Main Render Loop ────────────────────────────────────────────────────────
  function render() {
    animTime += 0.016;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    applyLayoutOverridesToTwinData();

    if (viewMode === '2d') {
      render2D();
    } else {
      render3D();
    }

    animationFrameId = requestAnimationFrame(render);
  }

  // ── Interactive Selection, Drag-and-Drop & Resizing Mechanics ────────────────

  canvas.addEventListener('mousedown', (e) => {
    if (!twinData || viewMode !== '2d') return;
    const { mouseX, mouseY } = getCanvasMouseCoords(e);
    const { rx, ry } = screenToRoom2D(mouseX, mouseY);

    // 1. Check Resize Handles for selected window/door
    if (selectedObject && (selectedObject.id.startsWith('win-') || selectedObject.id.startsWith('door-'))) {
      const p1 = toScreen2D(selectedObject.x1, selectedObject.y1);
      const p2 = toScreen2D(selectedObject.x2, selectedObject.y2);
      if (Math.hypot(mouseX - p1.x, mouseY - p1.y) < 14) {
        resizeHandle = 'handle1';
        draggedObject = { type: selectedObject.id.startsWith('win-') ? 'window' : 'door', id: selectedObject.id, ref: selectedObject };
        canvas.style.cursor = 'ew-resize';
        return;
      }
      if (Math.hypot(mouseX - p2.x, mouseY - p2.y) < 14) {
        resizeHandle = 'handle2';
        draggedObject = { type: selectedObject.id.startsWith('win-') ? 'window' : 'door', id: selectedObject.id, ref: selectedObject };
        canvas.style.cursor = 'ew-resize';
        return;
      }
    }
    resizeHandle = null;

    // 2. Check Vents (35px hit radius)
    if (showElements && twinData.vents) {
      for (const v of twinData.vents) {
        const sp = toScreen2D(v.x, v.y);
        if (Math.hypot(mouseX - sp.x, mouseY - sp.y) < 35) {
          draggedObject = { type: 'vent', id: v.id, ref: v };
          selectedObject = v;
          dragOffsetM = { x: v.x - rx, y: v.y - ry };
          canvas.style.cursor = 'grabbing';
          return;
        }
      }
    }

    // 3. Check Windows (Segment distance hit testing < 35px)
    if (showElements && twinData.architecture?.windows) {
      for (const win of twinData.architecture.windows) {
        const p1 = toScreen2D(win.x1, win.y1);
        const p2 = toScreen2D(win.x2, win.y2);
        const dist = distToSegment(mouseX, mouseY, p1.x, p1.y, p2.x, p2.y);
        if (dist < 35) {
          const midX = (win.x1 + win.x2) / 2;
          const midY = (win.y1 + win.y2) / 2;
          draggedObject = { type: 'window', id: win.id, ref: win, width_m: win.width_m || 2.0 };
          selectedObject = win;
          dragOffsetM = { x: midX - rx, y: midY - ry };
          canvas.style.cursor = 'grabbing';
          return;
        }
      }
    }

    // 4. Check Doors (Segment distance hit testing < 35px)
    if (showElements && twinData.architecture?.doors) {
      for (const door of twinData.architecture.doors) {
        const p1 = toScreen2D(door.x1, door.y1);
        const p2 = toScreen2D(door.x2, door.y2);
        const dist = distToSegment(mouseX, mouseY, p1.x, p1.y, p2.x, p2.y);
        if (dist < 35) {
          const midX = (door.x1 + door.x2) / 2;
          const midY = (door.y1 + door.y2) / 2;
          draggedObject = { type: 'door', id: door.id, ref: door, width_m: door.width_m || 1.0 };
          selectedObject = door;
          dragOffsetM = { x: midX - rx, y: midY - ry };
          canvas.style.cursor = 'grabbing';
          return;
        }
      }
    }

    selectedObject = null;
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!twinData) return;
    const { mouseX, mouseY } = getCanvasMouseCoords(e);
    const { rx, ry } = screenToRoom2D(mouseX, mouseY);

    // Handle Active Resizing of Doors/Windows
    if (draggedObject && resizeHandle) {
      const ref = draggedObject.ref;
      const wall = ref.wall;
      if (wall === 'north' || wall === 'south') {
        const newX = Math.round(Math.max(0.0, Math.min(8.0, rx)) * 100) / 100;
        if (resizeHandle === 'handle1') ref.x1 = Math.min(ref.x2 - 0.5, newX);
        else ref.x2 = Math.max(ref.x1 + 0.5, newX);
      } else {
        const newY = Math.round(Math.max(0.0, Math.min(6.0, ry)) * 100) / 100;
        if (resizeHandle === 'handle1') ref.y1 = Math.min(ref.y2 - 0.5, newY);
        else ref.y2 = Math.max(ref.y1 + 0.5, newY);
      }
      ref.width_m = Math.round(Math.hypot(ref.x2 - ref.x1, ref.y2 - ref.y1) * 100) / 100;

      const cacheObj = draggedObject.type === 'window' ? layoutCache.windows : layoutCache.doors;
      cacheObj[ref.id] = {
        x1: ref.x1, y1: ref.y1, x2: ref.x2, y2: ref.y2,
        zone_id: ref.zone_id, wall: ref.wall, width_m: ref.width_m
      };

      updateInspector(
        `Resizing ${draggedObject.type.toUpperCase()} (${ref.id})`,
        `Width: ${ref.width_m} m`,
        'End Handle Drag',
        '--',
        `Wall: ${wall.toUpperCase()}`
      );
      return;
    }

    // Handle Active Position Dragging with Auto-Wall Snapping
    if (draggedObject) {
      const targetX = rx + dragOffsetM.x;
      const targetY = ry + dragOffsetM.y;

      if (draggedObject.type === 'vent') {
        const roundedX = Math.round(Math.max(0.3, Math.min(7.7, targetX)) * 100) / 100;
        const roundedY = Math.round(Math.max(0.3, Math.min(5.7, targetY)) * 100) / 100;
        draggedObject.ref.x = roundedX;
        draggedObject.ref.y = roundedY;
        layoutCache.vents[draggedObject.id] = { x: roundedX, y: roundedY };
      } else if (draggedObject.type === 'window' || draggedObject.type === 'door') {
        const halfW = (draggedObject.ref.width_m || 1.5) / 2;

        // Auto-Snap to closest wall (North y=0, South y=6, West x=0, East x=8)
        const dNorth = Math.abs(targetY);
        const dSouth = Math.abs(6.0 - targetY);
        const dWest = Math.abs(targetX);
        const dEast = Math.abs(8.0 - targetX);
        const minDist = Math.min(dNorth, dSouth, dWest, dEast);

        let wall = draggedObject.ref.wall;
        let x1, y1, x2, y2;

        if (minDist === dNorth) {
          wall = 'north';
          x1 = Math.round(Math.max(0.1, targetX - halfW) * 100) / 100;
          x2 = Math.round(Math.min(7.9, targetX + halfW) * 100) / 100;
          y1 = 0.0; y2 = 0.0;
        } else if (minDist === dSouth) {
          wall = 'south';
          x1 = Math.round(Math.max(0.1, targetX - halfW) * 100) / 100;
          x2 = Math.round(Math.min(7.9, targetX + halfW) * 100) / 100;
          y1 = 6.0; y2 = 6.0;
        } else if (minDist === dWest) {
          wall = 'west';
          y1 = Math.round(Math.max(0.1, targetY - halfW) * 100) / 100;
          y2 = Math.round(Math.min(5.9, targetY + halfW) * 100) / 100;
          x1 = 0.0; x2 = 0.0;
        } else {
          wall = 'east';
          y1 = Math.round(Math.max(0.1, targetY - halfW) * 100) / 100;
          y2 = Math.round(Math.min(5.9, targetY + halfW) * 100) / 100;
          x1 = 8.0; x2 = 8.0;
        }

        const newZone = (x1 < 4.0 && y1 < 3.0) ? 'zone-1' : (x1 >= 4.0 && y1 < 3.0) ? 'zone-2' : (x1 < 4.0 && y1 >= 3.0) ? 'zone-3' : 'zone-4';
        draggedObject.ref.wall = wall;
        draggedObject.ref.zone_id = newZone;
        draggedObject.ref.x1 = x1; draggedObject.ref.y1 = y1;
        draggedObject.ref.x2 = x2; draggedObject.ref.y2 = y2;

        const cacheObj = draggedObject.type === 'window' ? layoutCache.windows : layoutCache.doors;
        cacheObj[draggedObject.id] = {
          x1, y1, x2, y2,
          zone_id: newZone,
          wall: wall,
          width_m: draggedObject.ref.width_m
        };
      }

      updateInspector(
        `Moving ${draggedObject.type.toUpperCase()} (${draggedObject.id})`,
        `Position: (${rx.toFixed(2)}m, ${ry.toFixed(2)}m)`,
        `Wall: ${draggedObject.ref.wall?.toUpperCase() || '--'}`,
        '--',
        'Live Repositioning'
      );
      return;
    }

    // Normal Hover Hit Testing
    hoveredObject = null;
    let tooltipHtml = '';
    let isHoverable = false;

    // Check Occupants
    if (showOccupants && twinData.occupants) {
      for (const occ of twinData.occupants) {
        const sp = getScreenCoords(occ.x, occ.y, viewMode === '3d' ? 0.9 : 0);
        if (Math.hypot(mouseX - sp.x, mouseY - sp.y) < 20) {
          hoveredObject = occ;
          isHoverable = true;
          tooltipHtml = `
            <strong>👤 Occupant ${occ.id}</strong><br>
            Zone: ${occ.zone_id.toUpperCase()}<br>
            Position: (${occ.x}m, ${occ.y}m)<br>
            Activity: <span style="color:var(--accent);">${occ.activity}</span><br>
            Metabolic Heat: <strong>${occ.metabolic_watts} W</strong>
          `;
          updateInspector(
            `Occupant ${occ.id}`,
            (twinData.zones.find(z => z.id === occ.zone_id)?.temperature_c || 22.0) + ' °C',
            '--',
            `${occ.metabolic_watts} W`,
            '--'
          );
          break;
        }
      }
    }

    // Check Vents
    if (!hoveredObject && showElements && twinData.vents) {
      for (const v of twinData.vents) {
        const sp = getScreenCoords(v.x, v.y, viewMode === '3d' ? v.z : 0);
        if (Math.hypot(mouseX - sp.x, mouseY - sp.y) < 35) {
          hoveredObject = v;
          isHoverable = true;
          tooltipHtml = `
            <strong>🌀 Diffuser Vent ${v.id}</strong> 🖐️ (Click & Drag)<br>
            Zone: ${v.zone_id.toUpperCase()}<br>
            Position: (${v.x}m, ${v.y}m)<br>
            Valve Opening: <strong>${v.valve_opening_pct}%</strong><br>
            Airflow: <strong>${v.airflow_cfm} CFM</strong>
          `;
          updateInspector(
            `Vent ${v.id} (${v.zone_id})`,
            `${v.supply_air_temp_c} °C (Supply)`,
            `${v.valve_opening_pct} %`,
            '--',
            `${v.airflow_cfm} CFM`
          );
          break;
        }
      }
    }

    // Check Windows
    if (!hoveredObject && showElements && twinData.architecture?.windows) {
      for (const win of twinData.architecture.windows) {
        const p1 = toScreen2D(win.x1, win.y1);
        const p2 = toScreen2D(win.x2, win.y2);
        if (distToSegment(mouseX, mouseY, p1.x, p1.y, p2.x, p2.y) < 35) {
          hoveredObject = win;
          isHoverable = true;
          tooltipHtml = `
            <strong>🪟 Window ${win.id}</strong> 🖐️ (Drag / Resize / Delete)<br>
            Zone: ${win.zone_id.toUpperCase()}<br>
            Wall: <strong>${win.wall.toUpperCase()}</strong> · Width: ${win.width_m}m
          `;
          updateInspector(`Window ${win.id}`, `Wall: ${win.wall.toUpperCase()}`, `Width: ${win.width_m}m`, '--', 'Drag to any wall');
          break;
        }
      }
    }

    // Check Doors
    if (!hoveredObject && showElements && twinData.architecture?.doors) {
      for (const door of twinData.architecture.doors) {
        const p1 = toScreen2D(door.x1, door.y1);
        const p2 = toScreen2D(door.x2, door.y2);
        if (distToSegment(mouseX, mouseY, p1.x, p1.y, p2.x, p2.y) < 35) {
          hoveredObject = door;
          isHoverable = true;
          tooltipHtml = `
            <strong>🚪 Door ${door.id}</strong> 🖐️ (Drag / Resize / Delete)<br>
            Zone: ${door.zone_id.toUpperCase()}<br>
            Wall: <strong>${door.wall.toUpperCase()}</strong> · Width: ${door.width_m}m
          `;
          updateInspector(`Door ${door.id}`, `Wall: ${door.wall.toUpperCase()}`, `Width: ${door.width_m}m`, '--', 'Drag to any wall');
          break;
        }
      }
    }

    // Continuous Point Temperature Inspection when unhovered
    if (!hoveredObject && twinData && rx >= 0.0 && rx <= 8.0 && ry >= 0.0 && ry <= 6.0) {
      let pointTemp = null;
      if (twinData.thermal_heatmap?.grid) {
        const hm = twinData.thermal_heatmap;
        const gx = Math.min(hm.nx - 1, Math.max(0, Math.floor((rx / 8.0) * hm.nx)));
        const gy = Math.min(hm.ny - 1, Math.max(0, Math.floor((ry / 6.0) * hm.ny)));
        pointTemp = hm.grid[gy][gx];
      }

      const pZone = rx < 4.0 && ry < 3.0 ? 'Zone 1 (NW)' :
                    rx >= 4.0 && ry < 3.0 ? 'Zone 2 (NE)' :
                    rx < 4.0 && ry >= 3.0 ? 'Zone 3 (SW)' : 'Zone 4 (SE)';
      const tStr = pointTemp !== null && pointTemp !== undefined ? `${pointTemp}°C` : 'Unmonitored';

      tooltipHtml = `
        <strong>📍 Point Inspector</strong><br>
        Coord: <strong>(${rx.toFixed(2)}m, ${ry.toFixed(2)}m)</strong><br>
        Temp: <strong style="color:#2dd4bf;">${tStr}</strong><br>
        Location: ${pZone}
      `;
      updateInspector(`Point (${rx.toFixed(2)}m, ${ry.toFixed(2)}m)`, tStr, '--', '--', pZone);
    }

    canvas.style.cursor = isHoverable ? 'grab' : 'default';

    if (tooltipHtml) {
      tooltip.innerHTML = tooltipHtml;
      const rect = canvas.getBoundingClientRect();
      tooltip.style.left = `${(e.clientX - rect.left) + 16}px`;
      tooltip.style.top = `${(e.clientY - rect.top) + 16}px`;
      tooltip.style.display = 'block';
    } else {
      tooltip.style.display = 'none';
    }
  });

  const saveCurrentLayout = async () => {
    const layoutPayload = {
      vents: layoutCache.vents,
      windows: layoutCache.windows,
      doors: layoutCache.doors
    };

    try {
      await fetch('/api/digital-twin/layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(layoutPayload)
      });
    } catch (err) {
      console.warn('Failed to persist layout:', err);
    }
  };

  const stopDragging = async () => {
    if (!draggedObject) return;
    canvas.style.cursor = 'default';
    draggedObject = null;
    resizeHandle = null;
    await saveCurrentLayout();
  };

  canvas.addEventListener('mouseup', stopDragging);
  canvas.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none';
    hoveredObject = null;
    stopDragging();
  });

  function updateInspector(name, temp, valve, heat, flow) {
    document.getElementById('twin-focus-name').textContent = name;
    document.getElementById('twin-focus-temp').textContent = temp;
    document.getElementById('twin-focus-valve').textContent = valve;
    document.getElementById('twin-focus-heat').textContent = heat;
    document.getElementById('twin-focus-flow').textContent = flow;
  }

  // ── Element Addition & Removal Controls ────────────────────────────────────

  function deleteTargetElement(target) {
    if (!target || !twinData) return;
    const targetId = target.id;
    let deleted = false;

    if (twinData.architecture?.windows) {
      const idx = twinData.architecture.windows.findIndex(w => w.id === targetId);
      if (idx !== -1) {
        twinData.architecture.windows.splice(idx, 1);
        delete layoutCache.windows[targetId];
        deleted = true;
      }
    }

    if (!deleted && twinData.architecture?.doors) {
      const idx = twinData.architecture.doors.findIndex(d => d.id === targetId);
      if (idx !== -1) {
        twinData.architecture.doors.splice(idx, 1);
        delete layoutCache.doors[targetId];
        deleted = true;
      }
    }

    if (deleted) {
      hoveredObject = null;
      selectedObject = null;
      updateInspector('Element Removed', '--', '--', '--', '--');
      saveCurrentLayout();
    }
  }

  document.getElementById('twin-add-window')?.addEventListener('click', async () => {
    if (!twinData || !twinData.architecture) return;
    const winId = `win-${Date.now().toString().slice(-4)}`;
    const activeZones = Array.from(getActiveZoneIds());
    const targetZone = activeZones[0] || 'zone-1';

    const newWin = {
      id: winId,
      zone_id: targetZone,
      wall: 'north',
      x1: 1.5, y1: 0.0, x2: 3.5, y2: 0.0,
      z_bottom: 1.0, z_top: 2.3,
      width_m: 2.0
    };

    if (!twinData.architecture.windows) twinData.architecture.windows = [];
    twinData.architecture.windows.push(newWin);
    layoutCache.windows[winId] = {
      x1: newWin.x1, y1: newWin.y1, x2: newWin.x2, y2: newWin.y2,
      zone_id: targetZone, wall: 'north', width_m: 2.0
    };

    selectedObject = newWin;
    updateInspector(`Added Window ${winId}`, 'North Wall', '--', '--', 'Drag to any wall');
    await saveCurrentLayout();
  });

  document.getElementById('twin-add-door')?.addEventListener('click', async () => {
    if (!twinData || !twinData.architecture) return;
    const doorId = `door-${Date.now().toString().slice(-4)}`;
    const activeZones = Array.from(getActiveZoneIds());
    const targetZone = activeZones[0] || 'zone-1';

    const newDoor = {
      id: doorId,
      zone_id: targetZone,
      wall: 'west',
      x1: 0.0, y1: 1.5, x2: 0.0, y2: 2.5,
      z_bottom: 0.0, z_top: 2.1,
      width_m: 1.0
    };

    if (!twinData.architecture.doors) twinData.architecture.doors = [];
    twinData.architecture.doors.push(newDoor);
    layoutCache.doors[doorId] = {
      x1: newDoor.x1, y1: newDoor.y1, x2: newDoor.x2, y2: newDoor.y2,
      zone_id: targetZone, wall: 'west', width_m: 1.0
    };

    selectedObject = newDoor;
    updateInspector(`Added Door ${doorId}`, 'West Wall', '--', '--', 'Drag to any wall');
    await saveCurrentLayout();
  });

  document.getElementById('twin-delete-element')?.addEventListener('click', () => {
    const target = hoveredObject || selectedObject;
    if (target) {
      deleteTargetElement(target);
    } else {
      updateInspector('No Element Selected', 'Click a Window/Door first', '--', '--', '--');
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const target = hoveredObject || selectedObject;
      if (target && (target.id.startsWith('win-') || target.id.startsWith('door-'))) {
        deleteTargetElement(target);
      }
    }
  });

  // ── UI Controls ─────────────────────────────────────────────────────────────
  document.getElementById('twin-view-2d')?.addEventListener('click', () => {
    viewMode = '2d';
    document.getElementById('twin-view-2d').classList.add('active');
    document.getElementById('twin-view-3d').classList.remove('active');
  });

  document.getElementById('twin-view-3d')?.addEventListener('click', () => {
    viewMode = '3d';
    document.getElementById('twin-view-3d').classList.add('active');
    document.getElementById('twin-view-2d').classList.remove('active');
  });

  document.getElementById('twin-toggle-occupants')?.addEventListener('click', function() {
    showOccupants = !showOccupants;
    this.classList.toggle('active', showOccupants);
  });

  document.getElementById('twin-toggle-heatmap')?.addEventListener('click', function() {
    showHeatmap = !showHeatmap;
    this.classList.toggle('active', showHeatmap);
  });

  document.getElementById('twin-toggle-vectors')?.addEventListener('click', function() {
    showVectors = !showVectors;
    this.classList.toggle('active', showVectors);
  });

  document.getElementById('twin-toggle-elements')?.addEventListener('click', function() {
    showElements = !showElements;
    this.classList.toggle('active', showElements);
  });

  document.getElementById('twin-reset-layout')?.addEventListener('click', async () => {
    const defaultLayout = {
      vents: {},
      windows: {
        'win-1': { x1: 1.0, y1: 0.0, x2: 3.5, y2: 0.0, zone_id: 'zone-1', wall: 'north', width_m: 2.5 },
        'win-2': { x1: 4.5, y1: 0.0, x2: 7.0, y2: 0.0, zone_id: 'zone-2', wall: 'north', width_m: 2.5 },
        'win-3': { x1: 0.0, y1: 3.8, x2: 0.0, y2: 5.2, zone_id: 'zone-3', wall: 'west', width_m: 1.4 },
        'win-4': { x1: 4.8, y1: 6.0, x2: 6.8, y2: 6.0, zone_id: 'zone-4', wall: 'south', width_m: 2.0 }
      },
      doors: {
        'door-1': { x1: 0.0, y1: 1.0, x2: 0.0, y2: 2.0, zone_id: 'zone-1', wall: 'west', width_m: 1.0 },
        'door-2': { x1: 8.0, y1: 4.2, x2: 8.0, y2: 5.2, zone_id: 'zone-4', wall: 'east', width_m: 1.0 }
      }
    };

    layoutCache = defaultLayout;

    try {
      await fetch('/api/digital-twin/layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(defaultLayout)
      });
      await fetchDigitalTwinState();
      updateInspector('Layout Reset', 'Defaults Restored', '--', '--', '--');
    } catch (err) {
      console.warn('Failed to reset layout:', err);
    }
  });

  // ── Sync with API & WebSocket ───────────────────────────────────────────────
  async function fetchDigitalTwinState() {
    try {
      const res = await fetch('/api/digital-twin/state');
      if (res.ok) {
        twinData = await res.json();
        applyLayoutOverridesToTwinData();
        updateStatsBadge();
      }
    } catch (e) {
      console.warn('Digital twin initial fetch failed:', e);
    }
  }

  function updateStatsBadge() {
    if (!twinData) return;
    const ac = twinData.system_status?.ac_state || 'ON';
    const cfm = twinData.system_status?.total_airflow_cfm || 600;
    const occCnt = twinData.occupants?.length || 0;
    const activeZids = twinData.active_zone_ids || ['zone-1', 'zone-4'];

    const bAc = document.getElementById('twin-badge-ac');
    const bCfm = document.getElementById('twin-badge-cfm');
    const bOcc = document.getElementById('twin-badge-occupants');

    if (bAc) bAc.textContent = `AC: ${ac} · ${activeZids.length} Active Zones`;
    if (bCfm) bCfm.textContent = `${cfm} CFM`;
    if (bOcc) bOcc.textContent = `${occCnt} Occupant${occCnt === 1 ? '' : 's'}`;
  }

  window.updateDigitalTwinState = function(data) {
    twinData = data;
    applyLayoutOverridesToTwinData();
    updateStatsBadge();
  };

  fetchDigitalTwinState();
  animationFrameId = requestAnimationFrame(render);
})();
