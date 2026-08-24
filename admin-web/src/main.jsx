import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Copy,
  Database,
  Download,
  FolderTree,
  Image,
  LayoutDashboard,
  ListChecks,
  Loader2,
  LogOut,
  MessageSquare,
  Plus,
  Play,
  Receipt,
  RefreshCw,
  Save,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  Wand2,
  X
} from 'lucide-react'
import { app, auth, callAdmin, callAnalytics } from './cloudbase'
import DashboardPanel from './v2/DashboardPanel'
import { AuditLogsPanel, FeedbackPanel, GenerationJobsPanel, OrdersPanel, SystemConfigPanel } from './v2/OperationsPanels'
import { ImagesV22Panel, RecommendationV22Panel, TemplatesV22Panel } from './v2/V22Panels'
import { ConfirmDialogHost, FilterBar, confirmAction, maskIdentifier, roleLabel, statusLabel, useDebouncedValue, useHashParamState } from './v2/ui'
import './styles.css'

const NAV_GROUPS = [
  {
    label: '运营',
    items: [{ key: 'overview', path: '/overview', label: '运营首页', icon: LayoutDashboard }]
  },
  {
    label: '模板运营',
    items: [
      { key: 'templates', path: '/templates', label: '模板中心', icon: Wand2 },
      { key: 'placements', path: '/placements', label: '推荐位与排序', icon: ArrowUpDown },
      { key: 'categories', path: '/categories', label: '分类管理', icon: FolderTree },
      { key: 'assets', path: '/assets', label: '图片中心', icon: Image }
    ]
  },
  {
    label: '业务运营',
    items: [
      { key: 'jobs', path: '/jobs', label: '生成任务', icon: ListChecks },
      { key: 'users', path: '/users', label: '用户管理', icon: UserRound },
      { key: 'feedback', path: '/feedback', label: '反馈与投诉', icon: MessageSquare },
      { key: 'orders', path: '/orders', label: '订单与星光', icon: Receipt }
    ]
  },
  {
    label: '系统管理',
    items: [
      { key: 'models', path: '/models', label: '模型与路由', icon: Database },
      { key: 'audit', path: '/audit', label: '审计日志', icon: ShieldCheck },
      { key: 'settings', path: '/settings', label: '管理员与权限', icon: Settings },
      { key: 'system_config', path: '/system-config', label: '系统配置', icon: Settings }
    ]
  }
]
const TABS = NAV_GROUPS.flatMap((group) => group.items)
const ROUTE_TO_TAB = Object.fromEntries(TABS.map((item) => [item.path, item.key]))
const ROLE_TAB_KEYS = {
  admin: ['overview', 'templates', 'categories', 'assets', 'placements', 'jobs', 'users', 'feedback', 'orders', 'models', 'audit', 'system_config'],
  template_editor: ['overview', 'templates', 'categories', 'assets', 'placements'],
  operator: ['overview', 'jobs', 'users', 'feedback'],
  finance: ['overview', 'users', 'orders'],
  readonly_analyst: ['overview']
}

function tabFromLocation() {
  const hashPath = window.location.hash.replace(/^#/, '').split('?')[0]
  return ROUTE_TO_TAB[hashPath] || 'overview'
}

const EMPTY_MODEL = {
  model_call_id: '',
  name: '',
  provider: '',
  base_url: '',
  model_id: '',
  api_key: '',
  ratio: '',
  resolution_type: '',
  status: 1,
  remark: ''
}

const ZONE_OPTIONS = ['boss', 'play']
const ZONE_LABELS = {
  boss: '老板专区',
  play: '玩图专区'
}

const EMPTY_GROUP = { name: '', zone: 'play', status: 1, sort: 10, description: '' }
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
  placements: [],
  home_banner: '',
  detail_banner: '',
  template_type: 'image_to_image',
  input_fields: [],
  supported_ratios: ['1:1', '3:4', '4:3', '4:5', '9:16', '16:9'],
  upload_count: 1,
  points_cost: 5,
  enable_upscale_print: false,
  size: '',
  model_call_id: '',
  fallback_model_call_id: '',
  prompt: '',
  status: 0,
  lifecycle_status: 'draft',
  sort: 10,
  tag: 'normal',
  description: ''
}
const TEMPLATE_TYPE_LABELS = {
  image_to_image: '图生图',
  text_to_image: '文生图'
}
const FEATURE_STATUS_LABELS = {
  draft: '草稿',
  testing: '测试中',
  ready: '可发布',
  published: '已发布',
  offline: '已下线'
}
const TEXT_TO_IMAGE_PROVIDERS = ['volcengine', 'supersolo', 'supersolo_async', 'toapis', 'joapi', 'jimeng_cli']
const TOAPIS_SIZE_OPTIONS = ['1:1', '3:4', '9:16']
const WEB_RATIO_OPTIONS = ['1:1', '3:4', '4:3', '4:5', '9:16', '16:9']
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

function Field({ label, children, error = '', name = '' }) {
  const generatedId = useId()
  const fieldName = name || `field-${generatedId.replace(/:/g, '')}`
  const controlId = React.isValidElement(children) && children.props.id ? children.props.id : fieldName
  const errorId = `${fieldName}-error`
  const child = React.isValidElement(children) ? React.cloneElement(children, {
    id: controlId,
    name: children.props.name || fieldName,
    'aria-invalid': error ? 'true' : undefined,
    'aria-describedby': error ? errorId : children.props['aria-describedby']
  }) : children
  return (
    <label className={`field ${error ? 'has-error' : ''}`} htmlFor={controlId}>
      <span>{label}</span>
      {child}
      {error ? <small className="field-error" id={errorId}>{error}</small> : null}
    </label>
  )
}

function TextInput({ value, onChange, onCompositionStart, onCompositionEnd, ...props }) {
  const composingRef = useRef(false)
  const [draft, setDraft] = useState(value ?? '')

  useEffect(() => {
    if (!composingRef.current) {
      setDraft(value ?? '')
    }
  }, [value])

  const handleChange = (event) => {
    const nextValue = event.target.value
    setDraft(nextValue)
    if (!composingRef.current) {
      onChange(nextValue)
    }
  }

  const handleCompositionStart = (event) => {
    composingRef.current = true
    onCompositionStart?.(event)
  }

  const handleCompositionEnd = (event) => {
    composingRef.current = false
    const nextValue = event.target.value
    setDraft(nextValue)
    onChange(nextValue)
    onCompositionEnd?.(event)
  }

  return (
    <input
      value={draft}
      onChange={handleChange}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      {...props}
    />
  )
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const initialParams = new URLSearchParams(window.location.hash.split('?')[1] || '')
  const [page, setPage] = useState(Math.max(Number(initialParams.get('page')) || 1, 1))
  const [pageSize, setPageSize] = useState([20, 50, 100].includes(Number(initialParams.get('pageSize'))) ? Number(initialParams.get('pageSize')) : 20)
  const [total, setTotal] = useState(0)
  const filterReadyRef = useRef(false)

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
    if (!filterReadyRef.current) {
      filterReadyRef.current = true
      return
    }
    setPage(1)
  }, deps)

  useEffect(() => {
    const [path, raw = ''] = window.location.hash.replace(/^#/, '').split('?')
    const params = new URLSearchParams(raw)
    params.set('page', String(page))
    params.set('pageSize', String(pageSize))
    window.history.replaceState(null, '', `#${path}?${params.toString()}`)
  }, [page, pageSize])

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
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    setLoading(true)
    setMessage('')
    try {
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
        <h1>AI 造梦馆运营后台</h1>
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
            登录
          </button>
        </form>
        <p className="muted">安全登录 · 仅限授权管理员</p>
      </section>
    </main>
  )
}

function BootstrapView({ status, onDone }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [bootstrapToken, setBootstrapToken] = useState('')

  const bootstrap = async () => {
    setLoading(true)
    setError('')
    try {
      await callAdmin('bootstrapAdmin', { username: status?.caller?.uid || '', bootstrapToken })
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
        <p className="muted">检测到管理员白名单为空。请输入部署时配置的一次性初始化密钥。</p>
        <Field label="初始化密钥">
          <TextInput value={bootstrapToken} onChange={setBootstrapToken} type="password" required />
        </Field>
        {error ? <p className="error-text">{error}</p> : null}
        <button className="primary-button" onClick={bootstrap} disabled={loading || !bootstrapToken}>
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
  const [keyword, setKeyword] = useHashParamState('keyword')
  const [providerFilter, setProviderFilter] = useHashParamState('provider')
  const [statusFilter, setStatusFilter] = useHashParamState('status')
  const [dateFrom, setDateFrom] = useHashParamState('dateFrom')
  const [dateTo, setDateTo] = useHashParamState('dateTo')
  const debouncedKeyword = useDebouncedValue(keyword)
  const { items, loading, error, reload, pagination } = useAdminList('listModels', [debouncedKeyword, providerFilter, statusFilter, dateFrom, dateTo], () => ({ keyword: debouncedKeyword, filters: { provider: providerFilter, status: statusFilter === '' ? '' : Number(statusFilter), dateField: 'createdAt', dateFrom, dateTo } }))
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
    const item = items.find((row) => row._id === id)
    if (!await confirmAction({ title: '删除能力策略', description: '删除后依赖该策略的模板可能无法发布。', objectName: item?.name, objectId: id, impact: '不会修改已生成结果，但会影响后续模板调用。', recovery: '不可恢复，请确认没有模板正在使用。', requireText: item?.name || id, confirmLabel: '确认删除能力策略' })) return
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
        <Field label="图片比例"><TextInput value={form.ratio} onChange={(value) => setForm({ ...form, ratio: value })} placeholder="即梦默认 1:1" /></Field>
        <Field label="分辨率"><TextInput value={form.resolution_type} onChange={(value) => setForm({ ...form, resolution_type: value })} placeholder="即梦默认 2k" /></Field>
        <Field label="状态"><Select value={form.status} onChange={(value) => setForm({ ...form, status: Number(value) })} options={[1, 0]} labels={{ 1: '启用', 0: '停用' }} /></Field>
        <Field label="备注"><Textarea value={form.remark} onChange={(value) => setForm({ ...form, remark: value })} /></Field>
      </Editor>
      <FilterBar keyword={keyword} onKeywordChange={setKeyword} placeholder="搜索调用ID、名称或服务商" onReset={() => { setKeyword(''); setProviderFilter(''); setStatusFilter(''); setDateFrom(''); setDateTo('') }}>
        <label>服务商<input name="providerFilter" value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)} placeholder="精确筛选" /></label>
        <label>状态<select name="modelStatus" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">全部状态</option><option value="1">启用</option><option value="0">停用</option></select></label>
        <label>开始日期<input name="modelDateFrom" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
        <label>结束日期<input name="modelDateTo" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
      </FilterBar>
      <DataTable loading={loading} error={error} onRefresh={reload} pagination={pagination}>
        <thead><tr><th>调用 ID</th><th>名称</th><th>服务商</th><th>模型</th><th>密钥</th><th>状态</th><th></th></tr></thead>
        <tbody>{items.map((item) => (
          <tr key={item._id}>
            <td>{item.model_call_id}</td><td>{item.name || '-'}</td><td>{item.provider}</td><td>{item.model_id}</td>
            <td>{item.has_api_key ? '已配置' : '未配置'}</td><td>{item.status === 1 ? '启用' : '停用'}</td>
            <td className="row-actions"><button onClick={() => edit(item)}>编辑</button><IconButton title="删除" onClick={() => remove(item._id)}><Trash2 size={16} /></IconButton></td>
          </tr>
        ))}</tbody>
      </DataTable>
    </section>
  )
}

