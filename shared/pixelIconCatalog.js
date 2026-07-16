// Original 8x8 pixel icons using a compact, high-contrast game UI style.
// The visual direction was informed by the local Degrees of Lewdity asset set;
// no source bitmap is embedded or copied here.
export const PIXEL_ICON_CATALOG = Object.freeze([
  icon('map.world', '世界', 'map', ['00111100', '01222210', '12233221', '12333321', '12323321', '12222221', '01222210', '00111100']),
  icon('map.district', '区域', 'map', ['00010000', '00121000', '01222100', '12222210', '01232100', '00121000', '00010000', '00000000']),
  icon('building.house', '住宅', 'building', ['00011000', '00122100', '01222210', '12222221', '11122111', '10022001', '10022001', '11111111']),
  icon('building.shop', '商店', 'building', ['01111110', '12222221', '13333331', '11111111', '10222201', '10200201', '10222201', '11111111']),
  icon('building.tower', '高塔', 'building', ['00111100', '00122100', '00122100', '01122110', '01222210', '01200210', '11200211', '11111111']),
  icon('room.door', '房间', 'room', ['00111100', '01222210', '01222210', '01222210', '01222210', '01222310', '01222210', '01111110']),
  icon('room.bed', '卧室', 'room', ['00000000', '11000000', '12333300', '12222210', '12222221', '11111111', '10000001', '10000001']),
  icon('item.chest', '箱子', 'item', ['00000000', '01111110', '12222221', '11133111', '12233221', '12222221', '12222221', '11111111']),
  icon('item.key', '钥匙', 'item', ['00000000', '01110000', '12021000', '12021000', '01112000', '00012110', '00001101', '00000110']),
  icon('item.book', '书籍', 'item', ['01100110', '12211221', '12211221', '12211221', '12311321', '12211221', '01100110', '00000000']),
  icon('item.bag', '背包', 'item', ['00111100', '01222210', '01200210', '11111111', '12233221', '12222221', '12222221', '11111111']),
  icon('clothing.underwear', '内衣', 'clothing', ['00000000', '00000000', '11000011', '12211221', '12222221', '01222210', '00122100', '00011000']),
  icon('clothing.top', '上衣', 'clothing', ['01100110', '12211221', '12222221', '01222210', '01222210', '01222210', '01222210', '01111110']),
  icon('clothing.bottom', '裤子/裙', 'clothing', ['01111110', '01222210', '01222210', '01211210', '01211210', '01211210', '01211210', '01100110']),
  icon('clothing.socks', '袜子/连裤袜', 'clothing', ['01100110', '01200210', '01200210', '01200210', '01200210', '01200210', '12211221', '11100111']),
  icon('clothing.shoes', '鞋子', 'clothing', ['00000000', '00000000', '00000000', '01100110', '01200210', '12211221', '12211221', '11111111']),
  icon('clothing.outfit', '连体套装', 'clothing', ['01100110', '12211221', '12222221', '01222210', '00122100', '00122100', '01211210', '01100110'])
]);

export const PIXEL_ICON_KEYS = Object.freeze(PIXEL_ICON_CATALOG.map(item => item.key));

export function findPixelIcon(key) {
  return PIXEL_ICON_CATALOG.find(item => item.key === key) || null;
}

function icon(key, label, category, pixels) {
  return Object.freeze({
    key,
    label,
    category,
    pixels: Object.freeze(pixels),
    palette: Object.freeze(['transparent', '#16213b', '#8da2ff', '#f3c969'])
  });
}
