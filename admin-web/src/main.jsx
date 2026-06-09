import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Copy,
  Database,
  FolderTree,
  Image,
  Loader2,
  LogOut,
  Plus,
  Play,
  RefreshCw,
  Save,
  Settings,
  Sparkles,
  Trash2,
  UserRound,
  Wand2
} from 'lucide-react'
import { app, auth, callAdmin, cloudbaseConfig } from './cloudbase'
import './styles.css'

const TABS = [
  { key: 'models', label: '模型', icon: Database },
  { key: 'groups', label: '分组', icon: FolderTree },
  { key: 'images', label: '图片', icon: Image },
  { key: 'features', label: '卡片', icon: Wand2 },
  { key: 'users', label: '用户', icon: UserRound },
  { key: 'settings', label: '设置', icon: Settings }
]

const EMPTY_MODEL = {
  model_call_id: '',
  name: '',
  provider: '',
  base_url: '',
  model_id: '',
  api_key: '',
  status: 1,
  remark: ''
}

const EMPTY_GROUP = { name: '', status: 1, sort: 10, description: '' }
const EMPTY_IMAGE = {
  name: '',
  category: '',
  usage: 'banner',
  folder: 'admin-assets',
  objectKey: '',
  cloudPath: '',
  fileID: '',
  size: 0,
  status: 1,
  remark: ''
}
const EMPTY_FEATURE = {
  name: '',
  group: '',
  home_banner: '',
  detail_banner: '',
  template_type: 'image_to_image',
  input_fields: [],
  upload_count: 1,
  points_cost: 5,
  enable_upscale_print: false,
  hang_count: 0,
  la_count: 0,
  model_call_id: '',
  fallback_model_call_id: '',
  prompt: '',
  status: 1,
  sort: 10,
  tag: 'normal',
  description: ''
}
const TEMPLATE_TYPE_LABELS = {
  image_to_image: '图生图',
  text_to_image: '文生图'
}
const FEATURE_STATUS_LABELS = {
  0: '草稿',
  1: '已发布'
}
const TEXT_TO_IMAGE_PROVIDERS = ['volcengine', 'supersolo', 'supersolo_async', 'toapis', 'joapi']
const EMPTY_ADMIN = {
  uid: '',
  openid: '',
  username: '',
  displayName: '',
  role: 'admin',
  status: 1
}

function IconButton({ title, children, className = '', ...props }) {
  return (
    <button className={`icon-button ${className}`} title={title} aria-label={title} {...props}>
      {children}
    </button>
  )
}

function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}

function TextInput({ value, onChange, ...props }) {
  return <input value={value ?? ''} onChange={(event) => onChange(event.target.value)} {...props} />
}

function NumberInput({ value, onChange, ...props }) {
  return (
    <input
      type="number"
      value={value ?? 0}
      onChange={(event) => onChange(Number(event.target.value))}
      {...props}
    />
  )
}

function Textarea({ value, onChange, ...props }) {
  return <textarea value={value ?? ''} onChange={(event) => onChange(event.target.value)} {...props} />
}

function formatDate(value) {
  if (!value) return '-'
  const raw = value.$date || value.iso || value
  const date = raw instanceof Date ? raw : new Date(raw)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('zh-CN', { hour12: false })
}

function useSort(defaultField = 'createdAt', defaultOrder = 'desc') {
  const [sort, setSort] = useState({ sortBy: defaultField, sortOrder: defaultOrder })
  const toggleSort = (sortBy) => {
    setSort((current) => ({
      sortBy,
      sortOrder: current.sortBy === sortBy && current.sortOrder === 'desc' ? 'asc' : 'desc'
    }))
  }
  return [sort, toggleSort]
}

function SortableTh({ field, sort, onSort, children }) {
  const active = sort?.sortBy === field
  const SortIcon = !active ? ArrowUpDown : sort.sortOrder === 'asc' ? ArrowUp : ArrowDown
  return (
    <th>
      <button type="button" className={`sort-button ${active ? 'active' : ''}`} onClick={() => onSort(field)}>
        <span>{children}</span>
        <SortIcon size={14} />
      </button>
    </th>
  )
}

function useAdminList(action, deps = [], getPayload = () => ({})) {
  const [items, setItems] = useState([])
  const [refs, setRefs] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [total, setTotal] = useState(0)

  const reload = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await callAdmin(action, { page, pageSize, ...getPayload() })
      setItems(res.data || [])
      setRefs({ ...(res.refs || {}), folders: res.folders || [] })
      setTotal(res.total || 0)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [page, pageSize, ...deps])

  useEffect(() => {
    setPage(1)
  }, deps)

  return {
    items,
    refs,
    loading,
    error,
    reload,
    pagination: {
      page,
      pageSize,
      total,
      setPage,
      setPageSize: (nextPageSize) => {
        setPageSize(nextPageSize)
        setPage(1)
      }
    }
  }
}

