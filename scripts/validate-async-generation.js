const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const requiredFiles = [
  'cloudfunctions/aiGenerate/index.js',
  'cloudfunctions/aiGenerate/taskHelpers.js',
  'cloudfunctions/aiGenerate/generationExecutor.js',
  'cloudfunctions/generationWorker/index.js',
  'cloudfunctions/generationWorker/generationExecutor.js',
  'cloudfunctions/generationWorker/config.json',
  'miniprogram/pages/analyzing/analyzing.js',
  'docs/generation_tasks_schema.json'
]

let failed = false

for (const relPath of requiredFiles) {
  const fullPath = path.join(root, relPath)
  if (!fs.existsSync(fullPath)) {
    console.error(`[FAIL] missing file: ${relPath}`)
    failed = true
    continue
  }
  console.log(`[OK] ${relPath}`)
}

function loadModule(relPath) {
  const fullPath = path.join(root, relPath)
  try {
    require(fullPath)
    console.log(`[OK] require ${relPath}`)
  } catch (err) {
    if (err.message && err.message.includes('Cannot find module')) {
      console.log(`[SKIP] require ${relPath}: dependency not installed locally`)
      return
    }
    console.error(`[FAIL] require ${relPath}: ${err.message}`)
    failed = true
  }
}

loadModule('cloudfunctions/aiGenerate/generationExecutor.js')
loadModule('cloudfunctions/generationWorker/generationExecutor.js')

const aiGenerateSource = fs.readFileSync(path.join(root, 'cloudfunctions/aiGenerate/index.js'), 'utf8')
const workerSource = fs.readFileSync(path.join(root, 'cloudfunctions/generationWorker/index.js'), 'utf8')
const workerExecutorSource = fs.readFileSync(path.join(root, 'cloudfunctions/generationWorker/generationExecutor.js'), 'utf8')
const analyzingSource = fs.readFileSync(path.join(root, 'miniprogram/pages/analyzing/analyzing.js'), 'utf8')
const taskHelpersSource = fs.readFileSync(path.join(root, 'cloudfunctions/aiGenerate/taskHelpers.js'), 'utf8')
const historySource = fs.readFileSync(path.join(root, 'miniprogram/pages/generation-history/generation-history.js'), 'utf8')

const checks = [
  ['aiGenerate createTask action', aiGenerateSource.includes("action === 'createTask'")],
  ['aiGenerate getTaskStatus action', aiGenerateSource.includes("action === 'getTaskStatus'")],
  ['worker CAS pending->running', workerSource.includes("status: 'pending'") && workerSource.includes("status: 'running'")],
  ['worker openid auth', workerSource.includes('task._openid !== openid')],
  ['worker idempotent refund', workerSource.includes('pointsRefunded')],
  ['fallback executor helper', workerExecutorSource.includes('executeGenerationWithFallback')],
  ['fallback task snapshot', taskHelpersSource.includes('fallbackModelCallIdSnapshot') && taskHelpersSource.includes('fallbackUsed')],
  ['task duration list field', taskHelpersSource.includes('totalDurationMs') && historySource.includes('formatDuration')],
  ['analyzing polling', analyzingSource.includes('getTaskStatus') && analyzingSource.includes('createTask')],
  ['task helper worker trigger', taskHelpersSource.includes("name: 'generationWorker'")]
]

for (const [name, ok] of checks) {
  if (ok) {
    console.log(`[OK] ${name}`)
  } else {
    console.error(`[FAIL] ${name}`)
    failed = true
  }
}

if (failed) {
  process.exit(1)
}

console.log('\nAsync generation refactor structure validation passed.')
