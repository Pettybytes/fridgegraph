/**
 * PhoneFrame showcase — a dev-only gallery for the device frame and its embed mode.
 * Bound by docs/contracts/design.md §8. Reachable only at `#/_showcase` under
 * import.meta.env.DEV (see main.tsx); never wired into production nav, and never
 * rendered inside a persona session, so it ships no real data. Every screen below
 * is fictional sample content, and every framed screen keeps its perspective +
 * live/sample/simulated caption visible.
 */
import { PhoneFrame } from '@/components/fg/PhoneFrame'
import { RosinaAvatar } from '@/components/fg/RosinaAvatar'
import { Surface, StatusChip, SourceChip, Avatar, Composer, Icon } from '@/components/fg/primitives'
import '@/index.css'
import './showcase.css'

/** A compact, self-contained Today-like screen (no providers, fictional data). */
function TodayScreen() {
  return (
    <div className="sc-screen">
      <p className="sc-date">Saturday, October 31</p>
      <h2 className="sc-hi">Good evening, Kendra.</h2>
      <StatusChip tone="brand" icon={false}>Viewing Nora Ellison</StatusChip>
      <Surface elevated className="sc-rosina">
        <div className="sc-rosina-head">
          <RosinaAvatar state="ready" size={40} />
          <div><strong>Ask Rosina</strong><p>Ask about what's shared with you. Every change needs your confirmation.</p></div>
        </div>
        <Composer placeholder="What's on Nora's calendar today?" onSend={() => {}} sendLabel="Ask Rosina" />
      </Surface>
      <Surface className="sc-card">
        <div className="sc-card-head"><strong>Children shared with you</strong></div>
        <div className="sc-childrow">
          <Avatar name="Nora Ellison" personId="p_nora" kind="child" size={40} />
          <div><strong>Nora Ellison</strong><div className="sc-chips"><StatusChip tone="neutral" icon={false}>Current view</StatusChip><StatusChip tone="simulated" icon={false}>Sample</StatusChip></div></div>
        </div>
      </Surface>
    </div>
  )
}

/** A compact village-preview screen. */
function VillageScreen() {
  const people = [
    { id: 'p_mom', name: 'Kendra Ellison' }, { id: 'p_dad', name: 'Andre Ellison' },
    { id: 'p_gma', name: 'Loretta Brooks' }, { id: 'p_priya', name: 'Priya Nair' },
  ]
  return (
    <div className="sc-screen">
      <h2 className="sc-hi sc-hi-sm">Nora Ellison's village</h2>
      <p className="sc-sub">The people shared with your perspective.</p>
      <Surface className="sc-card">
        <div className="sc-card-head"><strong>Nora Ellison's village</strong><span className="sc-open">Open <Icon.chevron /></span></div>
        <div className="sc-cluster">
          {people.map((p) => <Avatar key={p.id} name={p.name} personId={p.id} kind="adult" size={38} title={p.name} />)}
          <span className="sc-more">+4</span>
        </div>
        <SourceChip>8 people shared with you · sample</SourceChip>
      </Surface>
    </div>
  )
}

export function PhoneShowcase() {
  return (
    <main className="sc-root">
      <header className="sc-header">
        <h1>PhoneFrame</h1>
        <p>The drawn device frame for showcasing FridgeGraph surfaces. Concentric corners from the radius tokens, decorative non-interactive chrome, and a persistent caption that states whose perspective this is and whether the data is live, sample, or simulated. Fictional data only.</p>
      </header>

      <section className="sc-gallery" aria-label="Framed screens">
        <PhoneFrame label="Kendra" context="Nora's village" status="sample"><TodayScreen /></PhoneFrame>
        <PhoneFrame label="Andre" context="Nora's village" status="sample"><VillageScreen /></PhoneFrame>
        <PhoneFrame label="Kendra" context="Live session" status="live"><TodayScreen /></PhoneFrame>
        <PhoneFrame label="Rosina" context="Scenario replay" status="simulated"><VillageScreen /></PhoneFrame>
      </section>

      <section className="sc-embed" aria-label="Embed mode">
        <h2>Embed mode (<code>bare</code>)</h2>
        <p>Just the clipped screen — no bezel or caption — for embedding a surface inside another layout. The host is responsible for the perspective + status label.</p>
        <div className="sc-embed-box">
          <PhoneFrame label="" status="sample" bare><TodayScreen /></PhoneFrame>
        </div>
      </section>
    </main>
  )
}
