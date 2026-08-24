import React, { useEffect, useState } from 'react'
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, RefreshCw, TrendingUp, X } from 'lucide-react'
import { callAnalytics } from '../cloudbase'

const EVENT_LABELS = {
  app_open: '小程序启动', template_detail_view: '模板详情访问', template_generate_click: '立即生成点击',
  original_save_click: '保存原图点击', hd_save_click: '保存高清图点击',
  points_page_view: '星光页访问', recharge_click: '充值点击', recharge_succeeded: '充值成功', recharge_failed: '充值失败'
}

const CHANNEL_LABELS = {
  app_jump: 'APP跳转', recent_tasks: '任务栏/最近使用', mobile_search: '手机端搜索',
  official_account: '公众号', mini_program_jump: '其他小程序', share: '好友或群分享',
  qr_code: '普通码/小程序码', direct: '直接访问', other: '其他', unknown: '无法识别'
}

const FAILURE_STAGE_LABELS = {
  create_order: '创建订单', virtual_payment: '调起支付', query_order: '查单对账', user_cancel: '用户取消'
}

function shanghaiDate(offsetDays = 0) {
  const shifted = Date.now() + 8 * 60 * 60 * 1000 + offsetDays * 24 * 60 * 60 * 1000
  return new Date(shifted).toISOString().slice(0, 10)
}

