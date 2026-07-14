"use strict";
// 交互式地图插件 —— 纯 JS，无需编译，使用原生 ES6 class（Chromium 原生支持）。
// 在笔记中写 ```interactive-map 代码块，引用一张 SVG，即可悬浮高亮、点击跳转。
// 关键：必须用 `class X extends Plugin` 让原型链正确建立，插件才能继承 Obsidian API。
const { Plugin, PluginSettingTab, Setting, Notice, TFolder, MarkdownView, normalizePath } = require("obsidian");
const HOVER_SOURCE = "interactive-map";

// ===== 兼容旧版中国省级地图的拼音 -> 中文映射 =====
const PROVINCE_NAMES = {
  anhui: "安徽", aomen: "澳门", beijing: "北京", chongqing: "重庆",
  fujian: "福建", gansu: "甘肃", guangdong: "广东", guangxi: "广西",
  guizhou: "贵州", hainan: "海南", hebei: "河北", heilongjiang: "黑龙江",
  henan: "河南", hubei: "湖北", hunan: "湖南", jiangsu: "江苏",
  jiangxi: "江西", jilin: "吉林", liaoning: "辽宁", neimenggu: "内蒙古",
  ningxia: "宁夏", qinghai: "青海", shandong: "山东", shanghai: "上海",
  shanxi: "山西", sichuan: "四川", taiwan: "台湾", tianjin: "天津",
  xianggang: "香港", xinjiang: "新疆", xizang: "西藏", yunnan: "云南",
  zhejiang: "浙江"
};

const DEFAULT_SETTINGS = {
  createIfMissing: false,      // 点击不存在的区域时是否自动新建笔记
  defaultBaseFolder: "",       // 区域笔记所在目录（留空则在全库按文件名解析）
  hoverScale: 1.08,            // 悬浮放大倍数
  hoverColor: "#f5a623",       // 悬浮填充色
  openInNewTab: false          // 是否在新标签页打开
};

class InteractiveMapPlugin extends Plugin {
  // 不写 constructor：让默认构造函数把 (app, id) 透传给 Plugin，
  // 否则 this.app / this.id 会是 undefined，导致加载即崩溃。
  async onload() {
    this.svgCache = new Map(); // path -> { mtime, text }
    await this.loadSettings();
    this.addSettingTab(new InteractiveMapSettingTab(this.app, this));
    this.applyStyleVars();
    this.app.workspace.registerHoverLinkSource(HOVER_SOURCE, {
      display: "Interactive Map",
      defaultMod: true,
    });

    this.registerMarkdownCodeBlockProcessor("interactive-map", (source, el, ctx) => {
      this.renderMap(source, el, ctx).catch((err) => {
        console.error("[interactive-map]", err);
        el.empty();
        el.addClass("interactive-map-container");
        const div = el.createEl("div", { cls: "im-error" });
        div.setText("Interactive Map 出错：" + (err && err.message ? err.message : err));
      });
    });

    this.addCommand({
      id: "insert-interactive-map",
      name: "插入交互式地图代码块",
      editorCallback: (editor) => {
        editor.replaceSelection("```interactive-map\n[[]]\n```");
      }
    });

    this.setupDropHandler();
    this.setupHoverPreview();
  }

  // Ctrl 悬浮预览：跟踪鼠标当前所在区域，并监听 Ctrl 按下 —— 这样「先悬浮、后按 Ctrl」无需移动鼠标也能弹预览。
  setupHoverPreview() {
    this.imHover = { x: 0, y: 0, target: null, hoverParent: null, sourcePath: "", lastKey: "" };
    this.registerDomEvent(document, "keydown", (e) => {
      if (e.key !== "Control" && e.key !== "Meta") return;
      const st = this.imHover;
      if (!st.target || !st.hoverParent) return;
      // 合成一个带「当前鼠标坐标 + ctrlKey」的真实 MouseEvent，交给核心 page-preview
      const ev = new MouseEvent("mouseover", {
        ctrlKey: true, metaKey: e.key === "Meta",
        clientX: st.x, clientY: st.y, bubbles: true,
      });
      this.imPreview(ev, st.target, st.hoverParent, st.sourcePath);
    });
    // 松开 Ctrl/Meta 时清除去重标记，确保重复按下 Ctrl 依然能触发预览
    this.registerDomEvent(document, "keyup", (e) => {
      if (e.key === "Control" || e.key === "Meta") this.imHover.lastKey = "";
    });
  }

