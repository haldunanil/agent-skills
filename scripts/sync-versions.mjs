#!/usr/bin/env node
// Propagate package.json#version to .claude-plugin/plugin.json and .claude-plugin/marketplace.json.
// Run from repo root. `npm run version` invokes this after `changeset version` has bumped package.json.
import fs from 'node:fs/promises';

const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
const version = pkg.version;
const PLUGIN_NAME = pkg.name;

if (!version) {
  console.error('ERROR: package.json has no version field');
  process.exit(1);
}

if (!PLUGIN_NAME) {
  console.error('ERROR: package.json has no name field');
  process.exit(1);
}

const pluginPath = '.claude-plugin/plugin.json';
const plugin = JSON.parse(await fs.readFile(pluginPath, 'utf8'));
plugin.version = version;
await fs.writeFile(pluginPath, JSON.stringify(plugin, null, 2) + '\n');

const marketPath = '.claude-plugin/marketplace.json';
const market = JSON.parse(await fs.readFile(marketPath, 'utf8'));

if (!Array.isArray(market.plugins)) {
  console.error('ERROR: marketplace.json has no plugins array');
  process.exit(1);
}

const matching = market.plugins.find((p) => p.name === PLUGIN_NAME);
if (!matching) {
  console.error(`ERROR: marketplace.json has no plugin entry named '${PLUGIN_NAME}'`);
  process.exit(1);
}

market.plugins = market.plugins.map((p) =>
  p.name === PLUGIN_NAME ? { ...p, version } : p,
);
await fs.writeFile(marketPath, JSON.stringify(market, null, 2) + '\n');

console.log(`Synced version ${version} to plugin.json and marketplace.json`);
