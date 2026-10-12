const fs = require('fs');
const path = require('path');

const babelPath = path.join(__dirname, 'babel.min.js');
const babelCode = fs.readFileSync(babelPath, 'utf8');
const fn = new Function('window', 'self', 'global', babelCode + '; return typeof Babel !== "undefined" ? Babel : (window.Babel || self.Babel);');
const Babel = fn(global, global, global);

if (!Babel) {
  console.error('Babel failed to load');
  process.exit(1);
}

const sourceHtmlPath = 'G:\\My Drive\\ALL\\iki\\bosjuspos\\index.html';
const html = fs.readFileSync(sourceHtmlPath, 'utf8');
const startTag = '<script type="text/babel">';
const endTag = '</script>';

const startIdx = html.indexOf(startTag);
const endIdx = html.lastIndexOf(endTag);
const jsxCode = html.substring(startIdx + startTag.length, endIdx);

console.log('Compiling JSX (' + jsxCode.length + ' chars)...');
const t0 = Date.now();
const res = Babel.transform(jsxCode, {
  presets: ['react']
});
console.log('Compiled in ' + (Date.now() - t0) + ' ms. JS size: ' + res.code.length + ' chars');

const targetAppJs = path.join(__dirname, 'app.js');
fs.writeFileSync(targetAppJs, res.code, 'utf8');
console.log('Saved ' + targetAppJs + ' successfully');
