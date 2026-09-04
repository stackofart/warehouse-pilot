import { Plus, RefreshCw, ShieldCheck, UserCog, Users } from 'lucide-react'
import { FormEvent, useCallback, useEffect, useState } from 'react'
import { addManagedUser, listManagedUsers, updateManagedUser, type ManagedUser } from '../auth/adminApi'
import type { AuthenticatedUser } from '../auth/session'

export function AdminUsersPage({ currentUser }: { currentUser: AuthenticatedUser }) {
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<'picker' | 'admin'>('picker')

  const reload = useCallback(async () => {
    setState('loading')
    try {
      setUsers(await listManagedUsers())
      setState('ready')
    } catch (reason) {
      setState('error')
      setMessage(reason instanceof Error ? reason.message : 'Не удалось загрузить пользователей.')
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setMessage('')
    try {
      await addManagedUser({ email, name, role })
      setEmail('')
      setName('')
      setMessage('Пользователь добавлен. После входа через Cloudflare Access он получит выбранную роль.')
      await reload()
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Не удалось добавить пользователя.')
    }
  }

  const update = async (user: ManagedUser, input: Partial<Pick<ManagedUser, 'role' | 'status'>>) => {
    setMessage('')
    try {
      const updated = await updateManagedUser(user.id, input)
      setUsers((current) => current.map((candidate) => candidate.id === updated.id ? updated : candidate))
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Не удалось изменить пользователя.')
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-page-heading"><div><p className="eyebrow">ДОСТУП</p><h1>Пользователи и роли</h1><p>Cloudflare Access подтверждает личность, а Warehouse Pilot назначает права администратора или сборщика.</p></div><button className="admin-secondary-action" type="button" onClick={() => void reload()}><RefreshCw size={16} />Обновить</button></div>
      <form className="admin-user-form" onSubmit={(event) => void submit(event)}>
        <span><Plus size={19} /></span>
        <label>Имя<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Иван Петров" /></label>
        <label>Email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="picker@example.com" /></label>
        <label>Роль<select value={role} onChange={(event) => setRole(event.target.value as 'picker' | 'admin')}><option value="picker">Сборщик</option><option value="admin">Администратор</option></select></label>
        <button className="admin-primary-action" type="submit">Добавить</button>
      </form>
      {message && <div className="admin-inline-message"><ShieldCheck size={17} />{message}</div>}
      <section className="admin-panel admin-users-panel">
        <header><div><span>КОМАНДА</span><h2>{users.length} пользователей</h2></div></header>
        {state === 'loading' ? <div className="admin-empty-compact"><RefreshCw className="spin" size={27} /><b>Загрузка пользователей</b></div>
          : state === 'error' ? <div className="admin-empty-compact"><UserCog size={27} /><b>{message}</b></div>
            : users.length ? <div className="admin-user-list">{users.map((user) => {
              const self = user.id === currentUser.id
              return <article key={user.id}><span className="admin-user-avatar">{user.role === 'admin' ? <ShieldCheck size={18} /> : <Users size={18} />}</span><div><b>{user.name}</b><small>{user.email}{self ? ' · это вы' : ''}</small></div><select aria-label={`Роль ${user.name}`} value={user.role} disabled={self} onChange={(event) => void update(user, { role: event.target.value as ManagedUser['role'] })}><option value="picker">Сборщик</option><option value="admin">Администратор</option></select><button className={user.status === 'active' ? 'active' : 'suspended'} type="button" disabled={self} onClick={() => void update(user, { status: user.status === 'active' ? 'suspended' : 'active' })}>{user.status === 'active' ? 'Активен' : 'Доступ приостановлен'}</button></article>
            })}</div> : <div className="admin-empty-compact"><Users size={27} /><b>Пользователей пока нет</b></div>}
      </section>
    </div>
  )
}
