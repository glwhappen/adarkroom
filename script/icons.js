/**
 * 物品图标：给文字（库存行、按钮、成本提示）前面配一个小图标，每个物品一个颜色。
 *
 * 图标本体是 img/icons.svg 里的一张 sprite（来源 game-icons.net，见 tools/icons.json）。
 * 这里只负责按物品 key 造出 <svg><use/></svg>，颜色交给 css/icons.css 的 .icon-<key> 管。
 *
 * 没在图示表里的物品不显示图标，也不会报错 —— 加新图标改 tools/icons.json 后跑
 * node tools/fetch-icons.mjs 重建 sprite，再在 css/icons.css 里补一行颜色即可。
 */
var Icons = {
	SVG_NS: 'http://www.w3.org/2000/svg',
	XLINK_NS: 'http://www.w3.org/1999/xlink',
	FILE: 'img/icons.svg',

	/** 物品 key -> CSS class 后缀（"energy cell" -> "energy-cell"） */
	slug: function (key) {
		return String(key).replace(/\s+/g, '-').toLowerCase();
	},

	/** 这个物品到底有没有图标（清单由 tools/fetch-icons.mjs 生成） */
	has: function (key) {
		return typeof ICON_NAMES !== 'undefined' && ICON_NAMES.indexOf(key) !== -1;
	},

	/** 造一个图标元素；物品没有配图标就返回 null */
	create: function (key) {
		if (!key || !Icons.has(key)) return null;
		var slug = Icons.slug(key);
		var svg = document.createElementNS(Icons.SVG_NS, 'svg');
		svg.setAttribute('class', 'icon icon-' + slug);
		svg.setAttribute('viewBox', '0 0 512 512');
		svg.setAttribute('aria-hidden', 'true');
		var use = document.createElementNS(Icons.SVG_NS, 'use');
		// 两种写法都给上：老浏览器只认 xlink:href
		use.setAttribute('href', Icons.FILE + '#i-' + slug);
		use.setAttributeNS(Icons.XLINK_NS, 'xlink:href', Icons.FILE + '#i-' + slug);
		svg.appendChild(use);
		return svg;
	},

	/** 把图标插到 el 的开头；el 为空或该物品没图标时什么都不做 */
	prepend: function (el, key) {
		if (!el || !el.length) return;
		var icon = Icons.create(key);
		if (icon) el.prepend(icon);
	}
};
