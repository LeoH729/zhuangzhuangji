import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronsDown, ChevronsUp, Copy, Download, GripVertical, ImageOff, ImagePlus, Loader2, Pencil, Play, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react'
import { app, callAdmin } from '../cloudbase'
import { FilterBar, StandardPager, TableState, confirmAction, maskIdentifier, statusLabel, useDebouncedValue, useHashParamState } from './ui'

const ZONE_LABELS = { boss: '老板专区', play: '玩图专区' }
const BADGE_LABELS = { normal: '普通', new: '新品', hot: '热门' }
const TEMPLATE_TYPE_LABELS = { image_to_image: '图生图', text_to_image: '文生图' }
const EMPTY_TEMPLATE = {
  name: '', template_type: 'image_to_image', upload_count: 1, points_cost: 5, enable_upscale_print: false,
  tag: 'normal', placements: [], model_call_id: '', fallback_model_call_id: '', prompt: '', input_fields: [],
  home_banner: '', detail_banner: '', supported_ratios: ['1:1', '3:4', '4:3', '4:5', '9:16', '16:9'],
  size: '', sort: 10, description: '', status: 0
}
const ConfirmDialogHost = () => null

function publishStatus(item = {}) {
  if (Number(item.status) === 1) return { key: 'published', label: '已发布' }
  if (item.lifecycle_status === 'offline') return { key: 'offline', label: '已下线' }
  return { key: 'unpublished', label: '未发布' }
}

function CoverThumb({ src, name }) {
  return (
    <span className="cover-thumb" title={name || '封面缩略图'}>
      {src ? <img src={src} alt="" /> : <span className="cover-thumb-fallback"><ImageOff size={18} /><span>无封面</span></span>}
    </span>
  )
}

function modelCallIdOf(item = {}) {
  return String(item.model_call_id || item.modelCallId || '').trim()
}

function modelOptionLabel(item = {}) {
  return modelCallIdOf(item) || '未填写调用ID'
}

function ratingCountOf(item = {}, type = 'hang') {
  const userKey = type === 'hang' ? 'user_hang_count' : 'user_la_count'
  const legacyKey = type === 'hang' ? 'hang_count' : 'la_count'
  const num = Number(item[userKey] ?? item[legacyKey])
  return Number.isFinite(num) && num >= 0 ? num : 0
}

const dateText = (value) => {
  if (!value) return '—'
  const raw = value.$date || value.iso || value
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false })
}
const toast = (type, message) => window.dispatchEvent(new CustomEvent('admin-toast', { detail: { type, message } }))
const copyText = async (value) => { await navigator.clipboard.writeText(value); toast('success', '已复制') }
const cleanPath = (value = '') => String(value).replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.{2}/g, '').replace(/\/+$/, '')

function usePagedAdminList(action, buildPayload, dependencies) {
  const [pageValue, setPageValue] = useHashParamState('page', '1')
  const [pageSizeValue, setPageSizeValue] = useHashParamState('pageSize', '20')
  const page = Math.max(Number(pageValue) || 1, 1)
  const pageSize = [20, 50, 100].includes(Number(pageSizeValue)) ? Number(pageSizeValue) : 20
  const [result, setResult] = useState({ data: [], total: 0, refs: {} })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = async () => {
    setLoading(true); setError('')
    try { setResult(await callAdmin(action, { ...buildPayload(), page, pageSize })) }
    catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [action, page, pageSize, ...dependencies])
  const setPage = (value) => setPageValue(String(value))
  const setPageSize = (value) => { setPageSizeValue(String(value)); setPageValue('1') }
  return { ...result, items: result.data || [], loading, error, page, pageSize, setPage, setPageSize, reload: load }
}

function LabeledField({ label, name, error, children, wide = false }) {
  return <label className={`field ${wide ? 'form-wide' : ''} ${error ? 'has-error' : ''}`} htmlFor={name}><span>{label}</span>{React.cloneElement(children, { id: name, name, 'aria-invalid': error ? 'true' : undefined })}{error ? <small className="field-error">{error}</small> : null}</label>
}

function normalizeTemplate(source = {}) {
  return {
    ...EMPTY_TEMPLATE,
    ...source,
    placements: Array.isArray(source.placements) ? source.placements.map((item) => ({ zone: item.zone || 'play', group: item.group || item.category_id || '', sort_order: Number(item.sort_order || item.sortOrder || 0) })) : [],
    input_fields: Array.isArray(source.input_fields) ? source.input_fields.map((item, index) => ({ key: item.key || '', title: item.title || '', placeholder: item.placeholder || '', maxLength: Number(item.maxLength || 0), required: item.required !== false, sort: index })) : []
  }
}

function TemplatePreview({ form, assets }) {
  const resolve = (id) => assets.find((item) => item.fileID === id || item.objectKey === id)?.temporaryUrl || ''
  return <aside className="template-preview-panel"><div className="editor-subhead"><strong>实时预览</strong><span>{form.placements.length ? form.placements.map((item) => ZONE_LABELS[item.zone]).join(' / ') : '尚未配置专区'}</span></div><div className="preview-phone">{resolve(form.detail_banner) ? <img src={resolve(form.detail_banner)} alt="详情页图片预览" /> : <div className="preview-placeholder">选择详情页图片后显示预览</div>}<strong>{form.name || '模板名称'}</strong>{form.input_fields.slice(0, 3).map((field) => <label key={field.key || field.title}><span>{field.title || '输入项'}{field.required ? ' *' : ''}</span><input disabled placeholder={field.placeholder || '请输入'} /></label>)}<button disabled>立即生成 · {form.points_cost || 0} 星光</button></div></aside>
}