  // 触发 Obsidian 原生 hover-link（page-preview 接管，按事件 ctrlKey + 设置决定是否/何时弹）
  imPreview(ev, target, hoverParent, sourcePath) {
    if (!target) return;
    const name = target.getAttribute("data-name");
    if (!name) return;
    const linktext = target.getAttribute("data-link") || name;
    const slug = target.getAttribute("data-slug");
    const ctrl = ev.ctrlKey || ev.metaKey;
    const key = slug + "|" + (ctrl ? "1" : "0");
    if (key === this.imHover.lastKey) return; // 同区域+同 Ctrl 态不重复弹
    this.imHover.lastKey = key;
    this.app.workspace.trigger("hover-link", {
      event: ev, source: HOVER_SOURCE, hoverParent,
      targetEl: target, linktext, sourcePath,
    });
  }

  onunload() {
    this.app.workspace.unregisterHoverLinkSource(HOVER_SOURCE);
    document.documentElement.style.removeProperty("--im-hover-scale");
    document.documentElement.style.removeProperty("--im-hover-color");
  }

  // ===== 拖拽 SVG 到笔记：自动插入交互式地图代码块 =====
  setupDropHandler() {
    const handler = (evt) => {
      this.onDrop(evt).catch((error) => {
        console.error("[interactive-map] SVG 拖入失败", error);
        new Notice("SVG 拖入失败：" + (error?.message || error));
      });
    };
    // 用 window 捕获阶段，确保早于 Obsidian 自带的 drop 处理，便于接管
    window.addEventListener("drop", handler, true);
    this.register(() => window.removeEventListener("drop", handler, true));
  }

  getDropPosition(view, evt) {
    const editor = view.editor;
    try {
      if (typeof editor.posAtCoords === "function") {
        return editor.posAtCoords({ x: evt.clientX, y: evt.clientY });
      }
      const cm = editor.cm;
      if (cm && typeof cm.posAtCoords === "function") {
        const offset = cm.posAtCoords({ x: evt.clientX, y: evt.clientY });
        if (Number.isInteger(offset) && typeof editor.offsetToPos === "function") {
          return editor.offsetToPos(offset);
        }
      }
    } catch (_) {}
    return null;
  }

  async importDroppedSvg(file, sourcePath) {
    const targetPath = await this.app.fileManager.getAvailablePathForAttachment(file.name, sourcePath);
    const content = await file.arrayBuffer();
    await this.app.vault.createBinary(targetPath, content);
    return targetPath;
  }

  async onDrop(evt) {
    const dt = evt.dataTransfer;
    if (!dt) return;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return;
    const externalSvg = Array.from(dt.files || []).find((file) => /\.svg$/i.test(file.name));

    // 读取拖拽文本（Obsidian 内部拖文件会带 wikilink 或路径）
    let text = "";
    for (const type of dt.types) {
      try {
        const value = dt.getData(type);
        if (value && value.trim()) { text = value; break; }
      } catch (_) {}
    }
    let ref = this.extractSvgRef(text);
    if (!externalSvg && !ref) return; // 不是 SVG 拖拽，交给 Obsidian 默认处理

    // 接管：阻止 Obsidian 插入默认的 ![[x.svg]] 图片嵌入
    evt.preventDefault();
    evt.stopPropagation();
    const editor = view.editor;
    const pos = this.getDropPosition(view, evt);
    if (externalSvg) {
      ref = await this.importDroppedSvg(externalSvg, view.file?.path || "");
    }
    const block = "\n```interactive-map\n[[" + ref + "]]\n```\n";
    if (pos) editor.replaceRange(block, pos);
    else editor.replaceSelection(block);
    new Notice("已插入交互式 SVG 地图");
  }

