import React, { useEffect, useRef, useState } from 'react'
import { Loader2, RefreshCw, RotateCcw } from 'lucide-react'
import { callAdmin } from '../cloudbase'
import { FilterBar, StandardPager, TableState, confirmAction, maskIdentifier, roleLabel, statusLabel, useDebouncedValue, useHashParamState } from './ui'

const LEGACY_ACTION_LABELS = {
  saveFeatureDraft: '保存模板草稿', publishFeature: '发布模板', offlineFeature: '下线模板',
  rollbackTemplate: '回滚模板版本', deleteFeature: '删除模板', adjustUserPoints: '调整用户星光',
  createAdmin: '新增管理员', updateAdmin: '修改管理员', deleteAdmin: '删除管理员',
  resetAdminPassword: '重置管理员密码', revealSensitiveValue: '查看敏感信息', retryGenerationJob: '重试生成任务'
}

function formatDate(value) {
  if (!value) return '—'
  const raw = value.$date || value.iso || value
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false })
}

function useList(action, { keyword = '', filters = {}, sortBy = 'createdAt', sortOrder = 'desc' } = {}) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pageValue, setPageValue] = useHashParamState('page', '1')
  const [pageSizeValue, setPageSizeValue] = useHashParamState('pageSize', '20')
  const page = Math.max(Number(pageValue) || 1, 1)
  const pageSize = [20, 50, 100].includes(Number(pageSizeValue)) ? Number(pageSizeValue) : 20
  const [total, setTotal] = useState(0)
  const debouncedKeyword = useDebouncedValue(keyword)
  const stableFilters = JSON.stringify(filters)
  const filterReadyRef = useRef(false)
  const load = async () => {
    setLoading(true); setError('')
    try {
      const result = await callAdmin(action, { page, pageSize, keyword: debouncedKeyword, filters, sortBy, sortOrder })
      setItems(result.data || []); setTotal(result.total || 0)
    } catch (err) { setError(err.message) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [action, page, pageSize, debouncedKeyword, stableFilters, sortBy, sortOrder])
  const setPage = (value) => setPageValue(String(value))
  useEffect(() => {
    if (!filterReadyRef.current) { filterReadyRef.current = true; return }
    setPageValue('1')
  }, [debouncedKeyword, stableFilters])
  const setPageSize = (value) => { setPageSizeValue(String(value)); setPageValue('1') }
  return { items, loading, error, page, pageSize, total, setPage, setPageSize, reload: load, filtered: !!debouncedKeyword || Object.values(filters).some(Boolean) }
}

function PanelShell({ title, subtitle, list, filters, columns, children }) {
  return <section className="workspace operations-page">
    <div className="dashboard-toolbar"><div><h2>{title}</h2><p>{subtitle}</p></div><button type="button" className="secondary-button" onClick={list.reload}><RefreshCw size={15} />刷新</button></div>
    {filters}
    <div className="table-wrap operations-table"><table>
      {children}
      <TableState loading={list.loading} error={list.error} empty={!list.items.length} filtered={list.filtered} colSpan={columns} />
    </table></div>
    {!list.loading && !list.error ? <StandardPager {...list} /> : null}
  </section>
}

