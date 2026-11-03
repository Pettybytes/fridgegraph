/**
 * Dev-only gallery for the design-v2 Card family. Not a product route — it exists
 * so the one card family can be reviewed and screenshotted on the dark canvas
 * without the auth/picker flow. Served via web/showcase.html in dev.
 */
import type { ReactNode } from 'react'
import { Car, GraduationCap, Siren, Check, HeartPulse, Mail, Refrigerator, Sparkles, Loader, ArrowRight } from 'lucide-react'
import { Card, AccentCard, StatusCard, MediaCard, TimelineRow, PhotoCard, MetricTile, TypeNode, TypePill, ProgressBar, type CardType } from '@/components/fg/cards'
import { FgButton } from '@/components/fg/primitives'

const TYPES: { type: CardType; label: string; icon: ReactNode }[] = [
  { type: 'pickup', label: 'Pickup / transport', icon: <Car /> },
  { type: 'school', label: 'School notice', icon: <GraduationCap /> },
  { type: 'orbit', label: 'Orbit alert', icon: <Siren /> },
  { type: 'safe', label: 'Found safe', icon: <Check /> },
  { type: 'care', label: 'Care information', icon: <HeartPulse /> },
  { type: 'invite', label: 'Invitation', icon: <Mail /> },
  { type: 'fridge', label: 'Fridge / memories', icon: <Refrigerator /> },
  { type: 'rosina', label: 'Rosina (AI)', icon: <Sparkles /> },
  { type: 'pending', label: 'Pending / loading', icon: <Loader /> },
]
const iconOf = (t: CardType) => TYPES.find((x) => x.type === t)?.icon

const photoSvg = (a: string, b: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='320' height='180'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#${a}'/><stop offset='1' stop-color='#${b}'/></linearGradient></defs><rect width='320' height='180' fill='url(#g)'/></svg>`)}`

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="cs-section">
      <h2 className="cs-h2">{title}</h2>
      {children}
    </section>
  )
}

