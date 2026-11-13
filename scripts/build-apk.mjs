// Compila o APK de debug usando as ferramentas em D:\DevTools (disco C está cheio).
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const tools = process.env.QUARTZO_DEVTOOLS || 'D:\\DevTools';
const env = {
  ...process.env,
  JAVA_HOME: process.env.JAVA_HOME || path.join(tools, 'jdk21'),
  ANDROID_HOME: process.env.ANDROID_HOME || path.join(tools, 'android-sdk'),
  ANDROID_SDK_ROOT: process.env.ANDROID_SDK_ROOT || path.join(tools, 'android-sdk'),
  GRADLE_USER_HOME: process.env.GRADLE_USER_HOME || path.join(tools, 'gradle-home'),
};
env.PATH = `${path.join(env.JAVA_HOME, 'bin')}${path.delimiter}${env.PATH}`;

const variant = process.argv.includes('--release') ? 'Release' : 'Debug';
const android = path.join(root, 'android');
const gradlew = path.join(android, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
const r = spawnSync(`"${gradlew}"`, [`assemble${variant}`, '--no-daemon'], { cwd: android, env, stdio: 'inherit', shell: true });
if (r.status !== 0) process.exit(r.status ?? 1);

const v = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const lower = variant.toLowerCase();
const out = path.join(android, `app/build/outputs/apk/${lower}/app-${lower}${variant === 'Release' ? '-unsigned' : ''}.apk`);
mkdirSync(path.join(root, 'release'), { recursive: true });
const dest = path.join(root, 'release', `Quartzo-${v}-${lower}.apk`);
if (existsSync(out)) {
  copyFileSync(out, dest);
  console.log(`\nAPK pronto: ${dest}`);
} else {
  console.error('APK não encontrado em', out);
  process.exit(1);
}
