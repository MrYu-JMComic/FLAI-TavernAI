import { Graph, alg } from '@dagrejs/graphlib';
import { activeTownConditions } from '../../../shared/townLife.js';
import { distanceToSegment, pointTouchesTownWater, townDistance, townPathLength, townPathPoint } from '../../../shared/townGeometry.js';

const WALK_UNITS_PER_MINUTE = 36;

export function buildTownRoads(locations, waterBodies, width, height, architecture) {
  const grid = new Graph({ directed: false });
  const cell = 20;
  const permanentWater = waterBodies.filter((body) => body.kind !== 'river');
  const plots = locations.map((location) => ({ x: location.buildingX, y: location.buildingY, radius: location.footprint })).filter((plot) => Number.isFinite(plot.x));
  const crossesPlot = (from, to) => plots.some((plot) => distanceToSegment(plot, from, to) < plot.radius + 14);
  for (let y = cell; y < height; y += cell) {
    for (let x = cell; x < width; x += cell) {
      const point = { x, y };
      if (!pointTouchesTownWater(point, permanentWater, 16) && !crossesPlot(point, point)) grid.setNode(`${x}:${y}`, point);
    }
  }
  const offsets = architecture === 'modern' ? [[cell, 0], [0, cell]] : [[cell, 0], [0, cell], [cell, cell], [-cell, cell]];
  for (const id of grid.nodes()) {
    const point = grid.node(id);
    for (const [dx, dy] of offsets) {
      const target = `${point.x + dx}:${point.y + dy}`;
      if (!grid.hasNode(target)) continue;
      const next = grid.node(target);
      if (crossesPlot(point, next)) continue;
      const middle = { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 };
      if (pointTouchesTownWater(middle, permanentWater, 16)) continue;
      const crossing = pointTouchesTownWater(middle, waterBodies, 0);
      grid.setEdge(id, target, townDistance(point, next) * (crossing ? 3 : 1));
    }
  }
  const connected = alg.components(grid).sort((a, b) => b.length - a.length)[0] || [];
  const anchor = (location) => connected.filter((id) => !crossesPlot(location, grid.node(id)) && !samplesTouchWater([location, grid.node(id)], permanentWater)).reduce((best, id) => !best || townDistance(grid.node(id), location) < townDistance(grid.node(best), location) ? id : best, '');
  const roads = [];
  for (let index = 1; index < locations.length; index += 1) {
    const from = locations[index];
    const to = locations.slice(0, index).reduce((best, item) => townDistance(from, item) < townDistance(from, best) ? item : best);
    const ids = shortestPath(grid, anchor(from), anchor(to));
    if (!ids.length) throw new Error('Town road network cannot connect all locations.');
    const points = simplifyPath([from, ...ids.map((id) => grid.node(id)), to].map(({ x, y }) => ({ x, y })));
    roads.push({
      id: `road-${from.id}-${to.id}`, from: from.id, to: to.id, points,
      bridgeSegments: points.slice(1).flatMap((point, i) => {
        const start = points[i];
        const length = townDistance(start, point);
        const segments = [];
        const count = Math.max(1, Math.ceil(length / 12));
        for (let sample = 0; sample < count; sample += 1) {
          const fraction = (sample + 0.5) / count;
          const middle = { x: start.x + (point.x - start.x) * fraction, y: start.y + (point.y - start.y) * fraction };
          if (!pointTouchesTownWater(middle, waterBodies, 10)) continue;
          segments.push({
            from: { x: start.x + (point.x - start.x) * sample / count, y: start.y + (point.y - start.y) * sample / count },
            to: { x: start.x + (point.x - start.x) * (sample + 1) / count, y: start.y + (point.y - start.y) * (sample + 1) / count }
          });
        }
        return segments;
      })
    });
  }
  return roads;
}

