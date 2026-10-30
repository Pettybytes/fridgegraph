import { motion } from 'motion/react'
import type { GraphNode } from './types'
import type { ReasonCode, VillageEdge } from '@/lib/frontendData/types'
import { reasonLabel } from '@/lib/frontendData/types'

type PersonCardProps = {
  node: GraphNode
  edge: VillageEdge | null
  centerName: string
  highlight: ReasonCode | null
  onClose: () => void
}

export function PersonCard({ node, edge, centerName, highlight, onClose }: PersonCardProps) {
  const relationshipType = edge?.relationship.type ?? null
  const relationshipStatus = edge?.relationship.status ?? null

  return (
    <motion.div
      className="village-card-overlay"
      onClick={onClose}
      data-testid="person-card-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className="village-card"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label={`Details for ${node.displayName}`}
        data-testid="person-card"
        initial={{ opacity: 0, y: 48, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 32, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 340, damping: 32 }}
      >
        <button className="village-card-close" onClick={onClose} aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 6 6 18" /><path d="m6 6 12 12" />
          </svg>
        </button>

        {/* Portrait */}
        <div className="village-card-portrait" style={{ background: roleColor(node.role) }}>
          <span>{node.initials}</span>
        </div>

        <h3 className="village-card-name">{node.displayName}</h3>

        {/* Relationship to center */}
        {relationshipType && (
          <p className="village-card-relation">
            {formatRelationship(relationshipType)} of {centerName}
            {relationshipStatus && relationshipStatus !== 'ACTIVE' && (
              <span className="village-card-status"> · {relationshipStatus.toLowerCase()}</span>
            )}
          </p>
        )}

        {/* Role */}
        <span className="village-card-role">{(node.role.charAt(0).toUpperCase() + node.role.slice(1)).replaceAll('_', ' ')}</span>

        {/* Highlight badge */}
        {highlight && (
          <div className="village-card-highlight" data-reason={highlight}>
            {reasonLabel(highlight)}
          </div>
        )}

        {/* Household */}
        {node.household && (
          <p className="village-card-household">Household membership recorded</p>
        )}
      </motion.div>
    </motion.div>
  )
}

function roleColor(role: string): string {
  switch (role) {
    case 'child': return '#7559a1'
    case 'parent': return '#3a506b'
    default: return '#8b6e4e'
  }
}

function formatRelationship(type: string): string {
  return (type.charAt(0).toUpperCase() + type.slice(1)).replaceAll('_', ' ')
}