function LoginView({ onReady }) {
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    setLoading(true)
    setMessage('')
    try {
      if (mode === 'register') {
        const { error } = await auth.signUp({ username, password, nickname: username })
        if (error) throw new Error(error.message || '注册失败')
      }
      const { error } = await auth.signInWithPassword({ username, password })
      if (error) throw new Error(error.message || '登录失败')
      await onReady()
    } catch (err) {
      setMessage(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="brand-mark">
          <Sparkles size={28} />
        </div>
        <h1>AI 生图后台</h1>
        <form onSubmit={submit} className="login-form">
          <Field label="账号">
            <TextInput value={username} onChange={setUsername} minLength={5} maxLength={24} required />
          </Field>
          <Field label="密码">
            <TextInput value={password} onChange={setPassword} type="password" minLength={6} required />
          </Field>
          {message ? <p className="error-text">{message}</p> : null}
          <button className="primary-button" disabled={loading}>
            {loading ? <Loader2 className="spin" size={16} /> : null}
            {mode === 'login' ? '登录' : '注册并登录'}
          </button>
          <button type="button" className="text-button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? '创建后台账号' : '已有账号，去登录'}
          </button>
        </form>
        <p className="muted">EnvId: {cloudbaseConfig.env}</p>
      </section>
    </main>
  )
}

function BootstrapView({ status, onDone }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const bootstrap = async () => {
    setLoading(true)
    setError('')
    try {
      await callAdmin('bootstrapAdmin', { username: status?.caller?.uid || '' })
      await onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-shell">
      <section className="login-panel">
        <h1>初始化管理员</h1>
        <p className="muted">检测到管理员白名单为空，可将当前登录账号设为超级管理员。</p>
        {error ? <p className="error-text">{error}</p> : null}
        <button className="primary-button" onClick={bootstrap} disabled={loading}>
          {loading ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
          初始化当前账号
        </button>
      </section>
    </main>
  )
}

function LockedView({ status, onSignOut }) {
  return (
    <main className="login-shell">
      <section className="login-panel">
        <h1>无后台权限</h1>
        <p className="muted">当前账号已登录，但不在 `admin_users` 白名单中。</p>
        <pre className="identity-box">{JSON.stringify(status?.caller || {}, null, 2)}</pre>
        <button className="secondary-button" onClick={onSignOut}>
          <LogOut size={16} />
          退出登录
        </button>
      </section>
    </main>
  )
}

function ModelsPanel() {
  const { items, loading, error, reload, pagination } = useAdminList('listModels')
  const [form, setForm] = useState(EMPTY_MODEL)
  const [editingId, setEditingId] = useState('')

  const save = async () => {
    if (editingId) {
      await callAdmin('updateModel', { id: editingId, data: form })
    } else {
      await callAdmin('createModel', form)
    }
    setForm(EMPTY_MODEL)
    setEditingId('')
    await reload()
  }

  const edit = (item) => {
    setEditingId(item._id)
    setForm({ ...EMPTY_MODEL, ...item, api_key: '' })
  }

  const remove = async (id) => {
    if (!window.confirm('确定删除这个模型？')) return
    await callAdmin('deleteModel', { id })
    await reload()
  }

  return (
    <section className="workspace">
      <Editor title={editingId ? '编辑模型' : '新增模型'} onSave={save} onReset={() => { setForm(EMPTY_MODEL); setEditingId('') }}>
        <Field label="调用 ID"><TextInput value={form.model_call_id} onChange={(value) => setForm({ ...form, model_call_id: value })} /></Field>
        <Field label="名称"><TextInput value={form.name} onChange={(value) => setForm({ ...form, name: value })} /></Field>
        <Field label="服务商"><TextInput value={form.provider} onChange={(value) => setForm({ ...form, provider: value })} /></Field>
        <Field label="Base URL"><TextInput value={form.base_url} onChange={(value) => setForm({ ...form, base_url: value })} /></Field>
        <Field label="模型 ID"><TextInput value={form.model_id} onChange={(value) => setForm({ ...form, model_id: value })} /></Field>
        <Field label="API Key"><TextInput value={form.api_key} onChange={(value) => setForm({ ...form, api_key: value })} type="password" placeholder={editingId ? '留空则不修改' : ''} /></Field>
        <Field label="状态"><NumberInput value={form.status} onChange={(value) => setForm({ ...form, status: value })} /></Field>
        <Field label="备注"><Textarea value={form.remark} onChange={(value) => setForm({ ...form, remark: value })} /></Field>
      </Editor>
      <DataTable loading={loading} error={error} onRefresh={reload} pagination={pagination}>
        <thead><tr><th>调用 ID</th><th>名称</th><th>服务商</th><th>模型</th><th>密钥</th><th>状态</th><th></th></tr></thead>
        <tbody>{items.map((item) => (
          <tr key={item._id}>
            <td>{item.model_call_id}</td><td>{item.name || '-'}</td><td>{item.provider}</td><td>{item.model_id}</td>
            <td>{item.has_api_key ? '已配置' : '未配置'}</td><td>{item.status ?? '-'}</td>
            <td className="row-actions"><button onClick={() => edit(item)}>编辑</button><IconButton title="删除" onClick={() => remove(item._id)}><Trash2 size={16} /></IconButton></td>
          </tr>
        ))}</tbody>
      </DataTable>
    </section>
  )
}

function GroupsPanel() {
  const { items, loading, error, reload, pagination } = useAdminList('listGroups')
  const [form, setForm] = useState(EMPTY_GROUP)
  const [editingId, setEditingId] = useState('')

  const save = async () => {
    await callAdmin(editingId ? 'updateGroup' : 'createGroup', editingId ? { id: editingId, data: form } : form)
    setForm(EMPTY_GROUP)
    setEditingId('')
    await reload()
  }

  const remove = async (id) => {
    if (!window.confirm('确定删除这个分组？')) return
    await callAdmin('deleteGroup', { id })
    await reload()
  }

  return (
    <section className="workspace">
      <Editor title={editingId ? '编辑分组' : '新增分组'} onSave={save} onReset={() => { setForm(EMPTY_GROUP); setEditingId('') }}>
        <Field label="名称"><TextInput value={form.name} onChange={(value) => setForm({ ...form, name: value })} /></Field>
        <Field label="状态"><NumberInput value={form.status} onChange={(value) => setForm({ ...form, status: value })} /></Field>
        <Field label="排序"><NumberInput value={form.sort} onChange={(value) => setForm({ ...form, sort: value })} /></Field>
        <Field label="描述"><Textarea value={form.description} onChange={(value) => setForm({ ...form, description: value })} /></Field>
      </Editor>
      <DataTable loading={loading} error={error} onRefresh={reload} pagination={pagination}>
        <thead><tr><th>名称</th><th>状态</th><th>排序</th><th>描述</th><th></th></tr></thead>
        <tbody>{items.map((item) => (
          <tr key={item._id}>
            <td>{item.name}</td><td>{item.status}</td><td>{item.sort}</td><td>{item.description || '-'}</td>
            <td className="row-actions"><button onClick={() => { setEditingId(item._id); setForm({ ...EMPTY_GROUP, ...item }) }}>编辑</button><IconButton title="删除" onClick={() => remove(item._id)}><Trash2 size={16} /></IconButton></td>
          </tr>
        ))}</tbody>
      </DataTable>
    </section>
  )
}

function ImagesPanel() {
  const [folder, setFolder] = useState('')
  const [sort, toggleSort] = useSort('lastModified', 'desc')
  const { items, refs, loading, error, reload, pagination } = useAdminList('listImages', [folder, sort.sortBy, sort.sortOrder], () => ({ folder, ...sort }))
  const [form, setForm] = useState(EMPTY_IMAGE)
  const [editingId, setEditingId] = useState('')
  const [uploading, setUploading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncPrefix, setSyncPrefix] = useState('')
  const [syncResult, setSyncResult] = useState(null)
  const [selectedIds, setSelectedIds] = useState([])
  const [uploadResult, setUploadResult] = useState(null)
  const [previewAsset, setPreviewAsset] = useState(null)

  useEffect(() => {
    setSelectedIds([])
  }, [folder, sort.sortBy, sort.sortOrder])

  const allVisibleSelected = items.length > 0 && items.every((item) => selectedIds.includes(item._id))

  const toggleAllVisible = () => {
    setSelectedIds(allVisibleSelected ? [] : items.map((item) => item._id))
  }

  const toggleSelected = (id) => {
    setSelectedIds((current) => (
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    ))
  }

  const upload = async (event) => {
    const files = Array.from(event.target.files || [])
    if (files.length === 0) return
    const uploadFiles = editingId ? files.slice(0, 1) : files
    setUploading(true)
    setUploadResult(null)
    try {
      const targetFolder = cleanFolder(form.folder || folder || 'admin-assets')
      const uploaded = []

      for (const [index, file] of uploadFiles.entries()) {
        const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '.jpg'
        const cloudPath = `${targetFolder}/${Date.now()}_${index}_${Math.floor(Math.random() * 100000)}${ext}`
        const res = await app.uploadFile({ cloudPath, filePath: file })
        uploaded.push({
          name: file.name,
          folder: targetFolder,
          category: form.category || targetFolder,
          usage: form.usage || targetFolder,
          objectKey: cloudPath,
          cloudPath,
          fileID: res.fileID,
          size: file.size,
          lastModified: new Date().toISOString(),
          status: form.status ?? 1
        })
      }

      if (uploadFiles.length === 1 || editingId) {
        const asset = uploaded[0]
        setForm({
          ...form,
          ...asset,
          name: form.name || asset.name
        })
      } else {
        for (const asset of uploaded) {
          await callAdmin('createImageAsset', asset)
        }
        setUploadResult({ count: uploaded.length, folder: targetFolder })
        await reload()
      }
    } finally {
      setUploading(false)
      event.target.value = ''
    }
  }

  const save = async () => {
    if (editingId) {
      await callAdmin('updateImageAsset', { id: editingId, data: form })
    } else {
      await callAdmin('createImageAsset', form)
    }
    setForm(EMPTY_IMAGE)
    setEditingId('')
    await reload()
  }

  const copy = async (value) => {
    await navigator.clipboard.writeText(value)
  }

  const remove = async (id, force = false) => {
    try {
      await callAdmin('deleteImageAsset', { id, force })
      await reload()
    } catch (err) {
      if (err.result && err.result.code === 'IMAGE_IN_USE' && window.confirm('图片正在被卡片引用，是否强制删除？')) {
        await remove(id, true)
        return
      }
      throw err
    }
  }

  const removeSelected = async () => {
    if (selectedIds.length === 0) return
    if (!window.confirm(`确定删除选中的 ${selectedIds.length} 个图片资源吗？`)) return
    for (const id of selectedIds) {
      await callAdmin('deleteImageAsset', { id })
    }
    setSelectedIds([])
    await reload()
  }

  const edit = (item) => {
    setEditingId(item._id)
    setForm({ ...EMPTY_IMAGE, ...item })
  }

  const syncStorage = async () => {
    setSyncing(true)
    setSyncResult(null)
    try {
      const res = await callAdmin('syncStorageAssets', { prefix: syncPrefix })
      setSyncResult(res)
      await reload()
    } finally {
      setSyncing(false)
    }
  }

  return (
    <section className="workspace">
      <div className="sync-panel">
        <div className="section-head">
          <h2>云存储同步</h2>
          <button className="primary-button" type="button" onClick={syncStorage} disabled={syncing}>
            {syncing ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
            同步
          </button>
        </div>
        <div className="form-grid">
          <Field label="同步目录前缀">
            <TextInput value={syncPrefix} onChange={setSyncPrefix} placeholder="留空同步全部，例如 generated_results" />
          </Field>
          <Field label="列表目录筛选">
            <select value={folder} onChange={(event) => setFolder(event.target.value)}>
              <option value="">全部目录</option>
              {(refs.folders || []).map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </Field>
        </div>
        {syncResult ? (
          <p className="muted">
            已扫描 {syncResult.scanned} 个对象，新增 {syncResult.created} 条，更新 {syncResult.updated} 条。
          </p>
        ) : null}
      </div>
      <Editor title={editingId ? '编辑图片资源' : '新增图片资源'} onSave={save} onReset={() => { setForm(EMPTY_IMAGE); setEditingId('') }}>
        <Field label="上传"><input type="file" accept="image/*" multiple onChange={upload} disabled={uploading} /></Field>
        <Field label="名称"><TextInput value={form.name} onChange={(value) => setForm({ ...form, name: value })} /></Field>
        <Field label="目录"><FolderSelect value={form.folder} onChange={(value) => setForm({ ...form, folder: cleanFolder(value) })} folders={refs.folders || []} /></Field>
        <Field label="对象路径"><TextInput value={form.objectKey || form.cloudPath} onChange={(value) => setForm({ ...form, objectKey: value, cloudPath: value })} /></Field>
        <Field label="分类"><TextInput value={form.category} onChange={(value) => setForm({ ...form, category: value })} /></Field>
        <Field label="用途"><TextInput value={form.usage} onChange={(value) => setForm({ ...form, usage: value })} /></Field>
        <Field label="FileID"><Textarea value={form.fileID} onChange={(value) => setForm({ ...form, fileID: value })} /></Field>
        <Field label="状态"><NumberInput value={form.status} onChange={(value) => setForm({ ...form, status: value })} /></Field>
      </Editor>
      {uploadResult ? (
        <p className="muted">
          已批量上传 {uploadResult.count} 张图片到 {uploadResult.folder}。
        </p>
      ) : null}
      <DataTable
        loading={loading}
        error={error}
        onRefresh={reload}
        pagination={pagination}
        actions={(
          <button className="secondary-button danger" type="button" onClick={removeSelected} disabled={selectedIds.length === 0}>
            <Trash2 size={16} />
            批量删除{selectedIds.length ? `(${selectedIds.length})` : ''}
          </button>
        )}
      >
        <thead><tr>
          <th className="select-col"><input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} /></th>
          <th>预览</th>
          <SortableTh field="name" sort={sort} onSort={toggleSort}>名称</SortableTh>
          <SortableTh field="folder" sort={sort} onSort={toggleSort}>目录</SortableTh>
          <th>对象路径</th>
          <SortableTh field="usage" sort={sort} onSort={toggleSort}>用途</SortableTh>
          <SortableTh field="lastModified" sort={sort} onSort={toggleSort}>云存储时间</SortableTh>
          <th>URL</th><th></th>
        </tr></thead>
        <tbody>{items.map((item) => (
          <tr key={item._id}>
            <td className="select-col"><input type="checkbox" checked={selectedIds.includes(item._id)} onChange={() => toggleSelected(item._id)} /></td>
            <td>{item.temporaryUrl ? <button type="button" className="thumb-button" onClick={() => setPreviewAsset(item)} title="预览大图"><img className="thumb" src={item.temporaryUrl} alt={item.name} /></button> : '-'}</td>
            <td>{item.name}</td><td>{item.folder || '-'}</td><td className="mono">{item.objectKey || item.cloudPath || item.fileID}</td><td>{item.usage || '-'}</td><td>{formatDate(item.lastModified || item.createdAt)}</td>
            <td><IconButton title="复制URL" onClick={() => copy(item.temporaryUrl || item.fileID)}><Copy size={16} /></IconButton></td>
            <td className="row-actions"><button onClick={() => edit(item)}>编辑</button><IconButton title="删除" onClick={() => remove(item._id)}><Trash2 size={16} /></IconButton></td>
          </tr>
        ))}</tbody>
      </DataTable>
      {previewAsset ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setPreviewAsset(null)}>
          <div className="image-modal" role="dialog" aria-modal="true" aria-label="图片预览" onClick={(event) => event.stopPropagation()}>
            <div className="section-head">
              <h2>{previewAsset.name || '图片预览'}</h2>
              <IconButton title="关闭" onClick={() => setPreviewAsset(null)}>×</IconButton>
            </div>
            <img src={previewAsset.temporaryUrl || previewAsset.fileID} alt={previewAsset.name || 'preview'} />
            <p className="mono">{previewAsset.objectKey || previewAsset.cloudPath || previewAsset.fileID}</p>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function cleanFolder(value = '') {
  return String(value || '').replace(/^\/+/, '').replace(/\/+$/, '')
}

function createInputField(index = 0) {
  return {
    key: `field_${index + 1}`,
    title: '',
    placeholder: '',
    maxLength: 20,
    required: true,
    sort: index
  }
}

function normalizeInputFields(fields = []) {
  return (Array.isArray(fields) ? fields : [])
    .map((field, index) => ({
      key: String(field.key || '').trim(),
      title: String(field.title || field.label || '').trim(),
      placeholder: String(field.placeholder || '').trim(),
      maxLength: Number(field.maxLength || field.max_length || field.limit || 0),
      required: field.required !== false,
      sort: Number(field.sort ?? index)
    }))
    .filter((field) => field.key)
    .sort((a, b) => a.sort - b.sort)
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function compilePrompt(prompt = '', fields = [], inputValues = {}) {
  let compiled = String(prompt || '')
  fields.forEach((field) => {
    compiled = compiled.replace(new RegExp(`\\{${escapeRegExp(field.key)}\\}`, 'g'), inputValues[field.key] || '')
  })
  return compiled
}

function formatDuration(ms = 0) {
  const value = Number(ms || 0)
  if (!value || value < 0) return '-'
  if (value < 1000) return `${value}ms`
  return `${(value / 1000).toFixed(1)}s`
}

function normalizeFeatureForm(form = {}) {
  const templateType = form.template_type === 'text_to_image' ? 'text_to_image' : 'image_to_image'
  return {
    ...form,
    template_type: templateType,
    enable_upscale_print: !!form.enable_upscale_print,
    upload_count: templateType === 'text_to_image' ? 0 : Number(form.upload_count || 1),
    input_fields: templateType === 'text_to_image' ? normalizeInputFields(form.input_fields) : []
  }
}

function getSelectedModel(models = [], modelCallId = '') {
  return (models || []).find((item) => item.model_call_id === modelCallId) || null
}

function FeatureDebugPanel({ form, editingId }) {
  const [inputValues, setInputValues] = useState({})
  const [imageUrls, setImageUrls] = useState([])
  const [uploading, setUploading] = useState(false)
  const [running, setRunning] = useState(false)
  const [task, setTask] = useState(null)
  const [error, setError] = useState('')
  const templateType = form.template_type === 'text_to_image' ? 'text_to_image' : 'image_to_image'
  const inputFields = useMemo(() => normalizeInputFields(form.input_fields), [form.input_fields])
  const localCompiledPrompt = templateType === 'text_to_image'
    ? compilePrompt(form.prompt || '', inputFields, inputValues)
    : (form.prompt || '')

  useEffect(() => {
    const nextValues = {}
    inputFields.forEach((field) => {
      nextValues[field.key] = inputValues[field.key] || ''
    })
    setInputValues(nextValues)
  }, [form.template_type, form.input_fields])

  useEffect(() => {
    if (!task || !task.taskId || !['pending', 'running'].includes(task.status)) return undefined
    const poll = async () => {
      try {
        const res = await callAdmin('getDebugGenerationStatus', { taskId: task.taskId })
        const nextTask = res.task || null
        setTask(nextTask)
        if (nextTask && !['pending', 'running'].includes(nextTask.status)) {
          setRunning(false)
        }
      } catch (err) {
        setError(err.message)
        setRunning(false)
      }
    }
    const timer = setInterval(poll, 5000)
    poll()
    return () => clearInterval(timer)
  }, [task && task.taskId, task && task.status])

  const updateInputValue = (key, value, maxLength = 0) => {
    const nextValue = maxLength > 0 ? value.slice(0, maxLength) : value
    setInputValues((current) => ({ ...current, [key]: nextValue }))
  }

  const uploadDebugImages = async (event) => {
    const files = Array.from(event.target.files || [])
    if (files.length === 0) return
    setUploading(true)
    setError('')
    try {
      const maxCount = Math.max(Number(form.upload_count || 1), 1)
      const remain = Math.max(maxCount - imageUrls.length, 0)
      const uploadFiles = files.slice(0, remain || 1)
      const uploaded = []
      for (const [index, file] of uploadFiles.entries()) {
        const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '.jpg'
        const cloudPath = `admin-debug-inputs/${Date.now()}_${index}_${Math.floor(Math.random() * 100000)}${ext}`
        const res = await app.uploadFile({ cloudPath, filePath: file })
        if (res.fileID) uploaded.push(res.fileID)
      }
      setImageUrls((current) => [...current, ...uploaded].slice(0, maxCount))
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
      event.target.value = ''
    }
  }

  const removeDebugImage = (fileID) => {
    setImageUrls((current) => current.filter((item) => item !== fileID))
  }

  const startDebug = async () => {
    setError('')
    setRunning(true)
    try {
      const payload = {
        id: editingId,
        featureId: editingId,
        feature: normalizeFeatureForm(form),
        imageUrls: templateType === 'image_to_image' ? imageUrls : [],
        inputValues
      }
      const res = await callAdmin('debugFeatureGeneration', payload)
      setTask({
        taskId: res.taskId,
        status: 'pending',
        compiledPrompt: res.compiledPrompt || localCompiledPrompt
      })
    } catch (err) {
      setError(err.message)
      setRunning(false)
    }
  }

  const canStart = !!form.name && !!form.model_call_id && !!String(form.prompt || '').trim() &&
    (templateType === 'text_to_image'
      ? inputFields.every((field) => !field.required || String(inputValues[field.key] || '').trim())
      : imageUrls.length > 0)

  return (
    <div className="debug-panel">
      <div className="editor-subhead">
        <strong>调试生成</strong>
        <button type="button" className="primary-button" onClick={startDebug} disabled={running || uploading || !canStart}>
          {running ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
          开始调试
        </button>
      </div>
      {templateType === 'text_to_image' ? (
        <div className="debug-fields">
          {inputFields.map((field) => (
            <Field key={field.key} label={field.title || field.key}>
              <TextInput
                value={inputValues[field.key] || ''}
                placeholder={field.placeholder}
                maxLength={field.maxLength || undefined}
                onChange={(value) => updateInputValue(field.key, value, field.maxLength)}
              />
            </Field>
          ))}
        </div>
      ) : (
        <div className="debug-upload">
          <Field label="测试参考图">
            <input type="file" accept="image/*" multiple onChange={uploadDebugImages} disabled={uploading} />
          </Field>
          {imageUrls.length ? (
            <div className="debug-file-list">
              {imageUrls.map((fileID) => (
                <span key={fileID} className="debug-file-chip">
                  <span className="mono">{fileID}</span>
                  <button type="button" onClick={() => removeDebugImage(fileID)}>移除</button>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      )}
      <div className="debug-prompt">
        <span>实际提示词</span>
        <pre>{(task && task.compiledPrompt) || localCompiledPrompt || '-'}</pre>
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      {task ? (
        <div className={`debug-result ${task.status || ''}`}>
          <div className="debug-meta">
            <span>状态：{task.status || '-'}</span>
            <span>模型：{task.modelCallId || form.model_call_id || '-'}</span>
            <span>耗时：{formatDuration(task.totalDurationMs || task.executionDurationMs)}</span>
            {task.fallbackUsed ? <span>已使用兜底模型</span> : null}
          </div>
          {task.errorMessage ? <p className="error-text">{task.errorMessage}</p> : null}
          {task.primaryErrorMessage ? <p className="muted">主模型错误：{task.primaryErrorMessage}</p> : null}
          {task.resultTempUrl ? (
            <div className="debug-image-wrap">
              <img src={task.resultTempUrl} alt="调试生成结果" />
              <p className="mono">{task.resultUrl}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function FeaturesPanel() {
  const [sort, toggleSort] = useSort('createdAt', 'desc')
  const [imageFolder, setImageFolder] = useState('')
  const { items, refs, loading, error, reload, pagination } = useAdminList('listFeatures', [sort.sortBy, sort.sortOrder, imageFolder], () => ({ ...sort, imageFolder }))
  const [form, setForm] = useState(EMPTY_FEATURE)
  const [editingId, setEditingId] = useState('')
  const [featureMessage, setFeatureMessage] = useState('')
  const [featureError, setFeatureError] = useState('')
  const [savingDraft, setSavingDraft] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const selectedModel = getSelectedModel(refs.models || [], form.model_call_id)
  const selectedFallbackModel = getSelectedModel(refs.models || [], form.fallback_model_call_id)
  const textProviderCompatible = !selectedModel || TEXT_TO_IMAGE_PROVIDERS.includes(selectedModel.provider)
  const fallbackTextProviderCompatible = !selectedFallbackModel || TEXT_TO_IMAGE_PROVIDERS.includes(selectedFallbackModel.provider)

  const saveDraft = async () => {
    const payload = normalizeFeatureForm(form)
    setSavingDraft(true)
    setFeatureError('')
    setFeatureMessage('')
    try {
      const res = await callAdmin('saveFeatureDraft', editingId ? { id: editingId, data: payload } : { data: payload })
      if (!editingId && res._id) {
        setEditingId(res._id)
      }
      setFeatureMessage('草稿已保存，未发布到小程序')
      await reload()
    } catch (err) {
      setFeatureError(err.message)
    } finally {
      setSavingDraft(false)
    }
  }

  const publish = async () => {
    const payload = normalizeFeatureForm({ ...form, status: 1 })
    setPublishing(true)
    setFeatureError('')
    setFeatureMessage('')
    try {
      const res = await callAdmin('publishFeature', editingId ? { id: editingId, data: payload } : { data: payload })
      if (!editingId && res._id) {
        setEditingId(res._id)
      }
      setForm({ ...payload, status: 1 })
      setFeatureMessage('已发布到小程序')
      await reload()
    } catch (err) {
      setFeatureError(err.message)
    } finally {
      setPublishing(false)
    }
  }

  const resetForm = () => {
    setForm(EMPTY_FEATURE)
    setEditingId('')
    setFeatureMessage('')
    setFeatureError('')
  }

  const resetAfterDelete = async () => {
    setForm(EMPTY_FEATURE)
    setEditingId('')
    await reload()
  }

  const edit = (item) => {
    setEditingId(item._id)
    setForm(normalizeFeatureForm({ ...EMPTY_FEATURE, ...item, ...(item.has_draft && item.draft_data ? item.draft_data : {}) }))
    setFeatureMessage(item.has_draft ? '正在编辑未发布草稿' : '')
    setFeatureError('')
  }

  const remove = async (id) => {
    if (!window.confirm('确定删除这个卡片？')) return
    await callAdmin('deleteFeature', { id })
    await resetAfterDelete()
  }

  const updateTemplateType = (value) => {
    const nextFields = value === 'text_to_image' && (!form.input_fields || form.input_fields.length === 0)
      ? [
          { ...createInputField(0), key: 'category', title: '品类', placeholder: '例如：粽子礼盒', maxLength: 12, sort: 0 },
          { ...createInputField(1), key: 'brandName', title: '品牌名', placeholder: '例如：超级独奏', maxLength: 12, sort: 1 },
          { ...createInputField(2), key: 'mainCopy', title: '主文案', placeholder: '例如：端午安康 礼遇佳节', maxLength: 24, sort: 2 }
        ]
      : (form.input_fields || [])
    setForm({
      ...form,
      template_type: value,
      upload_count: value === 'text_to_image' ? 0 : (form.upload_count || 1),
      input_fields: nextFields
    })
  }

  const updateInputField = (index, patch) => {
    const inputFields = [...(form.input_fields || [])]
    inputFields[index] = { ...inputFields[index], ...patch }
    setForm({ ...form, input_fields: inputFields })
  }

  const addInputField = () => {
    const inputFields = [...(form.input_fields || [])]
    inputFields.push(createInputField(inputFields.length))
    setForm({ ...form, input_fields: inputFields })
  }

  const removeInputField = (index) => {
    const inputFields = (form.input_fields || []).filter((_, itemIndex) => itemIndex !== index)
    setForm({ ...form, input_fields: inputFields })
  }

  const insertPromptVariable = (key) => {
    setForm({ ...form, prompt: `${form.prompt || ''}{${key}}` })
  }

  return (
    <section className="workspace">
      <Editor
        title={editingId ? '编辑生图卡片' : '新增生图卡片'}
        onSave={saveDraft}
        onReset={resetForm}
        actions={(
          <>
            <button type="button" className="secondary-button" onClick={resetForm}>清空</button>
            <button type="button" className="secondary-button" onClick={saveDraft} disabled={savingDraft || publishing}>
              {savingDraft ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
              保存草稿
            </button>
            <button type="button" className="primary-button" onClick={publish} disabled={savingDraft || publishing}>
              {publishing ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
              发布到小程序
            </button>
          </>
        )}
      >
        <Field label="名称"><TextInput value={form.name} onChange={(value) => setForm({ ...form, name: value })} /></Field>
        <Field label="分组"><Select value={form.group} onChange={(value) => setForm({ ...form, group: value })} options={(refs.groups || []).map((item) => item.name)} /></Field>
        <Field label="模型"><Select value={form.model_call_id} onChange={(value) => setForm({ ...form, model_call_id: value })} options={(refs.models || []).map((item) => item.model_call_id)} /></Field>
        <Field label="兜底模型"><Select value={form.fallback_model_call_id} onChange={(value) => setForm({ ...form, fallback_model_call_id: value })} options={(refs.models || []).map((item) => item.model_call_id)} /></Field>
        <Field label="模板类型"><Select value={form.template_type} onChange={updateTemplateType} options={['image_to_image', 'text_to_image']} labels={TEMPLATE_TYPE_LABELS} /></Field>
        {form.template_type === 'text_to_image' && selectedFallbackModel && !fallbackTextProviderCompatible ? (
          <div className="form-notice warning">Fallback provider {selectedFallbackModel.provider} is not compatible with text-to-image. Use volcengine, supersolo, supersolo_async, or toapis.</div>
        ) : null}
        {form.template_type === 'text_to_image' && selectedModel && !textProviderCompatible ? (
          <div className="form-notice warning">当前模型 provider 为 {selectedModel.provider}，不兼容文生图。请切换为 volcengine、supersolo、supersolo_async 或 toapis。</div>
        ) : null}
        <Field label="图片目录">
          <select value={imageFolder} onChange={(event) => setImageFolder(event.target.value)}>
            <option value="">全部目录</option>
            {(refs.folders || []).map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </Field>
        <Field label="首页图"><ImageAssetSelect value={form.home_banner} onChange={(value) => setForm({ ...form, home_banner: value })} images={refs.images || []} /></Field>
        <Field label="详情图"><ImageAssetSelect value={form.detail_banner} onChange={(value) => setForm({ ...form, detail_banner: value })} images={refs.images || []} /></Field>
        <Field label="上传数"><NumberInput value={form.upload_count} disabled={form.template_type === 'text_to_image'} onChange={(value) => setForm({ ...form, upload_count: value })} /></Field>
        <Field label="星光消耗"><NumberInput value={form.points_cost} onChange={(value) => setForm({ ...form, points_cost: value })} /></Field>
        <Field label="高清打印">
          <label className="inline-check">
            <input type="checkbox" checked={!!form.enable_upscale_print} onChange={(event) => setForm({ ...form, enable_upscale_print: event.target.checked })} />
            开启保存时生成高清可打印版
          </label>
        </Field>
        <Field label="夯数量"><NumberInput value={form.hang_count} onChange={(value) => setForm({ ...form, hang_count: value })} /></Field>
        <Field label="拉数量"><NumberInput value={form.la_count} onChange={(value) => setForm({ ...form, la_count: value })} /></Field>
        <Field label="状态"><NumberInput value={form.status} onChange={(value) => setForm({ ...form, status: value })} /></Field>
        <Field label="排序"><NumberInput value={form.sort} onChange={(value) => setForm({ ...form, sort: value })} /></Field>
        <Field label="标签"><Select value={form.tag} onChange={(value) => setForm({ ...form, tag: value })} options={['normal', 'new', 'hot']} /></Field>
        {form.template_type === 'text_to_image' ? (
          <div className="input-field-editor">
            <div className="editor-subhead">
              <strong>动态字段</strong>
              <button type="button" className="secondary-button" onClick={addInputField}><Plus size={14} />添加字段</button>
            </div>
            {(form.input_fields || []).map((field, index) => (
              <div className="input-field-row" key={`${field.key}_${index}`}>
                <TextInput placeholder="key，如 category" value={field.key} onChange={(value) => updateInputField(index, { key: value })} />
                <TextInput placeholder="标题，如 品类" value={field.title} onChange={(value) => updateInputField(index, { title: value })} />
                <TextInput placeholder="占位文案" value={field.placeholder} onChange={(value) => updateInputField(index, { placeholder: value })} />
                <NumberInput placeholder="字数" value={field.maxLength} onChange={(value) => updateInputField(index, { maxLength: value })} />
                <label className="inline-check">
                  <input type="checkbox" checked={field.required !== false} onChange={(event) => updateInputField(index, { required: event.target.checked })} />
                  必填
                </label>
                <IconButton type="button" title="插入变量" onClick={() => insertPromptVariable(field.key)}><Copy size={16} /></IconButton>
                <IconButton type="button" title="删除字段" onClick={() => removeInputField(index)}><Trash2 size={16} /></IconButton>
              </div>
            ))}
            <div className="variable-helper">
              {(form.input_fields || []).filter((field) => field.key).map((field) => (
                <button type="button" key={field.key} className="text-button" onClick={() => insertPromptVariable(field.key)}>
                  {`{${field.key}}`}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <Field label="提示词"><Textarea value={form.prompt} onChange={(value) => setForm({ ...form, prompt: value })} /></Field>
        <FeatureDebugPanel form={form} editingId={editingId} />
        {featureError ? <p className="error-text form-wide">{featureError}</p> : null}
        {featureMessage ? <p className="success-text form-wide">{featureMessage}</p> : null}
      </Editor>
      <DataTable loading={loading} error={error} onRefresh={reload} pagination={pagination}>
        <thead><tr>
          <SortableTh field="name" sort={sort} onSort={toggleSort}>名称</SortableTh>
          <SortableTh field="group" sort={sort} onSort={toggleSort}>分组</SortableTh>
          <SortableTh field="model_call_id" sort={sort} onSort={toggleSort}>模型</SortableTh>
          <th>Fallback</th>
          <SortableTh field="points_cost" sort={sort} onSort={toggleSort}>消耗</SortableTh>
          <SortableTh field="hang_count" sort={sort} onSort={toggleSort}>夯</SortableTh>
          <SortableTh field="la_count" sort={sort} onSort={toggleSort}>拉</SortableTh>
          <SortableTh field="status" sort={sort} onSort={toggleSort}>发布状态</SortableTh>
          <th>草稿</th>
          <SortableTh field="sort" sort={sort} onSort={toggleSort}>排序</SortableTh>
          <SortableTh field="createdAt" sort={sort} onSort={toggleSort}>创建时间</SortableTh>
          <th></th>
        </tr></thead>
        <tbody>{items.map((item) => (
          <tr key={item._id}>
            <td>{item.name}</td><td>{item.group}</td><td>{item.model_call_id}</td><td>{item.fallback_model_call_id || '-'}</td><td>{item.points_cost}</td><td>{item.hang_count || 0}</td><td>{item.la_count || 0}</td><td>{FEATURE_STATUS_LABELS[item.status] || item.status}</td><td>{item.has_draft ? '有' : '-'}</td><td>{item.sort}</td><td>{formatDate(item.createdAt)}</td>
            <td className="row-actions"><button onClick={() => edit(item)}>编辑</button><IconButton title="删除" onClick={() => remove(item._id)}><Trash2 size={16} /></IconButton></td>
          </tr>
        ))}</tbody>
      </DataTable>
    </section>
  )
}

function UsersPanel() {
  const [sort, toggleSort] = useSort('updatedAt', 'desc')
  const { items, loading, error, reload, pagination } = useAdminList('listUsers', [sort.sortBy, sort.sortOrder], () => sort)
  const [openid, setOpenid] = useState('')
  const [mode, setMode] = useState('set')
  const [value, setValue] = useState(0)
  const [reason, setReason] = useState('后台调整星光')
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState(null)

  const adjust = async () => {
    await callAdmin('adjustUserPoints', { openid, mode, value, reason })
    setOpenid('')
    setValue(0)
    await reload()
  }

  const syncUsers = async () => {
    setSyncing(true)
    try {
      const result = await callAdmin('syncUserPoints')
      setSyncResult(result)
      await reload()
    } finally {
      setSyncing(false)
    }
  }

  return (
    <section className="workspace">
      <Editor title="调整用户星光" onSave={adjust} onReset={() => { setOpenid(''); setValue(0) }}>
        <Field label="OpenID"><TextInput value={openid} onChange={setOpenid} /></Field>
        <Field label="模式"><Select value={mode} onChange={setMode} options={['set', 'delta']} labels={{ set: '设置为', delta: '增减' }} /></Field>
        <Field label="数值"><NumberInput value={value} onChange={setValue} /></Field>
        <Field label="原因"><TextInput value={reason} onChange={setReason} /></Field>
      </Editor>
      {syncResult ? (
        <p className="muted">
          已扫描 {syncResult.scanned || 0} 个 OpenID，新增 {syncResult.created || 0} 条，已存在 {syncResult.existing || 0} 条，修复时间 {syncResult.normalizedTimestamps || 0} 条，失败 {((syncResult.failed || []).length + (syncResult.timestampFailed || []).length)} 条。
        </p>
      ) : null}
      <DataTable
        loading={loading}
        error={error}
        onRefresh={reload}
        pagination={pagination}
        actions={(
          <button className="secondary-button" onClick={syncUsers} disabled={syncing}>
            {syncing ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
            同步用户
          </button>
        )}
      >
        <thead><tr>
          <th>OpenID</th>
          <SortableTh field="points" sort={sort} onSort={toggleSort}>星光</SortableTh>
          <th>最近原因</th>
          <SortableTh field="createdAt" sort={sort} onSort={toggleSort}>创建时间</SortableTh>
          <SortableTh field="updatedAt" sort={sort} onSort={toggleSort}>更新时间</SortableTh>
          <th></th>
        </tr></thead>
        <tbody>{items.map((item) => (
          <tr key={item._id}>
            <td className="mono">{item._id}</td><td>{item.points}</td><td>{item.lastReason || '-'}</td><td>{formatDate(item.createdAt)}</td><td>{formatDate(item.updatedAt)}</td>
            <td><button onClick={() => setOpenid(item._id)}>调整</button></td>
          </tr>
        ))}</tbody>
      </DataTable>
    </section>
  )
}

function ImageAssetSelect({ value, onChange, images }) {
  const hasCurrent = value && !(images || []).some((item) => item.fileID === value)
  return (
    <select value={value ?? ''} onChange={(event) => onChange(event.target.value)}>
      <option value="">请选择</option>
      {hasCurrent ? <option value={value}>{value}</option> : null}
      {(images || []).map((item) => (
        <option key={item._id || item.fileID} value={item.fileID}>
          {[item.folder, item.name || item.objectKey || item.fileID].filter(Boolean).join(' / ')}
        </option>
      ))}
    </select>
  )
}

function FolderSelect({ value, onChange, folders }) {
  const options = [...new Set([value, ...(folders || [])].filter(Boolean))].sort()
  return (
    <select value={value ?? ''} onChange={(event) => onChange(event.target.value)}>
      <option value="">请选择目录</option>
      {options.map((item) => <option key={item} value={item}>{item}</option>)}
    </select>
  )
}

function SettingsPanel({ status, onPasswordChanged }) {
  const { items, loading, error, reload, pagination } = useAdminList('listAdmins')
  const [form, setForm] = useState(EMPTY_ADMIN)
  const [editingId, setEditingId] = useState('')
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordMessage, setPasswordMessage] = useState('')
  const [passwordError, setPasswordError] = useState('')

  const resetAdminForm = () => {
    setForm(EMPTY_ADMIN)
    setEditingId('')
  }

  const saveAdmin = async () => {
    await callAdmin(editingId ? 'updateAdmin' : 'createAdmin', editingId ? { id: editingId, data: form } : form)
    resetAdminForm()
    await reload()
  }

  const editAdmin = (item) => {
    setEditingId(item._id)
    setForm({ ...EMPTY_ADMIN, ...item })
  }

  const removeAdmin = async (item) => {
    if (!window.confirm(`确定删除管理员 ${item.displayName || item.username || item.uid} 吗？`)) return
    await callAdmin('deleteAdmin', { id: item._id })
    await reload()
  }

  const changePassword = async (event) => {
    event.preventDefault()
    setPasswordSaving(true)
    setPasswordMessage('')
    setPasswordError('')
    try {
      if (newPassword !== confirmPassword) throw new Error('两次输入的新密码不一致')
      const { error: resetError } = await auth.resetPasswordForOld({
        old_password: oldPassword,
        new_password: newPassword
      })
      if (resetError) throw new Error(resetError.message || '密码修改失败')
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordMessage('密码已更新，请使用新密码重新登录。')
      await onPasswordChanged()
    } catch (err) {
      setPasswordError(err.message)
    } finally {
      setPasswordSaving(false)
    }
  }

  return (
    <section className="workspace">
      <form className="editor" onSubmit={changePassword}>
        <div className="section-head">
          <h2>当前账号密码</h2>
          <button className="primary-button" disabled={passwordSaving}>
            {passwordSaving ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
            修改密码
          </button>
        </div>
        <div className="form-grid">
          <Field label="旧密码"><TextInput value={oldPassword} onChange={setOldPassword} type="password" minLength={6} required /></Field>
          <Field label="新密码"><TextInput value={newPassword} onChange={setNewPassword} type="password" minLength={6} required /></Field>
          <Field label="确认新密码"><TextInput value={confirmPassword} onChange={setConfirmPassword} type="password" minLength={6} required /></Field>
        </div>
        {passwordError ? <p className="error-text">{passwordError}</p> : null}
        {passwordMessage ? <p className="success-text">{passwordMessage}</p> : null}
      </form>

      <Editor title={editingId ? '编辑管理员账号' : '新增管理员账号'} onSave={saveAdmin} onReset={resetAdminForm}>
        <Field label="UID"><TextInput value={form.uid} onChange={(value) => setForm({ ...form, uid: value })} /></Field>
        <Field label="OpenID"><TextInput value={form.openid} onChange={(value) => setForm({ ...form, openid: value })} /></Field>
        <Field label="账号名"><TextInput value={form.username} onChange={(value) => setForm({ ...form, username: value })} /></Field>
        <Field label="显示名"><TextInput value={form.displayName} onChange={(value) => setForm({ ...form, displayName: value })} /></Field>
        <Field label="角色"><Select value={form.role} onChange={(value) => setForm({ ...form, role: value })} options={['super_admin', 'admin']} labels={{ super_admin: '超级管理员', admin: '管理员' }} /></Field>
        <Field label="状态"><NumberInput value={form.status} onChange={(value) => setForm({ ...form, status: value })} /></Field>
      </Editor>

      <DataTable loading={loading} error={error} onRefresh={reload} pagination={pagination}>
        <thead><tr><th>UID</th><th>账号名</th><th>显示名</th><th>角色</th><th>状态</th><th>创建时间</th><th>更新时间</th><th></th></tr></thead>
        <tbody>{items.map((item) => {
          const isSelf = item.uid === status?.caller?.uid
          return (
            <tr key={item._id}>
              <td className="mono">{item.uid}</td><td>{item.username || '-'}</td><td>{item.displayName || '-'}</td><td>{item.role || '-'}</td><td>{item.status ?? '-'}</td><td>{formatDate(item.createdAt)}</td><td>{formatDate(item.updatedAt)}</td>
              <td className="row-actions">
                <button onClick={() => editAdmin(item)}>编辑</button>
                <IconButton title={isSelf ? '不能删除当前账号' : '删除'} onClick={() => removeAdmin(item)} disabled={isSelf}><Trash2 size={16} /></IconButton>
              </td>
            </tr>
          )
        })}</tbody>
      </DataTable>
    </section>
  )
}

function Select({ value, onChange, options, labels = {} }) {
  return (
    <select value={value ?? ''} onChange={(event) => onChange(event.target.value)}>
      <option value="">请选择</option>
      {options.map((option) => <option key={option} value={option}>{labels[option] || option}</option>)}
    </select>
  )
}

function Editor({ title, children, onSave, onReset, actions = null }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onSave()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="editor" onSubmit={submit}>
      <div className="section-head">
        <h2>{title}</h2>
        <div className="toolbar">
          {actions || (
            <>
              <button type="button" className="secondary-button" onClick={onReset}>清空</button>
              <button className="primary-button" disabled={saving}>
                {saving ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
                保存
              </button>
            </>
          )}
        </div>
      </div>
      <div className="form-grid">{children}</div>
      {error ? <p className="error-text">{error}</p> : null}
    </form>
  )
}

function DataTable({ children, loading, error, onRefresh, actions = null, pagination = null }) {
  const totalPages = pagination ? Math.max(Math.ceil((pagination.total || 0) / pagination.pageSize), 1) : 1
  return (
    <div className="table-section">
      <div className="section-head">
        <h2>数据列表</h2>
        <div className="toolbar">
          {actions}
          <IconButton title="刷新" onClick={onRefresh}><RefreshCw size={16} /></IconButton>
        </div>
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      <div className="table-wrap">
        <table>{children}</table>
        {loading ? <div className="loading-mask"><Loader2 className="spin" size={22} /></div> : null}
      </div>
      {pagination ? (
        <div className="table-footer">
          <span>共 {pagination.total || 0} 条，第 {pagination.page} / {totalPages} 页</span>
          <div className="pager">
            <select
              value={pagination.pageSize}
              onChange={(event) => pagination.setPageSize(Number(event.target.value))}
              aria-label="每页条数"
            >
              {[20, 50, 100].map((size) => <option key={size} value={size}>每页 {size} 条</option>)}
            </select>
            <button
              type="button"
              className="secondary-button"
              onClick={() => pagination.setPage(Math.max(pagination.page - 1, 1))}
              disabled={pagination.page <= 1}
            >
              上一页
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => pagination.setPage(Math.min(pagination.page + 1, totalPages))}
              disabled={pagination.page >= totalPages}
            >
              下一页
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Dashboard({ status, onSignOut }) {
  const [tab, setTab] = useState('models')
  const ActiveIcon = useMemo(() => TABS.find((item) => item.key === tab)?.icon || Database, [tab])

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><Sparkles size={22} /><span>AI 生图后台</span></div>
        <nav>{TABS.map((item) => {
          const TabIcon = item.icon
          return <button key={item.key} className={tab === item.key ? 'active' : ''} onClick={() => setTab(item.key)}><TabIcon size={18} />{item.label}</button>
        })}</nav>
        <button className="signout-button" onClick={onSignOut}><LogOut size={16} />退出</button>
      </aside>
      <section className="main-area">
        <header className="topbar">
          <div><ActiveIcon size={22} /><h1>{TABS.find((item) => item.key === tab)?.label}</h1></div>
          <span>{status?.admin?.displayName || status?.caller?.uid || 'Admin'}</span>
        </header>
        {tab === 'models' ? <ModelsPanel /> : null}
        {tab === 'groups' ? <GroupsPanel /> : null}
        {tab === 'images' ? <ImagesPanel /> : null}
        {tab === 'features' ? <FeaturesPanel /> : null}
        {tab === 'users' ? <UsersPanel /> : null}
        {tab === 'settings' ? <SettingsPanel status={status} onPasswordChanged={onSignOut} /> : null}
      </section>
    </main>
  )
}

function App() {
  const [booting, setBooting] = useState(true)
  const [session, setSession] = useState(null)
  const [status, setStatus] = useState(null)

  const refreshStatus = async () => {
    const sessionRes = await auth.getSession()
    const nextSession = sessionRes?.data?.session || null
    setSession(nextSession)
    if (!nextSession || nextSession.user?.is_anonymous) {
      setStatus(null)
      return
    }
    const adminStatus = await callAdmin('getAdminStatus')
    setStatus(adminStatus)
  }

  useEffect(() => {
    refreshStatus().finally(() => setBooting(false))
  }, [])

  const signOut = async () => {
    await auth.signOut()
    setSession(null)
    setStatus(null)
  }

  if (booting) {
    return <main className="login-shell"><Loader2 className="spin" size={30} /></main>
  }

  if (!session) {
    return <LoginView onReady={refreshStatus} />
  }

  if (status?.needsBootstrap) {
    return <BootstrapView status={status} onDone={refreshStatus} />
  }

  if (!status?.isAdmin) {
    return <LockedView status={status} onSignOut={signOut} />
  }

  return <Dashboard status={status} onSignOut={signOut} />
}

createRoot(document.getElementById('root')).render(<App />)