function DebugGeneration({ form, templateId }) {
  const [inputValues, setInputValues] = useState({})
  const [imageUrls, setImageUrls] = useState([])
  const [route, setRoute] = useState('primary')
  const [uploading, setUploading] = useState(false)
  const [running, setRunning] = useState(false)
  const [task, setTask] = useState(null)
  const [error, setError] = useState('')
  const textTemplate = form.template_type === 'text_to_image'

  useEffect(() => {
    if (!task?.taskId || !['pending', 'running'].includes(task.status)) return undefined
    const poll = async () => {
      try {
        const result = await callAdmin('getDebugGenerationStatus', { taskId: task.taskId })
        setTask(result.task)
        if (!['pending', 'running'].includes(result.task?.status)) setRunning(false)
      } catch (err) { setError(err.message); setRunning(false) }
    }
    poll(); const timer = window.setInterval(poll, 5000)
    return () => window.clearInterval(timer)
  }, [task?.taskId, task?.status])

  const upload = async (event) => {
    const files = Array.from(event.target.files || []).slice(0, Math.max(Number(form.upload_count) || 1, 1))
    if (!files.length) return
    setUploading(true); setError('')
    try {
      const uploaded = []
      for (const [index, file] of files.entries()) {
        const extension = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '.jpg'
        const cloudPath = `admin-debug-inputs/${Date.now()}_${index}_${Math.floor(Math.random() * 100000)}${extension}`
        const result = await app.uploadFile({ cloudPath, filePath: file })
        if (result.fileID) uploaded.push(result.fileID)
      }
      setImageUrls(uploaded)
    } catch (err) { setError(err.message) }
    finally { setUploading(false); event.target.value = '' }
  }

  const start = async () => {
    setRunning(true); setError('')
    try {
      const result = await callAdmin('debugFeatureGeneration', {
        id: templateId, featureId: templateId, feature: form,
        imageUrls: textTemplate ? [] : imageUrls, inputValues, forceFallback: route === 'fallback'
      })
      setTask({ taskId: result.taskId, status: 'pending', compiledPrompt: result.compiledPrompt })
    } catch (err) { setError(err.message); setRunning(false) }
  }

  const canRun = templateId && form.name && form.model_call_id && form.prompt && (textTemplate ? form.input_fields.every((field) => !field.required || inputValues[field.key]) : imageUrls.length)
  return <section className="debug-panel" id="template-section-debug"><div className="editor-subhead"><div><strong>调试生成</strong><small className="cell-subtitle">调试可随时运行，不影响发布资格，也不会注入默认图片比例。</small></div><button className="primary-button" type="button" disabled={!canRun || running || uploading} onClick={start}>{running ? <Loader2 className="spin" size={16} /> : <Play size={16} />}运行调试</button></div><div className="debug-fields"><LabeledField label="能力路由" name="debugRoute"><select value={route} onChange={(event) => setRoute(event.target.value)}><option value="primary">主能力策略</option><option value="fallback" disabled={!form.fallback_model_call_id}>兜底能力策略</option></select></LabeledField></div>{textTemplate ? <div className="debug-fields">{form.input_fields.map((field) => <LabeledField key={field.key} label={field.title || field.key} name={`debug_${field.key}`}><input value={inputValues[field.key] || ''} maxLength={field.maxLength || undefined} placeholder={field.placeholder} onChange={(event) => setInputValues({ ...inputValues, [field.key]: event.target.value })} /></LabeledField>)}</div> : <div className="debug-upload"><LabeledField label="调试参考图" name="debugImages"><input type="file" accept="image/*" multiple onChange={upload} disabled={uploading} /></LabeledField>{imageUrls.map((fileID) => <span className="debug-file-chip" key={fileID}><span className="mono">{fileID}</span><button type="button" onClick={() => setImageUrls(imageUrls.filter((item) => item !== fileID))}>移除</button></span>)}</div>}<div className="debug-prompt"><span>实际提示词</span><pre>{task?.compiledPrompt || form.prompt || '—'}</pre></div>{error ? <p className="error-text">{error}</p> : null}{task ? <div className="debug-result"><div className="debug-meta"><span>状态：{statusLabel(task.status)}</span><span>模型：{task.modelCallId || (route === 'fallback' ? form.fallback_model_call_id : form.model_call_id) || '—'}</span><span>耗时：{task.totalDurationMs ? `${(task.totalDurationMs / 1000).toFixed(1)}秒` : '—'}</span></div>{task.errorMessage ? <p className="error-text">{task.errorMessage}</p> : null}{task.resultTempUrl ? <div className="debug-image-wrap"><img src={task.resultTempUrl} alt="调试生成结果" /><p className="mono">{task.resultUrl}</p></div> : null}</div> : null}</section>
}

