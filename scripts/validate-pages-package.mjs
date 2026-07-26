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

const index = read('index.html');
const cspMatches = [...index.matchAll(
  /<meta\s+[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]+)"[^>]*>/gi
)];
if (cspMatches.length !== 1) fail(`Expected exactly one Content Security Policy meta tag, found ${cspMatches.length}.`);

const cspDirectives = new Map();
for (const declaration of cspMatches[0][1].split(';')) {
  const tokens = declaration.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) continue;
  const [name, ...sources] = tokens;
  if (cspDirectives.has(name)) fail(`Content Security Policy repeats the ${name} directive.`);
  cspDirectives.set(name, sources);
}

const expectedCsp = new Map([
  ['default-src', ["'self'"]],
  ['base-uri', ["'self'"]],
  ['object-src', ["'none'"]],
  ['frame-src', ["'none'"]],
  ['form-action', ["'self'"]],
  ['script-src', ["'self'", 'https://cdn.jsdelivr.net']],
  ['script-src-attr', ["'none'"]],
  ['style-src', ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com']],
  ['font-src', ['https://fonts.gstatic.com']],
  ['img-src', ["'self'", 'data:']],
  ['media-src', ["'self'", 'blob:', 'https://*.b-cdn.net']],
  ['connect-src', ["'self'", 'https://*.b-cdn.net', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com']],
  ['manifest-src', ["'self'"]],
  ['worker-src', ["'self'", 'blob:']],
  ['upgrade-insecure-requests', []]
]);

if (cspDirectives.size !== expectedCsp.size) {
  fail(`Content Security Policy has ${cspDirectives.size} directives; expected ${expectedCsp.size}.`);
}
for (const [directive, expectedSources] of expectedCsp) {
  const actualSources = cspDirectives.get(directive);
  if (!actualSources) fail(`Content Security Policy is missing ${directive}.`);
  if (JSON.stringify(actualSources) !== JSON.stringify(expectedSources)) {
    fail(`${directive} must use only the approved sources. Found: ${actualSources.join(' ') || '(none)'}.`);
  }
}
if (cspDirectives.get('script-src').includes("'unsafe-inline'")) {
  fail('Content Security Policy must not permit inline scripts.');
}
if ([...cspDirectives.values()].flat().some(source => source === '*' || source.startsWith('http://'))) {
  fail('Content Security Policy must not allow an unrestricted or insecure remote source.');
}

const scriptTags = [...index.matchAll(/<script\b([^>]*)>/gi)];
const inlineScripts = scriptTags.filter(([, attributes]) => !/\bsrc\s*=\s*["'][^"']+["']/i.test(attributes));
if (inlineScripts.length) fail(`The public page contains ${inlineScripts.length} inline executable script tag(s).`);
if (/serviceWorker\.register\s*\(/.test(index)) fail('Service-worker registration must not be embedded in HTML.');

const serviceWorkerRegistration = read('sw-register.js');
if (!/navigator\.serviceWorker\.register\(['"]\.\/sw\.js['"]\)/.test(serviceWorkerRegistration)) {
  fail('The external registration script must register the project-relative service worker.');
}
if (/<\/?script\b/i.test(serviceWorkerRegistration)) {
  fail('The external registration script contains an unexpected HTML script tag.');
}

const serviceWorker = read('sw.js');
const cacheVersion = serviceWorker.match(/CACHE_VERSION\s*=\s*(\d+)/)?.[1];
if (!cacheVersion) fail('The service worker must expose a numeric cache version.');
if (!index.includes(`sw-register.js?v=${cacheVersion}`)) {
  fail('The HTML registration script must use the current service-worker cache version.');
}
if (!serviceWorker.includes(`'./sw-register.js?v=${cacheVersion}'`)) {
  fail('The service worker must precache the external registration script.');
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
const workflowTriggers = workflow.split(/^permissions:\s*$/m)[0];
const pushTrigger = workflowTriggers.split(/^  push:\s*$/m)[1]?.split(/^  pull_request:\s*$/m)[0];
const pullRequestTrigger = workflowTriggers.split(/^  pull_request:\s*$/m)[1]?.split(/^  workflow_dispatch:\s*$/m)[0];
if (!pushTrigger || !/^\s+paths:\s*$/m.test(pushTrigger)) {
  fail('Production pushes must retain their Pages path filter.');
}
if (!pullRequestTrigger || /^\s+paths:\s*$/m.test(pullRequestTrigger)) {
  fail('The required Pages package check must run on every pull request without a path filter.');
}
if (!/^\s*-\s*['"]?sw-register\.js['"]?\s*$/m.test(pushTrigger)) {
  fail('Changes to the external service-worker registration script must trigger production deployment.');
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
