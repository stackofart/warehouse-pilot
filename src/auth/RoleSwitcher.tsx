import { Check, ChevronDown, ShieldCheck, UserRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AppRole } from './roles'

type RoleSwitcherProps = {
  role: AppRole
  onRoleChange: (role: AppRole) => void
  compact?: boolean
}

const roleLabel: Record<AppRole, string> = {
  picker: 'Сборщик',
  admin: 'Администратор',
}

export function RoleSwitcher({ role, onRoleChange, compact = false }: RoleSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isOpen])

  const selectRole = (nextRole: AppRole) => {
    setIsOpen(false)
    onRoleChange(nextRole)
  }

  return (
    <div className={`role-switcher ${compact ? 'compact' : ''}`} ref={rootRef}>
      <button className="profile role-switcher-trigger" type="button" aria-haspopup="menu" aria-expanded={isOpen} onClick={() => setIsOpen((current) => !current)}>
        <span className="avatar">АМ</span>
        {!compact && <div><strong>Алексей Морозов</strong><span>{roleLabel[role]}</span></div>}
        <ChevronDown size={17} />
      </button>
      {isOpen && (
        <div className="role-menu" role="menu" aria-label="Выбор режима приложения">
          <div className="role-menu-heading"><strong>Режим приложения</strong><span>Прототип без авторизации</span></div>
          <button type="button" role="menuitemradio" aria-checked={role === 'picker'} onClick={() => selectRole('picker')}>
            <span><UserRound size={17} /></span><div><b>Сборщик</b><small>Заказы, маршрут и паллета</small></div>{role === 'picker' && <Check size={17} />}
          </button>
          <button type="button" role="menuitemradio" aria-checked={role === 'admin'} onClick={() => selectRole('admin')}>
            <span><ShieldCheck size={17} /></span><div><b>Администратор</b><small>Склад, команда и контроль</small></div>{role === 'admin' && <Check size={17} />}
          </button>
        </div>
      )}
    </div>
  )
}