  // 从拖拽文本提取 SVG 引用：[[x.svg]] / [[x.svg|别名]] / 裸路径 x.svg
  extractSvgRef(text) {
    if (!text) return null;
    let m = text.match(/\[\[([^\[\]]*?\.svg)(?:\|[^\[\]]*)?\]\]/i);
    if (m) return m[1].trim();
    m = text.match(/([^\s"']+\.svg)\b/i);
    if (m) return m[1].trim();
    return null;
  }

  async loadSettings() {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data || {});
    this.applyStyleVars();
  }
  async saveSettings() {
    await this.saveData(this.settings);
    this.applyStyleVars();
  }
  applyStyleVars() {
    document.documentElement.style.setProperty("--im-hover-scale", String(this.settings.hoverScale));
    document.documentElement.style.setProperty("--im-hover-color", this.settings.hoverColor);
  }

  // 从代码块内容里解析出 SVG 文件引用（支持 [[xxx.svg]] 或裸路径）
  parseFileRef(source) {
    const m = source.match(/\[\[([^\]]+)\]\]/);
    let ref = m ? m[1] : source.trim().split(/\r?\n/)[0].trim();
    if (ref && ref.includes("|")) ref = ref.split("|")[0].trim();
    return ref;
  }

  // 用 Obsidian 的链接解析找到 TFile（支持全库唯一文件名 / 相对路径）
  resolveFile(linkText, sourcePath) {
    if (!linkText) return null;
    const cleanLink = normalizePath(linkText);
    // 显式库内路径优先，不依赖 metadataCache 是否已完成批量文件索引。
    const exact = this.app.vault.getAbstractFileByPath(cleanLink);
    if (exact?.path) return exact;
    const file = this.app.metadataCache.getFirstLinkpathDest(linkText, sourcePath);
    if (file) return file;
    // 最后按唯一文件名兜底；若有重名则拒绝猜测，避免打开错误文件。
    const leafName = cleanLink.slice(cleanLink.lastIndexOf("/") + 1);
    const matches = this.app.vault.getFiles().filter((candidate) => candidate.name === leafName);
    return matches.length === 1 ? matches[0] : null;
  }

  // 读取 SVG 文本（按 mtime 缓存）
  async readSvgText(file) {
    try {
      const stat = await this.app.vault.adapter.stat(file.path);
      const cached = this.svgCache.get(file.path);
      const mtime = stat ? stat.mtime : 0;
      if (cached && cached.mtime === mtime) return cached.text;
      const text = await this.app.vault.read(file);
      this.svgCache.set(file.path, { mtime, text });
      return text;
    } catch (e) {
      return this.app.vault.read(file);
    }
  }

  // 加载同名 .json 侧车配置（用于下级地图：省→市、市→县）
  // 格式：{ "regions": { "nanchang": "南昌", ... } } 或直接 { "nanchang": "南昌" }
  async loadSidecar(svgFile) {
    const jsonPath = svgFile.path.replace(/\.[^.\/]+$/, ".json");
    const jf = this.app.vault.getAbstractFileByPath(jsonPath);
    if (!jf) return null;
    try {
      const raw = await this.app.vault.read(jf);
      const data = JSON.parse(raw);
      return data.regions || data || null;
    } catch (e) {
      console.warn("[interactive-map] 侧车 JSON 解析失败：" + jsonPath, e);
      return null;
    }
  }

  // 拼音/slug -> 笔记名（侧车优先，其次内置省表，最后用 slug 本身）
  resolveRegionName(slug, sidecar) {
    if (sidecar && sidecar[slug]) return String(sidecar[slug]);
    if (PROVINCE_NAMES[slug]) return PROVINCE_NAMES[slug];
    return slug;
  }

  getRegionInfo(node, sidecar) {
    const classes = (node.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean);
    const stateIndex = classes.indexOf("state");
    const classSlug = stateIndex >= 0 ? classes[stateIndex + 1] : "";
    const slug = node.getAttribute("data-adcode")
      || node.getAttribute("data-slug")
      || classSlug
      || node.getAttribute("id")
      || "";
    const title = node.querySelector(":scope > title")?.textContent?.trim();
    const mapped = sidecar?.[slug] ? String(sidecar[slug]) : PROVINCE_NAMES[slug];
    const name = node.getAttribute("data-name") || mapped || title || slug;
    return { slug, name };
  }

  getTargetCandidates(name, sourcePath) {
    const cleanSource = normalizePath(sourcePath || "");
    const slash = cleanSource.lastIndexOf("/");
    const sourceDir = slash >= 0 ? cleanSource.slice(0, slash) : "";
    const sourceName = cleanSource.slice(slash + 1).replace(/\.md$/i, "");
    const baseValue = (this.settings.defaultBaseFolder || "").replace(/\/+$/, "");
    const base = baseValue ? normalizePath(baseValue) : "";
    const candidates = [];
    if (sourceName) candidates.push(normalizePath([sourceDir, sourceName, name].filter(Boolean).join("/")));
    if (base) candidates.push(normalizePath(`${base}/${name}`));
    candidates.push(normalizePath(name));
    return [...new Set(candidates.filter(Boolean))];
  }

  resolveRegionFile(name, sourcePath) {
    for (const candidate of this.getTargetCandidates(name, sourcePath)) {
      const exactPath = candidate.toLowerCase().endsWith(".md") ? candidate : `${candidate}.md`;
      const exact = this.app.vault.getAbstractFileByPath(exactPath);
      if (exact?.path) return exact;
      const resolved = this.resolveFile(candidate, sourcePath);
      if (resolved?.path) return resolved;
    }
    return null;
  }

  async renderMap(source, el, ctx) {
    el.empty();
    el.addClass("interactive-map-container");

    const ref = this.parseFileRef(source);
    if (!ref) {
      el.createEl("div", { cls: "im-error" }).setText("请在代码块中提供 SVG 文件，例如：[[china_provinces_map.svg]]");
      return;
    }

    const svgFile = this.resolveFile(ref, ctx.sourcePath);
    if (!svgFile) {
      el.createEl("div", { cls: "im-error" }).setText("未找到 SVG 文件：" + ref + "（请检查路径或文件名是否在全库唯一）");
      return;
    }

    const [svgText, sidecar] = await Promise.all([this.readSvgText(svgFile), this.loadSidecar(svgFile)]);

    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    const svgEl = doc.documentElement;
    if (!svgEl || svgEl.nodeName.toLowerCase() !== "svg") {
      el.createEl("div", { cls: "im-error" }).setText("SVG 解析失败，请确认文件是有效的 SVG。");
      return;
    }
    // 自适应宽度
    svgEl.removeAttribute("width");
    svgEl.removeAttribute("height");
    svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");

    const inlined = document.importNode(svgEl, true);
    el.appendChild(inlined);

    // 给每个区域打标记 + 中文 title 提示
    const regionEls = Array.from(inlined.querySelectorAll("[class~='state'], [data-adcode]"));
    regionEls.forEach((node) => {
      const { slug, name } = this.getRegionInfo(node, sidecar);
      if (!slug || !name) return;
      node.setAttribute("data-slug", slug);
      node.setAttribute("data-name", name);
      const target = this.resolveRegionFile(name, ctx.sourcePath);
      if (target) node.setAttribute("data-link", target.path.replace(/\.md$/i, ""));
      if (!node.querySelector(":scope > title")) {
        const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
        title.textContent = name;
        node.prepend(title);
      }
    });

    // 事件委托：点击区域 -> 打开对应笔记
    inlined.addEventListener("click", (ev) => {
      const target = ev.target.closest("[data-slug]");
      if (!target || !inlined.contains(target)) return;
      ev.preventDefault();
      const name = target.getAttribute("data-name");
      const slug = target.getAttribute("data-slug");
      this.openRegion(name, slug, ctx.sourcePath).catch((error) => {
        console.error("[interactive-map] 打开区域失败", error);
        new Notice("打开区域失败：" + (error?.message || error));
      });
    });

    // 先用真实 mouseover 事件通知 Page Preview；是否要求 Ctrl 由注册来源的 defaultMod 控制。
    // 「先悬浮、后按 Ctrl」由 setupHoverPreview() 的 keydown 监听补触发。
    const hoverParent = el;
    const arm = (ev, t) => {
      this.imHover.x = ev.clientX; this.imHover.y = ev.clientY;
      this.imHover.target = t; this.imHover.hoverParent = hoverParent;
      this.imHover.sourcePath = ctx.sourcePath;
    };
    inlined.addEventListener("mouseover", (ev) => {
      const t = ev.target.closest("[data-slug]");
      if (t && inlined.contains(t)) {
        arm(ev, t);
        this.imPreview(ev, t, hoverParent, ctx.sourcePath);
      }
    });
    inlined.addEventListener("mousemove", (ev) => {
      this.imHover.x = ev.clientX; this.imHover.y = ev.clientY; // 始终记录坐标，供 keydown 合成事件定位
      // 始终更新 target，确保 mouseover 漏掉时（如切换笔记后鼠标已在区域内）也能跟踪
      const t = ev.target.closest("[data-slug]");
      if (t && inlined.contains(t)) {
        this.imHover.target = t;
        this.imHover.hoverParent = hoverParent;
        this.imHover.sourcePath = ctx.sourcePath;
        if (ev.ctrlKey || ev.metaKey) this.imPreview(ev, t, hoverParent, ctx.sourcePath);
      }
    });
    inlined.addEventListener("mouseleave", () => {
      if (this.imHover.hoverParent === hoverParent) {
        this.imHover.target = null;
        this.imHover.hoverParent = null;
      }
      this.imHover.lastKey = "";
    });
  }

  async openRegion(name, slug, sourcePath) {
    const baseValue = (this.settings.defaultBaseFolder || "").replace(/\/+$/, "");
    const base = baseValue ? normalizePath(baseValue) : "";
    const file = this.resolveRegionFile(name, sourcePath);

    if (file) {
      // 使用完整库内路径，避免不同省份同名市/区时打开错误文件。
      await this.app.workspace.openLinkText(file.path.replace(/\.md$/i, ""), sourcePath, this.settings.openInNewTab);
      return;
    }

    if (this.settings.createIfMissing) {
      const candidates = this.getTargetCandidates(name, sourcePath);
      const nestedCandidate = candidates[0] || "";
      const nestedDir = nestedCandidate.includes("/") ? nestedCandidate.slice(0, nestedCandidate.lastIndexOf("/")) : "";
      const dir = nestedDir && this.app.vault.getAbstractFileByPath(nestedDir) instanceof TFolder
        ? nestedDir
        : base;
      const path = (dir ? dir + "/" : "") + name + ".md";
      try {
        if (dir && !this.app.vault.getAbstractFileByPath(dir)) {
          try { await this.app.vault.createFolder(dir); } catch (_) {}
        }
        await this.app.vault.create(path, "# " + name + "\n\n");
        await this.app.workspace.openLinkText(path.replace(/\.md$/i, ""), sourcePath, this.settings.openInNewTab);
      } catch (e) {
        new Notice("创建笔记失败：" + (e && e.message ? e.message : e));
      }
    } else {
      new Notice("未找到笔记：「" + name + "」\n（可在插件设置中开启「自动创建」）");
    }
  }
}

// ===== 设置面板 =====
class InteractiveMapSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();