function GroupsPanel() {
  const [tableZone, setTableZone] = useHashParamState('zone', 'boss')
  const [keyword, setKeyword] = useHashParamState('keyword')
  const [statusFilter, setStatusFilter] = useHashParamState('status')
  const debouncedKeyword = useDebouncedValue(keyword)
  const { items, loading, error, reload, pagination } = useAdminList(
    'listGroups',
    [tableZone, debouncedKeyword, statusFilter],
    () => ({ zone: tableZone, keyword: debouncedKeyword, filters: { status: statusFilter === '' ? '' : Number(statusFilter) }, sortBy: 'sort', sortOrder: 'asc' })
  )
  const [form, setForm] = useState(EMPTY_GROUP)
  const [editingId, setEditingId] = useState('')

  const save = async () => {
    await callAdmin(editingId ? 'updateGroup' : 'createGroup', editingId ? { id: editingId, data: form } : form)
    setForm(EMPTY_GROUP)
    setEditingId('')
    await reload()
  }

  const remove = async (id) => {
    const item = items.find((row) => row._id === id)
    if (!await confirmAction({ title: '删除分类', description: '删除前请确认没有模板依赖该分类。', objectName: item?.name, objectId: id, impact: '相关模板可能进入未归类状态。', recovery: '可重新创建分类，但原关联不会自动恢复。', requireText: item?.name || id, confirmLabel: '确认删除分类' })) return
    await callAdmin('deleteGroup', { id })
    await reload()
  }

  return (
    <section className="workspace">
      <Editor title={editingId ? '编辑分类' : '新增分类'} onSave={save} onReset={() => { setForm(EMPTY_GROUP); setEditingId('') }}>
        <Field label="名称"><TextInput value={form.name} onChange={(value) => setForm({ ...form, name: value })} /></Field>
        <Field label="专区"><Select value={form.zone} onChange={(value) => setForm({ ...form, zone: value || 'play' })} options={ZONE_OPTIONS} labels={ZONE_LABELS} /></Field>
        <Field label="状态"><Select value={form.status} onChange={(value) => setForm({ ...form, status: Number(value) })} options={[1, 0]} labels={{ 1: '启用', 0: '停用' }} /></Field>
        <Field label="排序"><NumberInput value={form.sort} onChange={(value) => setForm({ ...form, sort: value })} /></Field>
        <Field label="描述"><Textarea value={form.description} onChange={(value) => setForm({ ...form, description: value })} /></Field>
      </Editor>
      <div className="table-tabs" role="tablist" aria-label="分类专区">
        {ZONE_OPTIONS.map((zone) => (
          <button
            key={zone}
            type="button"
            role="tab"
            aria-selected={tableZone === zone}
            className={tableZone === zone ? 'active' : ''}
            onClick={() => setTableZone(zone)}
          >
            {ZONE_LABELS[zone]}
          </button>
        ))}
      </div>
      <FilterBar keyword={keyword} onKeywordChange={setKeyword} placeholder="搜索分类名称或描述" onReset={() => { setKeyword(''); setStatusFilter('') }}><label>状态<select name="categoryStatus" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">全部状态</option><option value="1">启用</option><option value="0">停用</option></select></label></FilterBar>
      <DataTable loading={loading} error={error} onRefresh={reload} pagination={pagination}>
        <thead><tr><th>名称</th><th>专区</th><th>状态</th><th>排序</th><th>描述</th><th></th></tr></thead>
        <tbody>{items.map((item) => (
          <tr key={item._id}>
            <td>{item.name}</td><td>{ZONE_LABELS[item.zone || 'play']}</td><td>{item.status === 1 ? '启用' : '停用'}</td><td>{item.sort}</td><td>{item.description || '-'}</td>
            <td className="row-actions"><button onClick={() => { setEditingId(item._id); setForm({ ...EMPTY_GROUP, ...item }) }}>编辑</button><IconButton title="删除" onClick={() => remove(item._id)}><Trash2 size={16} /></IconButton></td>
          </tr>
        ))}</tbody>
      </DataTable>
    </section>
  )
}