function shiftDate(value, days) {
  const timestamp = Date.parse(`${value}T00:00:00+08:00`) + days * 24 * 60 * 60 * 1000
  return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

const number = (value) => value == null ? '—' : Number(value).toLocaleString('zh-CN')
const percent = (value) => value == null ? '—' : `${(Number(value) * 100).toFixed(1)}%`
const yuan = (cents) => cents ? `¥${(Number(cents) / 100).toFixed(2)}` : '—'

function MetricCard({ label, value, isPercent = false, hint }) {
  return <article className="metric-card"><span>{label}</span><strong>{isPercent ? percent(value) : number(value)}</strong><small>{hint}</small></article>
}

function EmptyState({ text }) {
  return <div className="analytics-empty"><TrendingUp size={22} /><span>{text}</span></div>
}

function RankingTable({ title, rows = [], type }) {
  return <section className="dashboard-card ranking-card">
    <div className="section-head"><h2>{title}</h2></div>
    {!rows.length ? <EmptyState text="所选日期暂无可统计数据" /> : <div className="table-wrap compact-table"><table>
      <thead><tr><th>#</th><th>模板</th>{type === 'detail' ? <><th>访问次数</th><th>访问用户</th></> : null}{type === 'usage' ? <><th>详情访问</th><th>立即生成</th><th>使用率</th></> : null}{type === 'hd' ? <><th>原图点击</th><th>高清点击</th><th>高清图保存率</th><th>保存成功</th><th>更新时间</th></> : null}</tr></thead>
      <tbody>{rows.map((row, index) => <tr key={row.templateId}>
        <td>{index + 1}</td><td><strong>{row.templateName}</strong><small className="cell-subtitle mono">{row.templateId}</small></td>
        {type === 'detail' ? <><td>{number(row.detailViews)}</td><td>{number(row.detailUsers)}</td></> : null}
        {type === 'usage' ? <><td>{number(row.detailViews)}</td><td>{number(row.generateClicks)}</td><td>{percent(row.usageRate)}{row.detailViews < 10 ? <span className="sample-badge">小样本</span> : null}</td></> : null}
        {type === 'hd' ? <><td>{number(row.originalSaveClicks)}</td><td>{number(row.hdSaveClicks)}</td><td title="本指标为高清保存点击/原图保存点击，不代表文件最终保存成功率">{percent(row.hdSaveRate)}{row.originalSaveClicks < 10 ? <span className="sample-badge">小样本</span> : null}</td><td>{number(row.hdSaveSuccesses)}</td><td>{row.updatedAt ? new Date(row.updatedAt).toLocaleString('zh-CN') : '—'}</td></> : null}
      </tr>)}</tbody>
    </table></div>}
  </section>
}

function TrendChart({ rows = [], days, onDaysChange }) {
  const maxValue = Math.max(1, ...rows.flatMap((row) => [row.activeUsers, row.newUsers, row.templateUsers].map((value) => Number(value) || 0)))
  return <section className="dashboard-card trend-card">
    <div className="section-head"><h2>用户趋势</h2><div className="toolbar"><span className="chart-legend"><i className="active" />活跃 <i className="new" />新增 <i className="template" />使用模板</span><select aria-label="用户趋势时间范围" value={days} onChange={(event) => onDaysChange(Number(event.target.value))}><option value="7">近7天</option><option value="15">近15天</option><option value="30">近30天</option></select></div></div>
    {!rows.length ? <EmptyState text="等待 app_open 埋点数据" /> : <div className="trend-bars">{rows.map((row) => <div className="trend-day" key={row.date} title={`${row.date} 活跃${number(row.activeUsers)} 新增${number(row.newUsers)} 使用模板${number(row.templateUsers)}`}><div className="trend-stack"><i className="active" style={{ height: `${Math.max(2, (Number(row.activeUsers) || 0) / maxValue * 100)}%` }} /><i className="new" style={{ height: `${Math.max(2, (Number(row.newUsers) || 0) / maxValue * 100)}%` }} /><i className="template" style={{ height: `${Math.max(2, (Number(row.templateUsers) || 0) / maxValue * 100)}%` }} /></div><small>{row.date.slice(5)}</small></div>)}</div>}
  </section>
}

function PaymentBoard({ data = {}, days, onDaysChange, onOpenFailures }) {
  const packages = data.packages || []
  return <section className="dashboard-card payment-card">
    <div className="section-head">
      <h2>星光套餐</h2>
      <div className="toolbar">
        <button className="secondary-button" type="button" onClick={onOpenFailures}>购买失败原因</button>
        <select aria-label="星光套餐时间范围" value={days} onChange={(event) => onDaysChange(Number(event.target.value))}>
          <option value="1">今日</option>
          <option value="7">近7天</option>
          <option value="15">近15天</option>
          <option value="30">近30天</option>
        </select>
      </div>
    </div>
    <div className="generation-summary payment-metrics">
      <MetricCard label="进入用户" value={data.page_users} hint="星光页去重用户" />
      <MetricCard label="点击次数" value={data.click_count} hint="充值按钮点击" />
      <MetricCard label="成功次数" value={data.success_count} hint="对账确认到账" />
      <MetricCard label="转化率" value={data.conversion_rate} isPercent hint="成功 / 点击" />
    </div>
    {!packages.length ? <EmptyState text="等待星光充值埋点数据" /> : <div className="table-wrap compact-table"><table>
      <thead><tr><th>套餐</th><th>价格</th><th>星光</th><th>点击</th><th>成功</th><th>转化率</th></tr></thead>
      <tbody>{packages.map((row) => (
        <tr key={row.package_id || row.product_id}>
          <td><strong>{row.package_label || row.package_id || '未知套餐'}</strong><small className="cell-subtitle mono">{row.product_id || row.package_id}</small></td>
          <td>{yuan(row.price_cents)}</td>
          <td>{number(row.points_amount)}</td>
          <td>{number(row.clicks)}</td>
          <td>{number(row.successes)}</td>
          <td>{percent(row.conversion_rate)}</td>
        </tr>
      ))}</tbody>
    </table></div>}
  </section>
}

function FailureDialog({ rows = [], onClose }) {
  return <div className="modal-backdrop" role="presentation" onClick={onClose}>
    <div className="image-modal payment-fail-dialog" role="dialog" aria-labelledby="payment-fail-title" onClick={(event) => event.stopPropagation()}>
      <div className="section-head">
        <h2 id="payment-fail-title">购买失败原因</h2>
        <button type="button" className="icon-button" aria-label="关闭" onClick={onClose}><X size={18} /></button>
      </div>
      {!rows.length ? <EmptyState text="所选窗口暂无失败记录" /> : <div className="table-wrap compact-table"><table>
        <thead><tr><th>日期</th><th>套餐</th><th>阶段</th><th>错误</th><th>订单号</th></tr></thead>
        <tbody>{rows.map((row, index) => (
          <tr key={`${row.order_no || 'fail'}-${index}`}>
            <td>{row.date || '—'}</td>
            <td>{row.package_label || row.package_id || '—'}</td>
            <td>{FAILURE_STAGE_LABELS[row.failure_stage] || row.failure_stage || '—'}</td>
            <td>{[row.error_type, row.error_code].filter(Boolean).join(' / ') || '—'}</td>
            <td className="mono">{row.order_no || '—'}</td>
          </tr>
        ))}</tbody>
      </table></div>}
    </div>
  </div>
}

export default function DashboardPanel() {
  const today = shanghaiDate()
  const [businessDate, setBusinessDate] = useState(today)
  const [trendDays, setTrendDays] = useState(7)
  const [paymentDays, setPaymentDays] = useState(7)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showFailures, setShowFailures] = useState(false)

  const load = async () => {
    setLoading(true); setError('')
    try { setData(await callAnalytics('getDashboardOverview', { business_date: businessDate, trend_days: trendDays, payment_days: paymentDays, timezone: 'Asia/Shanghai' })) }
    catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  useEffect(() => {
    load()
    const timer = window.setInterval(load, 5 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [businessDate, trendDays, paymentDays])

  const overview = data?.daily_overview || data?.overview || {}
  const trend = data?.user_trend || data?.userTrend || []
  const generation = data?.generation_performance || {}
  const payment = data?.payment_performance || {}
  const moveDate = (days) => setBusinessDate((current) => {
    const next = shiftDate(current, days)
    return next > today ? today : next
  })

  return <section className="dashboard-page">
    <div className="dashboard-toolbar"><div><h2>运营概览</h2><p>所有日指标按 Asia/Shanghai 自然日统计；用户趋势与星光套餐范围可分别选择。</p></div><div className="toolbar dashboard-date-control"><button className="icon-button" aria-label="前一天" onClick={() => moveDate(-1)}><ChevronLeft size={16} /></button><CalendarDays size={17} /><input aria-label="业务日期" type="date" value={businessDate} max={today} onChange={(event) => setBusinessDate(event.target.value)} /><button className="icon-button" aria-label="后一天" disabled={businessDate >= today} onClick={() => moveDate(1)}><ChevronRight size={16} /></button><button className="secondary-button" onClick={load} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} />刷新</button></div></div>
    {error ? <div className="data-alert error"><AlertTriangle size={18} />{error}</div> : null}
    {data?.missing_events?.length || data?.missingEvents?.length ? <div className="data-alert"><AlertTriangle size={18} /><span>以下指标缺少埋点：{(data.missing_events || data.missingEvents).map((name) => EVENT_LABELS[name] || name).join('、')}。缺失值不会按0处理。</span></div> : null}
    {data ? <div className="freshness-line"><span className={`status-dot ${data.data_status || data.dataStatus}`} />{data.is_provisional ?? data.isProvisional ? '动态数据' : '已定稿'} · 业务日期 {businessDate} · 更新于 {new Date(data.updated_at || data.updatedAt).toLocaleString('zh-CN')}</div> : null}
    <div className="metric-grid"><MetricCard label="每日活跃用户" value={overview.activeUsers} hint="打开小程序的去重用户" /><MetricCard label="新增用户" value={overview.newUsers} hint="当日首次访问用户" /><MetricCard label="使用模板用户" value={overview.templateUsers} hint="点击立即生成的去重用户" /><MetricCard label="模板触达率" value={overview.templateReachRate} isPercent hint="使用模板用户 / 活跃用户" /><MetricCard label="保存原图用户" value={overview.originalSaveUsers} hint="明确点击保存原图的用户" /><MetricCard label="模板总使用率" value={overview.totalUsageRate} isPercent hint="立即生成点击 / 详情访问" /><MetricCard label="生图成功率" value={overview.generationSuccessRate} isPercent hint="成功任务 / 提交任务" /></div>
    {loading && !data ? <EmptyState text="正在汇总运营数据…" /> : null}
    {data ? <>
      <div className="dashboard-two-column">
        <TrendChart rows={trend} days={trendDays} onDaysChange={setTrendDays} />
        <PaymentBoard data={payment} days={paymentDays} onDaysChange={setPaymentDays} onOpenFailures={() => setShowFailures(true)} />
      </div>
      <div className="dashboard-three-column">
        <RankingTable title="模板详情访问 Top 10" rows={data.template_detail_rankings || data.templateDetailRankings} type="detail" />
        <RankingTable title="模板使用率 Top 10" rows={data.template_usage_rankings || data.templateUsageRankings} type="usage" />
        <RankingTable title="高清图保存率 Top 10" rows={data.hd_save_rankings || data.hdSaveRankings} type="hd" />
      </div>
      <div className="dashboard-two-column">
        <section className="dashboard-card">
          <div className="section-head"><h2>渠道模板使用率</h2></div>
          {!(data.channel_breakdown || data.channels)?.length ? <EmptyState text="等待渠道归因埋点" /> : <div className="table-wrap compact-table"><table><thead><tr><th>渠道</th><th>详情访问</th><th>立即生成</th><th>使用率</th></tr></thead><tbody>{(data.channel_breakdown || data.channels).map((row) => <tr key={row.channel}><td>{CHANNEL_LABELS[row.channel] || row.channel}</td><td>{number(row.detailViews)}</td><td>{number(row.generateClicks)}</td><td>{percent(row.usageRate)}</td></tr>)}</tbody></table></div>}
        </section>
        <section className="dashboard-card">
          <div className="section-head"><h2>生图性能</h2><span className="muted">{businessDate}</span></div>
          <div className="generation-summary"><MetricCard label="提交任务" value={generation.submitted_count} hint="已排除后台调试" /><MetricCard label="成功任务" value={generation.succeeded_count} hint="服务端最终状态" /><MetricCard label="失败任务" value={generation.failed_count} hint="可前往任务中心处理" /><MetricCard label="成功率" value={generation.success_rate} isPercent hint="成功 / 提交" /></div>
          {generation.failure_reasons?.length ? <ul className="failure-list">{generation.failure_reasons.map((item) => <li key={item.reason}><span>{item.reason}</span><strong>{item.count}</strong></li>)}</ul> : <EmptyState text="所选日期暂无失败任务" />}
        </section>
      </div>
    </> : null}
    {showFailures ? <FailureDialog rows={payment.failure_details || []} onClose={() => setShowFailures(false)} /> : null}
  </section>
}
