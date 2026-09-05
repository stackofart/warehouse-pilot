import { Suspense, lazy, useEffect, useState } from 'react'
import { Boxes, ClipboardList, Cuboid, LayoutDashboard, Menu, Settings, Warehouse } from 'lucide-react'
import { loadSession, type AuthenticatedUser } from './auth/session'
import { configureStorageScope } from './storage/database'
import { UserProfile } from './auth/UserProfile'
import { PickerSettings, type MobileNavigationMode } from './settings/PickerSettings'
import { flushSessions } from './fulfillment/sync'
import { flushReports } from './reports/api'
import { flushPallets } from './pallet/storage'
import './App.css'
import './operations.css'
const AdminWorkspace = lazy(() => import('./admin/AdminWorkspace').then(m => ({ default: m.AdminWorkspace })))
const OrderIntake = lazy(() => import('./orders/OrderIntake').then(m => ({ default: m.OrderIntake })))
const OrderQueue = lazy(() => import('./orders/OrderQueue').then(m => ({ default: m.OrderQueue })))
const OrderWorkflow = lazy(() => import('./fulfillment/OrderWorkflow').then(m => ({ default: m.OrderWorkflow })))
const CatalogSearch = lazy(() => import('./products/CatalogSearch').then(m => ({ default: m.CatalogSearch })))
const PalletWorkspace = lazy(() => import('./pallet/PalletWorkspace').then(m => ({ default: m.PalletWorkspace })))
const OverviewDashboard = lazy(() => import('./overview/OverviewDashboard').then(m => ({ default: m.OverviewDashboard })))
const ReportsQueue = lazy(() => import('./reports/ReportsQueue').then(m => ({ default: m.ReportsQueue })))
const nav = [{ id: 'orders', label: 'Заказы', icon: ClipboardList }, { id: 'products', label: 'Товары', icon: Boxes }, { id: 'pallet', label: 'Паллета', icon: Cuboid }, { id: 'overview', label: 'Обзор', icon: LayoutDashboard }, { id: 'settings', label: 'Настройки', icon: Settings }]
export default function App() {
  const [user, setUser] = useState<AuthenticatedUser | null>(null)
  const [error, setError] = useState('')
  const [hash, setHash] = useState(window.location.hash)
  const [drawer, setDrawer] = useState(false)
  const [navigationMode, setNavigationMode] = useState<MobileNavigationMode>(() => { try { return localStorage.getItem('warehouse-pilot.mobile-navigation') === 'drawer' ? 'drawer' : 'bottom' } catch { return 'bottom' } })
  useEffect(() => {
    let cancelled = false
    loadSession().then(current => { if (!cancelled) { configureStorageScope(current.id); setUser(current) } }).catch(reason => { if (!cancelled) setError(reason.message) })
    const expire = () => { configureStorageScope(null); setUser(null); setError('Доступ изменился или сессия истекла. Войдите повторно.') }
    const navigate = () => { setHash(window.location.hash); setDrawer(false) }
    window.addEventListener('warehouse:access-expired', expire)
    window.addEventListener('hashchange', navigate)
    return () => { cancelled = true; window.removeEventListener('warehouse:access-expired', expire); window.removeEventListener('hashchange', navigate) }
  }, [])
  useEffect(() => {
    if (!user) return
    const sync = () => { void Promise.all([flushSessions(), flushReports(), flushPallets()]).catch(console.error) }
    sync(); window.addEventListener('online', sync)
    return () => window.removeEventListener('online', sync)
  }, [user])
  if (!user) return <div className="auth-gate"><Warehouse size={32} /><h1>Warehouse Pilot</h1><p>{error || 'Проверяем доступ…'}</p>{error && <button onClick={() => window.location.reload()}>Повторить вход</button>}</div>
  const work = hash.startsWith('#work/') || hash.startsWith('#route/')
  const pallet = hash.startsWith('#pallet')
  if (user.role === 'admin' && !work && !pallet) return <Suspense fallback={<p className="page">Загрузка…</p>}><AdminWorkspace user={user} intake={<OrderIntake />} /></Suspense>
  const section = work ? 'orders' : pallet ? 'pallet' : nav.some(entry => hash === '#' + entry.id) ? hash.slice(1) : 'orders'
  const navigation = (user.role === 'replenisher' ? [{ id: 'reports', label: 'Пополнение', icon: Boxes }] : nav).map(({ id, label, icon: Icon }) => <a key={id} href={'#' + id} className={section === id ? 'active' : ''}><Icon size={20} /><span>{label}</span></a>)
  const changeMode = (value: MobileNavigationMode) => { setNavigationMode(value); try { localStorage.setItem('warehouse-pilot.mobile-navigation', value) } catch { /* Storage may be disabled. */ } }
  return <div className={'app-shell nav-' + navigationMode}>
    <aside className="sidebar"><div className="brand"><Warehouse size={28} /><strong>Warehouse Pilot</strong></div><nav className="main-nav">{navigation}</nav><div className="sidebar-bottom"><UserProfile user={user} /></div></aside>
    <main className="main-content"><header className="topbar"><button className="mobile-menu-trigger" aria-label="Открыть меню" onClick={() => setDrawer(true)}><Menu /></button><strong>Warehouse Pilot</strong><UserProfile compact user={user} /></header>
      {user.role === 'admin' && <a className="operations-back" href="#admin/orders">← К распределению заказов</a>}
      <Suspense fallback={<p className="page">Загрузка…</p>}>{user.role === 'replenisher' ? <ReportsQueue role={user.role} /> : work ? <OrderWorkflow /> : section === 'pallet' ? <PalletWorkspace /> : section === 'products' ? <CatalogSearch /> : section === 'overview' ? <OverviewDashboard /> : section === 'settings' ? <PickerSettings navigationMode={navigationMode} onNavigationModeChange={changeMode} /> : <OrderQueue user={user} />}</Suspense>
    </main>
    {user.role !== 'replenisher' && navigationMode === 'bottom' && <nav className="mobile-bottom-nav picker-mobile-nav">{navigation}</nav>}
    {drawer && <div className="mobile-navigation-drawer open"><button className="mobile-drawer-backdrop" aria-label="Закрыть меню" onClick={() => setDrawer(false)} /><aside><button onClick={() => setDrawer(false)}>Закрыть</button><nav>{navigation}</nav></aside></div>}
  </div>
}