    // 原生 <datalist>：文件夹自动补全。点击 / 方向键 / Enter 均由浏览器原生处理，稳定可靠。
    const datalist = document.createElement("datalist");
    datalist.id = "im-folder-datalist";
    this.app.vault.getAllLoadedFiles()
      .filter((f) => f instanceof TFolder)
      .forEach((f) => {
        const opt = document.createElement("option");
        opt.value = f.path;
        datalist.appendChild(opt);
      });
    containerEl.appendChild(datalist);

    new Setting(containerEl)
      .setName("悬浮放大倍数")
      .setDesc("鼠标悬浮时区域放大的比例，如 1.08")
      .addText((t) => {
        t.setValue(String(this.plugin.settings.hoverScale));
        t.onChange((v) => {
          const n = parseFloat(v);
          this.plugin.settings.hoverScale = isNaN(n) ? 1.08 : n;
          this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("悬浮颜色")
      .setDesc("鼠标悬浮时的填充颜色")
      .addColorPicker((c) => {
        c.setValue(this.plugin.settings.hoverColor);
        c.onChange((v) => {
          this.plugin.settings.hoverColor = v;
          this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("默认笔记目录")
      .setDesc("可选。点击区域后在该目录下查找/创建笔记。输入时会有文件夹自动补全；留空则在全库按文件名解析。")
      .addText((t) => {
        t.setPlaceholder("例如：归档/中国");
        t.setValue(this.plugin.settings.defaultBaseFolder);
        t.inputEl.setAttribute("list", "im-folder-datalist");
        t.onChange((v) => {
          this.plugin.settings.defaultBaseFolder = v.trim();
          this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("笔记不存在时自动创建")
      .setDesc("开启后，点击未对应笔记的区域会自动新建同名笔记")
      .addToggle((tg) => {
        tg.setValue(this.plugin.settings.createIfMissing);
        tg.onChange((v) => {
          this.plugin.settings.createIfMissing = v;
          this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("在新标签页打开")
      .setDesc("开启后，点击区域在新标签页打开笔记")
      .addToggle((tg) => {
        tg.setValue(this.plugin.settings.openInNewTab);
        tg.onChange((v) => {
          this.plugin.settings.openInNewTab = v;
          this.plugin.saveSettings();
        });
      });
  }
}

module.exports = InteractiveMapPlugin;
