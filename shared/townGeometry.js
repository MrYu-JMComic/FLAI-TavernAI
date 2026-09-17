export function townDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distanceToSegment(point, from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const fraction = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / (dx * dx + dy * dy || 1)));
  return townDistance(point, { x: from.x + fraction * dx, y: from.y + fraction * dy });
}

export function pointTouchesTownWater(point, bodies = [], clearance = 0) {
  return bodies.some((body) => {
    if (body.kind === 'river') {
      return (body.points || []).slice(1).some((to, index) => distanceToSegment(point, body.points[index], to) <= body.width / 2 + clearance);
    }
    if (body.kind === 'lake') {
      const angle = -(body.rotation || 0) * Math.PI / 180;
      const dx = point.x - body.x;
      const dy = point.y - body.y;
      const x = dx * Math.cos(angle) - dy * Math.sin(angle);
      const y = dx * Math.sin(angle) + dy * Math.cos(angle);
      return (x / (body.radiusX + clearance)) ** 2 + (y / (body.radiusY + clearance)) ** 2 <= 1;
    }
    const points = body.points || [];
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i];
      const b = points[j];
      if (distanceToSegment(point, a, b) <= clearance) return true;
      if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  });
}

export function townPathLength(points) {
  return points.slice(1).reduce((sum, point, index) => sum + townDistance(points[index], point), 0);
}

export function townPathPoint(points, distance) {
  if (!points.length) return { x: 0, y: 0 };
  let remaining = Math.max(0, distance);
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const length = townDistance(from, to);
    if (remaining <= length && length > 0) {
      const progress = remaining / length;
      return { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress };
    }
    remaining -= length;
  }
  return { ...points[points.length - 1] };
}
