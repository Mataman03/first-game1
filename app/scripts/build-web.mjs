// Builds app/www from the web game (../last-driver/index.html) so it runs offline inside the app:
//  - three.js and the fonts are copied in instead of loaded from a CDN
//  - the AdMob ids from ads.config.json are injected, and written into the native projects if they exist
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = path.join(root, '..', 'last-driver', 'index.html');
const www = path.join(root, 'www');
const nm = path.join(root, 'node_modules');
const ads = JSON.parse(fs.readFileSync(path.join(root, 'ads.config.json'), 'utf8'));

fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(path.join(www, 'lib'), { recursive: true });
fs.mkdirSync(path.join(www, 'fonts'), { recursive: true });

// libraries and fonts
fs.copyFileSync(path.join(nm, 'three', 'build', 'three.min.js'), path.join(www, 'lib', 'three.min.js'));
const fonts = [
  ['Bungee', 400, '@fontsource/bungee/files/bungee-latin-400-normal.woff2'],
  ['Rubik', 400, '@fontsource/rubik/files/rubik-latin-400-normal.woff2'],
  ['Rubik', 500, '@fontsource/rubik/files/rubik-latin-500-normal.woff2'],
  ['Rubik', 700, '@fontsource/rubik/files/rubik-latin-700-normal.woff2'],
];
let css = '';
for (const [family, weight, file] of fonts) {
  const name = path.basename(file);
  fs.copyFileSync(path.join(nm, file), path.join(www, 'fonts', name));
  css += `@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};font-display:swap;src:url(${name}) format("woff2")}\n`;
}
fs.writeFileSync(path.join(www, 'fonts', 'fonts.css'), css);

// page
let html = fs.readFileSync(src, 'utf8');
const swap = (from, to) => {
  if (!html.includes(from)) throw new Error('build-web: expected to find ' + from);
  html = html.replace(from, to);
};
swap('<link rel="preconnect" href="https://fonts.googleapis.com">\n', '');
swap('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bungee&family=Rubik:wght@400;500;700&display=swap">', '<link rel="stylesheet" href="fonts/fonts.css">');
const adsJs = `<script>window.LD_ADS=${JSON.stringify({ android: ads.android.rewarded, ios: ads.ios.rewarded, testing: !!ads.testing })};</script>`;
swap('<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>', adsJs + '\n<script src="lib/three.min.js"></script>');
html = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' + html.replace('<meta name="claude:viewport-fit-sides" content="cover">\n', '') + '\n</html>\n';
if (/https?:\/\/(cdnjs|fonts\.googleapis|cdn\.jsdelivr|unpkg)/.test(html)) throw new Error('build-web: page still loads something from the internet');
fs.writeFileSync(path.join(www, 'index.html'), html);

// AdMob app ids in the native projects
const manifest = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
if (fs.existsSync(manifest)) {
  let m = fs.readFileSync(manifest, 'utf8');
  const tag = `<meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="${ads.android.appId}"/>`;
  m = /<meta-data android:name="com\.google\.android\.gms\.ads\.APPLICATION_ID"[^>]*\/>/.test(m)
    ? m.replace(/<meta-data android:name="com\.google\.android\.gms\.ads\.APPLICATION_ID"[^>]*\/>/, tag)
    : m.replace(/(<application[^>]*>)/, `$1\n        ${tag}`);
  fs.writeFileSync(manifest, m);
}
const plist = path.join(root, 'ios', 'App', 'App', 'Info.plist');
if (fs.existsSync(plist)) {
  let p = fs.readFileSync(plist, 'utf8');
  p = p.replace(/<key>GADApplicationIdentifier<\/key>\s*<string>[^<]*<\/string>/, `<key>GADApplicationIdentifier</key>\n\t<string>${ads.ios.appId}</string>`);
  fs.writeFileSync(plist, p);
}
console.log('www built' + (ads.testing ? ' (AdMob TEST ads)' : ''));
