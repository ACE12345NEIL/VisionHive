/**
 * Stage 21 — Digital Twin 2D/3D Visual Spatial Model.
 * Interactive canvas renderer supporting:
 *  - 2D Top-Down Architectural Floor Plan
 *  - 3D Isometric Spatial Projection
 *  - Filtering to ONLY active/selected camera-assigned zones (e.g. Zone 1 & Zone 4)
 *  - Real-time Occupant Markers (position, ID, activity, metabolic heat)
 *  - Thermal Heat Map gradient overlay (interpolated zone & plume temps)
 *  - Airflow Vector Field with animated particles & velocity arrows
 *  - Ceiling Diffuser Vents & Central Return Grille
 *  - Interactive Element Inspector HUD & Hover Tooltip
 */
(function() {
  const canvas = document.getElementById('digital-twin-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const tooltip = document.getElementById('twin-tooltip');

  // Layer & View States
  let viewMode = '2d'; // '2d' or '3d'
  let showOccupants = true;
  let showHeatmap = true;
  let showVectors = true;
  let showElements = true;
  let animationFrameId = null;

  // State cache
  let twinData = null;
  let hoveredObject = null;
  let animTime = 0;

  // Particle system for airflow vectors
  const MAX_PARTICLES = 100;
  const particles = [];
  for (let i = 0; i < MAX_PARTICLES; i++) {
    particles.push({
      x: 2.0,
      y: 1.5,
      age: Math.random() * 100,
      maxAge: 70 + Math.random() * 60,
      speedScale: 0.8 + Math.random() * 0.5
    });
  }

  // Color gradient palette for temperatures (18°C - 28°C)
  function getThermalColor(tempC, alpha = 0.55) {
    const minT = 18.0;
    const maxT = 28.0;
    const ratio = Math.max(0, Math.min(1, (tempC - minT) / (maxT - minT)));

    let r, g, b;
    if (ratio < 0.2) { // 18 - 20: Cool Blue to Cyan
      const t = ratio / 0.2;
      r = Math.round(30 + 10 * t);
      g = Math.round(100 + 100 * t);
      b = Math.round(230 + 20 * t);
    } else if (ratio < 0.4) { // 20 - 22: Cyan to Teal / Emerald
      const t = (ratio - 0.2) / 0.2;
      r = Math.round(40 + 5 * t);
      g = Math.round(200 + 20 * t);
      b = Math.round(250 - 100 * t);
    } else if (ratio < 0.6) { // 22 - 24: Emerald to Lime / Yellow
      const t = (ratio - 0.4) / 0.2;
      r = Math.round(45 + 175 * t);
      g = Math.round(220 + 20 * t);
      b = Math.round(150 - 110 * t);
    } else if (ratio < 0.8) { // 24 - 26: Yellow to Orange
      const t = (ratio - 0.6) / 0.2;
      r = Math.round(220 + 30 * t);
      g = Math.round(240 - 100 * t);
      b = Math.round(40 - 20 * t);
    } else { // 26 - 28+: Orange to Deep Coral / Red
      const t = (ratio - 0.8) / 0.2;
      r = Math.round(250);
      g = Math.round(140 - 90 * t);
      b = Math.round(20 + 10 * t);
    }
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // Coordinate Transformers
  function toScreen2D(x, y) {
    const marginX = 60;
    const marginY = 50;
    const availableW = canvas.width - marginX * 2;
    const availableH = canvas.height - marginY * 2;
    const scale = Math.min(availableW / 8.0, availableH / 6.0);
    const offsetX = (canvas.width - 8.0 * scale) / 2;
    const offsetY = (canvas.height - 6.0 * scale) / 2;
    return {
      x: offsetX + x * scale,
      y: offsetY + y * scale,
      scale: scale
    };
  }

  function toScreen3D(x, y, z = 0) {
    // Isometric Projection: 30-degree isometric slant
    const scale = 44;
    const originX = canvas.width / 2;
    const originY = canvas.height / 2 + 35;
    const cos30 = 0.866;
    const sin30 = 0.5;

    // Center room at (4.0, 3.0)
    const dx = x - 4.0;
    const dy = y - 3.0;

    const isoX = originX + (dx - dy) * cos30 * scale;
    const isoY = originY + (dx + dy) * sin30 * scale - z * scale * 1.05;
    return { x: isoX, y: isoY, scale: scale };
  }

  function getScreenCoords(x, y, z = 0) {
    return viewMode === '3d' ? toScreen3D(x, y, z) : toScreen2D(x, y);
  }

  function getActiveZoneIds() {
    return new Set(twinData?.active_zone_ids || ['zone-1', 'zone-4']);
  }

  // ── Render 2D View ──────────────────────────────────────────────────────────
  function render2D() {
    const scale = toScreen2D(1, 0).scale;
    const p00 = toScreen2D(0, 0);
    const p86 = toScreen2D(8.0, 6.0);
    const roomW = p86.x - p00.x;
    const roomH = p86.y - p00.y;

    const activeZoneIds = getActiveZoneIds();

    // 1. Room Floor Background
    ctx.fillStyle = '#060a0b';
    ctx.fillRect(p00.x, p00.y, roomW, roomH);

    // 2. Thermal Heatmap Layer (ONLY for active zones)
    if (showHeatmap && twinData && twinData.thermal_heatmap) {
      renderHeatmap2D(p00.x, p00.y, roomW, roomH);
    }

    // 3. Render Quadrants (Inactive Hatching & Active Highlights)
    renderQuadrants2D(activeZoneIds);

    // 4. Zone Dividing Boundaries
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

    // 5. Architectural Elements (Walls, Windows, Doors, Desks)
    if (showElements) {
      renderArchitecture2D(p00.x, p00.y, roomW, roomH, scale, activeZoneIds);
    }

    // 6. HVAC Vents & Return Grille (ONLY in active zones)
    if (showElements && twinData && twinData.vents) {
      renderVents2D(scale);
    }

    // 7. Airflow Vector Field & Particles (ONLY in active zones)
    if (showVectors && twinData && twinData.airflow_vectors) {
      renderVectors2D();
      renderParticles2D(activeZoneIds);
    }

    // 8. Occupant Markers (ONLY in active zones)
    if (showOccupants && twinData && twinData.occupants) {
      renderOccupants2D();
    }

    // 9. Room Perimeter Outer Border
    ctx.strokeStyle = 'rgba(45, 212, 191, 0.7)';
    ctx.lineWidth = 3.5;
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
        if (temp === null || temp === undefined || temp < 0) {
          continue; // Inactive zone: skip!
        }
        ctx.fillStyle = getThermalColor(temp, 0.52);
        ctx.fillRect(originX + i * cellW, originY + j * cellH, cellW + 0.6, cellH + 0.6);
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
        // Inactive / Unmonitored Zone: Dark shading with subtle diagonal hatch lines
        ctx.fillStyle = 'rgba(6, 11, 12, 0.9)';
        ctx.fillRect(pTopLeft.x, pTopLeft.y, qw, qh);

        ctx.save();
        ctx.beginPath();
        ctx.rect(pTopLeft.x, pTopLeft.y, qw, qh);
        ctx.clip();
        ctx.strokeStyle = 'rgba(71, 85, 105, 0.12)';
        ctx.lineWidth = 1;
        for (let d = -qh; d < qw + qh; d += 16) {
          ctx.beginPath();
          ctx.moveTo(pTopLeft.x + d, pTopLeft.y);
          ctx.lineTo(pTopLeft.x + d + qh, pTopLeft.y + qh);
          ctx.stroke();
        }
        ctx.restore();

        // Inactive status badge
        ctx.fillStyle = 'rgba(100, 116, 139, 0.7)';
        ctx.font = '600 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`🔒 ${q.shortName}`, pTopLeft.x + qw / 2, pTopLeft.y + qh / 2 - 8);
        ctx.fillStyle = 'rgba(71, 85, 105, 0.85)';
        ctx.font = '500 10px Inter, sans-serif';
        ctx.fillText('[No Camera Assigned]', pTopLeft.x + qw / 2, pTopLeft.y + qh / 2 + 8);
      } else {
        // Active zone border highlight
        ctx.strokeStyle = 'rgba(45, 212, 191, 0.45)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(pTopLeft.x + 1, pTopLeft.y + 1, qw - 2, qh - 2);

        // Active Zone Title Badge with live temperature
        const zInfo = twinData?.zones?.find(z => z.id === q.id);
        const tempStr = zInfo && zInfo.temperature_c ? ` (${zInfo.temperature_c}°C)` : '';
        ctx.fillStyle = '#2dd4bf';
        ctx.font = '600 11px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`🟢 ${q.shortName}${tempStr}`, pTopLeft.x + 12, pTopLeft.y + 20);
      }
    });
  }

  function renderArchitecture2D(originX, originY, roomW, roomH, scale, activeZoneIds) {
    // Windows on outer perimeter
    const windows = twinData?.architecture?.windows || [];
    windows.forEach(w => {
      const isWindowActive = activeZoneIds.has(w.zone_id);
      let p1 = toScreen2D(w.x1, w.y1);
      let p2 = toScreen2D(w.x2, w.y2);
      ctx.strokeStyle = isWindowActive ? '#38bdf8' : 'rgba(71, 85, 105, 0.4)';
      ctx.lineWidth = isWindowActive ? 6 : 3;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();

      if (isWindowActive) {
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        ctx.fillStyle = '#38bdf8';
        ctx.font = '500 10px Inter, sans-serif';
        ctx.textAlign = 'center';
        const offset = w.wall === 'north' ? -8 : (w.wall === 'south' ? 14 : (w.wall === 'west' ? -12 : 12));
        if (w.wall === 'north' || w.wall === 'south') {
          ctx.fillText('🪟 Window', midX, midY + offset);
        } else {
          ctx.fillText('🪟 Window', midX + offset, midY);
        }
      }
    });

    // Doors on outer perimeter
    const doors = twinData?.architecture?.doors || [];
    doors.forEach(d => {
      const isDoorActive = activeZoneIds.has(d.zone_id);
      let p1 = toScreen2D(d.x1, d.y1);
      let p2 = toScreen2D(d.x2, d.y2);
      ctx.strokeStyle = isDoorActive ? '#f59e0b' : 'rgba(71, 85, 105, 0.4)';
      ctx.lineWidth = isDoorActive ? 6 : 3;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();

      if (isDoorActive) {
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        ctx.fillStyle = '#f59e0b';
        ctx.font = '500 10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('🚪 Door', midX + (d.wall === 'west' ? -18 : 18), midY);
      }
    });

    // Workstation Desks
    const desks = twinData?.architecture?.workstations || [];
    desks.forEach(desk => {
      const isDeskActive = activeZoneIds.has(desk.zone_id);
      if (!isDeskActive) return; // Only show workstations in selected zones!

      const sp = toScreen2D(desk.x, desk.y);
      const dw = desk.width_m * scale;
      const dl = desk.length_m * scale;
      ctx.fillStyle = 'rgba(30, 41, 59, 0.75)';
      ctx.strokeStyle = 'rgba(100, 116, 139, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(sp.x - dw / 2, sp.y - dl / 2, dw, dl, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = 'rgba(148, 163, 184, 0.8)';
      ctx.font = '500 9px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('💻 Desk', sp.x, sp.y + 3);
    });
  }

  function renderVents2D(scale) {
    // 1. Central Return Air Grille
    const ret = twinData.return_grille;
    if (ret) {
      const sp = toScreen2D(ret.x, ret.y);
      const rSize = 20;
      ctx.fillStyle = 'rgba(244, 63, 94, 0.2)';
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, rSize, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#f43f5e';
      ctx.font = '600 9px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('RETURN', sp.x, sp.y + 3);
    }

    // 2. Supply Vents (ONLY in active zones)
    twinData.vents.forEach(v => {
      const sp = toScreen2D(v.x, v.y);
      const isActive = v.status === 'active' && v.valve_opening_pct > 0;
      const ventRadius = 14;

      if (isActive) {
        const pulse = Math.sin(animTime * 4) * 4;
        ctx.fillStyle = 'rgba(45, 212, 191, 0.15)';
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, ventRadius + 8 + pulse, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = isActive ? 'rgba(45, 212, 191, 0.3)' : 'rgba(71, 85, 105, 0.3)';
      ctx.strokeStyle = isActive ? '#2dd4bf' : '#64748b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, ventRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(sp.x - 7, sp.y);
      ctx.lineTo(sp.x + 7, sp.y);
      ctx.moveTo(sp.x, sp.y - 7);
      ctx.lineTo(sp.x, sp.y + 7);
      ctx.stroke();

      ctx.fillStyle = '#e7f3f1';
      ctx.font = '600 9px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${v.valve_opening_pct}%`, sp.x, sp.y + ventRadius + 11);
      ctx.fillStyle = 'rgba(45, 212, 191, 0.85)';
      ctx.font = '500 8px Inter, sans-serif';
      ctx.fillText(`${v.airflow_cfm} CFM`, sp.x, sp.y + ventRadius + 21);
    });
  }

  function renderVectors2D() {
    const vectors = twinData.airflow_vectors;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
    ctx.fillStyle = 'rgba(56, 189, 248, 0.5)';
    ctx.lineWidth = 1.2;

    vectors.forEach(vec => {
      if (vec.speed_mps < 0.05) return;
      const p = toScreen2D(vec.x, vec.y);
      const arrowLen = Math.min(18, Math.max(6, vec.speed_mps * 28));
      const rad = (vec.direction_deg * Math.PI) / 180.0;
      const targetX = p.x + Math.cos(rad) * arrowLen;
      const targetY = p.y + Math.sin(rad) * arrowLen;

      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(targetX, targetY);
      ctx.stroke();

      const headLen = 4;
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
    ctx.fillStyle = '#38bdf8';
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

      p.x += vx * 0.04 * p.speedScale;
      p.y += vy * 0.04 * p.speedScale;
      p.age++;

      const pZid = p.x < 4.0 && p.y < 3.0 ? 'zone-1' :
                   p.x >= 4.0 && p.y < 3.0 ? 'zone-2' :
                   p.x < 4.0 && p.y >= 3.0 ? 'zone-3' : 'zone-4';

      if (p.age > p.maxAge || p.x < 0.2 || p.x > 7.8 || p.y < 0.2 || p.y > 5.8 || !activeZoneIds.has(pZid)) {
        const activeVents = (twinData.vents || []).filter(v => v.status === 'active' && activeZoneIds.has(v.zone_id));
        if (activeVents.length > 0) {
          const v = activeVents[Math.floor(Math.random() * activeVents.length)];
          p.x = v.x + (Math.random() - 0.5) * 0.4;
          p.y = v.y + (Math.random() - 0.5) * 0.4;
        } else {
          p.x = 2.0;
          p.y = 1.5;
        }
        p.age = 0;
      }

      const sp = toScreen2D(p.x, p.y);
      const alpha = Math.sin((p.age / p.maxAge) * Math.PI) * 0.7;
      ctx.fillStyle = `rgba(56, 189, 248, ${alpha})`;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 2, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function renderOccupants2D() {
    twinData.occupants.forEach(occ => {
      const sp = toScreen2D(occ.x, occ.y);
      const isHovered = hoveredObject && hoveredObject.id === occ.id;

      // Occupant Heat Dissipation Aura
      const auraPulse = Math.sin(animTime * 3) * 3;
      const auraGrad = ctx.createRadialGradient(sp.x, sp.y, 6, sp.x, sp.y, 24 + auraPulse);
      auraGrad.addColorStop(0, 'rgba(245, 158, 11, 0.4)');
      auraGrad.addColorStop(1, 'rgba(245, 158, 11, 0.0)');
      ctx.fillStyle = auraGrad;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 24 + auraPulse, 0, Math.PI * 2);
      ctx.fill();

      // Occupant Avatar Pin
      ctx.fillStyle = '#f59e0b';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = isHovered ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, isHovered ? 12 : 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#0a1214';
      ctx.beginPath();
      ctx.arc(sp.x, sp.y - 1, 3.5, 0, Math.PI * 2);
      ctx.fill();

      // Label Pill
      const shortId = occ.id.split('-').pop();
      const label = `#${shortId} · ${occ.activity}`;
      ctx.font = '600 10px Inter, sans-serif';
      const textW = ctx.measureText(label).width;

      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(sp.x - textW / 2 - 5, sp.y - 28, textW + 10, 16, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#fef3c7';
      ctx.textAlign = 'center';
      ctx.fillText(label, sp.x, sp.y - 16);
    });
  }

  // ── Render 3D Isometric View ────────────────────────────────────────────────
  function render3D() {
    drawIsoFloor();
    drawIsoWalls();

    if (showElements && twinData && twinData.vents) {
      drawIsoVents();
    }

    if (showOccupants && twinData && twinData.occupants) {
      drawIsoOccupants();
    }

    if (showVectors && twinData && twinData.airflow_vectors) {
      drawIsoVectors();
    }
  }

  function drawIsoFloor() {
    const hm = twinData?.thermal_heatmap;
    const nx = hm?.nx || 16;
    const ny = hm?.ny || 12;
    const dx = 8.0 / nx;
    const dy = 6.0 / ny;
    const activeZoneIds = getActiveZoneIds();

    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x1 = i * dx;
        const y1 = j * dy;
        const x2 = (i + 1) * dx;
        const y2 = (j + 1) * dy;

        const p1 = toScreen3D(x1, y1, 0);
        const p2 = toScreen3D(x2, y1, 0);
        const p3 = toScreen3D(x2, y2, 0);
        const p4 = toScreen3D(x1, y2, 0);

        const cx = (x1 + x2) / 2;
        const cy = (y1 + y2) / 2;
        const cellZid = cx < 4.0 && cy < 3.0 ? 'zone-1' :
                        cx >= 4.0 && cy < 3.0 ? 'zone-2' :
                        cx < 4.0 && cy >= 3.0 ? 'zone-3' : 'zone-4';

        const isCellActive = activeZoneIds.has(cellZid);
        const temp = (hm && isCellActive) ? hm.grid[j][i] : null;

        if (showHeatmap && temp !== null && temp !== undefined) {
          ctx.fillStyle = getThermalColor(temp, 0.65);
          ctx.strokeStyle = 'rgba(45, 212, 191, 0.15)';
        } else {
          ctx.fillStyle = isCellActive ? '#0a1518' : '#050a0b';
          ctx.strokeStyle = isCellActive ? 'rgba(45, 212, 191, 0.08)' : 'rgba(30, 41, 59, 0.15)';
        }
        ctx.lineWidth = 0.8;

        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p3.x, p3.y);
        ctx.lineTo(p4.x, p4.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }

    // Inactive Zone 3D badges
    const isoQuadCenters = [
      { id: 'zone-1', name: 'Zone 1 · NW', x: 2.0, y: 1.5 },
      { id: 'zone-2', name: 'Zone 2 · NE', x: 6.0, y: 1.5 },
      { id: 'zone-3', name: 'Zone 3 · SW', x: 2.0, y: 4.5 },
      { id: 'zone-4', name: 'Zone 4 · SE', x: 6.0, y: 4.5 },
    ];
    isoQuadCenters.forEach(q => {
      if (!activeZoneIds.has(q.id)) {
        const cp = toScreen3D(q.x, q.y, 0.05);
        ctx.fillStyle = 'rgba(100, 116, 139, 0.7)';
        ctx.font = '600 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`🔒 ${q.name}`, cp.x, cp.y - 6);
        ctx.fillStyle = 'rgba(71, 85, 105, 0.85)';
        ctx.font = '500 10px Inter, sans-serif';
        ctx.fillText('[No Camera Assigned]', cp.x, cp.y + 8);
      }
    });

    // Room Outer Floor Perimeter
    const f1 = toScreen3D(0, 0, 0);
    const f2 = toScreen3D(8.0, 0, 0);
    const f3 = toScreen3D(8.0, 6.0, 0);
    const f4 = toScreen3D(0, 6.0, 0);

    ctx.strokeStyle = '#2dd4bf';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(f1.x, f1.y);
    ctx.lineTo(f2.x, f2.y);
    ctx.lineTo(f3.x, f3.y);
    ctx.lineTo(f4.x, f4.y);
    ctx.closePath();
    ctx.stroke();
  }

  function drawIsoWalls() {
    const wallH = 2.8;
    const nw1 = toScreen3D(0, 0, 0);
    const nw2 = toScreen3D(8.0, 0, 0);
    const nw2Top = toScreen3D(8.0, 0, wallH);
    const nw1Top = toScreen3D(0, 0, wallH);

    ctx.fillStyle = 'rgba(13, 21, 22, 0.6)';
    ctx.strokeStyle = 'rgba(45, 212, 191, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(nw1.x, nw1.y);
    ctx.lineTo(nw2.x, nw2.y);
    ctx.lineTo(nw2Top.x, nw2Top.y);
    ctx.lineTo(nw1Top.x, nw1Top.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    const ww1 = toScreen3D(0, 0, 0);
    const ww2 = toScreen3D(0, 6.0, 0);
    const ww2Top = toScreen3D(0, 6.0, wallH);
    const ww1Top = toScreen3D(0, 0, wallH);

    ctx.fillStyle = 'rgba(16, 26, 27, 0.7)';
    ctx.beginPath();
    ctx.moveTo(ww1.x, ww1.y);
    ctx.lineTo(ww2.x, ww2.y);
    ctx.lineTo(ww2Top.x, ww2Top.y);
    ctx.lineTo(ww1Top.x, ww1Top.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  function drawIsoVents() {
    twinData.vents.forEach(v => {
      const topP = toScreen3D(v.x, v.y, v.z);
      const floorP = toScreen3D(v.x, v.y, 0);
      const isActive = v.status === 'active';

      if (isActive && v.valve_opening_pct > 0) {
        const coneGrad = ctx.createLinearGradient(topP.x, topP.y, floorP.x, floorP.y);
        coneGrad.addColorStop(0, 'rgba(56, 189, 248, 0.55)');
        coneGrad.addColorStop(1, 'rgba(56, 189, 248, 0.05)');

        ctx.fillStyle = coneGrad;
        ctx.beginPath();
        ctx.moveTo(topP.x, topP.y);
        ctx.lineTo(floorP.x - 25, floorP.y);
        ctx.lineTo(floorP.x + 25, floorP.y);
        ctx.closePath();
        ctx.fill();
      }

      ctx.fillStyle = isActive ? '#2dd4bf' : '#64748b';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(topP.x, topP.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
  }

  function drawIsoOccupants() {
    const sorted = [...twinData.occupants].sort((a, b) => (a.x + a.y) - (b.x + b.y));

    sorted.forEach(occ => {
      const base = toScreen3D(occ.x, occ.y, 0);
      const head = toScreen3D(occ.x, occ.y, 1.75);

      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.beginPath();
      ctx.ellipse(base.x, base.y, 12, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(head.x, head.y);
      ctx.stroke();

      ctx.fillStyle = '#fbbf24';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(head.x, head.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      const shortId = occ.id.split('-').pop();
      ctx.font = '600 10px Inter, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(`#${shortId}`, head.x, head.y - 12);
    });
  }

  function drawIsoVectors() {
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
    ctx.fillStyle = 'rgba(56, 189, 248, 0.6)';
    ctx.lineWidth = 1.2;

    twinData.airflow_vectors.forEach(vec => {
      if (vec.speed_mps < 0.08) return;
      const p1 = toScreen3D(vec.x, vec.y, 0.4);
      const p2 = toScreen3D(vec.x + vec.vx * 0.8, vec.y + vec.vy * 0.8, 0.4);

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    });
  }

  // ── Main Render Loop ────────────────────────────────────────────────────────
  function render() {
    animTime += 0.016;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (viewMode === '2d') {
      render2D();
    } else {
      render3D();
    }

    animationFrameId = requestAnimationFrame(render);
  }

  // ── Interactive Hover & Hit Testing ─────────────────────────────────────────
  // Interactive Drag & Drop State
  let draggedObject = null;
  let dragOffsetM = { x: 0, y: 0 };

  // Helper to convert screen pixel mouse coords to room physical coords (meters)
  function screenToRoom2D(mouseX, mouseY) {
    const p0 = toScreen2D(0, 0);
    const p8 = toScreen2D(8.0, 6.0);
    const scale = (p8.x - p0.x) / 8.0;
    const rx = Math.max(0.2, Math.min(7.8, (mouseX - p0.x) / scale));
    const ry = Math.max(0.2, Math.min(5.8, (mouseY - p0.y) / scale));
    return { rx, ry, scale };
  }

  // ── Drag & Drop Event Listeners ─────────────────────────────────────────────
  canvas.addEventListener('mousedown', (e) => {
    if (!twinData || viewMode !== '2d') return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const { rx, ry } = screenToRoom2D(mouseX, mouseY);

    // 1. Check Vents
    if (showElements && twinData.vents) {
      for (const v of twinData.vents) {
        const sp = toScreen2D(v.x, v.y);
        if (Math.hypot(mouseX - sp.x, mouseY - sp.y) < 20) {
          draggedObject = { type: 'vent', id: v.id, ref: v };
          dragOffsetM = { x: v.x - rx, y: v.y - ry };
          canvas.style.cursor = 'grabbing';
          return;
        }
      }
    }

    // 2. Check Desks / Workstations
    if (showElements && twinData.architecture?.workstations) {
      for (const desk of twinData.architecture.workstations) {
        const sp = toScreen2D(desk.x, desk.y);
        if (Math.hypot(mouseX - sp.x, mouseY - sp.y) < 25) {
          draggedObject = { type: 'workstation', id: desk.id, ref: desk };
          dragOffsetM = { x: desk.x - rx, y: desk.y - ry };
          canvas.style.cursor = 'grabbing';
          return;
        }
      }
    }

    // 3. Check Windows
    if (showElements && twinData.architecture?.windows) {
      for (const win of twinData.architecture.windows) {
        const midX = (win.x1 + win.x2) / 2;
        const midY = (win.y1 + win.y2) / 2;
        const sp = toScreen2D(midX, midY);
        if (Math.hypot(mouseX - sp.x, mouseY - sp.y) < 20) {
          draggedObject = { type: 'window', id: win.id, ref: win, width_m: win.width_m || Math.hypot(win.x2 - win.x1, win.y2 - win.y1) };
          dragOffsetM = { x: midX - rx, y: midY - ry };
          canvas.style.cursor = 'grabbing';
          return;
        }
      }
    }

    // 4. Check Doors
    if (showElements && twinData.architecture?.doors) {
      for (const door of twinData.architecture.doors) {
        const midX = (door.x1 + door.x2) / 2;
        const midY = (door.y1 + door.y2) / 2;
        const sp = toScreen2D(midX, midY);
        if (Math.hypot(mouseX - sp.x, mouseY - sp.y) < 20) {
          draggedObject = { type: 'door', id: door.id, ref: door, width_m: door.width_m || 1.0 };
          dragOffsetM = { x: midX - rx, y: midY - ry };
          canvas.style.cursor = 'grabbing';
          return;
        }
      }
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!twinData) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Handle Active Dragging
    if (draggedObject) {
      const { rx, ry } = screenToRoom2D(mouseX, mouseY);
      const targetX = Math.max(0.3, Math.min(7.7, rx + dragOffsetM.x));
      const targetY = Math.max(0.3, Math.min(5.7, ry + dragOffsetM.y));

      if (draggedObject.type === 'vent' || draggedObject.type === 'workstation') {
        draggedObject.ref.x = Math.round(targetX * 100) / 100;
        draggedObject.ref.y = Math.round(targetY * 100) / 100;
      } else if (draggedObject.type === 'window' || draggedObject.type === 'door') {
        const halfW = (draggedObject.width_m || 1.0) / 2;
        const wall = draggedObject.ref.wall;
        if (wall === 'north' || wall === 'south') {
          draggedObject.ref.x1 = Math.round(Math.max(0.2, targetX - halfW) * 100) / 100;
          draggedObject.ref.x2 = Math.round(Math.min(7.8, targetX + halfW) * 100) / 100;
        } else {
          draggedObject.ref.y1 = Math.round(Math.max(0.2, targetY - halfW) * 100) / 100;
          draggedObject.ref.y2 = Math.round(Math.min(5.8, targetY + halfW) * 100) / 100;
        }
      }

      updateInspector(
        `Moving ${draggedObject.type.toUpperCase()} (${draggedObject.id})`,
        `Position: (${targetX.toFixed(2)}m, ${targetY.toFixed(2)}m)`,
        'Custom Drag',
        '--',
        'Live Repositioning'
      );
      return;
    }

    // Normal Hover Cursor & Hit Testing
    hoveredObject = null;
    let tooltipHtml = '';
    let isHoverable = false;

    // Check Occupants
    if (showOccupants && twinData.occupants) {
      for (const occ of twinData.occupants) {
        const sp = getScreenCoords(occ.x, occ.y, viewMode === '3d' ? 0.9 : 0);
        if (Math.hypot(mouseX - sp.x, mouseY - sp.y) < 16) {
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
        if (Math.hypot(mouseX - sp.x, mouseY - sp.y) < 18) {
          hoveredObject = v;
          isHoverable = true;
          tooltipHtml = `
            <strong>🌀 Diffuser Vent ${v.id}</strong> 🖐️ (Drag to move)<br>
            Zone: ${v.zone_id.toUpperCase()}<br>
            Position: (${v.x}m, ${v.y}m)<br>
            Valve Opening: <strong>${v.valve_opening_pct}%</strong><br>
            Airflow: <strong>${v.airflow_cfm} CFM</strong><br>
            Supply Temp: ${v.supply_air_temp_c}°C
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

    // Check Desks / Workstations
    if (!hoveredObject && showElements && twinData.architecture?.workstations) {
      for (const desk of twinData.architecture.workstations) {
        const sp = getScreenCoords(desk.x, desk.y);
        if (Math.hypot(mouseX - sp.x, mouseY - sp.y) < 22) {
          hoveredObject = desk;
          isHoverable = true;
          tooltipHtml = `
            <strong>💻 Workstation ${desk.id}</strong> 🖐️ (Drag to move)<br>
            Zone: ${desk.zone_id.toUpperCase()}<br>
            Position: (${desk.x}m, ${desk.y}m)
          `;
          updateInspector(`Desk ${desk.id}`, '--', '--', '--', '--');
          break;
        }
      }
    }

    // Check Zones if neither occupant nor vent/desk
    if (!hoveredObject && twinData.zones) {
      const { rx, ry } = screenToRoom2D(mouseX, mouseY);
      if (rx >= 0 && rx <= 8.0 && ry >= 0 && ry <= 6.0) {
        const zid = rx < 4.0 && ry < 3.0 ? 'zone-1' :
                    rx >= 4.0 && ry < 3.0 ? 'zone-2' :
                    rx < 4.0 && ry >= 3.0 ? 'zone-3' : 'zone-4';
        const z = twinData.zones.find(item => item.id === zid);
        if (z) {
          if (z.is_active) {
            updateInspector(
              `${z.name} (${z.id})`,
              `${z.temperature_c} °C`,
              `${z.valve_opening_pct} %`,
              `${z.total_heat_load_w} W`,
              `Setpoint: ${z.target_setpoint_c} °C`
            );
          } else {
            updateInspector(
              `${z.name} [Unmonitored]`,
              `No Camera Assigned`,
              `0 %`,
              `0 W`,
              `Inactive`
            );
          }
        }
      }
    }

    canvas.style.cursor = isHoverable ? 'grab' : 'default';

    if (tooltipHtml) {
      tooltip.innerHTML = tooltipHtml;
      tooltip.style.left = `${mouseX + 14}px`;
      tooltip.style.top = `${mouseY + 14}px`;
      tooltip.style.display = 'block';
    } else {
      tooltip.style.display = 'none';
    }
  });

  const stopDragging = async () => {
    if (!draggedObject) return;
    canvas.style.cursor = 'default';

    // Build complete layout payload to persist
    const layoutPayload = {
      vents: {},
      windows: {},
      doors: {},
      workstations: {}
    };

    if (twinData.vents) {
      twinData.vents.forEach(v => { layoutPayload.vents[v.id] = { x: v.x, y: v.y }; });
    }
    if (twinData.architecture?.windows) {
      twinData.architecture.windows.forEach(w => { layoutPayload.windows[w.id] = { x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 }; });
    }
    if (twinData.architecture?.doors) {
      twinData.architecture.doors.forEach(d => { layoutPayload.doors[d.id] = { x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2 }; });
    }
    if (twinData.architecture?.workstations) {
      twinData.architecture.workstations.forEach(desk => { layoutPayload.workstations[desk.id] = { x: desk.x, y: desk.y }; });
    }

    draggedObject = null;

    try {
      await fetch('/api/digital-twin/layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(layoutPayload)
      });
    } catch (err) {
      console.warn('Failed to persist dragged layout to backend:', err);
    }
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
      vents: {
        'vent-1-1': { x: 1.5, y: 1.2 }, 'vent-1-2': { x: 3.0, y: 2.0 },
        'vent-2-1': { x: 5.0, y: 1.2 }, 'vent-2-2': { x: 6.5, y: 2.0 },
        'vent-3-1': { x: 1.5, y: 4.2 }, 'vent-3-2': { x: 3.0, y: 5.0 },
        'vent-4-1': { x: 5.0, y: 4.2 }, 'vent-4-2': { x: 6.5, y: 5.0 }
      },
      windows: {
        'win-1': { x1: 1.0, y1: 0.0, x2: 3.5, y2: 0.0 },
        'win-2': { x1: 4.5, y1: 0.0, x2: 7.0, y2: 0.0 },
        'win-3': { x1: 0.0, y1: 3.8, x2: 0.0, y2: 5.2 },
        'win-4': { x1: 4.8, y1: 6.0, x2: 6.8, y2: 6.0 }
      },
      doors: {
        'door-1': { x1: 0.0, y1: 1.0, x2: 0.0, y2: 2.0 },
        'door-2': { x1: 8.0, y1: 4.2, x2: 8.0, y2: 5.2 }
      },
      workstations: {
        'desk-1': { x: 1.8, y: 1.6 }, 'desk-2': { x: 5.8, y: 1.6 },
        'desk-3': { x: 1.8, y: 4.4 }, 'desk-4': { x: 5.8, y: 4.4 }
      }
    };

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

  // Listen to WebSocket broadcasts from window.digitalTwinHandler or global hook
  window.updateDigitalTwinState = function(data) {
    if (draggedObject) return; // Don't overwrite state while user is actively dragging an item
    twinData = data;
    updateStatsBadge();
  };

  // Start loop and initial fetch
  fetchDigitalTwinState();
  animationFrameId = requestAnimationFrame(render);
})();
