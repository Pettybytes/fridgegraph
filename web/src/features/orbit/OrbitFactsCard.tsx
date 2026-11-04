import type {ComponentType} from 'react'
import {ArrowUpRight,MapPin,Clock,Shirt,Palette,Backpack,UserRound} from 'lucide-react'
import {descriptorKeys} from './adapter'
import type {Alert,DescriptorKey} from './adapter'
import {descriptorLabels} from './OrbitPreparation'

/** Each descriptor tile carries a real icon, never an emoji; the label states the fact in words. */
const descriptorIcon: Record<DescriptorKey, ComponentType<{size?: number}>> = {
  wearColor: Palette, wearGarment: Shirt, hair: UserRound, carryColor: Palette, carryItem: Backpack,
}

export type LastSeenFacts = {placeText: string | null; timeText: string | null; recorded: boolean; missingText: string | null}

/**
 * The frosted facts card shared by the recipient takeover and the parent Orbit page, so active Orbit
 * is one design across roles. It restates recorded facts only: the last-seen place stands alone, the
 * time appears with its recorded provenance or is called out as not recorded, and up to two
 * descriptors fill the remaining tiles (N items, N cells). The photo slot states its own absence.
 */
export function OrbitFactsCard({childName, lastSeen, share, image, photoAlt, missingPhotoText, failedPhotoText, onOpen}: {
  childName: string
  lastSeen: LastSeenFacts
  share: Alert['share']
  image: {url?: string; failed: boolean; onError: () => void}
  photoAlt: string
  missingPhotoText: string
  failedPhotoText: string
  onOpen: () => void
}) {
  const descriptors = descriptorKeys.filter(key => share[key]).slice(0, 2)
  return <div className="orbit-facts-card">
    <div className="orbit-facts-top"><p className="orbit-facts-eyebrow">Orbit Alert</p><button type="button" className="orbit-facts-link" aria-label={`Open the Orbit page for ${childName}`} onClick={onOpen}><ArrowUpRight size={20}/></button></div>
    <div className="orbit-facts-photo">{image.url ? <img src={image.url} alt={photoAlt} onError={image.onError}/> : <p className="orbit-photo-unavailable">{image.failed ? failedPhotoText : missingPhotoText}</p>}</div>
    <h2 className="orbit-facts-name">{childName}</h2>
    <dl className="orbit-facts-tiles">
     {lastSeen.placeText
       ? <><div className="orbit-tile"><MapPin size={16}/><dt>Last seen place</dt><dd>{lastSeen.placeText}</dd></div>
           {/* The attention dot flags a fact that needs a second look: a time with no recorded
               provenance, or none recorded at all. A verified time shows the provenance chip instead. */}
           <div className={`orbit-tile${lastSeen.timeText && lastSeen.recorded ? '' : ' orbit-tile-attn'}`}><Clock size={16}/><dt>Last seen time</dt><dd>{lastSeen.timeText ?? 'Time not recorded.'}</dd>{lastSeen.timeText && lastSeen.recorded ? <span className="orbit-provenance">recorded by a parent</span> : <span className="orbit-tile-dot" title="Needs attention" aria-hidden="true"/>}</div></>
       : <div className="orbit-tile orbit-tile-wide orbit-tile-attn"><MapPin size={16}/><dt>Last seen</dt><dd>{lastSeen.missingText}</dd><span className="orbit-tile-dot" title="Needs attention" aria-hidden="true"/></div>}
     {descriptors.map(key => {const Icon = descriptorIcon[key]; return <div className="orbit-tile" key={key}><Icon size={16}/><dt>{descriptorLabels[key]}</dt><dd>{share[key]!.replaceAll('_', ' ')}</dd></div>})}
    </dl>
  </div>
}
