import { TOWN_ASSETS, townAssetId } from '../../../../shared/townAssets.js';

export function drawTownAsset(context, building, palette, options = {}) {
  const assetId = townAssetId(building);
  const asset = TOWN_ASSETS[assetId];
  const width = Number(building.width) || asset.width;
  const depth = Number(building.height) || asset.height;
  const modern = building.architecture === 'modern';
  const floors = Number.isFinite(building.floors) ? building.floors : asset.floors;
  const elevation = Math.max(12, Math.min(6, floors) * 9);
  context.save();
  context.translate(Number(building.x) || 0, Number(building.y) || 0);
  context.lineJoin = 'round';
  context.lineWidth = 1.5;
  if (assetId === 'park') {
    drawPark(context, width, depth, palette);
  } else if (assetId === 'car') {
    drawCar(context, width, depth, building.variant || 0);
  } else {
    context.fillStyle = 'rgba(18, 25, 30, 0.16)';
    context.fillRect(-width / 2 + 9, -depth / 3 + 10, width + 6, depth * 0.72);
    const wall = modern ? '#e7e9e3' : palette.wall;
    context.fillStyle = wall;
    context.strokeStyle = '#526368';
    context.fillRect(-width / 2, -depth / 3 - elevation, width, depth * 0.64 + elevation);
    context.strokeRect(-width / 2, -depth / 3 - elevation, width, depth * 0.64 + elevation);
    context.fillStyle = modern ? '#adbcc0' : '#a79574';
    context.fillRect(width / 2 - 10, -depth / 3 - elevation, 10, depth * 0.64 + elevation);
    if (modern || ['office', 'workshop', 'station', 'harbor'].includes(assetId)) {
      context.fillStyle = modern ? '#718a92' : palette.roof;
      context.fillRect(-width / 2 - 3, -depth / 3 - elevation - 5, width + 6, depth * 0.52);
      context.strokeRect(-width / 2 - 3, -depth / 3 - elevation - 5, width + 6, depth * 0.52);
      context.fillStyle = '#dce3dd';
      context.fillRect(-width * 0.23, -depth / 3 - elevation, width * 0.22, 8);
    } else {
      const roof = building.architecture === 'fantasy' ? ['#386e83', '#915c79', '#387e70'][Number(building.variant || 0) % 3] : palette.roof;
      polygon(context, [[-width * 0.6, -elevation], [0, -depth * 0.73 - elevation], [width * 0.6, -elevation], [0, depth * 0.2 - elevation]], roof);
      context.strokeStyle = '#e7c796';
      context.beginPath();
      context.moveTo(0, -depth * 0.7 - elevation);
      context.lineTo(0, depth * 0.17 - elevation);
      context.stroke();
    }
    const windowRows = Math.max(1, Math.min(5, floors));
    for (let row = 0; row < windowRows; row += 1) {
      for (let column = 0; column < Math.floor(width / 17); column += 1) {
        context.fillStyle = options.night ? '#f4d484' : assetId === 'office' ? '#62a6ba' : '#526e76';
        context.fillRect(-width / 2 + 8 + column * 15, depth * 0.02 - row * 9, 7, 5);
      }
    }
    context.fillStyle = '#334950';
    context.fillRect(-5, depth * 0.17, 10, depth * 0.15);
    drawIdentifier(context, assetId, width, depth, elevation);
  }
  context.restore();
}

function drawIdentifier(context, assetId, width, depth, elevation) {
  if (assetId === 'clinic') {
    context.fillStyle = '#f7f6f0';
    context.fillRect(-10, -elevation - 12, 20, 20);
    context.fillStyle = '#bb4552';
    context.fillRect(-2.5, -elevation - 9, 5, 14);
    context.fillRect(-7, -elevation - 4.5, 14, 5);
  } else if (['shop', 'cafe'].includes(assetId)) {
    for (let index = 0; index < 6; index += 1) {
      context.fillStyle = index % 2 ? '#f3e9ce' : assetId === 'cafe' ? '#d87b65' : '#54a393';
      context.fillRect(-width / 2 + index * width / 6, depth * 0.12, width / 6, 8);
    }
  } else if (assetId === 'school' || assetId === 'hall') {
    context.strokeStyle = '#3a5059';
    context.beginPath();
    context.moveTo(width / 2 + 8, -24);
    context.lineTo(width / 2 + 8, depth / 3);
    context.stroke();
    polygon(context, [[width / 2 + 8, -24], [width / 2 + 25, -20], [width / 2 + 8, -13]], '#cf6854');
  } else if (assetId === 'hotel') {
    context.fillStyle = '#e4b958';
    context.fillRect(-width / 2 - 7, -elevation, 8, 24);
  } else if (assetId === 'lighthouse') {
    context.fillStyle = '#e7b959';
    context.fillRect(-width * 0.25, -elevation - depth * 0.75, width * 0.5, 12);
    context.fillStyle = '#48565f';
    context.fillRect(-width * 0.32, -elevation - depth * 0.75 - 5, width * 0.64, 5);
  } else if (assetId === 'workshop') {
    context.fillStyle = '#736b65';
    context.fillRect(width * 0.2, -elevation - 24, 9, 24);
  } else if (assetId === 'station' || assetId === 'harbor') {
    context.fillStyle = '#889d9c';
    context.fillRect(-width * 0.7, depth * 0.34, width * 1.4, 6);
    context.strokeStyle = '#d8e3df';
    for (let i = 0; i < 7; i += 1) {
      context.beginPath();
      context.moveTo(-width * 0.65 + i * width * 0.2, depth * 0.3);
      context.lineTo(-width * 0.65 + i * width * 0.2, depth * 0.46);
      context.stroke();
    }
  }
}

function drawPark(context, width, depth, palette) {
  context.fillStyle = '#6da77b';
  context.fillRect(-width / 2, -depth / 2, width, depth);
  context.fillStyle = '#d4d4b9';
  context.fillRect(-width / 2, -4, width, 8);
  context.fillRect(-4, -depth / 2, 8, depth);
  for (const [x, y] of [[-width * 0.3, -depth * 0.28], [width * 0.3, depth * 0.28], [width * 0.3, -depth * 0.3]]) {
    context.fillStyle = '#685448';
    context.fillRect(x - 2, y, 4, 12);
    context.fillStyle = palette.tree;
    context.beginPath();
    context.arc(x, y - 5, 12, 0, Math.PI * 2);
    context.fill();
  }
  context.fillStyle = '#916d52';
  context.fillRect(-width * 0.35, depth * 0.2, 19, 5);
}

function drawCar(context, width, depth, variant) {
  context.fillStyle = '#303b42';
  for (const x of [-width * 0.36, width * 0.23]) context.fillRect(x, -depth * 0.48, 7, depth * 0.96);
  context.fillStyle = ['#bf5962', '#629bb1', '#e7e7df', '#d7ac56'][variant % 4];
  context.fillRect(-width / 2, -depth / 3, width, depth * 0.7);
  context.fillStyle = '#314f64';
  context.fillRect(-width * 0.12, -depth * 0.27, width * 0.34, depth * 0.55);
  context.fillStyle = '#f5e5a6';
  context.fillRect(width * 0.42, -depth * 0.26, 4, 5);
  context.fillRect(width * 0.42, depth * 0.14, 4, 5);
}

function polygon(context, points, fill) {
  context.beginPath();
  context.moveTo(...points[0]);
  for (const point of points.slice(1)) context.lineTo(...point);
  context.closePath();
  context.fillStyle = fill;
  context.fill();
  context.stroke();
}
