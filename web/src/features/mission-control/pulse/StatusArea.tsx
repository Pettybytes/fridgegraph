import { formatDay } from '@/features/calendar/time'
import { path, scaleBand, scaleLinear } from 'd3'
import type { DailyStatus } from './model'
import { statusOrder } from './model'

const y0 = 18, height = 156

function bandPath(days: DailyStatus[], label: string, x0: number, width: number, maximum: number): string {
  const x = scaleBand<string>().domain(days.map(day => day.day)).range([x0, x0 + width])
  const y = scaleLinear().domain([0, maximum]).range([y0 + height, y0])
  const points = days.map(day => {
    const previous = statusOrder.slice(0, statusOrder.indexOf(label as typeof statusOrder[number]))
      .reduce((sum, status) => sum + (day.counts[status] ?? 0), 0)
    const value = day.counts[label] ?? 0
    const left = x(day.day) ?? x0
    return { left, right: left + x.bandwidth(), upper: y(previous + value), lower: y(previous) }
  })
  const shape = path()
  points.forEach((point, index) => {
    if (!index) shape.moveTo(point.left, point.upper)
    else shape.lineTo(point.left, point.upper)
    shape.lineTo(point.right, point.upper)
  })
  points.reverse().forEach(point => {
    shape.lineTo(point.right, point.lower)
    shape.lineTo(point.left, point.lower)
  })
  shape.closePath()
  return shape.toString()
}

/** A stepped area represents discrete Detroit creation dates, grouped by CURRENT job status. */
export function StatusArea({ days, compact = false }: { days: DailyStatus[]; compact?: boolean }) {
  const x0 = compact ? 27 : 44
  const width = compact ? 312 : 648
  const maximum = Math.max(1, ...days.map(day => day.total))
  const x = scaleBand<string>().domain(days.map(day => day.day)).range([x0, x0 + width])
  const y = scaleLinear().domain([0, maximum]).range([y0 + height, y0])
  const present = statusOrder.filter(label => days.some(day => day.counts[label]))
  const middle = Math.floor(days.length / 2)
  return <>
    <svg className="vp-area" viewBox={`0 0 ${compact ? 360 : 720} 220`} role="img" aria-labelledby="vp-area-title" aria-describedby="vp-area-desc">
      <title id="vp-area-title">Pickup requests by creation date and current recorded status</title>
      <desc id="vp-area-desc">Daily counts for the last 30 America/Detroit dates. Status is the job's current recorded status, not its status on the creation date. A table of nonzero dates follows.</desc>
      {[0, maximum].map(value => <g key={value}><line x1={x0} x2={x0 + width} y1={y(value)} y2={y(value)} className="vp-area-grid"/><text x={x0 - 9} y={y(value) + 4} textAnchor="end" className="vp-area-axis">{value}</text></g>)}
      {present.map(label => <path key={label} d={bandPath(days, label, x0, width, maximum)} className={`vp-area-band vp-area-${statusOrder.indexOf(label)}`} />)}
      {[0, middle, days.length - 1].map(index => <text key={index} x={(x(days[index].day) ?? x0) + x.bandwidth() / 2} y="202" textAnchor={index === 0 ? 'start' : index === days.length - 1 ? 'end' : 'middle'} className="vp-area-axis">{compact ? formatDay(days[index].day).split(', ')[1] : formatDay(days[index].day)}</text>)}
    </svg>
    <ul className="vp-legend" aria-label="Current recorded status groups">{present.map(label => <li key={label}><span className={`vp-legend-key vp-area-${statusOrder.indexOf(label)}`} aria-hidden="true" />{label}</li>)}</ul>
    <details className="vp-daily"><summary>Read daily counts</summary><table><caption>Requests by Detroit creation date and current status</caption><thead><tr><th>Date</th><th>Requests</th><th>Current status</th></tr></thead><tbody>{days.filter(day => day.total).map(day => <tr key={day.day}><th scope="row">{formatDay(day.day)}</th><td>{day.total}</td><td>{statusOrder.filter(label => day.counts[label]).map(label => `${label}: ${day.counts[label]}`).join('; ')}</td></tr>)}</tbody></table></details>
  </>
}
