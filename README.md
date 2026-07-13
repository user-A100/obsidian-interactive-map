# Interactive Map &middot; 交互式地图

[English](#english) | [中文](#中文)

---

## English

### Installation

1. Open **Settings → Community Plugins** in Obsidian
2. Turn off **Restricted mode**
3. Click **Browse**, search for "Interactive Map"
4. Click **Install**, then **Enable**

Or install manually: copy `main.js`, `manifest.json`, and `styles.css` into `VaultFolder/.obsidian/plugins/interactive-map/`.

### Quick Start

The plugin ships with a built-in **China provinces map** (`china_provinces_map.svg` + `.json`). Zero configuration needed.

Create a code block in any note:

~~~
```interactive-map
[[china_provinces_map.svg]]
```
~~~

Switch to **Reading view**:
- **Hover** a province — it scales up and changes color with a tooltip
- **Ctrl/Cmd + hover** — shows a native page preview popup (same as wikilinks)
- **Click** a province — navigates to the corresponding note (e.g. `Beijing.md`)

![Hover preview](悬浮.png)

> If no matching note exists, the plugin will show a notice. Enable "Auto-create notes" in settings to create notes automatically.

### Drill-down: Province → City → District

The plugin includes two Node.js scripts under `scripts/` that generate SVG maps and JSON sidecars from public DataV GeoJSON data.

**Data source** (free, no registration):

```
https://geo.datav.aliyun.com/areas_v3/bound/<adcode>_full.json
```

**Generate a province or city map:**

```bash
curl -o Guangdong.geojson "https://geo.datav.aliyun.com/areas_v3/bound/440000_full.json"
node scripts/build_map.js Guangdong.geojson Guangdong
# → Guangdong.svg + Guangdong.json
```

**Rebuild the China map:**

```bash
curl -o china.geojson "https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json"
node scripts/build_china.js
# → china_provinces_map.svg + china_provinces_map.json
```

**Create a drill-down chain:**

1. Create `Guangdong.md` with:
~~~
```interactive-map
[[Guangdong.svg]]
```
~~~

2. Click "Guangdong" on the China map → navigates to `Guangdong.md` with the city-level map
3. Repeat: download Guangzhou geojson (adcode=440100) → generate → create `Guangzhou.md`

This gives you **China → Guangdong → Guangzhou** drill-down.

![Drill-down example](下探.png)

### Province adcode reference

| Province | adcode | Province | adcode | Province | adcode |
|----------|--------|----------|--------|----------|--------|
| Beijing | 110000 | Shanghai | 310000 | Tianjin | 120000 |
| Chongqing | 500000 | Hebei | 130000 | Shanxi | 140000 |
| Inner Mongolia | 150000 | Liaoning | 210000 | Jilin | 220000 |
| Heilongjiang | 230000 | Jiangsu | 320000 | Zhejiang | 330000 |
| Anhui | 340000 | Fujian | 350000 | Jiangxi | 360000 |
| Shandong | 370000 | Henan | 410000 | Hubei | 420000 |
| Hunan | 430000 | Guangdong | 440000 | Guangxi | 450000 |
| Hainan | 460000 | Sichuan | 510000 | Guizhou | 520000 |
| Yunnan | 530000 | Tibet | 540000 | Shaanxi | 610000 |
| Gansu | 620000 | Qinghai | 630000 | Ningxia | 640000 |
| Xinjiang | 650000 | Taiwan | 710000 | Hong Kong | 810000 |
| Macau | 820000 | | | | |

### SVG format spec

To create custom maps, each region must be an element (`<path>` / `<polygon>` / `<rect>` …) with:

1. `class="state <slug>"` — slug identifies the region
2. A `<title>` child element for the tooltip
3. A matching `.json` sidecar mapping slugs to note names

Example:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3" preserveAspectRatio="xMidYMid meet">
  <g>
    <path class="state 440100" fill="#BFBFBF" fill-rule="evenodd" stroke="#fff" stroke-width="0.01" d="M...Z">
      <title>Guangzhou</title>
    </path>
  </g>
</svg>
```

```json
{ "regions": { "440100": "Guangzhou", "440300": "Shenzhen" } }
```

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Hover scale | `1.08` | Zoom factor on hover |
| Hover color | `#f5a623` | Fill color on hover |
| Default note folder | (empty) | Lookup/create notes under this folder |
| Auto-create notes | Off | Create missing notes on click |
| Open in new tab | Off | Open clicked notes in a new tab |

### Shortcuts

- **Ctrl/Cmd + hover**: show page preview (requires core "Page Preview" plugin)
- Command palette → "Insert interactive map code block"
- **Drag and drop** an SVG file into the editor to auto-insert a map code block

---

## 中文

### 安装

1. Obsidian → 设置 → 第三方插件 → 关闭安全模式
2. 点击**浏览**，搜索 "Interactive Map"
3. 点击**安装**，然后**启用**

或手动安装：将 `main.js`、`manifest.json`、`styles.css` 复制到 `仓库/.obsidian/plugins/interactive-map/`。

### 快速开始

插件内置了一张**中国 34 省级行政区地图**，零配置即可使用。

在笔记中写入：

~~~
```interactive-map
[[china_provinces_map.svg]]
```
~~~

切换到**阅读视图**：
- **悬浮**省份 — 区域放大变色 + tooltip 显示省名
- **Ctrl/Cmd + 悬浮** — 弹出笔记的原生页面预览（和 wikilink 一样）
- **点击**省份 — 跳转到对应笔记（如 `北京.md`）

![悬浮预览](悬浮.png)

### 层层下钻：省 → 市 → 区县

从 DataV 公开数据生成地图：

```bash
curl -o 广东省.geojson "https://geo.datav.aliyun.com/areas_v3/bound/440000_full.json"
node scripts/build_map.js 广东省.geojson 广东省
# → 广东省.svg + 广东省.json
```

建 `广东.md` 内嵌地图 → 点中国地图的「广东」→ 跳转到市级地图 → 再生成广州市.svg → 点「广州」→ 进区级笔记。

![下钻示例](下探.png)

### SVG 格式约定

区域元素带 `class="state <slug>"`，内嵌 `<title>`，配同名 `.json` 侧车映射 slug→笔记名。推荐用 6 位 adcode 作为 slug。

### 设置

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| 悬浮放大倍数 | `1.08` | 悬浮时缩放比例 |
| 悬浮颜色 | `#f5a623` | 悬浮时填充颜色 |
| 默认笔记目录 | (空) | 在该目录下查找/创建笔记 |
| 笔记不存在时自动创建 | 关闭 | 点击无笔记区域自动新建 |
| 在新标签页打开 | 关闭 | 在新标签页打开笔记 |