function ImagesPanel() {
  const [folder, setFolder] = useHashParamState('folder')
  const [featureId, setFeatureId] = useHashParamState('templateId')
  const [keyword, setKeyword] = useHashParamState('keyword')
  const [usageFilter, setUsageFilter] = useHashParamState('usage')
  const [statusFilter, setStatusFilter] = useHashParamState('status')
  const [dateFrom, setDateFrom] = useHashParamState('dateFrom')
  const [dateTo, setDateTo] = useHashParamState('dateTo')
  const debouncedKeyword = useDebouncedValue(keyword)
  const [sort, toggleSort] = useSort('lastModified', 'desc')
  const { items, refs, loading, error, reload, pagination } = useAdminList('listImages', [folder, featureId, debouncedKeyword, usageFilter, statusFilter, dateFrom, dateTo, sort.sortBy, sort.sortOrder], () => ({ folder, featureId, keyword: debouncedKeyword, filters: { usage: usageFilter, status: statusFilter === '' ? '' : Number(statusFilter), dateField: 'lastModified', dateFrom, dateTo }, ...sort }))
  const [form, setForm] = useState(EMPTY_IMAGE)
  const [editingId, setEditingId] = useState('')
  const [uploading, setUploading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncPrefix, setSyncPrefix] = useState('')
  const [syncResult, setSyncResult] = useState(null)
  const [selectedIds, setSelectedIds] = useState([])
  const [uploadResult, setUploadResult] = useState(null)
  const [previewAsset, setPreviewAsset] = useState(null)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    setSelectedIds([])
  }, [folder, featureId, sort.sortBy, sort.sortOrder])

  const allVisibleSelected = items.length > 0 && items.every((item) => selectedIds.includes(item._id))
  const selectedAssets = items.filter((item) => selectedIds.includes(item._id))

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
      const item = items.find((row) => row._id === id)
      if (err.result && err.result.code === 'IMAGE_IN_USE' && await confirmAction({ title: '强制删除被引用素材', description: '该素材正在被模板引用。', objectName: item?.name || item?.objectKey, objectId: id, impact: '引用它的模板将出现素材缺失，发布检查会失败。', recovery: '不可恢复，需重新上传并逐一关联。', requireText: item?.name || item?.objectKey || id, confirmLabel: '确认强制删除' })) {
        await remove(id, true)
        return
      }
      throw err
    }
  }

  const removeSelected = async () => {
    if (selectedIds.length === 0) return
    if (!await confirmAction({ title: '批量删除素材', description: `将删除选中的 ${selectedIds.length} 个素材。`, impact: '被模板引用的素材会单独阻止删除。', recovery: '已删除的存储文件不可恢复。', confirmLabel: `确认删除 ${selectedIds.length} 个素材` })) return
    for (const id of selectedIds) {
      await callAdmin('deleteImageAsset', { id })
    }
    setSelectedIds([])
    await reload()
  }

  const getDownloadName = (item = {}, index = 0) => {
    const rawPath = item.objectKey || item.cloudPath || ''
    const rawName = item.name || rawPath || `image_${index + 1}`
    const fallbackExt = rawPath.includes('.') ? rawPath.slice(rawPath.lastIndexOf('.')) : '.jpg'
    const name = String(rawName).split('/').pop().replace(/[\\/:*?"<>|]/g, '_') || `image_${index + 1}${fallbackExt}`
    return name.includes('.') ? name : `${name}${fallbackExt}`
  }

  const downloadSelected = () => {
    if (selectedAssets.length === 0 || downloading) return
    const downloadable = selectedAssets.filter((item) => item.temporaryUrl || item.fileID)
    if (downloadable.length === 0) {
      window.dispatchEvent(new CustomEvent('admin-toast', { detail: { type: 'error', message: '选中的图片暂无可下载链接，请先刷新列表后重试。' } }))
      return
    }

    setDownloading(true)
    downloadable.forEach((item, index) => {
      window.setTimeout(() => {
        const link = document.createElement('a')
        link.href = item.temporaryUrl || item.fileID
        link.download = getDownloadName(item, index)
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
      }, index * 250)
    })
    window.setTimeout(() => setDownloading(false), Math.max(downloadable.length, 1) * 250)
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

  const getImageModelLabel = (item = {}) => (
    item.modelCallId ||
    item.model_call_id ||
    item.modelCallIdSnapshot ||
    item.model ||
    '-'
  )

  const getImageOwnerOpenid = (item = {}) => (
    item.ownerOpenid ||
    item.generatedOpenid ||
    item.generated_openid ||
    item.openid ||
    item._openid ||
    ''
  )

  const getImageSavedLabel = (item = {}) => {
    if (item.saveStatus === 'saved') return '是'
    if (item.saveStatus === 'not_saved') return '否'
    if (item.saveStatus === 'unknown') return '—'
    return ''
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
          <Field label="生图模板筛选">
            <select value={featureId} onChange={(event) => setFeatureId(event.target.value)}>
              <option value="">全部模板</option>
              {(refs.templates || []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}{item.status === 0 ? '（草稿）' : ''}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {syncResult ? (
          <p className="muted">
            已扫描 {syncResult.scanned} 个对象，新增 {syncResult.created} 条，更新 {syncResult.updated} 条。
          </p>
        ) : null}
      </div>
      <Editor title={editingId ? '编辑素材' : '新增素材'} onSave={save} onReset={() => { setForm(EMPTY_IMAGE); setEditingId('') }}>
        <Field label="上传"><input type="file" accept="image/*" multiple onChange={upload} disabled={uploading} /></Field>
        <Field label="名称"><TextInput value={form.name} onChange={(value) => setForm({ ...form, name: value })} /></Field>
        <Field label="目录"><FolderSelect value={form.folder} onChange={(value) => setForm({ ...form, folder: cleanFolder(value) })} folders={refs.folders || []} /></Field>
        <Field label="对象路径"><TextInput value={form.objectKey || form.cloudPath} onChange={(value) => setForm({ ...form, objectKey: value, cloudPath: value })} /></Field>
        <Field label="分类"><TextInput value={form.category} onChange={(value) => setForm({ ...form, category: value })} /></Field>
        <Field label="用途"><TextInput value={form.usage} onChange={(value) => setForm({ ...form, usage: value })} /></Field>
        <Field label="FileID"><Textarea value={form.fileID} onChange={(value) => setForm({ ...form, fileID: value })} /></Field>
        <Field label="状态"><Select value={form.status} onChange={(value) => setForm({ ...form, status: Number(value) })} options={[1, 0]} labels={{ 1: '启用', 0: '停用' }} /></Field>
      </Editor>
      {uploadResult ? (
        <p className="muted">
          已批量上传 {uploadResult.count} 张图片到 {uploadResult.folder}。
        </p>
      ) : null}
      <FilterBar keyword={keyword} onKeywordChange={setKeyword} placeholder="搜索素材名称、对象路径或目录" onReset={() => { setKeyword(''); setUsageFilter(''); setStatusFilter(''); setFolder(''); setFeatureId(''); setDateFrom(''); setDateTo('') }}>
        <label>用途<input name="assetUsage" value={usageFilter} onChange={(event) => setUsageFilter(event.target.value)} placeholder="精确筛选" /></label>
        <label>状态<select name="assetStatus" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">全部状态</option><option value="1">启用</option><option value="0">停用</option></select></label>
        <label>开始日期<input name="assetDateFrom" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
        <label>结束日期<input name="assetDateTo" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
      </FilterBar>
      <DataTable
        loading={loading}
        error={error}
        onRefresh={reload}
        pagination={pagination}
        actions={(
          <>
            <button className="secondary-button" type="button" onClick={downloadSelected} disabled={selectedAssets.length === 0 || downloading}>
              {downloading ? <Loader2 className="spin" size={16} /> : <Download size={16} />}
              批量下载{selectedAssets.length ? `(${selectedAssets.length})` : ''}
            </button>
            <button className="secondary-button danger" type="button" onClick={removeSelected} disabled={selectedIds.length === 0}>
              <Trash2 size={16} />
              批量删除{selectedIds.length ? `(${selectedIds.length})` : ''}
            </button>
          </>
        )}
      >
        <thead><tr>
          <th className="select-col"><input name="selectAllAssets" aria-label="选择当前页全部素材" type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} /></th>
          <th>预览</th>
          <SortableTh field="name" sort={sort} onSort={toggleSort}>名称</SortableTh>
          <SortableTh field="folder" sort={sort} onSort={toggleSort}>目录</SortableTh>
          <th>对象路径</th>
          <SortableTh field="usage" sort={sort} onSort={toggleSort}>用途</SortableTh>
          <th>图片类型</th>
          <th>是否被保存</th>
          <th>生图模板</th>
          <th>使用模型</th>
          <th>上传/生成用户</th>
          <SortableTh field="lastModified" sort={sort} onSort={toggleSort}>云存储时间</SortableTh>
          <th>URL</th><th></th>
        </tr></thead>
        <tbody>{items.map((item) => (
          <tr key={item._id}>
            <td className="select-col"><input name={`asset_${item._id}`} aria-label={`选择素材 ${item.name || item._id}`} type="checkbox" checked={selectedIds.includes(item._id)} onChange={() => toggleSelected(item._id)} /></td>
            <td>{item.temporaryUrl ? <button type="button" className="thumb-button" onClick={() => setPreviewAsset(item)} title="预览大图"><img className="thumb" src={item.temporaryUrl} alt={item.name} /></button> : '-'}</td>
            <td>{item.name}</td><td>{item.folder || '-'}</td><td className="mono">{item.objectKey || item.cloudPath || item.fileID}</td><td>{item.usage || '-'}</td><td>{({ original: '原图', generated: '生成图', upscaled: '高清图' })[item.imageRole] || '-'}</td><td title={item.saveStatus === 'unknown' ? '历史版本没有精确保存成功埋点，暂时无法判断' : ''}>{getImageSavedLabel(item)}</td><td>{item.featureName || '-'}</td><td>{getImageModelLabel(item)}</td><td className="mono">{getImageOwnerOpenid(item) || '—'}</td><td>{formatDate(item.lastModified || item.createdAt)}</td>
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
              <IconButton title="关闭" onClick={() => setPreviewAsset(null)}><X size={16} /></IconButton>
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
  const placements = normalizePlacements(form.placements, form.group)
  return {
    ...form,
    group: placements[0]?.group || '',
    placements,
    template_type: templateType,
    enable_upscale_print: !!form.enable_upscale_print,
    upload_count: templateType === 'text_to_image' ? 0 : Number(form.upload_count || 1),
    input_fields: templateType === 'text_to_image' ? normalizeInputFields(form.input_fields) : []
  }
}

function normalizePlacements(placements = [], legacyGroup = '') {
  const list = Array.isArray(placements) ? placements : []
  const normalized = list
    .map((item) => ({
      zone: item?.zone === 'boss' ? 'boss' : 'play',
      group: String(item?.group || '').trim()
    }))
    .filter((item) => item.group)
  if (normalized.length > 0) return normalized
  return legacyGroup ? [{ zone: 'play', group: legacyGroup }] : [{ zone: 'play', group: '' }]
}

function getGroupsForZone(groups = [], zone = 'play') {
  return (groups || []).filter((item) => (item.zone || 'play') === zone).map((item) => item.name)
}

function formatPlacements(placements = [], legacyGroup = '') {
  return normalizePlacements(placements, legacyGroup)
    .filter((item) => item.group)
    .map((item) => `${ZONE_LABELS[item.zone] || item.zone}/${item.group}`)
    .join('、') || '-'
}

function getSelectedModel(models = [], modelCallId = '') {
  return (models || []).find((item) => item.model_call_id === modelCallId) || null
}

function normalizeToapisSize(value = '') {
  const size = String(value || '').trim()
  return TOAPIS_SIZE_OPTIONS.includes(size) ? size : '1:1'
}

function usesToapisProvider(primaryModel, fallbackModel) {
  return primaryModel?.provider === 'toapis' || fallbackModel?.provider === 'toapis'
}

function FeatureDebugPanel({ form, editingId, onComplete }) {
  const [inputValues, setInputValues] = useState({})
  const [imageUrls, setImageUrls] = useState([])
  const [uploading, setUploading] = useState(false)
  const [running, setRunning] = useState(false)
  const [task, setTask] = useState(null)
  const [error, setError] = useState('')
  const [testRoute, setTestRoute] = useState('primary')
  const [targetRatio, setTargetRatio] = useState(form.size || form.supported_ratios?.[0] || '1:1')
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
    if (!form.fallback_model_call_id && testRoute === 'fallback') setTestRoute('primary')
    if (!(form.supported_ratios || []).includes(targetRatio)) setTargetRatio(form.supported_ratios?.[0] || '1:1')
  }, [form.fallback_model_call_id, form.supported_ratios])

  useEffect(() => {
    if (!task || !task.taskId || !['pending', 'running'].includes(task.status)) return undefined
    const poll = async () => {
      try {
        const res = await callAdmin('getDebugGenerationStatus', { taskId: task.taskId })
        const nextTask = res.task || null
        setTask(nextTask)
        if (nextTask && !['pending', 'running'].includes(nextTask.status)) {
          setRunning(false)
          onComplete?.()
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
        inputValues,
        forceFallback: testRoute === 'fallback',
        targetRatio
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

  const canStart = !!editingId && !!form.name && !!form.model_call_id && !!String(form.prompt || '').trim() &&
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
      <div className="debug-fields">
        <Field label="测试能力路由"><Select value={testRoute} onChange={setTestRoute} options={form.fallback_model_call_id ? ['primary', 'fallback'] : ['primary']} labels={{ primary: '主能力策略', fallback: '兜底能力策略' }} /></Field>
        <Field label="目标比例"><Select value={targetRatio} onChange={setTargetRatio} options={form.supported_ratios?.length ? form.supported_ratios : ['1:1']} /></Field>
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
            <span>状态：{statusLabel(task.status)}</span>
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

function TemplateWorkflow({ editingId, form, completedTestCount, versions, activeStep, onStepChange, publishCheck }) {
  const inputKeys = (form.input_fields || []).map((item) => item.key).filter(Boolean)
  const steps = [
    ['basic', '1', '基础信息', !!form.name && !!form.description && !!editingId],
    ['input', '2', '用户输入', form.template_type === 'image_to_image' || (inputKeys.length > 0 && new Set(inputKeys).size === inputKeys.length)],
    ['output', '3', '输出与星光', Number(form.points_cost) >= 0 && (form.supported_ratios || []).length > 0],
    ['policy', '4', '能力策略', !!form.model_call_id && !!String(form.prompt || '').trim()],
    ['preview', '5', '展示与预览', !!form.home_banner && !!form.detail_banner && (form.placements || []).some((item) => item.zone && item.group)],
    ['test', '6', '模板测试', completedTestCount >= 5],
    ['check', '7', '发布检查', !!publishCheck?.passed],
    ['release', '8', '发布与版本', versions.length > 0]
  ]
  return <aside className="template-stepper" aria-label="模板配置步骤">{steps.map(([key, number, label, done]) => {
    const hasError = (publishCheck?.errors || []).some((item) => item.step === key)
    const state = hasError ? 'error' : activeStep === key ? 'active' : done ? 'done' : 'pending'
    return <button type="button" className={state} key={key} onClick={() => onStepChange(key)} aria-current={activeStep === key ? 'step' : undefined}>
      <span>{done && !hasError ? '✓' : number}</span><strong>{label}</strong><small>{hasError ? '有错误' : activeStep === key ? '编辑中' : done ? '已完成' : '未开始'}</small>
    </button>
  })}</aside>
}

function TemplateLivePreview({ form, images }) {
  const resolveAsset = (fileId) => {
    const asset = (images || []).find((item) => item.fileID === fileId)
    const url = asset?.temporaryUrl || asset?.tempFileURL || ''
    return /^https?:\/\//.test(url) ? url : ''
  }
  const detailImage = resolveAsset(form.detail_banner)
  return <aside className="template-preview-panel">
    <div className="editor-subhead"><strong>实时预览</strong><span>{ZONE_LABELS[form.placements?.[0]?.zone] || '玩图专区'}</span></div>
    <div className="preview-phone">
      {detailImage ? <img src={detailImage} alt="模板详情素材预览" /> : <div className="preview-placeholder">已选素材后显示详情图</div>}
      <strong>{form.name || '模板名称'}</strong>
      <small>{form.description || '模板业务说明'}</small>
      {(form.input_fields || []).slice(0, 3).map((field) => <label key={field.key || field.title}><span>{field.title || '输入项'}{field.required !== false ? ' *' : ''}</span><input disabled placeholder={field.placeholder || '请输入'} /></label>)}
      <button type="button" disabled>立即生成 · {form.points_cost || 0} 星光</button>
    </div>
  </aside>
}

function FeaturesPanel() {
  const [sort, toggleSort] = useSort('createdAt', 'desc')
  const [imageFolder, setImageFolder] = useState('')
  const [tableZone, setTableZone] = useHashParamState('zone')
  const [keyword, setKeyword] = useHashParamState('keyword')
  const [lifecycleFilter, setLifecycleFilter] = useHashParamState('lifecycle')
  const [categoryFilter, setCategoryFilter] = useHashParamState('category')
  const [tagFilter, setTagFilter] = useHashParamState('badge')
  const [modelFilter, setModelFilter] = useHashParamState('model')
  const [dateFrom, setDateFrom] = useHashParamState('dateFrom')
  const [dateTo, setDateTo] = useHashParamState('dateTo')
  const debouncedKeyword = useDebouncedValue(keyword)
  const { items, refs, loading, error, reload, pagination } = useAdminList(
    'listFeatures',
    [sort.sortBy, sort.sortOrder, imageFolder, tableZone, debouncedKeyword, lifecycleFilter, categoryFilter, tagFilter, modelFilter, dateFrom, dateTo],
    () => ({ ...sort, imageFolder, zone: tableZone, keyword: debouncedKeyword, filters: { lifecycleStatus: lifecycleFilter, categoryId: categoryFilter, tag: tagFilter, modelCallId: modelFilter, dateFrom, dateTo } })
  )
  const [form, setForm] = useState(EMPTY_FEATURE)
  const [editingId, setEditingId] = useState('')
  const [activeStep, setActiveStep] = useState('basic')
  const [publishCheck, setPublishCheck] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const savedSnapshotRef = useRef(JSON.stringify(EMPTY_FEATURE))
  const [featureMessage, setFeatureMessage] = useState('')
  const [featureError, setFeatureError] = useState('')
  const [savingDraft, setSavingDraft] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [versionNote, setVersionNote] = useState('')
  const [versions, setVersions] = useState([])
  const [testCases, setTestCases] = useState([])
  const [metaLoading, setMetaLoading] = useState(false)
  const [observation, setObservation] = useState(null)
  const [scheduleAt, setScheduleAt] = useState('')
  const [scheduledJob, setScheduledJob] = useState(null)
  const selectedModel = getSelectedModel(refs.models || [], form.model_call_id)
  const selectedFallbackModel = getSelectedModel(refs.models || [], form.fallback_model_call_id)
  const textProviderCompatible = !selectedModel || TEXT_TO_IMAGE_PROVIDERS.includes(selectedModel.provider)
  const fallbackTextProviderCompatible = !selectedFallbackModel || TEXT_TO_IMAGE_PROVIDERS.includes(selectedFallbackModel.provider)
  const showToapisSize = usesToapisProvider(selectedModel, selectedFallbackModel)
  const completedTestCount = testCases.filter((item) => ['succeeded', 'failed'].includes(item.status)).length
  const dirty = JSON.stringify(form) !== savedSnapshotRef.current

  useEffect(() => {
    const warn = (event) => {
      if (!dirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const loadTemplateMeta = async (templateId = editingId) => {
    if (!templateId) {
      setVersions([])
      setTestCases([])
      setObservation(null)
      return
    }
    setMetaLoading(true)
    try {
      const [versionResult, testResult, observationResult, scheduleResult] = await Promise.all([
        callAdmin('listTemplateVersions', { templateId, page: 1, pageSize: 50 }),
        callAdmin('listTemplateTestCases', { templateId, page: 1, pageSize: 50 }),
        callAnalytics('getTemplateObservation', { templateId }),
        callAdmin('getScheduledPublish', { templateId })
      ])
      setVersions(versionResult.data || [])
      setTestCases(testResult.data || [])
      setObservation(observationResult)
      setScheduledJob(scheduleResult.job || null)
      if (scheduleResult.job?.scheduledAt) {
        const raw = scheduleResult.job.scheduledAt.$date || scheduleResult.job.scheduledAt
        const date = new Date(raw)
        const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
        setScheduleAt(local)
      }
    } catch (err) {
      setFeatureError(err.message)
    } finally {
      setMetaLoading(false)
    }
  }

  useEffect(() => {
    loadTemplateMeta(editingId)
  }, [editingId])

  const buildFeaturePayload = (source = form) => {
    const payload = normalizeFeatureForm(source)
    const primaryModel = getSelectedModel(refs.models || [], payload.model_call_id)
    const fallbackModel = getSelectedModel(refs.models || [], payload.fallback_model_call_id)
    payload.size = usesToapisProvider(primaryModel, fallbackModel) ? normalizeToapisSize(payload.size) : ''
    return payload
  }

  const updateModelSelection = (patch = {}) => {
    const nextForm = { ...form, ...patch }
    const primaryModel = getSelectedModel(refs.models || [], nextForm.model_call_id)
    const fallbackModel = getSelectedModel(refs.models || [], nextForm.fallback_model_call_id)
    nextForm.size = usesToapisProvider(primaryModel, fallbackModel) ? normalizeToapisSize(nextForm.size) : ''
    setForm(nextForm)
  }

  const saveDraft = async () => {
    const payload = buildFeaturePayload(form)
    setSavingDraft(true)
    setFeatureError('')
    setFieldErrors({})
    setFeatureMessage('')
    try {
      const res = await callAdmin('saveFeatureDraft', editingId ? { id: editingId, data: payload } : { data: payload })
      const templateId = editingId || res.id || res._id
      if (!editingId && templateId) {
        setEditingId(templateId)
      }
      setForm(payload)
      savedSnapshotRef.current = JSON.stringify(payload)
      setLastSavedAt(new Date())
      setPublishCheck(null)
      setFeatureMessage(`草稿已保存 · 模板ID ${templateId}${res.is_unassigned ? ' · 可在“未归类”中找到' : ''}`)
      await reload()
    } catch (err) {
      setFeatureError(err.message)
      if (err.field) setFieldErrors({ [err.field]: err.message })
    } finally {
      setSavingDraft(false)
    }
  }

  const runPublishCheck = async () => {
    setFeatureError('')
    if (!editingId) {
      setActiveStep('basic')
      setFeatureError('请先保存草稿获取模板ID')
      return null
    }
    try {
      const result = await callAdmin('checkFeaturePublish', { id: editingId, data: buildFeaturePayload(form) })
      setPublishCheck(result)
      const nextErrors = Object.fromEntries((result.errors || []).filter((item) => item.field).map((item) => [item.field, item.reason]))
      setFieldErrors(nextErrors)
      setActiveStep(result.passed ? 'release' : (result.errors?.[0]?.step || 'check'))
      if (result.passed) setFeatureMessage('发布检查已通过，可以发布或设置定时发布')
      else setFeatureError(`发布检查发现 ${result.errors.length} 个问题，请按步骤修复`)
      return result
    } catch (err) {
      setFeatureError(err.message)
      return null
    }
  }

  const publish = async () => {
    const payload = buildFeaturePayload({ ...form, status: 1 })
    setPublishing(true)
    setFeatureError('')
    setFeatureMessage('')
    try {
      const check = await callAdmin('checkFeaturePublish', { id: editingId, data: payload })
      setPublishCheck(check)
      if (!check.passed) {
        setFieldErrors(Object.fromEntries((check.errors || []).filter((item) => item.field).map((item) => [item.field, item.reason])))
        setActiveStep(check.errors?.[0]?.step || 'check')
        throw new Error(`发布检查未通过：还有 ${check.errors.length} 个问题`)
      }
      const res = await callAdmin('publishFeature', { id: editingId, data: payload, versionNote })
      if (!editingId && res._id) {
        setEditingId(res._id)
      }
      const publishedForm = { ...payload, status: 1, lifecycle_status: 'published' }
      setForm(publishedForm)
      savedSnapshotRef.current = JSON.stringify(publishedForm)
      setLastSavedAt(new Date())
      setFeatureMessage(`已发布到小程序，版本 V${res.versionNumber || ''}`)
      setVersionNote('')
      await loadTemplateMeta(editingId || res._id)
      await reload()
    } catch (err) {
      setFeatureError(err.message)
      if (err.field) setFieldErrors({ [err.field]: err.message })
    } finally {
      setPublishing(false)
    }
  }

  const schedulePublish = async () => {
    setFeatureError('')
    if (!scheduleAt) return setFeatureError('请选择定时发布时间')
    try {
      const payload = buildFeaturePayload({ ...form, status: 1 })
      const check = await callAdmin('checkFeaturePublish', { id: editingId, data: payload })
      setPublishCheck(check)
      if (!check.passed) {
        setFieldErrors(Object.fromEntries((check.errors || []).filter((item) => item.field).map((item) => [item.field, item.reason])))
        setActiveStep(check.errors?.[0]?.step || 'check')
        throw new Error(`发布检查未通过：还有 ${check.errors.length} 个问题`)
      }
      const result = await callAdmin('scheduleTemplatePublish', {
        id: editingId,
        data: payload,
        versionNote,
        scheduledAt: new Date(scheduleAt).toISOString()
      })
      setScheduledJob(result)
      setFeatureMessage(`已设置定时发布：${new Date(result.scheduledAt).toLocaleString('zh-CN')}`)
    } catch (err) {
      setFeatureError(err.message)
    }
  }

  const cancelSchedule = async () => {
    if (!scheduledJob?.jobId || !await confirmAction({ title: '取消定时发布', description: '模板草稿仍会保留，只取消本次发布任务。', objectName: form.name, objectId: scheduledJob.jobId, impact: '到达原定时间后不会自动发布。', recovery: '可重新设置定时发布。', danger: false, confirmLabel: '确认取消定时发布' })) return
    await callAdmin('cancelScheduledPublish', { jobId: scheduledJob.jobId })
    setScheduledJob(null)
    setScheduleAt('')
    setFeatureMessage('定时发布已取消')
  }

  const resetForm = () => {
    const next = { ...EMPTY_FEATURE, placements: [], input_fields: [], supported_ratios: [...EMPTY_FEATURE.supported_ratios] }
    setForm(next)
    savedSnapshotRef.current = JSON.stringify(next)
    setEditingId('')
    setActiveStep('basic')
    setPublishCheck(null)
    setFieldErrors({})
    setLastSavedAt(null)
    setFeatureMessage('')
    setFeatureError('')
    setVersionNote('')
    setVersions([])
    setTestCases([])
    setObservation(null)
    setScheduleAt('')
    setScheduledJob(null)
  }

  const resetAfterDelete = async () => {
    setForm(EMPTY_FEATURE)
    setEditingId('')
    await reload()
  }

  const refreshFeaturePage = async () => {
    resetForm()
    await reload()
  }

  const edit = (item) => {
    const draftSource = item.has_draft && item.draft_data ? item.draft_data : {}
    const next = normalizeFeatureForm({ ...EMPTY_FEATURE, ...item, ...draftSource, status: item.status, lifecycle_status: item.lifecycle_status })
    setEditingId(item._id)
    setForm(next)
    savedSnapshotRef.current = JSON.stringify(next)
    setActiveStep('basic')
    setPublishCheck(null)
    setFieldErrors({})
    setLastSavedAt(item.draft_updated_at || item.updatedAt || null)
    setFeatureMessage(item.has_draft ? '正在编辑未发布草稿' : '')
    setFeatureError('')
  }

  const remove = async (id) => {
    const expectedName = items.find((item) => item._id === id)?.name || form.name
    if (!await confirmAction({ title: '删除模板', description: '删除模板及其后台配置。', objectName: expectedName, objectId: id, impact: '模板将无法继续编辑；已发布模板必须先下线。', recovery: '不可恢复，历史审计日志仍会保留。', requireText: expectedName, confirmLabel: '确认删除模板' })) return
    await callAdmin('deleteFeature', { id, confirmName: expectedName })
    await resetAfterDelete()
  }

  const offline = async () => {
    if (!editingId || !await confirmAction({ title: '下线模板', description: '小程序将不再展示该模板。', objectName: form.name, objectId: editingId, impact: '新用户无法进入模板，已有生成记录不受影响。', recovery: '可通过再次发布恢复上线。', confirmLabel: '确认下线模板' })) return
    await callAdmin('offlineTemplate', { templateId: editingId })
    setForm({ ...form, status: 0, lifecycle_status: 'offline' })
    setFeatureMessage('模板已下线')
    await reload()
  }

  const rollback = async (version) => {
    if (!await confirmAction({ title: `回滚至 V${version.versionNumber}`, description: '系统将以历史快照创建一个新的已发布版本。', objectName: form.name, objectId: editingId, impact: '当前线上配置会被替换，但版本历史仍保留。', recovery: '可再次回滚到其他历史版本。', requireText: form.name, confirmLabel: `确认回滚至 V${version.versionNumber}` })) return
    const result = await callAdmin('rollbackTemplate', {
      templateId: editingId,
      versionId: version._id,
      confirmName: form.name,
      versionNote: `回滚至 V${version.versionNumber}`
    })
    setFeatureMessage(`回滚完成，已生成 V${result.versionNumber}`)
    await Promise.all([reload(), loadTemplateMeta(editingId)])
  }

  const copyTemplateId = async (id) => {
    if (!id) return
    await navigator.clipboard.writeText(id)
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

  const updatePlacement = (index, patch) => {
    const placements = [...(form.placements || [])]
    placements[index] = { ...placements[index], ...patch }
    setForm({ ...form, placements })
  }

  const addPlacement = () => {
    setForm({
      ...form,
      placements: [...(form.placements || []), { zone: 'play', group: '' }]
    })
  }

  const removePlacement = (index) => {
    const placements = (form.placements || []).filter((_, itemIndex) => itemIndex !== index)
    setForm({ ...form, placements })
  }

  return (
    <section className="workspace">
      <Editor
        className="template-editor"
        title={editingId ? `${form.name || '未命名模板'} · ${FEATURE_STATUS_LABELS[form.lifecycle_status] || '草稿'}${form.status === 1 && dirty ? ' · 有未发布修改' : ''}` : '新建模板 · 草稿'}
        onSave={saveDraft}
        onReset={resetForm}
        actions={(
          <>
            <button type="button" className="secondary-button" onClick={refreshFeaturePage} disabled={loading}>
              <RefreshCw size={16} />
              刷新
            </button>
            <button type="button" className="secondary-button" onClick={resetForm}>清空</button>
            <button type="button" className="secondary-button" onClick={saveDraft} disabled={savingDraft || publishing}>
              {savingDraft ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
              保存草稿
            </button>
            {editingId && form.status === 1 ? <button type="button" className="danger-button" onClick={offline} disabled={savingDraft || publishing}>下线</button> : null}
            <button type="button" className="primary-button" onClick={publish} disabled={savingDraft || publishing || !editingId || completedTestCount < 5 || !versionNote.trim()}>
              {publishing ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
              发布到小程序
            </button>
          </>
        )}
      >
        <TemplateWorkflow
          editingId={editingId}
          form={form}
          completedTestCount={completedTestCount}
          versions={versions}
          activeStep={activeStep}
          publishCheck={publishCheck}
          onStepChange={(step) => {
            setActiveStep(step)
            window.requestAnimationFrame(() => document.getElementById(`template-step-${step}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
          }}
        />
        <div className="template-editor-main">
        <div className="editor-save-state form-wide" aria-live="polite">
          <span className={`status-dot ${dirty ? 'partial' : 'available'}`} />
          {savingDraft ? '保存中…' : dirty ? '有未保存修改' : lastSavedAt ? `已保存 · ${formatDate(lastSavedAt)}` : '新草稿尚未保存'}
          {editingId ? <span className="mono">模板ID：{editingId}</span> : null}
        </div>
        <Field label="名称" name="template-step-basic" error={fieldErrors.name}><TextInput value={form.name} onChange={(value) => setForm({ ...form, name: value })} /></Field>
        <Field label="模板类型" name="templateType"><Select value={form.template_type} onChange={updateTemplateType} options={['image_to_image', 'text_to_image']} labels={TEMPLATE_TYPE_LABELS} /></Field>
        <Field label="业务说明" name="description" error={fieldErrors.description}><Textarea value={form.description} onChange={(value) => setForm({ ...form, description: value })} placeholder="说明模板用途、目标用户和适用场景" /></Field>
        <div className="input-field-editor form-wide" id="template-step-preview">
          <div className="editor-subhead">
            <strong>展示位置</strong>
            <button type="button" className="secondary-button" onClick={addPlacement}><Plus size={14} />添加展示位置</button>
          </div>
          {(form.placements || []).map((placement, index) => (
            <div className="input-field-row" key={`placement_${index}`}>
              <Select value={placement.zone || 'play'} onChange={(value) => updatePlacement(index, { zone: value || 'play', group: '' })} options={ZONE_OPTIONS} labels={ZONE_LABELS} />
              <Select value={placement.group} onChange={(value) => updatePlacement(index, { group: value })} options={getGroupsForZone(refs.groups || [], placement.zone || 'play')} />
              <IconButton type="button" title="删除展示位置" onClick={() => removePlacement(index)}><Trash2 size={16} /></IconButton>
            </div>
          ))}
        </div>
        <div id="template-step-policy" className="step-anchor"><Field label="主能力策略" error={fieldErrors.model_call_id}><Select value={form.model_call_id} onChange={(value) => updateModelSelection({ model_call_id: value })} options={(refs.models || []).map((item) => item.model_call_id)} /></Field></div>
        <Field label="兜底能力策略"><Select value={form.fallback_model_call_id} onChange={(value) => updateModelSelection({ fallback_model_call_id: value })} options={(refs.models || []).map((item) => item.model_call_id)} /></Field>
        {showToapisSize ? (
          <Field label="图片比例"><Select value={normalizeToapisSize(form.size)} onChange={(value) => setForm({ ...form, size: value })} options={TOAPIS_SIZE_OPTIONS} /></Field>
        ) : null}
        <div className="input-field-editor form-wide" id="template-step-output">
          <div className="editor-subhead"><strong>网站可选比例</strong></div>
          <div className="variable-helper">
            {WEB_RATIO_OPTIONS.map((ratio) => (
              <label className="inline-check" key={ratio}>
                <input
                  name={`supportedRatio_${ratio.replace(':', '_')}`}
                  type="checkbox"
                  checked={(form.supported_ratios || []).includes(ratio)}
                  onChange={(event) => setForm({
                    ...form,
                    supported_ratios: event.target.checked
                      ? Array.from(new Set([...(form.supported_ratios || []), ratio]))
                      : (form.supported_ratios || []).filter((item) => item !== ratio)
                  })}
                />
                {ratio}
              </label>
            ))}
          </div>
        </div>
        {form.template_type === 'text_to_image' && selectedFallbackModel && !fallbackTextProviderCompatible ? (
          <div className="form-notice warning">Fallback provider {selectedFallbackModel.provider} is not compatible with text-to-image. Use volcengine, supersolo, supersolo_async, or toapis.</div>
        ) : null}
        {form.template_type === 'text_to_image' && selectedModel && !textProviderCompatible ? (
          <div className="form-notice warning">当前模型 provider 为 {selectedModel.provider}，不兼容文生图。请切换为 volcengine、supersolo、supersolo_async 或 toapis。</div>
        ) : null}
        <Field label="素材目录">
          <select value={imageFolder} onChange={(event) => setImageFolder(event.target.value)}>
            <option value="">全部目录</option>
            {(refs.folders || []).map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </Field>
        <Field label="首页素材"><ImageAssetSelect value={form.home_banner} onChange={(value) => setForm({ ...form, home_banner: value })} images={refs.images || []} /></Field>
        <Field label="详情页素材"><ImageAssetSelect value={form.detail_banner} onChange={(value) => setForm({ ...form, detail_banner: value })} images={refs.images || []} /></Field>
        <Field label="上传数"><NumberInput value={form.upload_count} disabled={form.template_type === 'text_to_image'} onChange={(value) => setForm({ ...form, upload_count: value })} /></Field>
        <Field label="星光消耗"><NumberInput value={form.points_cost} onChange={(value) => setForm({ ...form, points_cost: value })} /></Field>
        <Field label="高清打印">
          <label className="inline-check">
            <input name="enableUpscalePrint" type="checkbox" checked={!!form.enable_upscale_print} onChange={(event) => setForm({ ...form, enable_upscale_print: event.target.checked })} />
            开启保存时生成高清可打印版
          </label>
        </Field>
        <Field label="生命周期"><TextInput value={FEATURE_STATUS_LABELS[form.lifecycle_status] || '草稿'} onChange={() => {}} disabled /></Field>
        <Field label="排序"><NumberInput value={form.sort} onChange={(value) => setForm({ ...form, sort: value })} /></Field>
        <Field label="推荐标识"><Select value={form.tag} onChange={(value) => setForm({ ...form, tag: value })} options={['normal', 'new', 'hot']} labels={{ normal: '无', new: '新品', hot: '热门' }} /></Field>
        <div id="template-step-input" className={form.template_type === 'text_to_image' ? 'input-field-editor' : 'form-wide step-anchor-only'}>
        {form.template_type === 'text_to_image' ? (
          <>
            <div className="editor-subhead">
              <strong>动态字段</strong>
              <button type="button" className="secondary-button" onClick={addInputField}><Plus size={14} />添加字段</button>
            </div>
            {(form.input_fields || []).map((field, index) => (
              <div className="input-field-row" key={`input_field_${index}`}>
                <TextInput placeholder="key，如 category" value={field.key} onChange={(value) => updateInputField(index, { key: value })} />
                <TextInput placeholder="标题，如 品类" value={field.title} onChange={(value) => updateInputField(index, { title: value })} />
                <TextInput placeholder="占位文案" value={field.placeholder} onChange={(value) => updateInputField(index, { placeholder: value })} />
                <NumberInput placeholder="字数" value={field.maxLength} onChange={(value) => updateInputField(index, { maxLength: value })} />
                <label className="inline-check">
                  <input name={`inputFieldRequired_${index}`} type="checkbox" checked={field.required !== false} onChange={(event) => updateInputField(index, { required: event.target.checked })} />
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
          </>
        ) : <p className="muted">当前模板使用图片上传输入，可在“上传数”中配置用户所需素材数量。</p>}
        </div>
        <Field label="提示词" error={fieldErrors.prompt}><Textarea value={form.prompt} onChange={(value) => setForm({ ...form, prompt: value })} /></Field>
        <Field label="版本说明"><TextInput value={versionNote} onChange={setVersionNote} placeholder="发布必填，说明本次变更" maxLength={200} /></Field>
        <Field label="定时发布"><TextInput type="datetime-local" value={scheduleAt} onChange={setScheduleAt} /></Field>
        <div className="toolbar form-wide"><button type="button" className="secondary-button" onClick={schedulePublish} disabled={!editingId || completedTestCount < 5 || !versionNote.trim() || !scheduleAt || !!scheduledJob}>创建定时发布</button>{scheduledJob ? <button type="button" className="danger-button" onClick={cancelSchedule}>取消定时发布</button> : null}</div>
        <div className="publish-check-panel form-wide" id="template-step-check">
          <div className="editor-subhead"><strong>发布检查</strong><button type="button" className="secondary-button" onClick={runPublishCheck}>重新检查</button></div>
          <p>已完成 {completedTestCount}/5 组测试。{!editingId ? '请先保存草稿获取模板ID。' : completedTestCount < 5 ? '继续运行模板测试后再发布。' : '测试数量门禁已通过。'}</p>
          {publishCheck?.errors?.length ? <ul className="check-list error-list">{publishCheck.errors.map((item, index) => <li key={`${item.field}_${index}`}><strong>{item.reason}</strong><span>{item.suggestion}</span></li>)}</ul> : null}
          {publishCheck?.warnings?.length ? <ul className="check-list warning-list">{publishCheck.warnings.map((item, index) => <li key={`${item.field}_${index}`}><strong>{item.reason}</strong><span>{item.suggestion}</span></li>)}</ul> : null}
          {publishCheck?.passed ? <p className="success-text">所有发布检查已通过</p> : null}
        </div>
        <div id="template-step-test" className="form-wide"><FeatureDebugPanel form={form} editingId={editingId} onComplete={() => loadTemplateMeta(editingId)} /></div>
        {testCases.length ? <div className="test-case-list form-wide"><div className="editor-subhead"><strong>最近测试记录</strong><span>共 {testCases.length} 组</span></div>{testCases.slice(0, 8).map((item) => <div className="test-case-row" key={item._id}><span>{item.requestedModelRole === 'fallback' ? '兜底策略' : '主策略'} · {item.targetRatio || '默认比例'}</span><span className={`status-chip ${item.status}`}>{statusLabel(item.status)}</span><span>{item.durationMs ? `${Math.round(item.durationMs / 1000)}秒` : '—'}</span><span className="error-cell">{item.errorMessage || '—'}</span></div>)}</div> : null}
        {editingId ? (
          <div className="version-panel form-wide" id="template-step-release">
            <div className="editor-subhead"><strong>版本历史</strong>{metaLoading ? <Loader2 className="spin" size={16} /> : null}</div>
            {versions.length ? versions.map((version) => (
              <div className="version-row" key={version._id}>
                <span><strong>V{version.versionNumber}</strong> {version.versionNote || '无说明'}</span>
                <span>{formatDate(version.publishedAt || version.createdAt)}</span>
                <button type="button" className="secondary-button" onClick={() => rollback(version)}>回滚到此版本</button>
              </div>
            )) : <p className="muted">尚无已发布版本</p>}
          </div>
        ) : null}
        {editingId && observation ? <div className="observation-panel form-wide"><div className="editor-subhead"><strong>上线后 24 小时观察</strong><span>{formatDate(observation.updatedAt)}</span></div><div className="observation-metrics"><span>详情访问 <strong>{observation.detailViews}</strong></span><span>立即生成 <strong>{observation.generateClicks}</strong></span><span>使用率 <strong>{observation.usageRate == null ? '—' : `${(observation.usageRate * 100).toFixed(1)}%`}</strong></span><span>生图成功率 <strong>{observation.generationSuccessRate == null ? '—' : `${(observation.generationSuccessRate * 100).toFixed(1)}%`}</strong></span><span>异常任务 <strong>{observation.failed}</strong></span></div></div> : null}
        {featureError ? <p className="error-text form-wide">{featureError}</p> : null}
        {featureMessage ? <p className="success-text form-wide">{featureMessage}</p> : null}
        </div>
        <TemplateLivePreview form={form} images={refs.images || []} />
      </Editor>
      <div className="table-tabs" role="tablist" aria-label="模板生命周期">
        {[
          ['', '全部模板'], ['draft', '草稿'], ['testing', '测试中'], ['ready', '可发布'],
          ['published', '已发布'], ['offline', '已下线'], ['unassigned', '未归类']
        ].map(([value, label]) => (
          <button
            key={value || 'all'}
            type="button"
            role="tab"
            aria-selected={lifecycleFilter === value}
            className={lifecycleFilter === value ? 'active' : ''}
            onClick={() => setLifecycleFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <FilterBar
        keyword={keyword}
        onKeywordChange={setKeyword}
        placeholder="搜索模板名称或模板ID"
        onReset={() => { setKeyword(''); setTableZone(''); setCategoryFilter(''); setTagFilter(''); setModelFilter(''); setLifecycleFilter(''); setDateFrom(''); setDateTo('') }}
      >
        <label>展示专区<select name="zoneFilter" value={tableZone} onChange={(event) => setTableZone(event.target.value)}><option value="">全部专区</option>{ZONE_OPTIONS.map((zone) => <option key={zone} value={zone}>{ZONE_LABELS[zone]}</option>)}</select></label>
        <label>分类<select name="categoryFilter" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">全部分类</option>{[...new Set((refs.groups || []).map((item) => item.name).filter(Boolean))].map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
        <label>推荐标识<select name="tagFilter" value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}><option value="">全部</option><option value="normal">无</option><option value="new">新品</option><option value="hot">热门</option></select></label>
        <label>能力策略<select name="modelFilter" value={modelFilter} onChange={(event) => setModelFilter(event.target.value)}><option value="">全部策略</option>{(refs.models || []).map((item) => <option key={item.model_call_id} value={item.model_call_id}>{item.name || item.model_call_id}</option>)}</select></label>
        <label>更新开始<input name="templateDateFrom" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
        <label>更新结束<input name="templateDateTo" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
      </FilterBar>
      <DataTable loading={loading} error={error} onRefresh={reload} pagination={pagination}>
        <thead><tr>
          <th>模板ID</th>
          <SortableTh field="name" sort={sort} onSort={toggleSort}>名称</SortableTh>
          <th>展示位置</th>
          <SortableTh field="model_call_id" sort={sort} onSort={toggleSort}>主能力策略</SortableTh>
          <th>兜底能力策略</th>
          <SortableTh field="points_cost" sort={sort} onSort={toggleSort}>消耗</SortableTh>
          <SortableTh field="lifecycle_status" sort={sort} onSort={toggleSort}>生命周期</SortableTh>
          <th>未发布修改</th>
          <SortableTh field="sort" sort={sort} onSort={toggleSort}>排序</SortableTh>
          <SortableTh field="createdAt" sort={sort} onSort={toggleSort}>创建时间</SortableTh>
          <th></th>
        </tr></thead>
        <tbody>{items.map((item) => (
          <tr key={item._id}>
            <td className="mono id-cell">
              <span title={item._id}>{item._id}</span>
              <IconButton title="复制模板ID" onClick={() => copyTemplateId(item._id)}><Copy size={16} /></IconButton>
            </td>
            <td>{item.name}</td><td>{item.is_unassigned ? <span className="sample-badge">未归类</span> : formatPlacements(item.placements, item.group)}</td><td>{item.model_call_id || '未配置'}</td><td>{item.fallback_model_call_id || '-'}</td><td>{item.points_cost}</td><td><span className={`status-chip ${item.lifecycle_status}`}>{FEATURE_STATUS_LABELS[item.lifecycle_status] || statusLabel(item.lifecycle_status)}</span></td><td>{item.has_unpublished_changes ? '有未发布修改' : '-'}</td><td>{item.sort}</td><td>{formatDate(item.createdAt)}</td>
            <td className="row-actions"><button onClick={() => edit(item)}>编辑</button><IconButton title="删除" onClick={() => remove(item._id)}><Trash2 size={16} /></IconButton></td>
          </tr>
        ))}</tbody>
      </DataTable>
    </section>
  )
}

function UsersPanel({ canAdjust = false, canSync = false }) {
  const [sort, toggleSort] = useSort('updatedAt', 'desc')
  const [keyword, setKeyword] = useHashParamState('keyword')
  const [minPoints, setMinPoints] = useHashParamState('minPoints')
  const [maxPoints, setMaxPoints] = useHashParamState('maxPoints')
  const [dateFrom, setDateFrom] = useHashParamState('dateFrom')
  const [dateTo, setDateTo] = useHashParamState('dateTo')
  const [revealedIds, setRevealedIds] = useState({})
  const debouncedKeyword = useDebouncedValue(keyword)
  const { items, loading, error, reload, pagination } = useAdminList('listUsers', [sort.sortBy, sort.sortOrder, debouncedKeyword, minPoints, maxPoints, dateFrom, dateTo], () => ({
    ...sort,
    keyword: debouncedKeyword,
    filters: {
      ...(minPoints !== '' ? { minPoints } : {}),
      ...(maxPoints !== '' ? { maxPoints } : {}),
      dateFrom,
      dateTo
    }
  }))
  const [openid, setOpenid] = useState('')
  const [mode, setMode] = useState('set')
  const [value, setValue] = useState(0)
  const [reason, setReason] = useState('后台调整星光')
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState(null)

  const adjust = async () => {
    if (!openid) throw new Error('请填写用户 OpenID')
    if (!reason.trim()) throw new Error('请填写调整原因')
    if (!await confirmAction({ title: '调整用户星光', description: `${mode === 'set' ? '将星光设置为' : '按增量调整'} ${value}`, objectId: maskIdentifier(openid), impact: '会立即改变用户可用星光，并写入星光流水。', recovery: '可通过反向调整修正，但原操作会永久保留在审计中。', confirmLabel: '确认调整星光' })) return
    await callAdmin('adjustUserPoints', { openid, mode, value, reason })
    setOpenid('')
    setValue(0)
    await reload()
  }

  const revealOpenid = async (item) => {
    if (revealedIds[item._id]) {
      setRevealedIds((current) => ({ ...current, [item._id]: false }))
      return
    }
    const result = await callAdmin('revealSensitiveValue', { type: 'user_openid', recordId: item._id, reason: '用户管理列表查看' })
    setRevealedIds((current) => ({ ...current, [item._id]: result.value || item._id }))
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
      {canAdjust ? <Editor title="调整用户星光" onSave={adjust} onReset={() => { setOpenid(''); setValue(0) }}>
        <Field label="OpenID"><TextInput value={openid} onChange={setOpenid} /></Field>
        <Field label="模式"><Select value={mode} onChange={setMode} options={['set', 'delta']} labels={{ set: '设置为', delta: '增减' }} /></Field>
        <Field label="数值"><NumberInput value={value} onChange={setValue} /></Field>
        <Field label="原因"><TextInput value={reason} onChange={setReason} /></Field>
      </Editor> : null}
      {syncResult ? (
        <p className="muted">
          已扫描 {syncResult.scanned || 0} 个 OpenID，新增 {syncResult.created || 0} 条，已存在 {syncResult.existing || 0} 条，修复时间 {syncResult.normalizedTimestamps || 0} 条，失败 {((syncResult.failed || []).length + (syncResult.timestampFailed || []).length)} 条。
        </p>
      ) : null}
      <FilterBar keyword={keyword} onKeywordChange={setKeyword} placeholder="输入完整 OpenID 精确查询" onReset={() => { setKeyword(''); setMinPoints(''); setMaxPoints(''); setDateFrom(''); setDateTo('') }}>
        <label>最低星光<input name="minPoints" type="number" min="0" value={minPoints} onChange={(event) => setMinPoints(event.target.value)} /></label>
        <label>最高星光<input name="maxPoints" type="number" min="0" value={maxPoints} onChange={(event) => setMaxPoints(event.target.value)} /></label>
        <label>更新开始<input name="userDateFrom" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
        <label>更新结束<input name="userDateTo" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
      </FilterBar>
      <DataTable
        loading={loading}
        error={error}
        onRefresh={reload}
        pagination={pagination}
        actions={canSync ? (
          <button className="secondary-button" onClick={syncUsers} disabled={syncing}>
            {syncing ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
            同步用户
          </button>
        ) : null}
      >
        <thead><tr>
          <th>OpenID</th>
          <SortableTh field="points" sort={sort} onSort={toggleSort}>星光</SortableTh>
          <th>生图次数</th>
          <th>最近原因</th>
          <SortableTh field="createdAt" sort={sort} onSort={toggleSort}>创建时间</SortableTh>
          <SortableTh field="updatedAt" sort={sort} onSort={toggleSort}>更新时间</SortableTh>
          <th></th>
        </tr></thead>
        <tbody>{items.map((item) => (
          <tr key={item._id}>
            <td className="mono sensitive-cell"><span>{revealedIds[item._id] || item.maskedOpenid || maskIdentifier(item._id)}</span><button type="button" className="text-button" onClick={() => revealOpenid(item)}>{revealedIds[item._id] ? '隐藏' : '查看'}</button></td><td>{item.points}</td><td>{Number(item.successfulGenerationCount || 0).toLocaleString('zh-CN')}</td><td>{item.lastReasonLabel || item.lastReason || '-'}</td><td>{formatDate(item.createdAt)}</td><td>{formatDate(item.updatedAt)}</td>
            <td>{canAdjust ? <button onClick={() => setOpenid(item._id)}>调整</button> : '—'}</td>
          </tr>
        ))}</tbody>
      </DataTable>
    </section>
  )
}

function ImageAssetSelect({ value, onChange, images, ...props }) {
  const hasCurrent = value && !(images || []).some((item) => item.fileID === value)
  return (
    <select value={value ?? ''} onChange={(event) => onChange(event.target.value)} {...props}>
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

function FolderSelect({ value, onChange, folders, ...props }) {
  const options = [...new Set([value, ...(folders || [])].filter(Boolean))].sort()
  return (
    <select value={value ?? ''} onChange={(event) => onChange(event.target.value)} {...props}>
      <option value="">请选择目录</option>
      {options.map((item) => <option key={item} value={item}>{item}</option>)}
    </select>
  )
}

function SettingsPanel({ status, onPasswordChanged }) {
  const [keyword, setKeyword] = useHashParamState('keyword')
  const [roleFilter, setRoleFilter] = useHashParamState('role')
  const [statusFilter, setStatusFilter] = useHashParamState('status')
  const [dateFrom, setDateFrom] = useHashParamState('dateFrom')
  const [dateTo, setDateTo] = useHashParamState('dateTo')
  const debouncedKeyword = useDebouncedValue(keyword)
  const { items, loading, error, reload, pagination } = useAdminList('listAdmins', [debouncedKeyword, roleFilter, statusFilter, dateFrom, dateTo], () => ({ keyword: debouncedKeyword, filters: { role: roleFilter, status: statusFilter === '' ? '' : Number(statusFilter), dateField: 'createdAt', dateFrom, dateTo } }))
  const [form, setForm] = useState(EMPTY_ADMIN)
  const [editingId, setEditingId] = useState('')
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordMessage, setPasswordMessage] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [temporaryCredential, setTemporaryCredential] = useState(null)

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
    const name = item.displayName || item.username || item.uid
    if (!await confirmAction({ title: '删除管理员', description: '该账号将立即失去后台访问权限。', objectName: name, objectId: item.uid, impact: '不会删除认证账号，但会移出后台白名单。', recovery: '可重新添加管理员权限。', requireText: name, confirmLabel: '确认删除管理员' })) return
    await callAdmin('deleteAdmin', { id: item._id })
    await reload()
  }

  const resetPassword = async (item) => {
    const name = item.displayName || item.username || item.uid
    if (!await confirmAction({ title: '重置管理员密码', description: '系统将生成一次性临时密码。', objectName: name, objectId: item.uid, impact: '旧密码立即失效；该账号登录后只能先修改密码。', recovery: '临时密码30分钟内有效，过期后需重新重置。', requireText: name, confirmLabel: '确认重置密码' })) return
    const result = await callAdmin('resetAdminPassword', { id: item._id, adminName: name, reason: '管理员无法使用原密码登录' })
    setTemporaryCredential({ name, password: result.temporaryPassword, expiresAt: result.expiresAt })
    await reload()
  }

  const changePassword = async (event) => {
    event.preventDefault()
    setPasswordSaving(true)
    setPasswordMessage('')
    setPasswordError('')
    try {
      if (newPassword !== confirmPassword) throw new Error('两次输入的新密码不一致')
      if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,64}$/.test(newPassword)) throw new Error('新密码需为8—64位，并包含大小写字母、数字和特殊字符')
      const { error: resetError } = await auth.resetPasswordForOld({
        old_password: oldPassword,
        new_password: newPassword
      })
      if (resetError) throw new Error(resetError.message || '密码修改失败')
      if (status?.password_reset_required) await callAdmin('completePasswordReset')
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
          <Field label="旧密码"><TextInput value={oldPassword} onChange={setOldPassword} type="password" minLength={8} autoComplete="current-password" required /></Field>
          <Field label="新密码"><TextInput value={newPassword} onChange={setNewPassword} type="password" minLength={8} autoComplete="new-password" required /></Field>
          <Field label="确认新密码"><TextInput value={confirmPassword} onChange={setConfirmPassword} type="password" minLength={8} autoComplete="new-password" required /></Field>
        </div>
        <p className="muted">密码需为8—64位，并同时包含大小写字母、数字和特殊字符。</p>
        {passwordError ? <p className="error-text">{passwordError}</p> : null}
        {passwordMessage ? <p className="success-text">{passwordMessage}</p> : null}
      </form>

      {temporaryCredential ? <section className="temporary-password-panel" aria-live="polite">
        <div><strong>{temporaryCredential.name} 的临时密码</strong><p>仅展示一次，请通过安全渠道发送。有效期至 {formatDate(temporaryCredential.expiresAt)}。</p></div>
        <code>{temporaryCredential.password}</code>
        <button type="button" className="secondary-button" onClick={() => navigator.clipboard.writeText(temporaryCredential.password)}><Copy size={15} />复制临时密码</button>
        <button type="button" className="text-button" onClick={() => setTemporaryCredential(null)}>我已妥善保存</button>
      </section> : null}

      <Editor title={editingId ? '编辑管理员账号' : '新增管理员账号'} onSave={saveAdmin} onReset={resetAdminForm}>
        <Field label="UID"><TextInput value={form.uid} onChange={(value) => setForm({ ...form, uid: value })} /></Field>
        <Field label="OpenID"><TextInput value={form.openid} onChange={(value) => setForm({ ...form, openid: value })} /></Field>
        <Field label="账号名"><TextInput value={form.username} onChange={(value) => setForm({ ...form, username: value })} /></Field>
        <Field label="显示名"><TextInput value={form.displayName} onChange={(value) => setForm({ ...form, displayName: value })} /></Field>
        <Field label="角色"><Select value={form.role} onChange={(value) => setForm({ ...form, role: value })} options={['super_admin', 'admin', 'template_editor', 'operator', 'finance', 'readonly_analyst']} labels={{ super_admin: '超级管理员', admin: '管理员', template_editor: '模板编辑', operator: '运营专员', finance: '财务专员', readonly_analyst: '数据分析（只读）' }} /></Field>
        <Field label="状态"><Select value={form.status} onChange={(value) => setForm({ ...form, status: Number(value) })} options={[1, 0]} labels={{ 1: '启用', 0: '停用' }} /></Field>
      </Editor>

      <FilterBar keyword={keyword} onKeywordChange={setKeyword} placeholder="搜索管理员名称、账号或UID" onReset={() => { setKeyword(''); setRoleFilter(''); setStatusFilter(''); setDateFrom(''); setDateTo('') }}>
        <label>角色<select name="adminRoleFilter" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}><option value="">全部角色</option>{['super_admin', 'admin', 'template_editor', 'operator', 'finance', 'readonly_analyst'].map((value) => <option key={value} value={value}>{roleLabel(value)}</option>)}</select></label>
        <label>状态<select name="adminStatusFilter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">全部状态</option><option value="1">启用</option><option value="0">停用</option></select></label>
        <label>开始日期<input name="adminDateFrom" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
        <label>结束日期<input name="adminDateTo" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
      </FilterBar>
      <DataTable loading={loading} error={error} onRefresh={reload} pagination={pagination}>
        <thead><tr><th>UID</th><th>账号名</th><th>显示名</th><th>角色</th><th>状态</th><th>创建时间</th><th>更新时间</th><th></th></tr></thead>
        <tbody>{items.map((item) => {
          const isSelf = item.uid === status?.caller?.uid
          return (
            <tr key={item._id}>
              <td className="mono">{maskIdentifier(item.uid)}</td><td>{item.username || '-'}</td><td>{item.displayName || '-'}</td><td>{roleLabel(item.role)}</td><td>{item.status === 1 ? '启用' : '停用'}{item.passwordResetRequired ? ' · 待修改密码' : ''}</td><td>{formatDate(item.createdAt)}</td><td>{formatDate(item.updatedAt)}</td>
              <td className="row-actions">
                <button onClick={() => editAdmin(item)}>编辑</button>
                {!isSelf ? <button type="button" onClick={() => resetPassword(item)}>重置密码</button> : null}
                <IconButton title={isSelf ? '不能删除当前账号' : '删除'} onClick={() => removeAdmin(item)} disabled={isSelf}><Trash2 size={16} /></IconButton>
              </td>
            </tr>
          )
        })}</tbody>
      </DataTable>
    </section>
  )
}

function Select({ value, onChange, options, labels = {}, ...props }) {
  return (
    <select value={value ?? ''} onChange={(event) => onChange(event.target.value)} {...props}>
      <option value="">请选择</option>
      {options.map((option) => <option key={option} value={option}>{labels[option] || option}</option>)}
    </select>
  )
}

function Editor({ title, children, onSave, onReset, actions = null, className = '' }) {
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
    <form className={`editor ${className}`} onSubmit={submit}>
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
        {loading ? <div className="table-skeleton" aria-live="polite"><Loader2 className="spin" size={20} />正在加载数据</div> : error ? null : pagination?.total === 0 ? <div className="analytics-empty">暂无数据或没有符合当前筛选条件的结果</div> : <table>{children}</table>}
      </div>
      {pagination && !loading && !error ? (
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
            <label className="page-jump"><span className="sr-only">跳转页码</span><input aria-label="跳转页码" type="number" min="1" max={totalPages} value={pagination.page} onChange={(event) => pagination.setPage(Math.min(Math.max(Number(event.target.value) || 1, 1), totalPages))} /></label>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ToastHost() {
  const [toast, setToast] = useState(null)
  useEffect(() => {
    let timer = null
    const show = (event) => {
      setToast(event.detail)
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => setToast(null), 3600)
    }
    window.addEventListener('admin-toast', show)
    const clear = () => setToast(null)
    window.addEventListener('hashchange', clear)
    return () => {
      window.removeEventListener('admin-toast', show)
      window.removeEventListener('hashchange', clear)
      if (timer) window.clearTimeout(timer)
    }
  }, [])
  return toast ? <div className={`global-toast ${toast.type || 'success'}`} role="status">{toast.message}</div> : null
}

function ForcedPasswordView({ status, onSignOut }) {
  const [temporaryPassword, setTemporaryPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const expired = status?.temporary_password_expires_at && new Date(status.temporary_password_expires_at).getTime() < Date.now()
  const submit = async (event) => {
    event.preventDefault()
    setSaving(true); setError('')
    try {
      if (expired) throw new Error('临时密码已过期，请联系超级管理员重新重置')
      if (newPassword !== confirmPassword) throw new Error('两次输入的新密码不一致')
      if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,64}$/.test(newPassword)) throw new Error('新密码需为8—64位，并包含大小写字母、数字和特殊字符')
      const { error: resetError } = await auth.resetPasswordForOld({ old_password: temporaryPassword, new_password: newPassword })
      if (resetError) throw new Error(resetError.message || '密码修改失败')
      await callAdmin('completePasswordReset')
      await onSignOut()
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }
  return <main className="login-shell"><form className="login-panel forced-password-panel" onSubmit={submit}>
    <ShieldCheck size={30} /><h1>首次登录需要修改密码</h1>
    <p className="muted">账号：{status?.display_name || '管理员'} · {status?.role_label || ''}</p>
    {expired ? <p className="error-text">临时密码已过期，请联系超级管理员重新生成。</p> : <p>临时密码有效期至 {formatDate(status?.temporary_password_expires_at)}。修改完成前无法进入后台其他模块。</p>}
    <Field label="临时密码"><TextInput type="password" value={temporaryPassword} onChange={setTemporaryPassword} autoComplete="current-password" required /></Field>
    <Field label="新密码"><TextInput type="password" value={newPassword} onChange={setNewPassword} autoComplete="new-password" required /></Field>
    <Field label="确认新密码"><TextInput type="password" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" required /></Field>
    {error ? <p className="error-text">{error}</p> : null}
    <button className="primary-button" disabled={saving || expired}>{saving ? <Loader2 className="spin" size={16} /> : <Save size={16} />}修改密码并重新登录</button>
    <button type="button" className="text-button" onClick={onSignOut}>退出登录</button>
  </form></main>
}

function Dashboard({ status, onSignOut }) {
  const [tab, setTab] = useState(tabFromLocation)
  const role = status?.admin?.role || 'admin'
  const allowedKeys = ROLE_TAB_KEYS[role] || TABS.map((item) => item.key)
  const visibleGroups = NAV_GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => allowedKeys.includes(item.key)) })).filter((group) => group.items.length)
  const activeItem = useMemo(() => TABS.find((item) => item.key === tab && allowedKeys.includes(item.key)) || TABS[0], [tab, role])
  const ActiveIcon = activeItem.icon

  useEffect(() => {
    const handleHashChange = () => setTab(tabFromLocation())
    window.addEventListener('hashchange', handleHashChange)
    if (!window.location.hash) window.history.replaceState(null, '', '#/overview')
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  useEffect(() => {
    if (!allowedKeys.includes(tab)) window.location.hash = '/overview'
  }, [tab, role])

  const navigate = (item) => {
    if (window.location.hash === `#${item.path}`) setTab(item.key)
    else window.location.hash = item.path
  }

  if (status?.password_reset_required) return <ForcedPasswordView status={status} onSignOut={onSignOut} />

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><Sparkles size={22} /><span>AI 造梦馆运营后台</span></div>
        <nav>{visibleGroups.map((group) => (
          <div className="nav-group" key={group.label}>
            <span className="nav-group-label">{group.label}</span>
            {group.items.map((item) => {
              const TabIcon = item.icon
              return <button key={item.key} className={tab === item.key ? 'active' : ''} onClick={() => navigate(item)}><TabIcon size={18} />{item.label}</button>
            })}
          </div>
        ))}</nav>
        <button className="signout-button" onClick={onSignOut}><LogOut size={16} />退出</button>
      </aside>
      <section className="main-area">
        <header className="topbar">
          <div><ActiveIcon size={22} /><h1>{activeItem.label}</h1></div>
          <div className="admin-identity"><strong>{status?.display_name || status?.admin?.displayName || '管理员'}</strong><span>{status?.role_label || roleLabel(role)}</span></div>
        </header>
        {tab === 'overview' ? <DashboardPanel /> : null}
        {tab === 'templates' ? <TemplatesV22Panel /> : null}
        {tab === 'placements' ? <RecommendationV22Panel /> : null}
        {tab === 'categories' ? <GroupsPanel /> : null}
        {tab === 'assets' ? <ImagesV22Panel /> : null}
        {tab === 'jobs' ? <GenerationJobsPanel /> : null}
        {tab === 'feedback' ? <FeedbackPanel /> : null}
        {tab === 'orders' ? <OrdersPanel /> : null}
        {tab === 'models' ? <ModelsPanel /> : null}
        {tab === 'audit' ? <AuditLogsPanel /> : null}
        {tab === 'system_config' ? <SystemConfigPanel /> : null}
        {tab === 'users' ? <UsersPanel canAdjust={['super_admin', 'admin', 'finance'].includes(role)} canSync={['super_admin', 'admin'].includes(role)} /> : null}
        {tab === 'settings' ? <SettingsPanel status={status} onPasswordChanged={onSignOut} /> : null}
      </section>
      <ConfirmDialogHost />
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

createRoot(document.getElementById('root')).render(<><App /><ToastHost /></>)
