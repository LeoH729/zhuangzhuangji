const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile } = require('child_process')

const PORT = Number(process.env.PORT || 8080)
const TOKEN = String(process.env.JIMENG_WRAPPER_TOKEN || '').trim()
const DREAMINA_BIN = process.env.DREAMINA_BIN || 'dreamina'
const COMMAND_TIMEOUT_MS = Number(process.env.DREAMINA_COMMAND_TIMEOUT_MS || 120000)

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 1024 * 1024) {
        reject(new Error('request body too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      if (!body) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(body))
      } catch (err) {
        reject(new Error('invalid json body'))
      }
    })
    req.on('error', reject)
  })
}

function requireAuth(req) {
  if (!TOKEN) return true
  return req.headers.authorization === `Bearer ${TOKEN}`
}

function runDreamina(args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(DREAMINA_BIN, args, {
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
      ...options
    }, (err, stdout, stderr) => {
      const output = [stdout, stderr].filter(Boolean).join('\n')
      if (err) {
        err.output = output
        reject(err)
        return
      }
      resolve(output)
    })
  })
}

function extractJsonObjects(text = '') {
  const results = []
  const source = String(text || '')
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] !== '{') continue
    for (let j = source.length - 1; j > i; j -= 1) {
      if (source[j] !== '}') continue
      try {
        results.push(JSON.parse(source.slice(i, j + 1)))
        i = j
        break
      } catch (err) {
        // Keep scanning; CLI output is not guaranteed to be plain JSON.
      }
    }
  }
  return results
}

function findDeep(value, predicate) {
  if (predicate(value)) return value
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findDeep(item, predicate)
      if (found !== undefined) return found
    }
  } else if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      const found = findDeep(value[key], predicate)
      if (found !== undefined) return found
    }
  }
  return undefined
}

function extractSubmitId(text = '', jsonObjects = []) {
  for (const obj of jsonObjects) {
    const value = findDeep(obj, (candidate) => (
      typeof candidate === 'string' &&
      /^[A-Za-z0-9_-]{8,}$/.test(candidate)
    ))
    if (value && /submit/i.test(JSON.stringify(obj))) return value
  }

  const patterns = [
    /submit[_-]?id["'\s:=：]+([A-Za-z0-9_-]+)/i,
    /"submit_id"\s*:\s*"([^"]+)"/i,
    /任务\s*ID[:：\s]+([A-Za-z0-9_-]+)/i
  ]
  for (const pattern of patterns) {
    const match = String(text || '').match(pattern)
    if (match && match[1]) return match[1]
  }
  return ''
}

