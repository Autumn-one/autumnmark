const { readdir, lstat, readFile } = require('node:fs/promises')
const { homedir } = require('node:os')
const { join } = require('node:path')

const root = join(process.env.MARKTEXT_TEST_SKILL_HOME ?? homedir(), '.autumnmark', 'skill', 'instances')
const registryName = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.json$/i

async function request (instance, input) {
  const response = await fetch(`http://127.0.0.1:${instance.port}/skill`, {
    method: 'POST',
    redirect: 'error',
    headers: { Authorization: `Bearer ${instance.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(7000)
  })
  const result = await response.json()
  if (!response.ok || result.status !== 'ok') throw Error(result.error || 'operation-failed')
  return result
}

async function catalog () {
  let names
  try { names = await readdir(root) } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  const live = await Promise.all(names.filter(name => registryName.test(name)).map(async name => {
    const path = join(root, name)
    let instance
    try {
      const stat = await lstat(path)
      if (!stat.isFile() || stat.size > 1024) return
      instance = JSON.parse(await readFile(path, 'utf8'))
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return
      throw error
    }
    if (!instance || instance.instance + '.json' !== name ||
      !Number.isInteger(instance.port) || instance.port < 1 || instance.port > 65535 ||
      !/^[a-f0-9]{64}$/.test(instance.token)) return
    try {
      const targets = await request(instance, { action: 'targets' })
      return { instance, targets }
    } catch (error) {
      if (error.cause?.code !== 'ECONNREFUSED' && error.cause?.code !== 'ECONNRESET') throw error
    }
  }))
  return live.filter(Boolean).sort((left, right) => right.targets.focusedAt - left.targets.focusedAt)
}

function listDocuments (instances) {
  return instances.flatMap(({ instance, targets }) => targets.documents.map(document => ({
    instance,
    document,
    target: instance.instance + '/' + document.windowId + '/' + document.id
  })))
}

function listTheme (instances) {
  const entry = instances.find(({ targets }) => targets.theme?.scope === 'draft') ?? instances[0]
  if (!entry?.targets.theme) throw Error('theme-unavailable')
  return themeSelection(entry.instance, entry.targets.theme)
}

function themeSelection (instance, theme) {
  return { instance, theme, target: instance.instance + '/' + theme.scope + '/' + theme.id }
}

function appliedTheme ({ targets }) {
  return targets.activeTheme ?? (targets.theme?.scope === 'active' ? targets.theme : undefined)
}

function listThemes (instances) {
  return instances.flatMap(entry => {
    const current = entry.targets.theme
    const themes = current?.scope === 'draft' ? [current, appliedTheme(entry)] : [appliedTheme(entry)]
    return themes.filter(Boolean).map(theme => themeSelection(entry.instance, theme))
  })
}

function selectTheme (instances, requested) {
  if (!requested) return listTheme(instances)
  const selection = listThemes(instances).find(theme => theme.target === requested)
  if (!selection) throw Error('theme-target-changed')
  return selection
}

function editorInstance (instances) {
  return instances.filter(({ targets }) => targets.activeEditorId === undefined ? targets.documents.length : targets.activeEditorId !== null)
    .sort((left, right) => (right.targets.editorFocusedAt ?? right.targets.focusedAt) -
      (left.targets.editorFocusedAt ?? left.targets.focusedAt))[0]
}

function selectEditorTheme (instances) {
  const entry = editorInstance(instances)
  if (!entry) throw Error('editor-theme-unavailable')
  const theme = appliedTheme(entry)
  if (!theme) throw Error('skill-app-update-required')
  return themeSelection(entry.instance, theme)
}

function publicDocument ({ document: { name, path, editable, active, windowId }, target }) {
  return { target, name, path, editable, active, windowId }
}

function selectDocument (documents, confirmed) {
  if (!documents.length) return { status: 'no-documents' }
  if (!confirmed && documents.length > 1) {
    return { status: 'confirmation-required', documents: documents.map(publicDocument) }
  }
  const selection = confirmed ? documents.find(item => item.target === confirmed) : documents[0]
  if (!selection) throw Error('document-target-changed')
  if (!selection.document.editable) throw Error('document-unavailable')
  return selection
}

function selectCurrentDocument (instances) {
  const entry = editorInstance(instances)
  if (!entry) return { status: 'no-current-document' }
  const { activeEditorId } = entry.targets
  if (activeEditorId === undefined) return selectDocument(listDocuments(instances))
  const current = listDocuments([entry]).find(({ document }) => document.windowId === activeEditorId && document.active)
  if (!current) return { status: 'no-current-document' }
  if (!current.document.editable) throw Error('document-unavailable')
  return current
}

async function readInput (path) {
  let json = ''
  if (path) {
    const stat = await lstat(path)
    if (!stat.isFile() || stat.size > 6_004_096) throw Error('invalid-request-file')
    json = await readFile(path, 'utf8')
  } else {
    process.stdin.setEncoding('utf8')
    for await (const chunk of process.stdin) {
      json += chunk
      if (json.length > 6_004_096) throw Error('request-too-large')
    }
  }
  const input = JSON.parse(json.replace(/^\uFEFF/, ''))
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('invalid-request')
  return input
}

async function run ([action, ...args]) {
  const scopedMeasurement = action === 'measure-theme' && args[0] === '--target'
  const measureTarget = scopedMeasurement ? args[1] : undefined
  if (scopedMeasurement && !measureTarget) throw Error('invalid-theme-measurement')
  const [selected, argument, occurrence] = scopedMeasurement ? args.slice(2) : args
  if (selected === '--input-file' && !argument) throw Error('invalid-request-file')
  const input = action === 'edit-document' || action === 'edit-theme'
    ? await readInput(selected === '--input-file' ? argument : undefined)
    : undefined
  const instances = await catalog()
  if (!instances.length) throw Error('no-running-autumnmark')
  if (action === 'targets') {
    const { theme, target } = listTheme(instances)
    return {
      status: 'ok',
      documents: listDocuments(instances).map(publicDocument),
      theme: { ...theme, target },
      themes: listThemes(instances).map(({ theme, target }) => ({ ...theme, target }))
    }
  }
  if (action === 'read-document' || action === 'edit-document') {
    const requested = action === 'read-document' ? selected : input.confirmed === input.target ? input.confirmed : undefined
    if (!requested) {
      const { theme, target } = listTheme(instances)
      if (theme.scope === 'draft') {
        if (action === 'edit-document') throw Error('document-target-changed')
        return { status: 'theme-sample-open', theme: { ...theme, target } }
      }
    }
    const useEditor = action === 'read-document' && requested === '--editor'
    const selection = useEditor ? selectCurrentDocument(instances) : selectDocument(listDocuments(instances), requested)
    if (selection.status) return selection
    const { instance, document: { id, windowId }, target } = selection
    if (input && input.target !== target) throw Error('document-target-changed')
    const confirmed = useEditor ? target : requested
    const result = await request(instance, {
      action, id, windowId, confirmed: !!confirmed, revision: input?.revision, markdown: input?.markdown
    })
    return { ...result, ...publicDocument(selection), ...(confirmed ? { confirmed } : {}) }
  }
  if (action === 'theme-workspace' || action === 'read-theme' || action === 'edit-theme' || action === 'measure-theme') {
    let requested = selected
    if (action === 'measure-theme') requested = measureTarget
    if (action === 'edit-theme') requested = input.confirmed === input.target ? input.confirmed : undefined
    const editorRequested = action === 'read-theme' && requested === '--editor'
    const draftRequested = action === 'read-theme' && requested === '--draft'
    const { instance, theme, target } = editorRequested
      ? selectEditorTheme(instances)
      : selectTheme(instances, draftRequested ? undefined : requested)
    if ((action === 'theme-workspace' || draftRequested) && theme.scope !== 'draft') throw Error('theme-editor-unavailable')
    if (input && input.target !== target) throw Error('theme-target-changed')
    const probe = action === 'measure-theme'
      ? { selector: selected, property: argument, occurrence: occurrence === undefined ? 1 : Number(occurrence) }
      : undefined
    const result = await request(instance, {
      action, id: theme.id, scope: theme.scope, explicit: !!requested, revision: input?.revision, css: input?.css, probe
    })
    const resolved = { ...theme, ...result }
    return {
      ...resolved,
      target: themeSelection(instance, resolved).target,
      ...(action === 'read-theme' && requested ? { confirmed: target } : {})
    }
  }
  throw Error('invalid-command')
}

run(process.argv.slice(2)).then(result => {
  process.stdout.write(JSON.stringify(result) + '\n')
}).catch(error => {
  const message = /^[a-z][a-z-]{1,63}$/.test(error.message) ? error.message : 'autumnmark-unavailable'
  process.stdout.write(JSON.stringify({ status: 'error', error: message }) + '\n')
  process.exitCode = 1
})