function TemplateEditor({ initial, refs, onBack, onChanged, onCreated }) {
  const [form, setForm] = useState(() => normalizeTemplate(initial))
  const [templateId, setTemplateId] = useState(initial?._id || '')
  const [assets, setAssets] = useState([])
  const [assetError, setAssetError] = useState('')
  const [models, setModels] = useState(() => (refs.models || []).filter((item) => modelCallIdOf(item)))
  const [errors, setErrors] = useState({})
  const [errorList, setErrorList] = useState([])
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [message, setMessage] = useState(initial?.has_draft ? '正在编辑未发布草稿' : '')
  const savedRef = useRef(JSON.stringify(normalizeTemplate(initial)))
  const dirty = JSON.stringify(form) !== savedRef.current

  useEffect(() => {
    let active = true
    const loadAssets = async () => {
      try {
        const rows = []
        for (let page = 1; page <= 20; page += 1) {
          const result = await callAdmin('listImages', { scope: 'operations', page, pageSize: 100 })
          rows.push(...(result.data || []))
          if (rows.length >= Number(result.total || 0) || !(result.data || []).length) break
        }
        if (active) { setAssets(rows); setAssetError('') }
      } catch (err) { if (active) { setAssets([]); setAssetError(err.message || '运营图片加载失败') } }
    }
    loadAssets()
    const loadModels = async () => {
      try {
        const rows = []
        for (let page = 1; page <= 10; page += 1) {
          const result = await callAdmin('listModels', { page, pageSize: 100 })
          rows.push(...(result.data || []))
          if (rows.length >= Number(result.total || 0) || !(result.data || []).length) break
        }
        if (active) setModels(rows.filter((item) => modelCallIdOf(item)))
      } catch (_) {
        if (active) setModels((refs.models || []).filter((item) => modelCallIdOf(item)))
      }
    }
    loadModels()
    return () => { active = false }
  }, [])
  useEffect(() => { const warn = (event) => { if (!dirty) return; event.preventDefault(); event.returnValue = '' }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn) }, [dirty])

  const patch = (next) => setForm((current) => ({ ...current, ...next }))
  const validateResponse = (issues = []) => {
    setErrorList(issues)
    setErrors(Object.fromEntries(issues.filter((item) => item.field).map((item) => [item.field, item.message || item.reason])))
  }
  const scrollToIssue = (issue) => {
    const control = document.querySelector(`[name="${issue.field}"]`)
    control?.scrollIntoView({ behavior: 'smooth', block: 'center' }); control?.focus()
  }
  const save = async () => {
    setSaving(true); setErrors({}); setErrorList([]); setMessage('')
    try {
      const result = await callAdmin('saveFeatureDraft', templateId ? { id: templateId, data: form } : { data: form })
      const id = templateId || result.id || result._id
      setTemplateId(id); savedRef.current = JSON.stringify(form); setMessage(`已保存 · 模板ID ${id}`); onChanged()
      if (!templateId && id) onCreated(id)
    } catch (err) { if (err.field) setErrors({ [err.field]: err.message }) }
    finally { setSaving(false) }
  }
  const publish = async () => {
    if (!templateId) { setMessage('请先保存草稿再发布'); return }
    setPublishing(true); setErrors({}); setErrorList([]); setMessage('')
    try {
      const check = await callAdmin('checkFeaturePublish', { id: templateId, data: form })
      if (!check.passed) { validateResponse(check.errors || []); return }
      await callAdmin('publishFeature', { id: templateId, data: form })
      const next = { ...form, status: 1 }; setForm(next); savedRef.current = JSON.stringify(next); setMessage('已发布到小程序'); onChanged()
    } catch (err) { validateResponse(err.result?.errors || err.result?.details?.errors || []) }
    finally { setPublishing(false) }
  }
  const offline = async () => {
    if (!await confirmAction({ title: '下线模板', description: '小程序将不再展示该模板。', objectName: form.name, objectId: templateId, impact: '用户无法继续进入该模板，历史生成记录不受影响。', recovery: '完善配置后可以再次发布。', confirmLabel: '确认下线模板' })) return
    await callAdmin('offlineTemplate', { templateId }); const next = { ...form, status: 0 }; setForm(next); savedRef.current = JSON.stringify(next); setMessage('模板已下线'); onChanged()
  }
  const back = async () => {
    if (dirty && !await confirmAction({ title: '离开模板编辑', description: '当前有尚未保存的修改。', objectName: form.name || '新模板', objectId: templateId, impact: '未保存的修改将丢失。', recovery: '返回前可先取消并保存草稿。', danger: false, confirmLabel: '放弃修改并返回' })) return
    onBack()
  }
  const setType = (value) => patch({ template_type: value, upload_count: value === 'text_to_image' ? 0 : Math.max(form.upload_count || 1, 1), input_fields: value === 'text_to_image' && !form.input_fields.length ? [{ key: 'subject', title: '主体描述', placeholder: '请输入', maxLength: 50, required: true, sort: 0 }] : form.input_fields })
  const addPlacement = () => patch({ placements: [...form.placements, { zone: 'play', group: '', sort_order: 0 }] })
  const updatePlacement = (index, data) => patch({ placements: form.placements.map((item, itemIndex) => itemIndex === index ? { ...item, ...data } : item) })
  const assetOptions = assets.map((item) => ({ value: item.fileID || item.objectKey, label: item.name || item.objectKey }))
  ;[form.home_banner, form.detail_banner].forEach((value) => {
    if (value && !assetOptions.some((item) => item.value === value)) assetOptions.push({ value, label: value.split('/').pop() || value })
  })

  return <section className="workspace v22-template-editor"><div className="sticky-editor-actions"><div><button className="text-button" type="button" onClick={back}>返回模板列表</button><h2>{form.name || '新建模板'}</h2><div className="editor-save-state"><span className={`status-dot ${dirty ? 'partial' : 'available'}`} />{saving ? '保存中…' : dirty ? '有未保存修改' : '已保存'}{templateId ? <span className="mono">ID：{templateId}</span> : null}<span className={`status-chip ${publishStatus({ ...initial, status: form.status }).key}`}>{publishStatus({ ...initial, status: form.status }).label}</span></div></div><div className="toolbar"><button className="secondary-button" type="button" onClick={() => window.location.reload()}><RefreshCw size={15} />刷新</button><button className="secondary-button" type="button" onClick={() => setForm(normalizeTemplate(initial))}>清空修改</button><button className="secondary-button" type="button" disabled={saving || publishing} onClick={save}>{saving ? <Loader2 className="spin" size={15} /> : <Save size={15} />}保存草稿</button>{form.status === 1 ? <button className="danger-button" type="button" onClick={offline}>下线</button> : null}<button className="primary-button" type="button" disabled={saving || publishing || !templateId} onClick={publish}>{publishing ? <Loader2 className="spin" size={15} /> : <Save size={15} />}发布到小程序</button></div></div>{message ? <p className="success-text">{message}</p> : null}{errorList.length ? <div className="publish-check-panel"><strong>还有 {errorList.length} 项内容需要完善</strong><ul className="check-list">{errorList.map((item, index) => <li key={`${item.field}_${index}`}><button type="button" className="text-button" onClick={() => scrollToIssue(item)}>{item.message || item.reason}</button><span>{item.suggestion}</span></li>)}</ul></div> : null}<div className="template-single-layout"><div className="template-section-stack"><section className="editor-section"><h3>基础信息</h3><div className="form-grid"><LabeledField label="模板名称" name="name" error={errors.name}><input value={form.name} onChange={(event) => patch({ name: event.target.value })} /></LabeledField><LabeledField label="模板类型" name="template_type" error={errors.template_type}><select value={form.template_type} onChange={(event) => setType(event.target.value)}><option value="image_to_image">图生图</option><option value="text_to_image">文生图</option></select></LabeledField><LabeledField label="上传图片数量" name="upload_count" error={errors.upload_count}><input type="number" min="1" disabled={form.template_type === 'text_to_image'} value={form.upload_count} onChange={(event) => patch({ upload_count: Number(event.target.value) })} /></LabeledField><LabeledField label="消耗星光" name="points_cost" error={errors.points_cost}><input type="number" min="0" value={form.points_cost} onChange={(event) => patch({ points_cost: Number(event.target.value) })} /></LabeledField><LabeledField label="推荐标识" name="tag"><select value={form.tag} onChange={(event) => patch({ tag: event.target.value })}>{Object.entries(BADGE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></LabeledField><label className="inline-check"><input name="enable_upscale_print" type="checkbox" checked={form.enable_upscale_print} onChange={(event) => patch({ enable_upscale_print: event.target.checked })} />支持高清打印</label></div></section><section className="editor-section"><div className="section-head"><h3>展示位置</h3><button className="secondary-button" type="button" onClick={addPlacement}><Plus size={14} />新增位置</button></div>{errors.placements ? <p className="field-error">{errors.placements}</p> : null}<div className="placement-editor-list">{form.placements.map((placement, index) => <div className="placement-editor-row" key={`${placement.zone}_${index}`}><select aria-label={`展示专区${index + 1}`} value={placement.zone} onChange={(event) => updatePlacement(index, { zone: event.target.value, group: '' })}>{Object.entries(ZONE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><select aria-label={`分类${index + 1}`} value={placement.group} onChange={(event) => updatePlacement(index, { group: event.target.value })}><option value="">请选择分类</option>{(refs.groups || []).filter((group) => (group.zone || 'play') === placement.zone).map((group) => <option value={group.name} key={group._id}>{group.name}</option>)}</select><button className="icon-button" type="button" aria-label="移除展示位置" onClick={() => patch({ placements: form.placements.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 size={15} /></button></div>)}</div></section><section className="editor-section"><h3>核心配置</h3><div className="form-grid"><LabeledField label="主能力策略" name="model_call_id" error={errors.model_call_id}><select value={form.model_call_id} onChange={(event) => patch({ model_call_id: event.target.value })}><option value="">请选择模型调用ID</option>{models.filter((item) => item.status === 1).map((item) => <option value={modelCallIdOf(item)} key={modelCallIdOf(item)}>{modelOptionLabel(item)}</option>)}</select></LabeledField><LabeledField label="兜底能力策略" name="fallback_model_call_id" error={errors.fallback_model_call_id}><select value={form.fallback_model_call_id} onChange={(event) => patch({ fallback_model_call_id: event.target.value })}><option value="">请选择模型调用ID</option>{models.filter((item) => item.status === 1 && modelCallIdOf(item) !== form.model_call_id).map((item) => <option value={modelCallIdOf(item)} key={modelCallIdOf(item)}>{modelOptionLabel(item)}</option>)}</select></LabeledField><LabeledField label="提示词" name="prompt" error={errors.prompt} wide><textarea rows="9" value={form.prompt} onChange={(event) => patch({ prompt: event.target.value })} /></LabeledField></div>{form.template_type === 'text_to_image' ? <div className="input-field-editor"><div className="editor-subhead"><strong>用户输入字段</strong><button className="secondary-button" type="button" onClick={() => patch({ input_fields: [...form.input_fields, { key: '', title: '', placeholder: '', maxLength: 50, required: true, sort: form.input_fields.length }] })}><Plus size={14} />新增字段</button></div>{errors.input_fields ? <p className="field-error">{errors.input_fields}</p> : null}{form.input_fields.map((field, index) => <div className="input-field-row" key={index}><input aria-label="字段标识" placeholder="字段标识" value={field.key} onChange={(event) => patch({ input_fields: form.input_fields.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value } : item) })} /><input aria-label="字段名称" placeholder="字段名称" value={field.title} onChange={(event) => patch({ input_fields: form.input_fields.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item) })} /><input aria-label="输入提示" placeholder="输入提示" value={field.placeholder} onChange={(event) => patch({ input_fields: form.input_fields.map((item, itemIndex) => itemIndex === index ? { ...item, placeholder: event.target.value } : item) })} /><input aria-label="最大字数" type="number" min="0" value={field.maxLength} onChange={(event) => patch({ input_fields: form.input_fields.map((item, itemIndex) => itemIndex === index ? { ...item, maxLength: Number(event.target.value) } : item) })} /><label className="inline-check"><input type="checkbox" checked={field.required} onChange={(event) => patch({ input_fields: form.input_fields.map((item, itemIndex) => itemIndex === index ? { ...item, required: event.target.checked } : item) })} />必填</label><button className="icon-button" type="button" aria-label="删除输入字段" onClick={() => patch({ input_fields: form.input_fields.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 size={14} /></button></div>)}</div> : null}</section><section className="editor-section"><h3>图片素材</h3>{assetError ? <p className="error-text">{assetError}</p> : null}{!assetError && !assets.length ? <p className="muted">未读取到 Pictures 目录中的运营图片，请先在图片中心同步或上传。</p> : null}<div className="form-grid"><LabeledField label="首页/列表封面" name="home_banner" error={errors.home_banner}><select value={form.home_banner} onChange={(event) => patch({ home_banner: event.target.value })}><option value="">请选择运营图片</option>{assetOptions.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></LabeledField><LabeledField label="详情页图片" name="detail_banner" error={errors.detail_banner}><select value={form.detail_banner} onChange={(event) => patch({ detail_banner: event.target.value })}><option value="">请选择运营图片</option>{assetOptions.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></LabeledField></div></section><DebugGeneration form={form} templateId={templateId} /></div><TemplatePreview form={form} assets={assets} /></div><ConfirmDialogHost /></section>
}

function placementKey(zone, group) {
  return `${zone}::${group}`
}

function parsePlacementKey(value = '') {
  const [zone, ...rest] = String(value).split('::')
  return { zone: zone === 'boss' ? 'boss' : 'play', group: rest.join('::') }
}

function PlacementQuickEdit({ item, groups = [], onSaved }) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState([])
  const [saving, setSaving] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const popoverRef = useRef(null)
  const rootRef = useRef(null)
  const label = item.placements?.length ? item.placements.map((entry) => `${ZONE_LABELS[entry.zone] || entry.zone}/${entry.group}`).join('、') : '未配置'
  const options = useMemo(() => {
    const rows = (groups || []).filter((group) => group.name)
    const byZone = { boss: [], play: [] }
    rows.forEach((group) => {
      const zone = group.zone === 'boss' ? 'boss' : 'play'
      byZone[zone].push(group)
    })
    return byZone
  }, [groups])
  useEffect(() => {
    if (!open) return undefined
    setSelected((item.placements || []).filter((entry) => entry.group).map((entry) => placementKey(entry.zone || 'play', entry.group)))
    const onDoc = (event) => {
      if (rootRef.current?.contains(event.target) || popoverRef.current?.contains(event.target)) return
      setOpen(false)
    }
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, item])
  const toggle = (event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const width = 300
    setCoords({ top: rect.bottom + 6, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)) })
    setOpen((current) => !current)
  }
  const save = async () => {
    const currentMap = Object.fromEntries((item.placements || []).map((entry) => [placementKey(entry.zone || 'play', entry.group), entry]))
    const placements = selected.map((key) => {
      const parsed = parsePlacementKey(key)
      const previous = currentMap[key]
      return { zone: parsed.zone, group: parsed.group, sort_order: Number(previous?.sort_order || previous?.sortOrder || 0) }
    })
    setSaving(true)
    try {
      await callAdmin('updateTemplatePlacement', { id: item._id, data: { placements, tag: item.tag || 'normal', sort: item.sort } })
      setOpen(false)
      await onSaved()
    } finally { setSaving(false) }
  }
  return (
    <div className="placement-quick-edit" ref={rootRef}>
      <div className="placement-quick-summary">
        <span title={label}>{label}</span>
        <button className="icon-button" type="button" aria-label={`编辑${item.name}展示位置`} onClick={toggle}><Pencil size={14} /></button>
      </div>
      {open ? createPortal(
        <div className="placement-quick-popover" ref={popoverRef} style={{ top: coords.top, left: coords.left }} role="dialog" aria-label="编辑展示位置">
          {Object.entries(ZONE_LABELS).map(([zone, zoneLabel]) => {
            const zoneGroups = options[zone] || []
            const extra = selected
              .map(parsePlacementKey)
              .filter((entry) => entry.zone === zone && entry.group && !zoneGroups.some((group) => group.name === entry.group))
              .map((entry) => ({ name: entry.group, zone, status: 0 }))
            const list = [...zoneGroups, ...extra]
            return (
              <div className="placement-quick-zone" key={zone}>
                <strong>{zoneLabel}</strong>
                {!list.length ? <p className="muted">暂无分类</p> : list.map((group) => {
                  const key = placementKey(zone, group.name)
                  return (
                    <label className="inline-check" key={key}>
                      <input type="checkbox" checked={selected.includes(key)} onChange={(event) => setSelected(event.target.checked ? [...selected, key] : selected.filter((value) => value !== key))} />
                      {group.name}{Number(group.status) === 0 ? <small className="cell-subtitle">已停用</small> : null}
                    </label>
                  )
                })}
              </div>
            )
          })}
          <div className="dialog-actions">
            <button className="secondary-button" type="button" onClick={() => setOpen(false)}>取消</button>
            <button className="primary-button" type="button" disabled={saving} onClick={save}>{saving ? <Loader2 className="spin" size={14} /> : <Save size={14} />}保存</button>
          </div>
        </div>,
        document.body
      ) : null}
    </div>
  )
}

export function TemplatesV22Panel() {
  const [editId, setEditId] = useHashParamState('edit')
  const [keyword, setKeyword] = useHashParamState('keyword')
  const [status, setStatus] = useHashParamState('status')
  const [zone, setZone] = useHashParamState('zone')
  const [category, setCategory] = useHashParamState('category')
  const [badge, setBadge] = useHashParamState('badge')
  const [model, setModel] = useHashParamState('model')
  const [dateFrom, setDateFrom] = useHashParamState('dateFrom')
  const [dateTo, setDateTo] = useHashParamState('dateTo')
  const [sortBy, setSortBy] = useHashParamState('sortBy', 'updatedAt')
  const [sortOrder, setSortOrder] = useHashParamState('sortOrder', 'desc')
  const debouncedKeyword = useDebouncedValue(keyword)
  const safeSortBy = sortBy === 'createdAt' ? 'createdAt' : 'updatedAt'
  const list = usePagedAdminList('listFeatures', () => ({ keyword: debouncedKeyword, zone, filters: { lifecycleStatus: status, categoryId: category, tag: badge, modelCallId: model, dateFrom, dateTo }, sortBy: safeSortBy, sortOrder }), [debouncedKeyword, status, zone, category, badge, model, dateFrom, dateTo, safeSortBy, sortOrder])
  const [editing, setEditing] = useState(null)
  const [editorLoading, setEditorLoading] = useState(false)
  useEffect(() => {
    if (!editId) { setEditing(null); return }
    if (editId === 'new') { setEditing({ ...EMPTY_TEMPLATE, _id: '' }); return }
    const local = list.items.find((item) => item._id === editId)
    if (local) { setEditing(local); return }
    setEditorLoading(true)
    callAdmin('listFeatures', { keyword: editId, page: 1, pageSize: 20 }).then((result) => setEditing((result.data || []).find((item) => item._id === editId) || null)).finally(() => setEditorLoading(false))
  }, [editId, list.loading])
  if (editId) {
    if (editorLoading || !editing) return <section className="workspace"><div className="analytics-empty"><Loader2 className="spin" size={20} />正在加载模板</div></section>
    const source = editing.has_draft && editing.draft_data ? { ...editing, ...editing.draft_data, status: editing.status } : editing
    return <TemplateEditor initial={source} refs={list.refs || {}} onBack={() => setEditId('')} onChanged={list.reload} onCreated={setEditId} />
  }
  const remove = async (item) => {
    if (!await confirmAction({ title: '删除模板', description: '已发布模板必须先下线。', objectName: item.name, objectId: item._id, impact: '模板配置将被永久删除。', recovery: '不可恢复。', requireText: item.name, confirmLabel: '确认删除模板' })) return
    await callAdmin('deleteFeature', { id: item._id, confirmName: item.name }); list.reload()
  }
  const toggleSort = (field) => {
    if (safeSortBy === field) setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    else { setSortBy(field); setSortOrder('desc') }
  }
  const sortMark = (field) => safeSortBy === field ? (sortOrder === 'asc' ? '↑' : '↓') : ''
  return (
    <section className="workspace">
      <div className="dashboard-toolbar"><div><h2>模板中心</h2><p>在列表中查找模板，进入独立页面完成配置、调试和发布。</p></div><button className="primary-button" type="button" onClick={() => { setEditing({ ...EMPTY_TEMPLATE, _id: '' }); setEditId('new') }}><Plus size={16} />新建模板</button></div>
      <FilterBar keyword={keyword} onKeywordChange={setKeyword} placeholder="搜索模板名称或ID" onReset={() => { setKeyword(''); setStatus(''); setZone(''); setCategory(''); setBadge(''); setModel(''); setDateFrom(''); setDateTo('') }}>
        <label>小程序状态<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部</option><option value="draft">未发布</option><option value="published">已发布</option><option value="offline">已下线</option></select></label>
        <label>专区<select value={zone} onChange={(event) => setZone(event.target.value)}><option value="">全部专区</option>{Object.entries(ZONE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label>分类<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">全部分类</option>{(list.refs?.groups || []).map((item) => <option value={item.name} key={item._id}>{item.name}</option>)}</select></label>
        <label>推荐标识<select value={badge} onChange={(event) => setBadge(event.target.value)}><option value="">全部</option>{Object.entries(BADGE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label>能力策略<select value={model} onChange={(event) => setModel(event.target.value)}><option value="">全部</option>{(list.refs?.models || []).map((item) => <option value={modelCallIdOf(item)} key={modelCallIdOf(item)}>{modelOptionLabel(item)}</option>)}</select></label>
        <label>开始日期<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
        <label>结束日期<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
      </FilterBar>
      <div className="table-wrap operations-table">
        <table>
          <thead>
            <tr>
              <th>模板</th><th>缩略图</th><th>ID</th><th>类型</th><th>主力模型</th><th>展示位置</th><th>推荐标识</th><th>小程序状态</th>
              <th><button className={`sort-button ${safeSortBy === 'createdAt' ? 'active' : ''}`} type="button" onClick={() => toggleSort('createdAt')}>创建时间 {sortMark('createdAt')}</button></th>
              <th><button className={`sort-button ${safeSortBy === 'updatedAt' ? 'active' : ''}`} type="button" onClick={() => toggleSort('updatedAt')}>修改时间 {sortMark('updatedAt')}</button></th>
              <th />
            </tr>
          </thead>
          {!list.loading && !list.error && list.items.length ? <tbody>{list.items.map((item) => {
            const state = publishStatus(item)
            return (
              <tr key={item._id}>
                <td><button className="template-name-button" type="button" onClick={() => setEditId(item._id)}>{item.name}</button>{item.has_unpublished_changes ? <small className="cell-subtitle">有未发布修改</small> : null}</td>
                <td><CoverThumb src={item.cover_url} name={item.name} /></td>
                <td><span className="id-cell mono">{item._id.slice(0, 8)}<button className="icon-button" aria-label="复制完整模板ID" onClick={() => copyText(item._id)}><Copy size={13} /></button></span></td>
                <td>{TEMPLATE_TYPE_LABELS[item.template_type] || '图生图'}</td>
                <td><span className="mono">{modelCallIdOf(item) || '未配置'}</span></td>
                <td className="placement-cell"><PlacementQuickEdit item={item} groups={list.refs?.groups || []} onSaved={list.reload} /></td>
                <td>{BADGE_LABELS[item.tag || 'normal']}</td>
                <td><span className={`status-chip ${state.key}`}>{state.label}</span></td>
                <td>{dateText(item.createdAt)}</td>
                <td>{dateText(item.updatedAt)}</td>
                <td className="row-actions"><button className="secondary-button" onClick={() => setEditId(item._id)}>编辑</button><button className="icon-button" aria-label="删除模板" onClick={() => remove(item)}><Trash2 size={15} /></button></td>
              </tr>
            )
          })}</tbody> : null}
          <TableState loading={list.loading} error={list.error} empty={!list.items.length} filtered={Boolean(keyword || status || zone || category || badge || model || dateFrom || dateTo)} colSpan={11} />
        </table>
      </div>
      {!list.loading && !list.error ? <StandardPager {...list} total={list.total || 0} /> : null}
      <ConfirmDialogHost />
    </section>
  )
}

function placementOrder(item, zone, group) {
  const values = (item.placements || [])
    .filter((entry) => entry.zone === zone && (!group || entry.group === group))
    .map((entry) => Number(entry.sort_order || entry.sortOrder || 0))
    .filter((value) => value > 0)
  return values.length ? Math.min(...values) : Number.MAX_SAFE_INTEGER
}

export function RecommendationV22Panel() {
  const [zone, setZone] = useHashParamState('zone', 'boss')
  const [group, setGroup] = useHashParamState('group')
  const [groups, setGroups] = useState([])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [dragIndex, setDragIndex] = useState(-1)
  const load = async (selectedGroup = group) => {
    if (!selectedGroup) { setItems([]); setDirty(false); setLoading(false); return }
    setLoading(true)
    try {
      const rows = []
      for (let page = 1; page <= 20; page += 1) {
        const result = await callAdmin('listFeatures', { zone, filters: { lifecycleStatus: 'published', categoryId: selectedGroup }, sortBy: 'updatedAt', sortOrder: 'desc', page, pageSize: 100 })
        rows.push(...(result.data || []))
        if (rows.length >= Number(result.total || 0) || !(result.data || []).length) break
      }
      const ordered = rows
        .sort((a, b) => placementOrder(a, zone, selectedGroup) - placementOrder(b, zone, selectedGroup) || String(a._id).localeCompare(String(b._id)))
        .map((item, index) => ({ ...item, draft_order: index + 1, draft_tag: item.tag || 'normal' }))
      setItems(ordered); setDirty(false)
    } finally { setLoading(false) }
  }
  useEffect(() => {
    let cancelled = false
    const loadGroups = async () => {
      setLoading(true)
      try {
        const result = await callAdmin('listGroups', { zone, filters: { status: 1 }, sortBy: 'sort', sortOrder: 'asc', page: 1, pageSize: 100 })
        if (cancelled) return
        const enabled = (result.data || []).filter((item) => Number(item.status) === 1)
        setGroups(enabled)
        const nextGroup = enabled.some((item) => item.name === group) ? group : (enabled[0]?.name || '')
        if (nextGroup !== group) setGroup(nextGroup)
        else await load(nextGroup)
      } finally { if (!cancelled) setLoading(false) }
    }
    loadGroups()
    return () => { cancelled = true }
  }, [zone])
  useEffect(() => { if (group && groups.some((item) => item.name === group)) load(group) }, [group])
  useEffect(() => { const warn = (event) => { if (!dirty) return; event.preventDefault(); event.returnValue = '' }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn) }, [dirty])
  const reorder = (from, to) => {
    if (from < 0 || to < 0 || from === to) return
    const next = [...items]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved)
    setItems(next.map((item, index) => ({ ...item, draft_order: index + 1 }))); setDirty(true)
  }
  const save = async () => {
    const duplicates = items.filter((item, index) => items.some((other, otherIndex) => otherIndex !== index && other.draft_order === item.draft_order))
    if (duplicates.length) { toast('error', `排序值重复：${duplicates.map((item) => item.name).join('、')}`); return }
    setSaving(true)
    try {
      await callAdmin('saveRecommendationOrder', {
        zone,
        group,
        items: items.map((item) => ({ template_id: item._id, sort_order: Number(item.draft_order), tag: item.draft_tag || item.tag || 'normal' }))
      })
      await load(group)
    } finally { setSaving(false) }
  }
  return (
    <section className="workspace">
      <div className="dashboard-toolbar">
        <div>
          <h2>推荐位与排序</h2>
          <p>按启用分类筛选后，只对该分类内的已发布模板排序；可拖拽，也可置顶/置底。推荐标识只作为标签，不影响排序。未保存刷新即丢。</p>
        </div>
        <div className="toolbar">
          {dirty ? <span className="unsaved-badge">排序尚未保存</span> : null}
          <button className="secondary-button" type="button" onClick={() => load(group)} disabled={loading}><RefreshCw size={15} />刷新</button>
          <button className="primary-button" type="button" onClick={save} disabled={!dirty || saving || !items.length}>{saving ? <Loader2 className="spin" size={15} /> : <Save size={15} />}保存排序</button>
        </div>
      </div>
      <div className="placement-tabs">
        <div className="table-tabs" role="tablist">{Object.entries(ZONE_LABELS).map(([value, label]) => <button type="button" role="tab" aria-selected={zone === value} className={zone === value ? 'active' : ''} key={value} onClick={() => { setZone(value); setDirty(false) }}>{label}</button>)}</div>
        <label className="ordering-group-select">分类
          <select aria-label="启用分类" value={group} onChange={(event) => { setGroup(event.target.value); setDirty(false) }} disabled={!groups.length}>
            {!groups.length ? <option value="">暂无启用分类</option> : null}
            {groups.map((item) => <option value={item.name} key={item._id || item.name}>{item.name}</option>)}
          </select>
        </label>
      </div>
      {loading ? <div className="analytics-empty"><Loader2 className="spin" size={20} />正在加载排序</div> : !groups.length ? <div className="analytics-empty">当前专区没有启用中的分类</div> : !items.length ? <div className="analytics-empty">当前分类没有已发布模板</div> : (
        <div className="ordering-list">
          <div className="ordering-list-head ordering-row" aria-hidden="true">
            <span />
            <span>模板</span>
            <span>缩略图</span>
            <span>ID</span>
            <span>推荐标识</span>
            <span className="ordering-groups">展示分类</span>
            <span className="ordering-rating">夯</span>
            <span className="ordering-rating">拉</span>
            <span>排序</span>
            <span />
          </div>
          {items.map((item, index) => (
            <div
              className="ordering-row"
              draggable
              key={item._id}
              onDragStart={(event) => {
                if (event.target.closest('button, input, select, label')) {
                  event.preventDefault()
                  return
                }
                setDragIndex(index)
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => { reorder(dragIndex, index); setDragIndex(-1) }}
            >
              <GripVertical size={18} aria-label="拖拽排序" />
              <strong className="ordering-name">{item.name}</strong>
              <CoverThumb src={item.cover_url} name={item.name} />
              <span className="id-cell mono">{item._id.slice(0, 8)}<button className="icon-button" type="button" aria-label="复制完整模板ID" onClick={() => copyText(item._id)}><Copy size={13} /></button></span>
              <label>
                <span className="sr-only">{item.name} 推荐标识</span>
                <select value={item.draft_tag || item.tag || 'normal'} onChange={(event) => { setItems(items.map((row, rowIndex) => rowIndex === index ? { ...row, draft_tag: event.target.value } : row)); setDirty(true) }}>
                  {Object.entries(BADGE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                </select>
              </label>
              <span className="ordering-groups">{item.placements?.filter((entry) => entry.zone === zone).map((entry) => entry.group).join('、') || group}</span>
              <span className="ordering-rating" title="用户真实评价夯数">{ratingCountOf(item, 'hang')}</span>
              <span className="ordering-rating" title="用户真实评价拉数">{ratingCountOf(item, 'la')}</span>
              <label>
                <span className="sr-only">{item.name} 排序</span>
                <input type="number" min="1" value={item.draft_order} onChange={(event) => { setItems(items.map((row, rowIndex) => rowIndex === index ? { ...row, draft_order: Number(event.target.value) } : row)); setDirty(true) }} />
              </label>
              <div className="ordering-pin-actions">
                <button className="secondary-button" type="button" disabled={index === 0} aria-label={`将${item.name}置顶`} onPointerDown={(event) => event.stopPropagation()} onClick={() => reorder(index, 0)}><ChevronsUp size={14} />置顶</button>
                <button className="secondary-button" type="button" disabled={index === items.length - 1} aria-label={`将${item.name}置底`} onPointerDown={(event) => event.stopPropagation()} onClick={() => reorder(index, items.length - 1)}><ChevronsDown size={14} />置底</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function fileExtension(name = '') {
  return name.includes('.') ? name.slice(name.lastIndexOf('.')) : '.jpg'
}

function toFolderPrefix(value = '') {
  const cleaned = cleanPath(value)
  if (!cleaned) return ''
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(cleaned)) {
    const slash = cleaned.lastIndexOf('/')
    return slash >= 0 ? cleaned.slice(0, slash + 1) : ''
  }
  return cleaned.endsWith('/') ? cleaned : `${cleaned}/`
}

function uniqueFileName(name, used) {
  const extension = fileExtension(name)
  const stem = (name.slice(0, Math.max(name.length - extension.length, 0)) || 'image').trim() || 'image'
  let candidate = `${stem}${extension}`
  let index = 1
  while (used.has(candidate.toLowerCase())) {
    index += 1
    candidate = `${stem}_${index}${extension}`
  }
  used.add(candidate.toLowerCase())
  return candidate
}

function imageSaveText(item = {}) {
  if (item.saveStatus === 'saved') return '是'
  if (item.saveStatus === 'not_saved') return '否'
  if (item.saveStatus === 'unknown') return '—'
  return ''
}

function UploadImageDialog({ onClose, onUploaded }) {
  const [name, setName] = useState('')
  const [objectPath, setObjectPath] = useState('')
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState('')
  const submit = async (event) => {
    event.preventDefault()
    if (!files.length) return
    setUploading(true)
    setProgress('')
    const used = new Set()
    const uploaded = []
    const failed = []
    try {
      for (const [index, file] of files.entries()) {
        setProgress(`正在上传 ${index + 1}/${files.length}：${file.name}`)
        try {
          const extension = fileExtension(file.name)
          let relativePath
          if (files.length === 1) {
            relativePath = cleanPath(objectPath || file.name)
            if (!relativePath.toLowerCase().endsWith(extension.toLowerCase())) relativePath = `${relativePath || Date.now()}${extension}`
          } else {
            relativePath = `${toFolderPrefix(objectPath)}${uniqueFileName(file.name, used)}`
          }
          const cloudPath = `Pictures/${relativePath}`
          const result = await app.uploadFile({ cloudPath, filePath: file })
          uploaded.push({
            scope: 'operations',
            name: files.length === 1 ? (name || file.name) : file.name,
            objectKey: cloudPath,
            cloudPath,
            fileID: result.fileID,
            size: file.size,
            lastModified: new Date().toISOString()
          })
        } catch (err) {
          failed.push({ name: file.name, message: err.message || '上传失败' })
        }
      }
      if (!uploaded.length) throw new Error(failed[0]?.message || '上传失败')
      await callAdmin('createImageAssets', { scope: 'operations', items: uploaded })
      if (failed.length) toast('error', `${failed.length} 张图片上传失败：${failed.map((item) => item.name).join('、')}`)
      await onUploaded()
      onClose()
    } finally {
      setUploading(false)
      setProgress('')
    }
  }
  return (
    <div className="modal-backdrop">
      <form className="image-modal upload-image-dialog" onSubmit={submit}>
        <div className="section-head"><h2>新增运营图片</h2><button type="button" className="icon-button" aria-label="关闭" onClick={onClose}><X size={18} /></button></div>
        <LabeledField label="上传文件" name="operationImageFile">
          <input type="file" accept="image/*" multiple required={!files.length} onChange={(event) => setFiles(Array.from(event.target.files || []))} />
        </LabeledField>
        {files.length ? <p className="muted">已选择 {files.length} 张：{files.map((file) => file.name).join('、')}</p> : null}
        {files.length <= 1 ? <LabeledField label="图片名称" name="operationImageName"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="默认使用本地文件名" /></LabeledField> : <p className="muted">多图将使用原文件名；可填写统一目录前缀。</p>}
        <LabeledField label={files.length > 1 ? '目录前缀' : '对象路径'} name="operationImagePath">
          <input value={objectPath} onChange={(event) => setObjectPath(event.target.value)} placeholder={files.length > 1 ? '例如 campaign/；固定上传到 Pictures/' : '例如 campaign/banner.jpg；固定上传到 Pictures/'} />
        </LabeledField>
        {progress ? <p className="muted">{progress}</p> : null}
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onClose}>取消</button>
          <button className="primary-button" disabled={!files.length || uploading}>{uploading ? <Loader2 className="spin" size={15} /> : <ImagePlus size={15} />}{files.length > 1 ? `上传 ${files.length} 张` : '上传'}</button>
        </div>
      </form>
    </div>
  )
}

export function ImagesV22Panel() {
  const [scope, setScope] = useHashParamState('scope', 'user')
  const [keyword, setKeyword] = useHashParamState('keyword')
  const [templateId, setTemplateId] = useHashParamState('templateId')
  const [dateFrom, setDateFrom] = useHashParamState('dateFrom')
  const [dateTo, setDateTo] = useHashParamState('dateTo')
  const [selected, setSelected] = useState([])
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState(null)
  const [preview, setPreview] = useState(null)
  const [showUpload, setShowUpload] = useState(false)
  const debouncedKeyword = useDebouncedValue(keyword)
  const list = usePagedAdminList('listImages', () => ({ scope, keyword: debouncedKeyword, template_id: scope === 'user' ? templateId : '', start_date: dateFrom, end_date: dateTo, sortBy: 'lastModified', sortOrder: 'desc' }), [scope, debouncedKeyword, templateId, dateFrom, dateTo])
  useEffect(() => { setSelected([]); setSyncResult(null) }, [scope, list.page, list.pageSize])
  const sync = async () => { setSyncing(true); try { const result = await callAdmin('syncStorageAssets', { scope }); setSyncResult(result); await list.reload() } finally { setSyncing(false) } }
  const remove = async (item) => {
    if (!await confirmAction({ title: '删除图片', description: '删除前系统会再次检查模板、生成记录和运行中任务引用。', objectName: item.name || item.objectKey, objectId: item._id, impact: '未被引用时将同时删除云文件和索引。', recovery: '物理删除不可恢复。', confirmLabel: '确认删除图片' })) return false
    await callAdmin('deleteImageAsset', { id: item._id }); return true
  }
  const removeSelected = async () => {
    if (!selected.length || !await confirmAction({ title: '批量删除图片', description: `将逐项检查并处理 ${selected.length} 张图片。`, impact: '被引用图片会跳过，未引用图片会物理删除。', recovery: '物理删除不可恢复。', confirmLabel: `确认删除 ${selected.length} 张图片` })) return
    const failed = []
    for (const id of selected) { try { await callAdmin('deleteImageAsset', { id }) } catch (err) { failed.push({ id, message: err.message }) } }
    setSelected([]); await list.reload(); if (failed.length) toast('error', `${failed.length} 张图片因引用或错误未删除`)
  }
  const download = (item) => { const link = document.createElement('a'); link.href = item.temporaryUrl || item.fileID; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.download = item.name || 'image'; document.body.appendChild(link); link.click(); link.remove() }
  return <section className="workspace"><div className="dashboard-toolbar"><div><h2>图片中心</h2><p>用户图片用于追溯生成链路；运营图片用于模板配置和页面展示。</p></div><div className="toolbar"><button className="secondary-button" type="button" disabled={syncing} onClick={sync}>{syncing ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}同步图片</button>{scope === 'operations' ? <button className="primary-button" type="button" onClick={() => setShowUpload(true)}><ImagePlus size={15} />新增图片</button> : null}</div></div><div className="table-tabs" role="tablist"><button type="button" role="tab" aria-selected={scope === 'user'} className={scope === 'user' ? 'active' : ''} onClick={() => setScope('user')}>用户图片</button><button type="button" role="tab" aria-selected={scope === 'operations'} className={scope === 'operations' ? 'active' : ''} onClick={() => setScope('operations')}>运营图片</button></div>{scope === 'operations' ? <p className="muted storage-hint">运营图片读取云存储 Pictures 目录，可点击“同步图片”刷新索引。</p> : null}{syncResult ? <div className="sync-summary">已扫描 {syncResult.scanned} 个对象，新增 {syncResult.created}，更新 {syncResult.updated}，跳过 {syncResult.skipped}，失败 {syncResult.failed?.length || 0}。</div> : null}<FilterBar keyword={keyword} onKeywordChange={setKeyword} placeholder="搜索图片名称或对象Key" onReset={() => { setKeyword(''); setTemplateId(''); setDateFrom(''); setDateTo('') }}>{scope === 'user' ? <label>关联模板<select value={templateId} onChange={(event) => setTemplateId(event.target.value)}><option value="">全部模板</option>{(list.refs?.templates || []).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label> : null}<label>开始日期<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label><label>结束日期<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label></FilterBar><div className="list-action-bar"><button className="secondary-button danger" type="button" disabled={!selected.length} onClick={removeSelected}><Trash2 size={14} />批量删除{selected.length ? `（${selected.length}）` : ''}</button></div><div className="table-wrap operations-table"><table><thead><tr><th><input type="checkbox" aria-label="选择当前页全部图片" checked={list.items.length > 0 && list.items.every((item) => selected.includes(item._id))} onChange={(event) => setSelected(event.target.checked ? list.items.map((item) => item._id) : [])} /></th><th>预览</th><th>图片名称</th><th>对象Key</th>{scope === 'user' ? <><th>关联模板</th><th>使用模型</th><th>上传/生成用户</th><th>是否被保存</th></> : <th>文件大小</th>}<th>{scope === 'user' ? '创建时间' : '上传时间'}</th><th>操作</th></tr></thead>{!list.loading && !list.error && list.items.length ? <tbody>{list.items.map((item) => <tr key={item._id}><td><input type="checkbox" aria-label={`选择${item.name || item.objectKey}`} checked={selected.includes(item._id)} onChange={(event) => setSelected(event.target.checked ? [...selected, item._id] : selected.filter((id) => id !== item._id))} /></td><td><button className="thumb-button" onClick={() => setPreview(item)}>{item.temporaryUrl ? <img className="thumb" src={item.temporaryUrl} alt={item.name || '图片'} /> : <span>预览</span>}</button></td><td>{item.name || '—'}</td><td><span className="id-cell mono">{item.objectKey || item.cloudPath}<button className="icon-button" aria-label="复制对象Key" onClick={() => copyText(item.objectKey || item.cloudPath)}><Copy size={13} /></button></span></td>{scope === 'user' ? <><td>{item.featureName || item.featureId || '—'}</td><td>{item.modelCallId || item.model_call_id || '—'}</td><td className="mono">{item.ownerOpenid || item.generatedOpenid || item._openid || '—'}</td><td title={item.saveStatus === 'unknown' ? '历史版本没有精确保存成功埋点，暂时无法判断' : ''}>{imageSaveText(item)}</td></> : <td>{item.size ? `${(Number(item.size) / 1024).toFixed(1)} KB` : '—'}</td>}<td>{dateText(item.lastModified || item.createdAt)}</td><td className="row-actions"><button className="icon-button" aria-label="下载图片" disabled={!item.temporaryUrl && !item.fileID} onClick={() => download(item)}><Download size={15} /></button><button className="icon-button" aria-label="删除图片" onClick={async () => { if (await remove(item)) { await list.reload() } }}><Trash2 size={15} /></button></td></tr>)}</tbody> : null}<TableState loading={list.loading} error={list.error} empty={!list.items.length} filtered={Boolean(keyword || templateId || dateFrom || dateTo)} colSpan={scope === 'user' ? 10 : 7} /></table></div>{!list.loading && !list.error ? <StandardPager {...list} total={list.total || 0} /> : null}{showUpload ? <UploadImageDialog onClose={() => setShowUpload(false)} onUploaded={list.reload} /> : null}{preview ? <div className="modal-backdrop"><div className="image-modal"><div className="section-head"><h2>{preview.name || '图片预览'}</h2><button className="icon-button" aria-label="关闭预览" onClick={() => setPreview(null)}><X size={18} /></button></div><img src={preview.temporaryUrl || preview.fileID} alt={preview.name || '图片预览'} /><p className="mono">{preview.objectKey || preview.fileID}</p></div></div> : null}<ConfirmDialogHost /></section>
}