function extractImageUrls(text = '', jsonObjects = []) {
  const urls = new Set()
  const urlPattern = /https?:\/\/[^\s"'<>]+/g
  for (const match of String(text || '').matchAll(urlPattern)) {
    const url = match[0].replace(/[),，。]+$/, '')
    if (/\.(png|jpe?g|webp|gif)(\?|$)/i.test(url) || /image|tos|byteimg|dreamina|jianying/i.test(url)) {
      urls.add(url)
    }
  }

  for (const obj of jsonObjects) {
    const collect = (value) => {
      if (typeof value === 'string' && /^https?:\/\//.test(value)) urls.add(value)
      if (Array.isArray(value)) value.forEach(collect)
      if (value && typeof value === 'object') Object.keys(value).forEach((key) => collect(value[key]))
    }
    collect(obj)
  }

  return Array.from(urls)
}

function normalizeStatus(text = '', jsonObjects = []) {
  const raw = String(text || '').toLowerCase()
  for (const obj of jsonObjects) {
    const value = findDeep(obj, (candidate) => typeof candidate === 'string' && /^(success|succeeded|completed|querying|running|pending|failed|error)$/i.test(candidate))
    if (value) return String(value).toLowerCase()
  }
  if (raw.includes('querying') || raw.includes('pending') || raw.includes('running') || raw.includes('排队')) return 'querying'
  if (raw.includes('success') || raw.includes('succeeded') || raw.includes('completed') || raw.includes('成功')) return 'success'
  if (raw.includes('failed') || raw.includes('error') || raw.includes('失败')) return 'failed'
  return ''
}

function parseDreaminaOutput(output, downloadDir = '') {
  const jsonObjects = extractJsonObjects(output)
  const submit_id = extractSubmitId(output, jsonObjects)
  const image_urls = extractImageUrls(output, jsonObjects)
  const status = normalizeStatus(output, jsonObjects)
  const image_data = downloadDir ? readDownloadedImages(downloadDir) : []

  if (image_urls.length || image_data.length) {
    return { status: 'success', submit_id, image_urls, image_data, raw: output }
  }
  if (status === 'failed') {
    return { status: 'failed', submit_id, error: { message: output || 'dreamina task failed' }, raw: output }
  }
  return { status: status || 'querying', submit_id, image_urls, image_data, raw: output }
}

function readDownloadedImages(downloadDir) {
  if (!downloadDir || !fs.existsSync(downloadDir)) return []
  return fs.readdirSync(downloadDir)
    .filter((name) => /\.(png|jpe?g|webp|gif)$/i.test(name))
    .slice(0, 1)
    .map((name) => {
      const filePath = path.join(downloadDir, name)
      const ext = path.extname(name).replace('.', '').toLowerCase() || 'png'
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`
      return {
        filename: name,
        mime_type: mime,
        data_url: `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`
      }
    })
}

function cleanString(value, fallback = '') {
  const text = String(value || '').trim()
  return text || fallback
}

function buildCommonImageArgs(command, payload) {
  const args = [
    command,
    `--prompt=${cleanString(payload.prompt)}`,
    `--ratio=${cleanString(payload.ratio, '1:1')}`,
    `--resolution_type=${cleanString(payload.resolution_type, '2k')}`,
    '--poll=30'
  ]
  if (payload.model_version) args.push(`--model_version=${cleanString(payload.model_version)}`)
  if (payload.generate_num) args.push(`--generate_num=${Math.min(Math.max(Number(payload.generate_num) || 1, 1), 10)}`)
  if (payload.session) args.push(`--session=${cleanString(payload.session)}`)
  return args
}

async function downloadReferenceImage(url, dir) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`download reference image failed: ${response.status}`)
  }
  const contentType = response.headers.get('content-type') || 'image/png'
  const ext = contentType.includes('webp') ? 'webp' : contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : 'png'
  const filePath = path.join(dir, `reference.${ext}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  fs.writeFileSync(filePath, buffer)
  return filePath
}

async function handleText2Image(req, res) {
  const payload = await readBody(req)
  if (!cleanString(payload.prompt)) throw new Error('missing prompt')
  const output = await runDreamina(buildCommonImageArgs('text2image', payload))
  sendJson(res, 200, parseDreaminaOutput(output))
}

async function handleImage2Image(req, res) {
  const payload = await readBody(req)
  if (!cleanString(payload.prompt)) throw new Error('missing prompt')
  const imageUrl = Array.isArray(payload.image_urls) ? payload.image_urls[0] : ''
  if (!imageUrl) throw new Error('missing image_urls[0]')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jimeng-i2i-'))
  try {
    const imagePath = await downloadReferenceImage(imageUrl, dir)
    const args = buildCommonImageArgs('image2image', payload)
    args.splice(1, 0, `--images=${imagePath}`)
    const output = await runDreamina(args)
    sendJson(res, 200, parseDreaminaOutput(output))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

async function handleResult(req, res, url) {
  const submitId = cleanString(url.searchParams.get('submit_id'))
  if (!submitId) throw new Error('missing submit_id')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jimeng-result-'))
  try {
    const output = await runDreamina(['query_result', `--submit_id=${submitId}`, `--download_dir=${dir}`])
    sendJson(res, 200, parseDreaminaOutput(output, dir))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

async function handleHealth(res) {
  try {
    const output = await runDreamina(['-h'], { timeout: 10000 })
    sendJson(res, 200, { ok: true, dreamina: true, output: output.slice(0, 500) })
  } catch (err) {
    sendJson(res, 200, { ok: true, dreamina: false, error: err.message, output: String(err.output || '').slice(0, 500) })
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  try {
    if (url.pathname === '/health' && req.method === 'GET') {
      await handleHealth(res)
      return
    }
    if (!url.pathname.startsWith('/jimeng/')) {
      sendJson(res, 404, { error: { message: 'not found' } })
      return
    }
    if (!requireAuth(req)) {
      sendJson(res, 401, { error: { message: 'unauthorized' } })
      return
    }
    if (url.pathname === '/jimeng/text2image' && req.method === 'POST') {
      await handleText2Image(req, res)
      return
    }
    if (url.pathname === '/jimeng/image2image' && req.method === 'POST') {
      await handleImage2Image(req, res)
      return
    }
    if (url.pathname === '/jimeng/result' && req.method === 'GET') {
      await handleResult(req, res, url)
      return
    }
    sendJson(res, 404, { error: { message: 'not found' } })
  } catch (err) {
    sendJson(res, 500, {
      status: 'failed',
      error: {
        message: err.message || 'jimeng wrapper failed',
        output: String(err.output || '').slice(0, 4000)
      }
    })
  }
})

server.listen(PORT, () => {
  console.log(`[jimeng-wrapper] listening on ${PORT}`)
})
