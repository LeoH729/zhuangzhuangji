import React, { useEffect, useId, useRef, useState } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, Search, X } from 'lucide-react'

const ROLE_LABELS = {
  super_admin: '超级管理员',
  admin: '管理员',
  template_editor: '模板编辑',
  operator: '运营专员',
  finance: '财务专员',
  readonly_analyst: '数据分析（只读）'
}

export const STATUS_LABELS = {
  draft: '草稿', testing: '测试中', ready: '可发布', published: '已发布', offline: '已下线',
  pending: '等待中', running: '生成中', succeeded: '成功', success: '成功', failed: '失败',
  resolved: '已处理', open: '待处理', created: '待支付', paid: '已支付', cancelled: '已取消',
  active: '启用', blocked: '停用', scheduled: '已定时'
}

export function roleLabel(value) {
  return ROLE_LABELS[value] || value || '管理员'
}

export function statusLabel(value, fallback = '—') {
  const key = String(value ?? '').toLowerCase()
  return STATUS_LABELS[key] || fallback
}

export function maskIdentifier(value, start = 6, end = 4) {
  const text = String(value || '')
  if (!text) return '—'
  if (text.length <= start + end + 2) return `${text.slice(0, 2)}••••${text.slice(-2)}`
  return `${text.slice(0, start)}••••••${text.slice(-end)}`
}

export function useDebouncedValue(value, delay = 300) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export function useHashParamState(key, defaultValue = '') {
  const initialParams = new URLSearchParams(window.location.hash.split('?')[1] || '')
  const [value, setValue] = useState(initialParams.has(key) ? initialParams.get(key) : defaultValue)
  useEffect(() => {
    const [path, raw = ''] = window.location.hash.replace(/^#/, '').split('?')
    const params = new URLSearchParams(raw)
    if (value === '' || value === null || value === undefined) params.delete(key)
    else params.set(key, String(value))
    const query = params.toString()
    window.history.replaceState(null, '', `#${path}${query ? `?${query}` : ''}`)
  }, [key, value])
  return [value, setValue]
}

let activeDialogResolver = null

export function confirmAction(options) {
  return new Promise((resolve) => {
    if (activeDialogResolver) activeDialogResolver(false)
    activeDialogResolver = resolve
    window.dispatchEvent(new CustomEvent('admin-confirm', { detail: options }))
  })
}

export function ConfirmDialogHost() {
  const [dialog, setDialog] = useState(null)
  const [typedValue, setTypedValue] = useState('')
  const dialogRef = useRef(null)
  const titleId = useId()

  useEffect(() => {
    const show = (event) => {
      setDialog(event.detail || {})
      setTypedValue('')
    }
    window.addEventListener('admin-confirm', show)
    return () => window.removeEventListener('admin-confirm', show)
  }, [])

  useEffect(() => {
    if (!dialog) return undefined
    const previous = document.activeElement
    const timer = window.setTimeout(() => dialogRef.current?.focus(), 0)
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !dialog.requireText) finish(false)
      if (event.key !== 'Tab') return
      const focusable = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled)')]
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('keydown', onKeyDown)
      previous?.focus?.()
    }
  }, [dialog])

  const finish = (answer) => {
    const resolver = activeDialogResolver
    activeDialogResolver = null
    setDialog(null)
    setTypedValue('')
    resolver?.(answer)
  }

  if (!dialog) return null
  const canConfirm = !dialog.requireText || typedValue === dialog.requireText
  return <div className="dialog-backdrop" role="presentation">
    <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={dialogRef}>
      <div className="dialog-icon"><AlertTriangle size={22} /></div>
      <div className="dialog-copy">
        <h2 id={titleId}>{dialog.title || '确认操作'}</h2>
        <p>{dialog.description || '请确认是否继续。'}</p>
        {dialog.objectName || dialog.objectId ? <dl className="dialog-object">
          {dialog.objectName ? <><dt>对象</dt><dd>{dialog.objectName}</dd></> : null}
          {dialog.objectId ? <><dt>ID</dt><dd className="mono">{dialog.objectId}</dd></> : null}
          {dialog.impact ? <><dt>影响</dt><dd>{dialog.impact}</dd></> : null}
          {dialog.recovery ? <><dt>恢复</dt><dd>{dialog.recovery}</dd></> : null}
        </dl> : null}
        {dialog.requireText ? <label className="field dialog-confirm-field">
          <span>输入“{dialog.requireText}”确认</span>
          <input autoFocus name="confirmText" value={typedValue} onChange={(event) => setTypedValue(event.target.value)} autoComplete="off" />
        </label> : null}
        <div className="dialog-actions">
          <button type="button" className="secondary-button" onClick={() => finish(false)}>取消</button>
          <button type="button" className={dialog.danger === false ? 'primary-button' : 'danger-button'} disabled={!canConfirm} onClick={() => finish(true)}>
            {dialog.confirmLabel || '确认操作'}
          </button>
        </div>
      </div>
    </section>
  </div>
}

export function FilterBar({ keyword, onKeywordChange, placeholder = '搜索名称或ID', children, onReset }) {
  return <div className="standard-filter-bar">
    <label className="search-field">
      <Search size={16} aria-hidden="true" />
      <span className="sr-only">搜索</span>
      <input name="keyword" value={keyword} onChange={(event) => onKeywordChange(event.target.value)} placeholder={placeholder} />
      {keyword ? <button type="button" aria-label="清空搜索" onClick={() => onKeywordChange('')}><X size={14} /></button> : null}
    </label>
    {children}
    {onReset ? <button type="button" className="text-button" onClick={onReset}>重置筛选</button> : null}
  </div>
}

export function TableState({ loading, error, empty, filtered = false, colSpan = 1 }) {
  if (loading) return <tbody className="table-state"><tr><td colSpan={colSpan}><div className="table-skeleton" aria-live="polite"><Loader2 className="spin" size={18} />正在加载数据</div></td></tr></tbody>
  if (error) return <tbody className="table-state"><tr><td colSpan={colSpan}><div className="error-text">{error}</div></td></tr></tbody>
  if (empty) return <tbody className="table-state"><tr><td colSpan={colSpan}><div>{filtered ? '没有符合当前筛选条件的数据' : '暂无数据'}</div></td></tr></tbody>
  return null
}

export function StandardPager({ page, pageSize, total, setPage, setPageSize }) {
  const totalPages = Math.max(Math.ceil((total || 0) / pageSize), 1)
  return <div className="table-footer">
    <span>共 {total || 0} 条，第 {page} / {totalPages} 页</span>
    <div className="pager">
      <label><span className="sr-only">每页条数</span><select name="pageSize" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
        {[20, 50, 100].map((size) => <option key={size} value={size}>每页 {size} 条</option>)}
      </select></label>
      <button type="button" className="secondary-button" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={15} />上一页</button>
      <label className="page-jump"><span className="sr-only">跳转页码</span><input name="page" type="number" min="1" max={totalPages} value={page} onChange={(event) => setPage(Math.min(Math.max(Number(event.target.value) || 1, 1), totalPages))} /></label>
      <button type="button" className="secondary-button" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>下一页<ChevronRight size={15} /></button>
    </div>
  </div>
}
