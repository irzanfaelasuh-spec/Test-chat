import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('android/app/src/main/res');
const source = path.resolve('public/icons');
const density = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
if (!fs.existsSync(path.resolve('android/app'))) {
  console.error('Android project not found. Run: npx cap add android');
  process.exit(1);
}
for (const [name, size] of Object.entries(density)) {
  const dir = path.join(root, `mipmap-${name}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const file of ['ic_launcher.png', 'ic_launcher_round.png']) {
    fs.copyFileSync(path.join(source, `icon-${size}.png`), path.join(dir, file));
  }
}
const anydpi = path.join(root, 'mipmap-anydpi-v26');
fs.mkdirSync(anydpi, { recursive: true });
fs.writeFileSync(path.join(anydpi, 'ic_launcher.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/veyra_icon_background"/><foreground android:drawable="@mipmap/ic_launcher_foreground"/></adaptive-icon>\n`);
fs.writeFileSync(path.join(anydpi, 'ic_launcher_round.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/veyra_icon_background"/><foreground android:drawable="@mipmap/ic_launcher_foreground"/></adaptive-icon>\n`);
const fg = path.join(root, 'mipmap-xxxhdpi');
fs.copyFileSync(path.join(source, 'icon-432.png'), path.join(fg, 'ic_launcher_foreground.png'));
const drawable = path.join(root, 'drawable');
fs.mkdirSync(drawable, { recursive: true });
fs.copyFileSync(path.join(source, 'ic-stat-24.png'), path.join(drawable, 'ic_stat_veyra.png'));
const manifestPath = path.resolve('android/app/src/main/AndroidManifest.xml');
if (fs.existsSync(manifestPath)) {
  let manifest = fs.readFileSync(manifestPath, 'utf8');
  for (const permission of ['android.permission.INTERNET', 'android.permission.RECORD_AUDIO', 'android.permission.POST_NOTIFICATIONS']) {
    if (!manifest.includes(`name=\"${permission}\"`)) manifest = manifest.replace('<application', `<uses-permission android:name=\"${permission}\" />\n    <application`);
  }
  if (!manifest.includes('com.google.firebase.messaging.default_notification_icon')) {
    manifest = manifest.replace('</application>', '<meta-data android:name=\"com.google.firebase.messaging.default_notification_icon\" android:resource=\"@drawable/ic_stat_veyra\" /></application>');
  }
  fs.writeFileSync(manifestPath, manifest);
}
const values = path.join(root, 'values');
fs.mkdirSync(values, { recursive: true });
const colorsFile = path.join(values, 'veyra-colors.xml');
fs.writeFileSync(colorsFile, `<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="veyra_icon_background">#0D171C</color></resources>\n`);
console.log('Veyra Android launcher icons installed.');
