import { useEffect, useId, useState } from 'react'
import { animate, motion, useMotionValue, useMotionValueEvent, useReducedMotion } from 'motion/react'
import { arc, area, curveMonotoneX, pie, scaleBand, scaleLinear } from 'd3'
import { formatDay } from '@/features/calendar/time'
import type { DailyStatus } from './model'
import { statusOrder } from './model'

const shortStatus: Record<string, string> = {
  'Request recorded': 'Recorded',
  'Coordination in progress': 'In progress',
  'Waiting for parent approval': 'Awaiting approval',
  'Parent approval recorded': 'Parent approval',
  'Coordination ended': 'Ended',
  'Recorded status not recognized': 'Other recorded',
}

export function CountUp({ value }: { value: number }) {
  const reduced = useReducedMotion()
  const current = useMotionValue(value)
  const [shown, setShown] = useState(value)
  useMotionValueEvent(current, 'change', latest => setShown(Math.round(latest)))
  useEffect(() => {
    if (reduced || value === 0) { current.set(value); setShown(value); return }
    current.set(0)
    const control = animate(current, value, { duration: .75, ease: [0.23, 1, 0.32, 1] })
    return () => control.stop()
  }, [current, reduced, value])
  return <span aria-label={`${value}`}>{shown}</span>
}

/** Six five-day bins retain recorded totals; their smoothed edges are presentation, not extra events. */
export function RequestsStream({ days }: { days: DailyStatus[] }) {
  const reduced = useReducedMotion()
  const id = useId().replaceAll(':', '')
  const bins = Array.from({ length: 6 }, (_, index) => {
    const slice = days.slice(index * 5, index * 5 + 5)
    return { label: `${formatDay(slice[0].day)}–${formatDay(slice[4].day)}`, total: slice.reduce((sum, day) => sum + day.total, 0), counts: Object.fromEntries(statusOrder.map(status => [status, slice.reduce((sum, day) => sum + (day.counts[status] ?? 0), 0)])) }
  })
  const present = statusOrder.filter(label => bins.some(bin => bin.counts[label]))
  const maximum = Math.max(1, ...bins.map(bin => bin.total))
  const y = scaleLinear().domain([0, maximum]).range([49, 13])
  const x = scaleLinear().domain([0, 5]).range([12, 188])
  return <div className="vp-stream-wrap">
    <ul className="vp-stream-legend" aria-label="Current status groups">{present.map(label => <li key={label} title={label}><span className={`vp-key vp-chart-color-${statusOrder.indexOf(label)}`} aria-hidden="true"/>{shortStatus[label]}</li>)}</ul>
    <svg viewBox="0 0 200 72" role="img" aria-labelledby={`${id}-title`} aria-describedby={`${id}-desc`}>
      <title id={`${id}-title`}>Requests over 30 Detroit dates, grouped by current recorded status</title>
      <desc id={`${id}-desc`}>Six five-day totals from the caller-visible pickup cohort. The status of each job is its current recorded status, not a reconstructed status history.</desc>
      <defs>{present.map(label => { const index = statusOrder.indexOf(label); return <linearGradient key={label} id={`${id}-stream-${index}`} x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stopColor={`var(--vp-c${index})`} stopOpacity=".95"/><stop offset="100%" stopColor={`var(--vp-c${index})`} stopOpacity=".42"/></linearGradient> })}</defs>
      {[0, maximum].map(value => <line key={value} x1="12" x2="188" y1={y(value)} y2={y(value)} className="vp-chart-grid"/>)}
      {present.map(label => {
        const index = statusOrder.indexOf(label)
        const points = bins.map((bin, binIndex) => {
          const lower = statusOrder.slice(0, index).reduce((sum, prior) => sum + bin.counts[prior], 0)
          return { x: x(binIndex), y0: y(lower), y1: y(lower + bin.counts[label]) }
        })
        const d = area<typeof points[number]>().x(point => point.x).y0(point => point.y0).y1(point => point.y1).curve(curveMonotoneX)(points) ?? ''
        return <motion.path key={label} d={d} fill={`url(#${id}-stream-${index})`} className="vp-stream-layer" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .6, delay: index * .08 }}/>
      })}
      {[0, 2, 5].map(index => <text key={index} x={x(index)} y="65" textAnchor={index === 0 ? 'start' : index === 5 ? 'end' : 'middle'} className="vp-chart-axis">{formatDay(days[index * 5].day).split(', ')[1]}</text>)}
    </svg>
    <details className="vp-daily"><summary>Read daily counts</summary><table><caption>Requests by Detroit creation date and current status</caption><thead><tr><th>Date</th><th>Requests</th><th>Current status</th></tr></thead><tbody>{days.filter(day => day.total).map(day => <tr key={day.day}><th scope="row">{formatDay(day.day)}</th><td>{day.total}</td><td>{statusOrder.filter(label => day.counts[label]).map(label => `${label}: ${day.counts[label]}`).join('; ')}</td></tr>)}</tbody></table></details>
  </div>
}

