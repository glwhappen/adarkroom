/**
 * 用途：从 game-icons.net 的官方仓库抓取图标 SVG，合成一张本地 sprite（img/icons.svg），
 *       让游戏能离线/自托管地给物品文字配上可单独着色的图标。
 * 用法：node tools/fetch-icons.mjs           # 抓取并重建 sprite
 *       node tools/fetch-icons.mjs --check   # 只校验清单里的图标是否都存在（不写文件）
 * 入参：--check   仅检查，不写文件
 *       --force   忽略本地缓存，强制重新下载（tools/.icon-cache/）
 * 出参：img/icons.svg（产物，需提交入库）；控制台打印每个图标的处理结果
 * 依赖：Node 18+（内置 fetch）。联网访问 raw.githubusercontent.com。
 * 关键词：图标 icon icons game-icons sprite svg 素材 抓取 下载 构建 配色 美化 物品图标 库存图标
 * 更新：2026-09-15
 *
 * 说明：
 *  - 清单在 tools/icons.json（物品 key -> <作者>/<图标名>），想换图标改那里。
 *  - game-icons 的原始 SVG 是「黑色背景块 + 白色图形」，直接塞进页面会是一坨黑。
 *    这里做了三步清理：① 去掉整块画布背景 ② 去掉硬编码的 fill ③ 挂 fill="currentColor"，
 *    这样才能用 CSS 的 color 给每个图标单独上色。
 *  - 产物按物品 key 命名 symbol（id = i-<key-slug>），所以同一张图给两个物品用也不会串色。
 *  - 图标许可：CC BY 3.0，署名见 img/icons.svg 顶部的注释。
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'tools/icons.json');
const CACHE_DIR = path.join(ROOT, 'tools/.icon-cache');
const OUT = path.join(ROOT, 'img/icons.svg');
const BASE = 'https://raw.githubusercontent.com/game-icons/icons/master/';

const argv = process.argv.slice(2);
const CHECK_ONLY = argv.includes('--check');
const FORCE = argv.includes('--force');

/** 物品 key -> CSS class / symbol id 用的 slug */
function slug(key) {
	return key.replace(/\s+/g, '-').toLowerCase();
}

/**
 * 把 game-icons 的原始 SVG 洗成可着色的单色图标。
 * 原始结构基本固定为：<path d="M0 0h512v512H0z"/>（黑底）+ <path fill="#fff" .../>（图形）。
 */
function normalize(svg, label) {
	const viewBox = (svg.match(/viewBox="([^"]+)"/) || [, '0 0 512 512'])[1];
	const paths = [...svg.matchAll(/<path\b[^>]*?\bd="([^"]+)"[^>]*?\/?>/g)].map((m) => m[1]);
	if (paths.length === 0) throw new Error(label + '：没解析出任何 path');

	const [, , vw, vh] = viewBox.split(/\s+/).map(Number);
	const isBackground = (d) => {
		// 铺满整个画布的方块：M0 0h512v512H0z 之类
		const nums = d.match(/-?\d+(\.\d+)?/g)?.map(Number) || [];
		if (nums.length < 4) return false;
		const [x, y] = nums;
		return x === 0 && y === 0 && (d.includes(String(vw)) && d.includes(String(vh)));
	};

	const shapes = paths.filter((d) => !isBackground(d));
	if (shapes.length === 0) throw new Error(label + '：只剩下背景块，图形被误判成背景了');

	return (
		'<symbol id="i-' + slug(label) + '" viewBox="' + viewBox + '" fill="currentColor">' +
		shapes.map((d) => '<path d="' + d + '"/>').join('') +
		'</symbol>'
	);
}

async function load(rel) {
	const cacheFile = path.join(CACHE_DIR, rel.replace(/\//g, '__'));
	if (!FORCE && existsSync(cacheFile)) return readFile(cacheFile, 'utf8');
	// raw.githubusercontent.com 偶发瞬断，这里重试几次再放弃
	let lastErr;
	for (let attempt = 1; attempt <= 4; attempt++) {
		try {
			const res = await fetch(BASE + rel + '.svg');
			if (!res.ok) throw new Error('HTTP ' + res.status);
			const body = await res.text();
			if (!body.includes('<svg')) throw new Error('返回内容不是 SVG');
			await mkdir(CACHE_DIR, { recursive: true });
			await writeFile(cacheFile, body);
			return body;
		} catch (e) {
			lastErr = e;
			if (attempt < 4) await new Promise((r) => setTimeout(r, attempt * 1000));
		}
	}
	throw new Error(rel + ' -> ' + lastErr.message);
}

const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
const entries = Object.entries(manifest).filter(([k]) => !k.startsWith('_'));

if (CHECK_ONLY) {
	let bad = 0;
	for (const [key, src] of entries) {
		try {
			normalize(await load(src), key);
			console.log('ok    ' + key + '  <- ' + src);
		} catch (e) {
			bad++;
			console.log('FAIL  ' + key + '  <- ' + src + '  (' + e.message + ')');
		}
	}
	console.log('\n' + entries.length + ' 项，失败 ' + bad + ' 项');
	process.exit(bad ? 1 : 0);
}

const symbols = [];
const names = [];
const failed = [];
for (const [key, src] of entries) {
	try {
		symbols.push(normalize(await load(src), key));
		names.push(key);
		console.log('ok    ' + key + '  <- ' + src);
	} catch (e) {
		failed.push(key + ' (' + e.message + ')');
		console.log('FAIL  ' + key + '  <- ' + src + '  (' + e.message + ')');
	}
}

if (failed.length) {
	console.error('\n有 ' + failed.length + ' 项失败，未写出 sprite：\n  ' + failed.join('\n  '));
	process.exit(1);
}

const sprite =
	'<!--\n' +
	'  图标 sprite，由 tools/fetch-icons.mjs 依据 tools/icons.json 生成，不要手改。\n' +
	'  图标来自 game-icons.net（CC BY 3.0），作者标注见 tools/icons.json 的路径\n' +
	'  （路径第一段即作者：lorc / delapouite / sbed / skoll 等）。\n' +
	'  用 <svg class="icon icon-<物品key>"><use href="img/icons.svg#i-<物品key>"></use></svg> 引用。\n' +
	'-->\n' +
	'<svg xmlns="http://www.w3.org/2000/svg" style="display:none">' +
	symbols.join('') +
	'</svg>\n';

await writeFile(OUT, sprite);
console.log('\n写入 ' + path.relative(ROOT, OUT) + '：' + symbols.length + ' 个图标，' +
	Math.round(sprite.length / 1024) + ' KB');

// 图标名清单，给 script/icons.js 用：判断某个物品到底有没有图标。
// 没有这份清单，没配图标的物品会被塞一个空 <svg>，白占位、文字跟别的行对不齐。
const listFile = path.join(ROOT, 'script/icon-names.js');
await writeFile(listFile,
	'/**\n' +
	' * 已有图标的物品清单。由 tools/fetch-icons.mjs 生成，勿手改。\n' +
	' * 想加物品图标：改 tools/icons.json 后在项目根目录跑 node tools/fetch-icons.mjs。\n' +
	' */\n' +
	'var ICON_NAMES = ' + JSON.stringify(names) + ';\n');
console.log('写入 ' + path.relative(ROOT, listFile) + '：' + names.length + ' 项');
