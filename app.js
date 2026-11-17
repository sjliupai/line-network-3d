(() => {
  const { EPS, HEIGHT, point, dist, build, pathsFrom, riserSegments } = LineGeometry;
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const canvas = $('#scene');
  const ctx = canvas.getContext('2d');
  const colors = ['#7da3ff', '#5cebe5'];
  const amber = '#ffbd72';
  const storageKey = 'double-floor-line-network-v1';
  const number = n => (Math.abs(n) < .005 ? 0 : n).toFixed(2);
  const label = i => 'P' + String(i + 1).padStart(2, '0');
  const floorName = i => ['一层', '二层'][i];
  const line = (floor, x1, y1, x2, y2) =>
    ({ a: point(x1, y1, floor), b: point(x2, y2, floor), kind: 'line' });
  function sample() {
    return {
      base: [
        line(1, -10, -3, 8, -3), line(1, -4, -7, -4, 4), line(1, -4, 2, 6, 2),
        line(0, -9, -4, 8, -4), line(0, 1, -6, 1, 6), line(0, 1, 4, 9, 4),
        line(0, -10, 5, -6, 5),
      ],
      anchors: [{ x: 4, y: -.5 }],
    };
  }
  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      const finite = p => p && Number.isFinite(p.x) && Number.isFinite(p.y);
      if (Array.isArray(saved?.base) && Array.isArray(saved?.anchors) &&
        saved.base.every(l => l?.kind === 'line' && finite(l.a) && finite(l.b) &&
          [0, HEIGHT].includes(l.a.z) && l.a.z === l.b.z && dist(l.a, l.b) > EPS) &&
        saved.anchors.every(a => finite(a) && riserSegments(a, saved.base))) return saved;
    } catch { /* Storage may be unavailable for local files. */ }
    return sample();
  }
  let drawing = restore();
  const history = [];
  let graph, matrix, selection;
  let mode = 'orbit', floor = 1, snap = true, plan = false;
  let start = null, hover = null, drag = null, notice = '';
  let azimuth = .58, elevation = .55, zoom = 1;
  let center = { x: 0, y: 0, z: HEIGHT / 2 };
  let offset = { x: 0, y: 0 };
  let width = 1, height = 1, scale = 1;
  let bounds, fittedBounds;

  function recompute() {
    graph = build(drawing.base, drawing.anchors);
    matrix = graph.nodes.map(node => pathsFrom(graph.nodes, node.id));
    selection = null;
    const extent = { left: -12, right: 12, top: -8, bottom: 8 };
    for (const p of graph.nodes) {
      extent.left = Math.min(extent.left, Math.floor(p.x - 1));
      extent.right = Math.max(extent.right, Math.ceil(p.x + 1));
      extent.top = Math.min(extent.top, Math.floor(p.y - 1));
      extent.bottom = Math.max(extent.bottom, Math.ceil(p.y + 1));
    }
    bounds = extent;
    fittedBounds ??= bounds;
    try { localStorage.setItem(storageKey, JSON.stringify(drawing)); } catch { /* Drawing remains in memory. */ }
    renderTable();
    updateControls();
    render();
  }
  function change(next, fit = false) {
    history.push(drawing);
    drawing = next;
    start = hover = null;
    notice = '';
    recompute();
    if (fit) fitView();
  }
  function undo() {
    if (!history.length) return;
    drawing = history.pop();
    start = hover = null;
    notice = '已撤销';
    recompute();
  }
  function renderTable() {
    const nodes = graph.nodes;
    $('#node-count').textContent = nodes.length + ' 个点位';
    $('#result').textContent = '点击数字可在图中查看路径';
    if (!nodes.length) {
      $('#matrix').innerHTML = '<p class="empty">绘制直线后显示点位距离。</p>';
      $('#connectivity').innerHTML = '<p class="empty">绘制直线后显示点位连通关系。</p>';
      $('#points').innerHTML = '<p class="empty">暂无点位</p>';
      return;
    }
    const header = nodes.map(({id}) => '<th scope="col">' + label(id) + '</th>').join('');
    function table(name, corner, cell) {
      const rows = nodes.map(({id}) => '<tr><th scope="row">' + label(id) + '</th>' +
        matrix[id].distances.map((distance, target) => cell(distance, id, target)).join('') +
        '</tr>').join('');
      return '<table aria-label="' + name + '"><thead><tr><th scope="col">' + corner + '</th>' +
        header + '</tr></thead><tbody>' + rows + '</tbody></table>';
    }
    $('#matrix').innerHTML = table('沿线最短距离，单位米', 'm', (d, id, target) => {
      if (!Number.isFinite(d)) return '<td aria-label="不连通">-</td>';
      if (id === target) return '<td>0</td>';
      return '<td><button data-path="' + id + ',' + target + '" aria-label="' + label(id) +
        ' 到 ' + label(target) + '，' + number(d) + ' 米">' + number(d) + '</button></td>';
    });
    $('#connectivity').innerHTML = table('点位直接连通关系', '点位', (_, id, target) =>
      nodes[id].neighbors.has(target)
        ? '<td class="connected" aria-label="直接连通" title="直接连通">✓</td>'
        : '<td class="disconnected" aria-label="不直接连通" title="不直接连通">✗</td>');
    $('#points').innerHTML = nodes.map(p => '<button class="point-row" data-node="' + p.id +
      '"><strong style="color:' + colors[p.z / HEIGHT] + '">' + label(p.id) + '</strong><span>' +
      floorName(p.z / HEIGHT) + ' · ' + (p.intersection ? '交点' : '端点') +
      '</span><span>' + number(p.x) + ' / ' + number(p.y) + '</span></button>').join('');
  }
  function showSelection(ids, description, button) {
    $('.selected')?.classList.remove('selected');
    button?.classList.add('selected');
    if (plan && ids.some(id => graph.nodes[id].z !== floor * HEIGHT)) plan = false;
    selection = ids;
    $('#result').textContent = description;
    updateControls();
    render();
  }
  $('#matrix').addEventListener('click', event => {
    const button = event.target.closest('[data-path]');
    if (!button) return;
    const [source, target] = button.dataset.path.split(',').map(Number);
    const path = [target];
    for (let p = target; p !== source;) {
      p = matrix[source].previous[p];
      path.push(p);
    }
    showSelection(path, label(source) + ' → ' + label(target) + ' · ' +
      number(matrix[source].distances[target]) + ' m', button);
  });
  $('#points').addEventListener('click', event => {
    const button = event.target.closest('[data-node]');
    if (!button) return;
    const id = Number(button.dataset.node);
    showSelection([id], label(id) + ' · ' + floorName(graph.nodes[id].z / HEIGHT), button);
  });

  function updateControls() {
    const pressed = (button, value) => button.setAttribute('aria-pressed', String(value));
    $$('[data-mode]').forEach(button => pressed(button, button.dataset.mode === mode));
    $$('[data-floor]').forEach(button => {
      pressed(button, Number(button.dataset.floor) === floor);
      button.disabled = mode === 'riser' && button.dataset.floor === '0';
    });
    pressed($('#snap'), snap);
    $$('[data-plan]').forEach(button => pressed(button, plan && Number(button.dataset.plan) === floor));
    pressed($('#perspective'), !plan);
    $('#undo').disabled = !history.length;
    $('#clear').disabled = !drawing.base.length;
    $('#view-label').textContent = plan ? floorName(floor) + '俯视' : '三维视图';
    const hint = mode === 'orbit' ? (plan ? '拖动平移 · 滚轮缩放' : '拖动旋转 · 右键拖动平移 · 滚轮缩放') :
      mode === 'line' ? (start ? '选择终点 · Esc 取消当前线段' : '在' + floorName(floor) + '选择直线起点') :
      canDrawRiser() ? '在二层选点，自动接入两层最近的直线' : '两层都需要至少一条直线，才能绘制竖线';
    $('#hint').textContent = notice || hint;
    $('#coordinates').textContent = hover ? 'X ' + number(hover.p.x) + '  Y ' +
      number(hover.p.y) + '  Z ' + number(hover.p.z) : '单位 m';
    canvas.style.cursor = drag ? 'grabbing' : mode === 'orbit' ? 'grab' : 'crosshair';
  }
  function canDrawRiser() {
    return [0, HEIGHT].every(z => drawing.base.some(l => l.a.z === z));
  }
  function selectMode(next) {
    mode = next;
    if (mode === 'riser') floor = 1;
    resetGesture();
  }
  function resetGesture() {
    start = hover = null;
    notice = '';
    updateControls();
    render();
  }
  $$('[data-mode]').forEach(button => button.onclick = () => selectMode(button.dataset.mode));
  $$('[data-floor]').forEach(button => button.onclick = () => {
    floor = Number(button.dataset.floor);
    resetGesture();
  });
  $('#snap').onclick = () => { snap = !snap; hover = null; updateControls(); render(); };
  $('#demo').onclick = () => change(sample(), true);
  $('#undo').onclick = undo;
  $('#clear').onclick = () => change({ base: [], anchors: [] }, true);
  $$('[data-plan]').forEach(button => button.onclick = () => {
    floor = Number(button.dataset.plan);
    if (floor === 0 && mode === 'riser') mode = 'orbit';
    plan = true;
    offset = { x: 0, y: 0 };
    resetGesture();
  });
  $('#perspective').onclick = () => { plan = false; offset = { x: 0, y: 0 }; resetGesture(); };
  $('#fit').onclick = fitView;
  function fitView() {
    zoom = 1;
    azimuth = .58;
    elevation = .55;
    fittedBounds = bounds;
    center = { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2, z: HEIGHT / 2 };
    offset = { x: 0, y: 0 };
    render();
  }

  function camera() {
    const yaw = plan ? 0 : azimuth;
    const pitch = plan ? Math.PI / 2 : elevation;
    return { c: Math.cos(yaw), s: Math.sin(yaw), v: Math.sin(pitch), h: Math.cos(pitch) };
  }
  function screen(p) {
    const {c, s, v, h} = camera();
    const x = p.x - center.x;
    const y = p.y - center.y;
    return { x: width / 2 + offset.x + (c * x - s * y) * scale,
      y: height / 2 + offset.y + (v * (s * x + c * y) - h * (p.z - center.z)) * scale };
  }
  function world(x, y) {
    const {c, s, v, h} = camera();
    const u = (x - width / 2 - offset.x) / scale;
    const z = floor * HEIGHT;
    const depth = ((y - height / 2 - offset.y) / scale + h * (z - center.z)) / v;
    return point(center.x + c * u + s * depth, center.y - s * u + c * depth, floor);
  }
  function pointer(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  function candidate(cursor) {
    let nearest;
    let best = 12;
    if (snap) {
      for (const node of graph.nodes) {
        if (node.z !== floor * HEIGHT) continue;
        const q = screen(node);
        const d = Math.hypot(cursor.x - q.x, cursor.y - q.y);
        if (d < best) { best = d; nearest = node; }
      }
    }
    return nearest ? { p: point(nearest.x, nearest.y, floor), node: nearest } :
      { p: world(cursor.x, cursor.y) };
  }
  function place(cursor) {
    const {p} = candidate(cursor);
    if (mode === 'line') {
      if (!start) {
        start = p;
      } else if (dist(start, p) > EPS) {
        change({ ...drawing, base: [...drawing.base, { a: start, b: p, kind: 'line' }] });
      } else {
        notice = '请选择另一个点作为终点';
      }
    }
    if (mode === 'riser') {
      if (!canDrawRiser()) {
        notice = '两层都需要至少一条直线，才能绘制竖线';
      } else if (drawing.anchors.some(a => Math.hypot(a.x - p.x, a.y - p.y) <= EPS)) {
        notice = '该位置已有竖线';
      } else {
        change({ ...drawing, anchors: [...drawing.anchors, { x: p.x, y: p.y }] });
      }
    }
  }
  canvas.addEventListener('contextmenu', event => event.preventDefault());
  canvas.addEventListener('pointerdown', event => {
    if (drag || ![0, 1, 2].includes(event.button)) return;
    const p = pointer(event);
    drag = { id: event.pointerId, origin: p, last: p, moved: false,
      pan: event.button !== 0 || event.shiftKey || (plan && mode === 'orbit') };
    canvas.setPointerCapture(event.pointerId);
    updateControls();
  });
  canvas.addEventListener('pointermove', event => {
    if (drag && event.pointerId !== drag.id) return;
    const p = pointer(event);
    notice = '';
    if (drag) {
      drag.moved ||= Math.hypot(p.x - drag.origin.x, p.y - drag.origin.y) > 4;
      if (drag.moved && (drag.pan || mode === 'orbit')) {
        const dx = p.x - drag.last.x;
        const dy = p.y - drag.last.y;
        if (drag.pan) {
          offset.x += dx;
          offset.y += dy;
        } else {
          azimuth += dx * .009;
          elevation = Math.max(.19, Math.min(1.46, elevation + dy * .008));
        }
      }
      drag.last = p;
    }
    hover = mode === 'orbit' ? null : candidate(p);
    updateControls();
    render();
  });
  canvas.addEventListener('pointerup', event => {
    if (drag?.id !== event.pointerId) return;
    const p = pointer(event);
    if (!drag.pan && !drag.moved && mode !== 'orbit') place(p);
    drag = null;
    hover = event.pointerType === 'mouse' && mode !== 'orbit' ? candidate(p) : null;
    updateControls();
    render();
  });
  canvas.addEventListener('lostpointercapture', () => {
    drag = null;
    updateControls();
    render();
  });
  canvas.addEventListener('pointerleave', () => {
    hover = null;
    updateControls();
    render();
  });
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    const p = pointer(event);
    const next = Math.max(.22, Math.min(12, zoom * Math.exp(-event.deltaY * .001)));
    const factor = next / zoom;
    offset.x = p.x - width / 2 - (p.x - width / 2 - offset.x) * factor;
    offset.y = p.y - height / 2 - (p.y - height / 2 - offset.y) * factor;
    zoom = next;
    updateScale();
    if (mode !== 'orbit') hover = candidate(p);
    updateControls();
    render();
  }, { passive: false });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') resetGesture();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      undo();
    }
  });

  function stroke(a, b, color, weight, dash = []) {
    const p = screen(a);
    const q = screen(b);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.lineWidth = weight;
    ctx.strokeStyle = color;
    ctx.setLineDash(dash);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  function polygon(points, fill, outline) {
    ctx.beginPath();
    points.map(screen).forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  function slab(layer) {
    const {left, right, top, bottom} = bounds;
    const corners = [point(left, top, layer), point(right, top, layer),
      point(right, bottom, layer), point(left, bottom, layer)];
    polygon(corners, layer ? '#1c343d8c' : '#182942d6', layer ? '#41616a' : '#354d73');
    const step = Math.max(1, Math.ceil(Math.max(right - left, bottom - top) / 56));
    for (let x = Math.ceil(left / step) * step; x < right; x += step)
      stroke(point(x, top, layer), point(x, bottom, layer), x === 0 ? '#54758c77' : '#587b9750', x === 0 ? 1.2 : .65);
    for (let y = Math.ceil(top / step) * step; y < bottom; y += step)
      stroke(point(left, y, layer), point(right, y, layer), y === 0 ? '#54758c77' : '#587b9750', y === 0 ? 1.2 : .65);
    const tag = screen(point(left, bottom, layer));
    ctx.font = '600 12px Consolas, monospace';
    ctx.fillStyle = colors[layer];
    ctx.fillText((layer + 1) + 'F  /  ' + (layer ? '+' + HEIGHT : '0') + ' m', tag.x + 5, tag.y + 18);
    if (layer === floor && mode !== 'orbit') {
      corners.forEach((p, i) => stroke(p, corners[(i + 1) % 4], colors[layer] + '8c', 1.3));
    }
  }
  function drawSegments(layer) {
    for (const segment of graph.segments) {
      if (segment.kind === 'vertical' || segment.a.z !== layer * HEIGHT) continue;
      const connector = segment.kind === 'connector';
      const color = connector ? amber : colors[layer];
      stroke(segment.a, segment.b, color + '28', 7);
      stroke(segment.a, segment.b, color, 2.5, connector ? [5, 4] : []);
    }
  }
  function drawLabels() {
    const drawn = [];
    const visible = graph.nodes.filter(p => !plan || p.z === floor * HEIGHT);
    for (const p of visible) {
      const q = screen(p);
      const selected = selection?.includes(p.id);
      ctx.beginPath();
      ctx.arc(q.x, q.y, selected ? 5 : p.intersection ? 3.7 : 2.8, 0, Math.PI * 2);
      ctx.fillStyle = selected ? '#ffe199' : p.intersection ? '#f1feff' : colors[p.z / HEIGHT];
      ctx.fill();
      ctx.strokeStyle = '#0b1420';
      ctx.lineWidth = 1.3;
      ctx.stroke();
    }
    for (const p of visible) {
      const q = screen(p);
      const text = label(p.id);
      ctx.font = '600 11px Consolas, monospace';
      const w = ctx.measureText(text).width + 9;
      const candidates = [[8, -20], [8, 5], [-w - 8, -20], [-w - 8, 5],
        [-w / 2, -36], [-w / 2, 22], [24, -10], [-w - 24, -10]];
      const boxes = candidates.map(([x, y]) => ({ x: q.x + x, y: q.y + y, w }));
      const box = boxes.find(b => !drawn.some(a =>
        b.x < a.x + a.w + 2 && b.x + b.w + 2 > a.x && b.y < a.y + 18 && b.y + 18 > a.y)) || boxes[0];
      drawn.push(box);
      ctx.fillStyle = selection?.includes(p.id) ? '#60462e' : '#101c2ce8';
      ctx.fillRect(box.x, box.y, box.w, 16);
      ctx.fillStyle = selection?.includes(p.id) ? '#ffe8ba' : '#cfdfef';
      ctx.fillText(text, box.x + 4, box.y + 11.5);
    }
  }
  function drawSelection() {
    for (let i = 1; i < (selection?.length ?? 0); i++) {
      const a = graph.nodes[selection[i - 1]];
      const b = graph.nodes[selection[i]];
      if (plan && (a.z !== floor * HEIGHT || b.z !== floor * HEIGHT)) continue;
      stroke(a, b, '#ffe39a44', 12);
      stroke(a, b, '#ffe39a', 4);
    }
  }
  function updateScale() {
    const {v, h, c, s} = camera();
    const spanX = fittedBounds.right - fittedBounds.left;
    const spanY = fittedBounds.bottom - fittedBounds.top;
    scale = Math.min(width * .84 / (Math.abs(c) * spanX + Math.abs(s) * spanY),
      height * .73 / (v * (Math.abs(s) * spanX + Math.abs(c) * spanY) + h * HEIGHT)) * zoom;
  }
  function render() {
    if (!graph) return;
    updateScale();
    ctx.clearRect(0, 0, width, height);
    if (plan) {
      slab(floor);
      drawSegments(floor);
    } else {
      const {left, right, top, bottom} = bounds;
      for (const [x, y] of [[left, top], [right, top], [right, bottom], [left, bottom]])
        stroke(point(x, y, 0), point(x, y, 1), '#526e864e', 1, [4, 6]);
      slab(0);
      slab(1);
      drawSegments(0);
      for (const segment of graph.segments.filter(l => l.kind === 'vertical')) {
        stroke(segment.a, segment.b, amber + '36', 9);
        stroke(segment.a, segment.b, amber, 3);
      }
      drawSegments(1);
    }
    drawSelection();
    drawLabels();
    if (hover && !drag) {
      if (mode === 'line' && start) stroke(start, hover.p, colors[floor], 2, [5, 4]);
      if (mode === 'riser') {
        for (const l of riserSegments(hover.p, drawing.base) ?? []) {
          if (!plan || (l.kind !== 'vertical' && l.a.z === HEIGHT))
            stroke(l.a, l.b, '#ffd6a0', 2, [4, 4]);
        }
      }
      const q = screen(hover.p);
      ctx.strokeStyle = hover.node ? '#fff1b4' : '#c6e8ed';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(q.x - 5.5, q.y - 5.5, 11, 11);
      if (hover.node) {
        ctx.fillStyle = '#fff1b4';
        ctx.font = '12px "Microsoft YaHei UI", sans-serif';
        ctx.fillText('捕捉 ' + label(hover.node.id), q.x + 10, q.y + 18);
      }
    }
  }
  const observer = new ResizeObserver(() => {
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    render();
  });
  observer.observe(canvas);
  recompute();
  fitView();
})();
