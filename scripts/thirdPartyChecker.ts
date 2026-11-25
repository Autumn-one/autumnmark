/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-require-imports */
// @ts-nocheck
'use strict'

const path = require('path')
const checker = require('license-checker')

const repoRoot = path.resolve(__dirname, '..')
const desktop = require(path.join(repoRoot, 'packages/desktop/package.json'))
const muya = require(path.join(repoRoot, 'packages/muya/package.json'))
const shippedPackages = new Set([
  ...Object.keys(desktop.dependencies),
  ...Object.keys(desktop.optionalDependencies),
  ...desktop.bundledAppDependencies.filter(name => name !== muya.name),
  ...Object.keys(muya.dependencies)
])

const getLicenses = (rootDir, callback) => {
  const options = { start: rootDir, direct: true, json: true }
  // Vite bundles application dependencies from devDependencies. Resolve their
  // installed versions before applying license-checker's exact name@version filter.
  checker.init(options, (error, packages) => {
    if (error) {
      callback(error)
      return
    }
    const audited = Object.keys(packages).filter(id => shippedPackages.has(id.slice(0, id.lastIndexOf('@'))))
    if (audited.length === 0) {
      callback(new Error('No installed application dependencies found'))
      return
    }
    checker.init({
      ...options,
      packages: audited.join(';'),
      // BlueOak-1.0.0 covers minimatch and its related dependencies.
      onlyAllow:
        'Unlicense;WTFPL;ISC;MIT;BSD;Apache-2.0;MIT*;Apache;Apache*;BSD*;BlueOak-1.0.0;CC0-1.0;CC-BY-4.0;CC-BY-3.0'
    }, (err, selected) => callback(err, selected, checker))
  })
}

const validateLicenses = (rootDir) => {
  getLicenses(rootDir, (err, packages, checker) => {
    if (err) {
      console.log(`[ERROR] ${err}`)
      process.exit(1)
    }
    if (!packages || Object.keys(packages).length === 0) {
      console.log('[ERROR] No packages found — check your start path and filters.')
      process.exit(1)
    }
    console.log(checker.asSummary(packages))
  })
}

module.exports = {
  getLicenses,
  validateLicenses
}