export function ContactGauge({ contacted, total }: { contacted: number; total: number }) {
  const reduced = useReducedMotion()
  const ratio = total ? contacted / total : 0
  const shape = arc().innerRadius(24).outerRadius(31).cornerRadius(3)
  const track = shape({ innerRadius: 24, outerRadius: 31, startAngle: -Math.PI / 2, endAngle: Math.PI / 2 }) ?? ''
  const fill = shape({ innerRadius: 24, outerRadius: 31, startAngle: -Math.PI / 2, endAngle: -Math.PI / 2 + ratio * Math.PI }) ?? ''
  return <div className="vp-gauge-wrap"><svg viewBox="0 0 80 54" role="img" aria-label={`${contacted} of ${total} jobs have a contact attempt recorded`}><defs><linearGradient id="vp-gauge-gradient" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stopColor="#8b5cf6"/><stop offset="100%" stopColor="#a78bfa"/></linearGradient></defs><g transform="translate(40 39)"><path d={track} className="vp-gauge-track"/><motion.path d={fill} fill="url(#vp-gauge-gradient)" className="vp-gauge-fill" initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: .8, ease: [0.23, 1, 0.32, 1] }}/></g></svg><div className="vp-gauge-value"><CountUp value={contacted}/><span> of {total}</span></div></div>
}

export function StatusDonut({ counts }: { counts: Record<string, number> }) {
  return <SegmentDonut segments={statusOrder.map((label, index) => ({ label, index, value: counts[label] ?? 0 })).filter(item => item.value)} />
}

export function ApprovalDonut({ approved, pending }: { approved: number; pending: number }) {
  return <SegmentDonut segments={[{ label: 'Parent approval recorded', index: 0, value: approved }, { label: 'Waiting for parent approval', index: 3, value: pending }].filter(item => item.value)} />
}

function SegmentDonut({ segments }: { segments: { label: string; index: number; value: number }[] }) {
  const reduced = useReducedMotion()
  const total = segments.reduce((sum, item) => sum + item.value, 0)
  const slices = pie<typeof segments[number]>().value(item => item.value).sort(null)(segments)
  const shape = arc<typeof slices[number]>().innerRadius(17).outerRadius(24).cornerRadius(1)
  return <div className="vp-donut-wrap"><div className="vp-donut-chart"><svg viewBox="0 0 60 60" role="img" aria-label={`${total} requests in this breakdown`}><circle cx="30" cy="30" r="20.5" fill="none" className="vp-ring-track" strokeWidth="7"/><g transform="translate(30 30)">{slices.map(slice => <motion.path key={slice.data.label} d={shape(slice) ?? ''} className={`vp-chart-color-${slice.data.index}`} initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: .8, ease: [0.23, 1, 0.32, 1] }}/>)}</g><text x="30" y="33" textAnchor="middle" className="vp-donut-total">{total}</text></svg></div><ul className="vp-status-list">{segments.map(item => <li key={item.label} title={item.label}><span className={`vp-key vp-chart-color-${item.index}`} aria-hidden="true"/><span aria-label={item.label}>{shortStatus[item.label] ?? item.label}</span><strong>{item.value}</strong></li>)}</ul></div>
}

export function WeekdayBars({ values }: { values: number[] }) {
  const reduced = useReducedMotion()
  const maximum = Math.max(1, ...values)
  const x = scaleBand<number>().domain(values.map((_, index) => index)).range([16, 186]).padding(.28)
  const y = scaleLinear().domain([0, maximum]).range([54, 16])
  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  return <svg className="vp-weekday-chart" viewBox="0 0 200 72" role="img" aria-label={`Requests by Detroit creation weekday: ${labels.map((label, index) => `${label} ${values[index]}`).join(', ')}`}><defs><linearGradient id="vp-weekday-gradient" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stopColor="#fbbf24"/><stop offset="35%" stopColor="#f97316"/><stop offset="100%" stopColor="#ea580c"/></linearGradient></defs>{values.map((value, index) => { const left = x(index) ?? 0, barWidth = x.bandwidth(); return <g key={index}><rect x={left + 2} y="16" width={barWidth - 4} height="38" rx="3" className="vp-weekday-ghost"/><motion.rect x={left} y={y(value)} width={barWidth} height={54 - y(value)} rx="4" fill="url(#vp-weekday-gradient)" className="vp-weekday-lit" initial={reduced ? false : { scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ duration: .6, delay: index * .06 }} style={{ transformBox: 'fill-box', transformOrigin: 'bottom' }}/><text x={left + barWidth / 2} y="68" textAnchor="middle" className="vp-chart-axis">{labels[index]}</text></g> })}</svg>
}