export function findTownJourney(town, resident, destination) {
  const map = town.mapConfig || {};
  const locations = Array.isArray(map.locations) ? map.locations : [];
  const ongoing = resident.state?.life?.journey;
  if (ongoing?.points?.length > 1 && ongoing.minutes > 0 && Number.isFinite(ongoing.elapsedMinutes)) {
    const traveled = ongoing.distance * Math.min(1, ongoing.elapsedMinutes / ongoing.minutes);
    const tail = [townPathPoint(ongoing.points, traveled)];
    let distance = 0;
    for (let index = 1; index < ongoing.points.length; index += 1) {
      distance += townDistance(ongoing.points[index - 1], ongoing.points[index]);
      if (distance > traveled) tail.push(ongoing.points[index]);
    }
    if (ongoing.locationId !== destination.id) {
      const next = locations.find((location) => location.id === ongoing.locationId);
      if (!next) return null;
      const onward = findTownJourney(town, { ...resident, currentLocation: next.name, state: { mapX: next.x, mapY: next.y } }, destination);
      if (!onward) return null;
      tail.push(...onward.points);
    }
    const length = townPathLength(tail);
    return { points: tail, distance: length, minutes: travelMinutes(town, length, destination.id) };
  }
  const current = locations.find((location) => location.name === resident.currentLocation);
  const origin = {
    x: Number.isFinite(resident.state?.mapX) ? resident.state.mapX : current?.x ?? destination.x,
    y: Number.isFinite(resident.state?.mapY) ? resident.state.mapY : current?.y ?? destination.y
  };
  if (current?.id === destination.id && !resident.state?.life?.journey) return { points: [origin], distance: 0, minutes: 0 };
  const graph = new Graph({ directed: false });
  for (const location of locations) graph.setNode(location.id, location);
  const roads = Array.isArray(map.roads) ? map.roads : [];
  for (const road of roads) {
    if (!graph.hasNode(road.from) || !graph.hasNode(road.to) || !Array.isArray(road.points) || road.points.length < 2) continue;
    const length = townPathLength(road.points);
    if (Number.isFinite(length) && length > 0) graph.setEdge(road.from, road.to, { ...road, length });
  }
  const from = current || locations.reduce((best, location) => !best || townDistance(origin, location) < townDistance(origin, best) ? location : best, null);
  let points;
  if (roads.length && from) {
    const nodes = shortestPath(graph, from.id, destination.id, (edge) => graph.edge(edge).length);
    if (!nodes.length) return null;
    points = [origin, { x: from.x, y: from.y }];
    for (let index = 1; index < nodes.length; index += 1) {
      const edge = graph.edge(nodes[index - 1], nodes[index]);
      const segment = edge.from === nodes[index - 1] ? edge.points : [...edge.points].reverse();
      points.push(...segment.map(({ x, y }) => ({ x, y })));
    }
  } else {
    points = [origin, { x: destination.x, y: destination.y }];
    if ((map.waterBodies || []).length && samplesTouchWater(points, map.waterBodies)) return null;
  }
  const distance = townPathLength(points);
  return { points, distance, minutes: travelMinutes(town, distance, destination.id) };
}

function travelMinutes(town, distance, locationId) {
  const raining = activeTownConditions(town).some((condition) => condition.kind === 'rain' && (!condition.locationId || condition.locationId === locationId));
  return distance / WALK_UNITS_PER_MINUTE * (raining ? 1.4 : 1);
}

function shortestPath(graph, from, to, weight = (edge) => graph.edge(edge)) {
  if (!graph.hasNode(from) || !graph.hasNode(to)) return [];
  const paths = alg.dijkstra(graph, from, weight, (id) => graph.nodeEdges(id));
  if (!Number.isFinite(paths[to]?.distance)) return [];
  const nodes = [to];
  for (let id = to; id !== from;) {
    id = paths[id]?.predecessor;
    if (!id || nodes.includes(id)) return [];
    nodes.unshift(id);
  }
  return nodes;
}

function simplifyPath(points) {
  const output = [];
  for (const point of points) {
    if (output.length && townDistance(output[output.length - 1], point) < 0.01) continue;
    if (output.length >= 2) {
      const a = output[output.length - 2];
      const b = output[output.length - 1];
      if (Math.abs((b.x - a.x) * (point.y - b.y) - (b.y - a.y) * (point.x - b.x)) < 0.01) output.pop();
    }
    output.push(point);
  }
  return output;
}

function samplesTouchWater(points, bodies) {
  const [from, to] = points;
  const samples = Math.ceil(townDistance(from, to) / 16);
  for (let index = 0; index <= samples; index += 1) {
    const ratio = index / Math.max(1, samples);
    if (pointTouchesTownWater({ x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio }, bodies)) return true;
  }
  return false;
}
