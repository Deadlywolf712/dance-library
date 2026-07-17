import fs from 'node:fs';
import path from 'node:path';
import {
  OUTPUT,
  ROOT,
  listFiles,
  listPublicFiles,
  stagePages
} from './stage-pages.mjs';

const fail = message => { throw new Error(message); };
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

const sourceFiles = listPublicFiles();

const staged = stagePages();
const stagedFiles = [...staged.files].sort();
if (JSON.stringify(stagedFiles) !== JSON.stringify(sourceFiles)) {
  const missing = sourceFiles.filter(relativePath => !stagedFiles.includes(relativePath));
  const unexpected = stagedFiles.filter(relativePath => !sourceFiles.includes(relativePath));
  fail(`Pages package mismatch. Missing: ${missing.join(', ') || 'none'}. Unexpected: ${unexpected.join(', ') || 'none'}.`);
}

for (const relativePath of stagedFiles) {
  const source = fs.readFileSync(path.join(ROOT, relativePath));
  const packaged = fs.readFileSync(path.join(OUTPUT, relativePath));
  if (!source.equals(packaged)) fail(`Staged Pages asset differs from its source: ${relativePath}`);
}

const forbiddenPackageEntries = [
  'android/',
  'node_modules/',
  'scripts/',
  'tests/',
  '.github/',
  'package.json',
  'package-lock.json',
  'playwright.config.mjs',
  'README.md'
];
for (const forbidden of forbiddenPackageEntries) {
  if (stagedFiles.some(relativePath => relativePath === forbidden || relativePath.startsWith(forbidden))) {
    fail(`Development-only path leaked into the Pages package: ${forbidden}`);
  }
}

const workflow = read('.github/workflows/deploy.yml');
if (!/^\s*path:\s*['_"]?_site['"]?\s*$/m.test(workflow)) {
  fail('The Pages workflow must upload only the staged _site directory.');
}
if (/^\s*path:\s*['"]?\.['"]?\s*$/m.test(workflow)) {
  fail('The Pages workflow must never upload the repository root.');
}
if ((workflow.match(/^\s+paths:\s*$/gm) || []).length !== 2) {
  fail('Push and pull-request Pages triggers must both use path filters.');
}
if (/^\s*-\s*['"]?android\//m.test(workflow)) {
  fail('Android-only paths must not trigger the Pages workflow.');
}
if (!/^permissions:\s*\r?\n\s{2}contents:\s*read\s*$/m.test(workflow)) {
  fail('The Pages package job must default to read-only repository access.');
}

const requiredActions = new Set([
  'actions/checkout',
  'actions/setup-node',
  'actions/configure-pages',
  'actions/upload-pages-artifact',
  'actions/deploy-pages'
]);
const actionReferences = [...workflow.matchAll(/^\s*-?\s*uses:\s*([^\s#]+).*$/gm)].map(match => match[1]);
for (const action of requiredActions) {
  if (!actionReferences.some(reference => reference.startsWith(`${action}@`))) {
    fail(`Pages workflow is missing required action: ${action}.`);
  }
}
for (const reference of actionReferences) {
  if (!/@[0-9a-f]{40}$/i.test(reference)) fail(`Workflow action is not pinned to a full commit SHA: ${reference}`);
}

const deploySection = workflow.split(/^  deploy:\s*$/m)[1];
if (!deploySection) fail('Pages workflow is missing its isolated deploy job.');
if (!/^\s*needs:\s*package\s*$/m.test(deploySection)) fail('The deploy job must depend on the package job.');
if (!/^\s*pages:\s*write\s*$/m.test(deploySection) || !/^\s*id-token:\s*write\s*$/m.test(deploySection)) {
  fail('The deploy job must receive only the Pages and OIDC write capabilities it needs.');
}
if (/^\s*contents:\s*/m.test(deploySection)) fail('The deploy job must not receive repository contents permission.');
if (/actions\/checkout@/.test(deploySection)) fail('The privileged deploy job must not check out repository contents.');
if (/^\s*contents:\s*write\s*$/m.test(workflow)) fail('Pages workflow must not receive repository write permission.');

const ignoreRules = read('.gitignore').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
if (ignoreRules.includes('*.ts')) fail('The global *.ts ignore rule would hide TypeScript source files.');
for (const requiredRule of [
  '_site/',
  'android/.gradle/',
  'android/.idea/',
  'android/.kotlin/',
  'android/**/build/',
  'android/local.properties',
  '*.apk',
  '*.aab',
  '*.jks',
  '*.keystore',
  'keystore.properties'
]) {
  if (!ignoreRules.includes(requiredRule)) fail(`Missing Android/Pages ignore rule: ${requiredRule}`);
}

console.log(`Validated an isolated ${stagedFiles.length}-file Pages package (${staged.bytes} bytes, sha256 ${staged.sha256}).`);
