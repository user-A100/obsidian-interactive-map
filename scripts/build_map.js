#!/usr/bin/env node
// =====================================================================
// 通用：DataV GeoJSON(_full) → 可下钻 SVG + 同名 .json 侧车
// 适用：省级图（省→市）、市级图（市→区/县）。中国地图见 build_china.js。
//
// 用法（在仓库根目录或任意位置）：
//   node scripts/build_map.js <输入.geojson> <输出名>
// 例：
//   node scripts/build_map.js "归档/attachment/广东省.geojson" 广东省
//   → 生成 归档/attachment/广东省.svg 和 广东省.json（与 geojson 同目录）
//
// 产物约定（插件识别）：
//   <path class="state <adcode>" fill="#BFBFBF" fill-rule="evenodd" stroke="#fff" ... d="..."><title>中文名</title></path>
//   .json: { "regions": { "<adcode>": "<中文名>", ... } }
// =====================================================================
const fs = require("fs"), path = require("path");
const [, , inGeo, outName] = process.argv;
if (!inGeo || !outName) {
  console.error("用法: node build_map.js <输入.geojson> <输出名>");
  process.exit(1);
}
const ROUND = 1000, fmt = (n) => String(Math.round(n * ROUND) / ROUND);
const ringsOf = (g) => g.type === "Polygon" ? g.coordinates : g.type === "MultiPolygon" ? g.coordinates.flat() : [];

const dir = path.dirname(path.resolve(inGeo));
const geo = JSON.parse(fs.readFileSync(inGeo, "utf8"));
// 过滤掉无名/无几何的 feature（DataV 中国数据末尾偶有空 feature）
const feats = geo.features.filter((f) => f && f.properties && f.properties.name && f.geometry);

// 全局包围盒
let minX = Infinity, maxX = -Infinity, minLat = Infinity, maxY = -Infinity;
for (const f of feats) for (const r of ringsOf(f.geometry)) for (const [x, y] of r) {
  if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minLat) minLat = y; if (y > maxY) maxY = y;
}
const W = maxX - minX, H = maxY - minLat;
const sw = +(Math.max(W, H) / 400).toFixed(4);

const regions = {};
let body = "";
for (const f of feats) {
  const ac = String(f.properties.adcode), name = String(f.properties.name);
  regions[ac] = name;
  let d = "";
  for (const r of ringsOf(f.geometry)) {
    for (let i = 0; i < r.length; i++) { const [x, y] = r[i]; d += (i ? "L" : "M") + fmt(x - minX) + "," + fmt(maxY - y); }
    d += "Z";
  }
  body += `\t<path class="state ${ac}" fill="#BFBFBF" fill-rule="evenodd" stroke="#ffffff" stroke-width="${sw}" d="${d}"><title>${name}</title></path>\n`;
}
const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(W)} ${fmt(H)}" preserveAspectRatio="xMidYMid meet">\n` +
  `\t<g>\n${body}\t</g>\n</svg>\n`;

const svgPath = path.join(dir, outName + ".svg");
const jsonPath = path.join(dir, outName + ".json");
fs.writeFileSync(svgPath, svg, "utf8");
fs.writeFileSync(jsonPath, JSON.stringify({ regions }, null, 2), "utf8");
console.log(`${outName}: ${feats.length} 区域`);
console.log("  SVG :", svgPath, `(${fs.statSync(svgPath).size} bytes)`);
console.log("  JSON:", jsonPath);
console.log("  样例:", Object.entries(regions).slice(0, 5).map(([k, v]) => k + ":" + v).join("  "));
