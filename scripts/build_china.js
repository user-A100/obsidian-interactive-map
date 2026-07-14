#!/usr/bin/env node
// =====================================================================
// 中国地图：DataV 100000_full.geojson → china_provinces_map.svg + .json
// 特殊处理：把「南海诸岛」（纬度<18°的环，属海南离岛）分离到左下角小图框，避免压扁主体大陆。
// 侧车用「短省名」（北京市→北京、广西壮族自治区→广西…），匹配 Project/MAP 下的省笔记。
//
// 用法：
//   node scripts/build_china.js [中国.geojson] [输出目录]
// 默认：geojson=归档/attachment/china.geojson，输出目录=归档/attachment
// 数据源：https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json （下载后命名为 china.geojson）
// =====================================================================
const fs = require("fs"), path = require("path");
const inGeo = process.argv[2] || path.join(__dirname, "..", "china.geojson");
const OUT = process.argv[3] || path.join(__dirname, "..");
const ROUND = 1000, fmt = (n) => String(Math.round(n * ROUND) / ROUND);
const THRESH = 18; // 纬度阈值：< 18° 的环归入南海诸岛小图框

const shortName = (s) => String(s)
  .replace(/(壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区)$/, "")
  .replace(/(省|市)$/, "");
const ringsOf = (g) => g.type === "Polygon" ? g.coordinates : g.type === "MultiPolygon" ? g.coordinates.flat() : [];

const geo = JSON.parse(fs.readFileSync(inGeo, "utf8"));
const feats = geo.features.filter((f) => f && f.properties && f.properties.name && f.geometry && String(f.properties.adcode) !== "100000");

const mainRings = [], southRings = [];
for (const f of feats) {
  const ac = String(f.properties.adcode), name = shortName(f.properties.name);
  for (const ring of ringsOf(f.geometry)) {
    let mn = Infinity; for (const [, lat] of ring) if (lat < mn) mn = lat;
    (mn < THRESH ? southRings : mainRings).push({ ring, ac, name });
  }
}
const boxOf = (arr) => {
  let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
  for (const { ring } of arr) for (const [x, y] of ring) { if (x < a) a = x; if (x > b) b = x; if (y < c) c = y; if (y > d) d = y; }
  return { minLng: a, maxLng: b, minLat: c, maxLat: d };
};
const M = boxOf(mainRings), S = boxOf(southRings);
const mW = M.maxLng - M.minLng, mH = M.maxLat - M.minLat;
const sW = S.maxLng - S.minLng, sH = S.maxLat - S.minLat;
const mainSW = +(Math.max(mW, mH) / 400).toFixed(4);
const ringPath = (ring, fn) => {
  let d = ""; for (let i = 0; i < ring.length; i++) { const [x, y] = fn(ring[i][0], ring[i][1]); d += (i ? "L" : "M") + fmt(x) + "," + fmt(y); } return d + "Z";
};
const merge = (arr, fn) => { const m = {}; for (const { ring, ac, name } of arr) (m[ac] = m[ac] || { name, d: "" }).d += ringPath(ring, fn); return m; };
const mainOrigin = (lng, lat) => [lng - M.minLng, M.maxLat - lat];

let body = "";
for (const ac in merge(mainRings, mainOrigin)) {
  const v = merge(mainRings, mainOrigin)[ac];
  body += `\t<path class="state ${ac}" fill="#BFBFBF" fill-rule="evenodd" stroke="#ffffff" stroke-width="${mainSW}" d="${v.d}"><title>${v.name}</title></path>\n`;
}
// 南海诸岛小图框（左下角）
const insetW = mW * 0.30, insetH = mH * 0.30, pad = 0.02;
const insetX = mW * pad, insetY = mH - insetH - mH * pad;
const scale = Math.min(insetW / sW, insetH / sH) * 0.88;
const cW = sW * scale, cH = sH * scale;
const ox = insetX + (insetW - cW) / 2, oy = insetY + (insetH - cH) / 2;
const southOrigin = (lng, lat) => [ox + (lng - S.minLng) * scale, oy + cH - (lat - S.minLat) * scale];
let insetXml = `\t<rect x="${fmt(insetX)}" y="${fmt(insetY)}" width="${fmt(insetW)}" height="${fmt(insetH)}" fill="#f4f4f4" fill-opacity="0.6" stroke="#9aa0a6" stroke-width="${+(mainSW * 0.6).toFixed(4)}"/>\n`;
for (const ac in merge(southRings, southOrigin)) {
  const v = merge(southRings, southOrigin)[ac];
  insetXml += `\t<path class="state ${ac}" fill="#BFBFBF" fill-rule="evenodd" stroke="#ffffff" stroke-width="${+(mainSW * 0.45).toFixed(4)}" d="${v.d}"><title>${v.name}</title></path>\n`;
}
insetXml += `\t<text x="${fmt(insetX + insetW * 0.5)}" y="${fmt(insetY + insetH * 0.14)}" font-size="${+(mH * 0.022).toFixed(4)}" text-anchor="middle" fill="#5f6368">南海诸岛</text>\n`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(mW)} ${fmt(mH)}" preserveAspectRatio="xMidYMid meet">\n\t<g>\n` + body + insetXml + `\t</g>\n</svg>\n`;
fs.writeFileSync(path.join(OUT, "china_provinces_map.svg"), svg, "utf8");
const regions = {}; feats.forEach((f) => (regions[String(f.properties.adcode)] = shortName(f.properties.name)));
fs.writeFileSync(path.join(OUT, "china_provinces_map.json"), JSON.stringify({ regions }, null, 2), "utf8");
console.log(`中国地图: ${feats.length} 省 | 主体宽/高=${(mW / mH).toFixed(2)} | 南海诸岛环=${southRings.length}`);
console.log("  SVG :", path.join(OUT, "china_provinces_map.svg"), `(${fs.statSync(path.join(OUT, "china_provinces_map.svg")).size} bytes)`);
