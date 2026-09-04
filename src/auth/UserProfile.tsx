import { ShieldCheck, UserRound } from 'lucide-react'
import type { AuthenticatedUser } from './session'

const roleLabels = { admin: 'Администратор', picker: 'Сборщик' } as const

function initials(user: AuthenticatedUser) {
  const parts = user.name.trim().split(/\s+/).filter(Boolean)
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : parts[0]?.slice(0, 2) || user.email.slice(0, 2)).toUpperCase()
}

export function UserProfile({ user, compact = false }: { user: AuthenticatedUser; compact?: boolean }) {
  const Icon = user.role === 'admin' ? ShieldCheck : UserRound
  return (
    <div className={`user-profile ${compact ? 'compact' : ''}`} title={`${user.name} · ${roleLabels[user.role]}`}>
      <span className="avatar">{initials(user)}</span>
      {!compact && <div><strong>{user.name}</strong><span>{roleLabels[user.role]}</span><small>{user.email}</small></div>}
      <Icon size={17} aria-hidden="true" />
    </div>
  )
}