export function GenerationJobsPanel() {
  const [keyword, setKeyword] = useHashParamState('keyword')
  const [status, setStatus] = useHashParamState('status')
  const [provider, setProvider] = useHashParamState('provider')
  const [dateFrom, setDateFrom] = useHashParamState('dateFrom')
  const [dateTo, setDateTo] = useHashParamState('dateTo')
  const list = useList('listGenerationJobs', { keyword, filters: { status, provider, dateField: 'createdAt', dateFrom, dateTo } })
  const retry = async (item) => {
    if (!await confirmAction({ title: '重试生成任务', description: '将重新提交失败任务，可能产生新的服务商成本。', objectName: item.featureNameSnapshot || item.featureId, objectId: item._id, impact: '原失败记录保留，任务状态将重置为等待中。', recovery: '可继续在任务列表监控结果。', danger: false, confirmLabel: '确认重试任务' })) return
    await callAdmin('retryGenerationJob', { taskId: item._id }); await list.reload()
  }
  const filters = <FilterBar keyword={keyword} onKeywordChange={setKeyword} placeholder="搜索任务ID、模板、用户或服务商" onReset={() => { setKeyword(''); setStatus(''); setProvider(''); setDateFrom(''); setDateTo('') }}>
    <label>状态<select name="jobStatus" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option>{['pending', 'running', 'succeeded', 'failed'].map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></label>
    <label>服务商<input name="provider" value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="精确筛选" /></label>
    <label>开始日期<input name="jobDateFrom" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
    <label>结束日期<input name="jobDateTo" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
  </FilterBar>
  return <PanelShell title="生成任务" subtitle="定位失败任务并发起有审计记录的安全重试。" list={list} filters={filters} columns={9}>
    <thead><tr><th>任务ID</th><th>模板</th><th>用户</th><th>状态</th><th>服务商</th><th>耗时</th><th>错误</th><th>创建时间</th><th /></tr></thead>
    {!list.loading && !list.error && list.items.length ? <tbody>{list.items.map((item) => <tr key={item._id}><td className="mono">{item._id}</td><td>{item.featureNameSnapshot || item.featureId || '—'}</td><td className="mono">{item._openid || '—'}</td><td><span className={`status-chip ${item.status}`}>{statusLabel(item.status)}</span></td><td>{item.provider || item.modelCallIdSnapshot || '—'}</td><td>{item.totalDurationMs ? `${Math.round(item.totalDurationMs / 1000)}秒` : '—'}</td><td className="error-cell">{item.status === 'failed' ? (item.errorLabel || '生成失败，请查看技术详情') : '—'}</td><td>{formatDate(item.createdAt)}</td><td>{item.status === 'failed' ? <button type="button" className="secondary-button" onClick={() => retry(item)}><RotateCcw size={14} />重试</button> : null}</td></tr>)}</tbody> : null}
  </PanelShell>
}

export function OrdersPanel() {
  const [keyword, setKeyword] = useHashParamState('keyword')
  const [status, setStatus] = useHashParamState('status')
  const [dateFrom, setDateFrom] = useHashParamState('dateFrom')
  const [dateTo, setDateTo] = useHashParamState('dateTo')
  const list = useList('listOrders', { keyword, filters: { status, dateField: 'created_at', dateFrom, dateTo }, sortBy: 'created_at' })
  const filters = <FilterBar keyword={keyword} onKeywordChange={setKeyword} placeholder="搜索订单号、用户或支付单号" onReset={() => { setKeyword(''); setStatus(''); setDateFrom(''); setDateTo('') }}><label>支付状态<input name="orderStatus" value={status} onChange={(event) => setStatus(event.target.value)} placeholder="精确筛选" /></label><label>开始日期<input name="orderDateFrom" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label><label>结束日期<input name="orderDateTo" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label></FilterBar>
  return <PanelShell title="订单与星光" subtitle="查看支付状态、金额和星光入账结果。" list={list} filters={filters} columns={7}>
    <thead><tr><th>订单号</th><th>用户</th><th>金额</th><th>星光</th><th>状态</th><th>支付单号</th><th>创建时间</th></tr></thead>
    {!list.loading && !list.error && list.items.length ? <tbody>{list.items.map((item) => <tr key={item._id}><td className="mono">{item.out_trade_no || item._id}</td><td className="mono">{maskIdentifier(item.openid || item._openid)}</td><td>{item.amount != null ? `¥${(Number(item.amount) / 100).toFixed(2)}` : '—'}</td><td>{item.points ?? item.credit ?? '—'}</td><td><span className={`status-chip ${String(item.status || '').toLowerCase()}`}>{statusLabel(item.status, '未知状态')}</span></td><td className="mono">{item.transaction_id || '—'}</td><td>{formatDate(item.created_at || item.createdAt)}</td></tr>)}</tbody> : null}
  </PanelShell>
}

export function FeedbackPanel() {
  const [keyword, setKeyword] = useHashParamState('keyword')
  const [status, setStatus] = useHashParamState('status')
  const [type, setType] = useHashParamState('type')
  const [dateFrom, setDateFrom] = useHashParamState('dateFrom')
  const [dateTo, setDateTo] = useHashParamState('dateTo')
  const list = useList('listFeedbacks', { keyword, filters: { status, type, dateField: 'createTime', dateFrom, dateTo }, sortBy: 'createTime' })
  const resolve = async (id) => { await callAdmin('updateFeedback', { id, data: { status: 'resolved' } }); await list.reload() }
  const filters = <FilterBar keyword={keyword} onKeywordChange={setKeyword} placeholder="搜索反馈内容或用户" onReset={() => { setKeyword(''); setStatus(''); setType(''); setDateFrom(''); setDateTo('') }}>
    <label>处理状态<select name="feedbackStatus" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option><option value="open">待处理</option><option value="resolved">已处理</option></select></label>
    <label>反馈类型<input name="feedbackType" value={type} onChange={(event) => setType(event.target.value)} placeholder="精确筛选" /></label>
    <label>开始日期<input name="feedbackDateFrom" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
    <label>结束日期<input name="feedbackDateTo" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
  </FilterBar>
  return <PanelShell title="反馈与投诉" subtitle="集中处理用户问题并保留处置状态。" list={list} filters={filters} columns={6}>
    <thead><tr><th>类型</th><th>用户</th><th>内容</th><th>状态</th><th>提交时间</th><th /></tr></thead>
    {!list.loading && !list.error && list.items.length ? <tbody>{list.items.map((item) => <tr key={item._id}><td>{item.type || '其他'}</td><td className="mono">{maskIdentifier(item.openid)}</td><td className="feedback-content">{item.content}</td><td>{statusLabel(item.status || 'open')}</td><td>{formatDate(item.createTime)}</td><td>{item.status !== 'resolved' ? <button type="button" className="secondary-button" onClick={() => resolve(item._id)}>标记已处理</button> : null}</td></tr>)}</tbody> : null}
  </PanelShell>
}

export function AuditLogsPanel() {
  const [keyword, setKeyword] = useHashParamState('keyword')
  const [role, setRole] = useHashParamState('role')
  const [result, setResult] = useHashParamState('result')
  const [dateFrom, setDateFrom] = useHashParamState('dateFrom')
  const [dateTo, setDateTo] = useHashParamState('dateTo')
  const list = useList('listAuditLogs', { keyword, filters: { operatorRole: role, success: result === '' ? '' : result === 'success', dateField: 'createdAt', dateFrom, dateTo } })
  const filters = <FilterBar keyword={keyword} onKeywordChange={setKeyword} placeholder="搜索操作人、业务动作或对象" onReset={() => { setKeyword(''); setRole(''); setResult(''); setDateFrom(''); setDateTo('') }}>
    <label>角色<select name="auditRole" value={role} onChange={(event) => setRole(event.target.value)}><option value="">全部角色</option>{['super_admin', 'admin', 'template_editor', 'operator', 'finance', 'readonly_analyst'].map((value) => <option key={value} value={value}>{roleLabel(value)}</option>)}</select></label>
    <label>结果<select name="auditResult" value={result} onChange={(event) => setResult(event.target.value)}><option value="">全部结果</option><option value="success">成功</option><option value="failed">失败</option></select></label>
    <label>开始日期<input name="auditDateFrom" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
    <label>结束日期<input name="auditDateTo" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
  </FilterBar>
  return <PanelShell title="审计日志" subtitle="使用业务语言查看敏感操作的人员、对象、原因和结果。" list={list} filters={filters} columns={8}>
    <thead><tr><th>时间</th><th>操作人</th><th>角色</th><th>业务动作</th><th>操作对象</th><th>执行结果</th><th>操作原因</th><th>请求编号</th></tr></thead>
    {!list.loading && !list.error && list.items.length ? <tbody>{list.items.map((item) => <tr key={item._id}><td>{formatDate(item.createdAt)}</td><td>{item.operatorName || maskIdentifier(item.operatorUid)}</td><td>{roleLabel(item.operatorRole)}</td><td>{item.actionLabel || LEGACY_ACTION_LABELS[item.actionCode || item.action] || '后台操作'}</td><td><strong>{item.objectName || '—'}</strong><small className="cell-subtitle mono">{item.objectId || item.targetId || '—'}</small></td><td>{item.success ? '成功' : item.resultLabel || '失败'}</td><td>{item.reason || '—'}</td><td className="mono">{item.traceId || '—'}</td></tr>)}</tbody> : null}
  </PanelShell>
}

export function SystemConfigPanel() {
  const [form, setForm] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const load = async () => { setLoading(true); setError(''); try { const result = await callAdmin('getSystemConfig'); setForm(result.data) } catch (err) { setError(err.message) } finally { setLoading(false) } }
  useEffect(() => { load() }, [])
  const save = async (event) => { event.preventDefault(); setSaving(true); setError(''); try { await callAdmin('updateSystemConfig', { data: form }) } catch (err) { setError(err.message) } finally { setSaving(false) } }
  return <section className="workspace operations-page"><div className="dashboard-toolbar"><div><h2>系统配置</h2><p>统一管理星光与全局业务默认值。</p></div><button type="button" className="secondary-button" onClick={load}><RefreshCw size={15} />刷新</button></div>{loading ? <div className="analytics-empty"><Loader2 className="spin" size={20} />正在加载</div> : null}{error ? <p className="error-text">{error}</p> : null}{form ? <form className="editor system-config-form" onSubmit={save}><div className="form-grid"><label className="field"><span>产品名称</span><input name="creditName" value="星光" disabled /></label>{[['initial_points', '新用户初始星光'], ['analyze_cost', '分析消耗'], ['generate_cost', '生成消耗'], ['tryon_cost', '试穿消耗'], ['show_points_section', '是否展示星光区域']].map(([key, label]) => <label className="field" key={key}><span>{label}</span><input name={key} type="number" min="0" value={form[key]} onChange={(event) => setForm({ ...form, [key]: Number(event.target.value) })} /></label>)}<label className="field form-wide"><span>Banner 素材地址</span><input name="bannerImageUrl" value={form.banner_image_url} onChange={(event) => setForm({ ...form, banner_image_url: event.target.value })} /></label><label className="field form-wide"><span>提示素材地址</span><input name="tipsImageUrl" value={form.tips_image_url} onChange={(event) => setForm({ ...form, tips_image_url: event.target.value })} /></label></div><div className="toolbar"><button className="primary-button" disabled={saving}>{saving ? <Loader2 className="spin" size={15} /> : null}保存配置</button></div></form> : null}</section>
}

export function PlacementsPanel() {
  const [keyword, setKeyword] = useHashParamState('keyword')
  const list = useList('listFeatures', { keyword, sortBy: 'sort', sortOrder: 'asc' })
  const [drafts, setDrafts] = useState({})
  const patchDraft = (id, patch) => setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }))
  const save = async (item) => { const draft = drafts[item._id] || {}; await callAdmin('updateTemplatePlacement', { id: item._id, data: { sort: draft.sort ?? item.sort, tag: draft.tag ?? item.tag } }); await list.reload() }
  const placementText = (item) => (item.placements || []).map((entry) => `${entry.zone === 'boss' ? '老板专区' : '玩图专区'}/${entry.group || '未分类'}`).join('、') || '未归类'
  const filters = <FilterBar keyword={keyword} onKeywordChange={setKeyword} placeholder="搜索模板名称或ID" onReset={() => setKeyword('')} />
  return <PanelShell title="推荐位与排序" subtitle="统一调整模板推荐标识和展示顺序。" list={list} filters={filters} columns={5}>
    <thead><tr><th>模板</th><th>展示位置</th><th>推荐标识</th><th>排序</th><th /></tr></thead>
    {!list.loading && !list.error && list.items.length ? <tbody>{list.items.map((item) => <tr key={item._id}><td><strong>{item.name}</strong><small className="cell-subtitle">{item._id}</small></td><td>{placementText(item)}</td><td><select aria-label={`${item.name} 推荐标识`} value={drafts[item._id]?.tag ?? item.tag ?? 'normal'} onChange={(event) => patchDraft(item._id, { tag: event.target.value })}><option value="normal">无</option><option value="new">新品</option><option value="hot">热门</option></select></td><td><input aria-label={`${item.name} 排序`} className="compact-number" type="number" value={drafts[item._id]?.sort ?? item.sort ?? 10} onChange={(event) => patchDraft(item._id, { sort: Number(event.target.value) })} /></td><td><button type="button" className="primary-button" onClick={() => save(item)}>保存</button></td></tr>)}</tbody> : null}
  </PanelShell>
}