export function CardShowcase() {
  return (
    <main className="cs">
      <header className="cs-head">
        <p className="fg-caption">FridgeGraph design-v2</p>
        <h1>Card family</h1>
        <p className="fgc-sub">One card family. A card's type drives its colour everywhere: accent bar, icon node, corner glow, progress and tile gradient. Dark canvas, layered elevation, tabular figures.</p>
      </header>

      <Section title="Type legend">
        <div className="cs-legend">
          {TYPES.map(({ type, label, icon }) => (
            <div key={type} className="cs-legend-item">
              <TypeNode type={type}>{icon}</TypeNode>
              <div>
                <div className="fgc-title" style={{ fontSize: 'var(--text-body)' }}>{label}</div>
                <TypePill type={type}>{type}</TypePill>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Elevation">
        <div className="cs-row3">
          {[1, 2, 3].map((e) => (
            <Card key={e} elevation={e as 1 | 2 | 3}>
              <div className="fgc-title">Surface {e}</div>
              <p className="fgc-sub">Layered depth with an inner top highlight. Surface 3 is reserved for elevated, approval-level content.</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section title="Accent-bar rows">
        <div className="cs-stack">
          <AccentCard type="orbit"><div className="fgc-title">Orbit alert needs your activation</div><p className="fgc-sub">Review the preview, then activate explicitly. Simulated in the demo.</p></AccentCard>
          <AccentCard type="safe"><div className="fgc-title">Nora marked found safe</div><p className="fgc-sub">Only a parent can confirm this. Status is CLOSED.</p></AccentCard>
          <AccentCard type="pickup"><div className="fgc-title">Tasha can pick up, waiting for your OK</div><p className="fgc-sub">A reply was recorded. Parent approval is still required.</p></AccentCard>
          <AccentCard type="school"><div className="fgc-title">School notice, early dismissal 1:30 PM</div><p className="fgc-sub">Conflicts with Nora's recorded 3:00 PM pickup.</p></AccentCard>
          <AccentCard type="pending"><div className="fgc-title">Waiting for reply</div><p className="fgc-sub">The attempt is still open. No reply yet.</p></AccentCard>
        </div>
      </Section>

      <Section title="Status cards">
        <div className="cs-stack">
          <StatusCard type="rosina" icon={iconOf('rosina')} title="Rosina is preparing your request" onClose={() => {}}>
            Gathering the recorded details. Nothing is sent without your confirmation.
            <ProgressBar value={62} type="rosina" label="Preparing" />
          </StatusCard>
          <StatusCard type="safe" icon={<Check />} title="Invitation sent" onClose={() => {}}
            actions={<><FgButton variant="secondary">Copy link</FgButton><FgButton variant="primary">Done</FgButton></>}>
            Your invitation to the village was recorded.
          </StatusCard>
          <StatusCard type="orbit" icon={<Siren />} title="We could not reach a caregiver" onClose={() => {}}
            actions={<><FgButton variant="secondary">Retry</FgButton></>}>
            No reply was recorded within the response window. This is not a decline.
          </StatusCard>
        </div>
      </Section>

      <Section title="Media cards with progress">
        <div className="cs-stack">
          <MediaCard type="fridge" interactive thumb={photoSvg('e2994a', '8a4d1f')} title="Nora's first day drawing" meta="Added Oct 28 · 3 memories" progress={78} />
          <MediaCard type="care" interactive thumb={photoSvg('4bb6b0', '1f5a57')} title="Care plan reviewed" meta="2 of 3 sections confirmed" progress={66} />
        </div>
      </Section>

      <Section title="Timeline">
        <div className="cs-timeline">
          <TimelineRow time="06:30" type="pickup" icon={<Car />}>
            <AccentCard type="pickup"><div className="fgc-title">Pickup request received</div><p className="fgc-sub">Rosina is coordinating Nora's afternoon pickup.</p></AccentCard>
          </TimelineRow>
          <TimelineRow time="09:05" type="school" icon={<GraduationCap />}>
            <AccentCard type="school"><div className="fgc-title">School notice logged</div><p className="fgc-sub">Early dismissal at 1:30 PM.</p></AccentCard>
          </TimelineRow>
          <TimelineRow time="10:58" type="rosina" icon={<Sparkles />}>
            <AccentCard type="rosina"><div className="fgc-title">Rosina recommended Tasha</div><p className="fgc-sub">Authorized, available, has transport.</p></AccentCard>
          </TimelineRow>
          <TimelineRow time="11:12" type="safe" icon={<Check />} last>
            <AccentCard type="safe"><div className="fgc-title">Parent approval recorded</div><p className="fgc-sub">Kendra approved Tasha at 11:12 AM.</p></AccentCard>
          </TimelineRow>
        </div>
      </Section>

      <Section title="Metric tiles">
        <div className="cs-tiles">
          <MetricTile type="pickup" label="Caregivers in this job" value="4" foot="contacted together" />
          <MetricTile type="care" label="Care sections shared" value="3" foot="with you" />
          <MetricTile type="invite" label="Invitations sent" value="12" foot="this month" />
          <MetricTile type="safe" label="Check-ins recorded" value="98%" foot="on time" />
        </div>
      </Section>

      <Section title="Photo cards">
        <div className="cs-row3">
          <PhotoCard src={photoSvg('5b7cc9', '1b2b52')} title="March" badge={<TypePill type="fridge" glass>23 memories</TypePill>} menu={<button type="button" className="fg-iconbtn" aria-label="More"><ArrowRight size={16} /></button>} />
          <PhotoCard src={photoSvg('4f9e63', '1d3a26')} title="April" badge={<TypePill type="fridge" glass>18 memories</TypePill>} />
          <PhotoCard src={photoSvg('c06a33', '512414')} title="May" badge={<TypePill type="fridge" glass>29 memories</TypePill>} />
        </div>
      </Section>

      <Section title="Elevated approval (pinned pattern)">
        <Card type="pickup" elevation={3} glow>
          <TypePill type="pickup">Needs your approval</TypePill>
          <h3 className="fgc-title" style={{ fontSize: 'var(--text-title)', marginTop: 10 }}>Approve Tasha for Nora's pickup</h3>
          <p className="fgc-sub">Authorized, available and has transport. Parent approval is still required.</p>
          <div style={{ marginTop: 14 }}><FgButton variant="primary">Approve pickup</FgButton></div>
        </Card>
      </Section>
    </main>
  )
}
