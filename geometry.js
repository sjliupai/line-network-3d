(() => {
  const EPS = 1e-7;
  const HEIGHT = 4;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const point = (x, y, floor) => ({ x, y, z: floor * HEIGHT });
  const vector = (a, b) => ({ x: b.x - a.x, y: b.y - a.y, z: b.z - a.z });
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const cross = (a, b) => a.x * b.y - a.y * b.x;
  const along = (line, t) => {
    const d = vector(line.a, line.b);
    return { x: line.a.x + d.x * t, y: line.a.y + d.y * t, z: line.a.z + d.z * t };
  };
  const clamp = t => Math.max(0, Math.min(1, t));
  function project(p, line) {
    const d = vector(line.a, line.b);
    return along(line, clamp(dot(vector(line.a, p), d) / dot(d, d)));
  }
  function intersections(a, b) {
    if (a.a.z !== b.a.z) return [];
    const r = vector(a.a, a.b);
    const s = vector(b.a, b.b);
    const offset = vector(a.a, b.a);
    const denominator = cross(r, s);
    if (Math.abs(denominator) <= EPS * Math.hypot(r.x, r.y) * Math.hypot(s.x, s.y)) {
      // Shared overlap boundaries are already segment endpoints.
      return [a.a, a.b, b.a, b.b].filter(p =>
        dist(p, project(p, a)) <= EPS && dist(p, project(p, b)) <= EPS);
    }
    const t = cross(offset, s) / denominator;
    const u = cross(offset, r) / denominator;
    const p = along(a, clamp(t));
    return dist(p, along(a, t)) <= EPS && dist(along(b, clamp(u)), along(b, u)) <= EPS ? [p] : [];
  }
  function riserSegments(anchor, lines) {
    const endpoints = [point(anchor.x, anchor.y, 0), point(anchor.x, anchor.y, 1)];
    const feet = endpoints.map(p => {
      let nearest;
      let best = Infinity;
      for (const line of lines) {
        if (line.a.z !== p.z) continue;
        const q = project(p, line);
        const distance = dist(p, q);
        if (distance < best) {
          best = distance;
          nearest = q;
        }
      }
      return nearest;
    });
    if (feet.some(p => !p)) return null;
    const [a, b] = endpoints;
    return [{ a, b, kind: 'vertical' }, ...endpoints.flatMap((p, i) =>
      dist(p, feet[i]) > EPS ? [{ a: p, b: feet[i], kind: 'connector' }] : [])];
  }
  function build(base, anchors) {
    const segments = [...base, ...anchors.flatMap(anchor => riserSegments(anchor, base) ?? [])];
    const nodes = [];
    const cuts = segments.map(() => new Map());
    function add(i, p, intersection = false) {
      let node = nodes.find(n => dist(n, p) <= EPS);
      if (!node) {
        node = { ...p, id: nodes.length, neighbors: new Map(), intersection };
        nodes.push(node);
      }
      node.intersection ||= intersection;
      cuts[i].set(node.id, dist(segments[i].a, p));
    }
    segments.forEach((line, i) => {
      add(i, line.a);
      add(i, line.b);
    });
    for (let i = 0; i < segments.length; i++) {
      for (let j = i + 1; j < segments.length; j++) {
        const a = segments[i];
        const b = segments[j];
        const vertical = a.kind === 'vertical' ? a : b;
        const horizontal = vertical === a ? b : a;
        let shared;
        if (a.kind === 'vertical' && b.kind === 'vertical') continue;
        if (vertical.kind === 'vertical') {
          const p = horizontal.a.z === 0 ? vertical.a : vertical.b;
          shared = dist(p, project(p, horizontal)) <= EPS ? [p] : [];
        } else {
          shared = intersections(a, b);
        }
        for (const p of shared) {
          add(i, p, true);
          add(j, p, true);
        }
      }
    }
    cuts.forEach(cut => {
      const ids = [...cut.keys()].sort((a, b) => cut.get(a) - cut.get(b));
      for (let i = 1; i < ids.length; i++) {
        const a = nodes[ids[i - 1]];
        const b = nodes[ids[i]];
        const length = dist(a, b);
        a.neighbors.set(b.id, length);
        b.neighbors.set(a.id, length);
      }
    });
    return { nodes, segments };
  }
  function pathsFrom(nodes, source) {
    const distances = nodes.map(() => Infinity);
    const previous = nodes.map(() => -1);
    const visited = nodes.map(() => false);
    distances[source] = 0;
    for (let i = 0; i < nodes.length; i++) {
      let current = -1;
      for (const node of nodes) {
        if (!visited[node.id] && (current < 0 || distances[node.id] < distances[current])) current = node.id;
      }
      if (!Number.isFinite(distances[current])) break;
      visited[current] = true;
      for (const [neighbor, length] of nodes[current].neighbors) {
        const cost = distances[current] + length;
        if (cost < distances[neighbor]) {
          distances[neighbor] = cost;
          previous[neighbor] = current;
        }
      }
    }
    return { distances, previous };
  }
  globalThis.LineGeometry = { EPS, HEIGHT, point, dist, build, pathsFrom, riserSegments };
})();
