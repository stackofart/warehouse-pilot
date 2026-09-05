import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bell,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Database,
  FileWarning,
  LayoutDashboard,
  Map as MapIcon,
  Menu,
  PackageCheck,
  Search,
  Settings,
  ShieldCheck,
  UserCog,
  Users,
  Warehouse,
  Wrench,
  X,
} from 'lucide-react'
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import type { AuthenticatedUser } from '../auth/session'
import { UserProfile } from '../auth/UserProfile'
import { listFulfillmentSessions } from '../fulfillment/storage'
import type { FulfillmentSession } from '../fulfillment/workflow'
import { listOrders, type SavedOrder } from '../orders/storage'
import { getAdminProductPage, type SharedCatalogProduct } from '../products/sharedApi'
import { AdminUsersPage } from './AdminUsersPage'
import { SharedProductDatabase } from './SharedProductDatabase'
import { adminHash, adminSectionFromHash } from './routing'
import { AdminOrderDetail } from './AdminOrderDetail'
import { OrderQueue } from '../orders/OrderQueue'
import { ReportsQueue } from '../reports/ReportsQueue'
import { getReports, type Report } from '../reports/api'

export type AdminSection = 'overview' | 'warehouse' | 'products' | 'workers' | 'orders' | 'reports' | 'settings' | 'new-order' | 'pallet'
const PalletWorkspace = lazy(() => import('../pallet/PalletWorkspace').then(m => ({ default: m.PalletWorkspace })))

type AdminWorkspaceProps = {
  user: AuthenticatedUser
  intake?: ReactNode
}

type AdminData = {
  products: SharedCatalogProduct[]
  productTotal: number
  unverifiedProductTotal: number
  orders: SavedOrder[]
  sessions: FulfillmentSession[]
  reports: Report[]
}

const emptyData: AdminData = { products: [], productTotal: 0, unverifiedProductTotal: 0, orders: [], sessions: [], reports: [] }

const adminNavigation = [
  { section: 'overview' as const, label: 'Обзор', icon: LayoutDashboard },
  { section: 'warehouse' as const, label: 'Конструктор склада', icon: MapIcon },
  { section: 'products' as const, label: 'База товаров', icon: Boxes },
  { section: 'workers' as const, label: 'Сборщики', icon: Users },
  { section: 'orders' as const, label: 'Заказы', icon: ClipboardList },
  { section: 'reports' as const, label: 'Контроль и репорты', icon: FileWarning },
  { section: 'settings' as const, label: 'Система', icon: Settings },
]

const adminHref = (section: AdminSection) => section === 'overview' ? '#admin' : `#admin/${section}`

function AdminPageHeading({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return (
    <div className="admin-page-heading">
      <div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>
      {actions && <div className="admin-heading-actions">{actions}</div>}
    </div>
  )
}

function AdminOverview({ data }: { data: AdminData }) {
  const activeSessions = data.sessions.filter((session) => session.status === 'in-progress').length
  const pausedSessions = data.sessions.filter((session) => session.status === 'paused').length
  const unverifiedProducts = data.unverifiedProductTotal
  const completedSessions = data.sessions.filter((session) => session.status === 'completed').length

  return (
    <div className="admin-page">
      <AdminPageHeading eyebrow="АДМИНИСТРИРОВАНИЕ" title="Центр управления складом" description="Состояние операций, справочников и команды в одном интерфейсе." actions={<a className="admin-primary-action" href="#admin/reports"><AlertTriangle size={17} />Открыть контроль</a>} />

      <section className="admin-kpi-grid" aria-label="Показатели склада">
        <article><span className="green"><Activity size={20} /></span><div><small>Активные сборки</small><strong>{activeSessions}</strong><em>{pausedSessions ? `${pausedSessions} на паузе` : 'Без задержек'}</em></div></article>
        <article><span className="blue"><ClipboardList size={20} /></span><div><small>Заказы в базе</small><strong>{data.orders.length}</strong><em>{completedSessions} завершено</em></div></article>
        <article><span className="violet"><Boxes size={20} /></span><div><small>Товаров</small><strong>{data.productTotal}</strong><em>{unverifiedProducts} требуют проверки</em></div></article>
        <article><span className="amber"><FileWarning size={20} /></span><div><small>Открытые репорты</small><strong>{data.reports.length}</strong><em>{data.reports.filter(report => report.kind === 'missing').length} по отсутствию</em></div></article>
      </section>

      <div className="admin-dashboard-grid">
        <section className="admin-panel admin-operations-panel">
          <header><div><span>Текущие операции</span><h2>Сборка заказов</h2></div><a href="#admin/orders">Все заказы <ArrowRight size={15} /></a></header>
          {data.sessions.length ? (
            <div className="admin-operation-list">
              {data.sessions.slice(0, 4).map((session) => {
                const order = data.orders.find((candidate) => candidate.id === session.orderId)
                const handled = Object.values(session.items).filter((item) => item.status === 'picked' || item.status === 'missing').length
                const total = Object.keys(session.items).length
                const percent = total ? Math.round(handled / total * 100) : 0
                return <article key={session.orderId}><span className={`admin-status-dot ${session.status}`} /><div><b>{order?.orderNumber || 'Заказ без номера'}</b><small>{order?.assigneeName || 'Комплектовщик'} · {session.mode === 'fast' ? 'Свободная сборка, без отслеживания позиции' : session.currentAddress || 'Центральный вход'}</small><i><span style={{ width: `${percent}%` }} /></i></div><strong>{percent}%</strong></article>
              })}
            </div>
          ) : <div className="admin-empty-compact"><PackageCheck size={28} /><b>Активных сборок пока нет</b><span>Они появятся после запуска заказа сборщиком.</span></div>}
        </section>

        <section className="admin-panel admin-attention-panel">
          <header><div><span>Требует внимания</span><h2>Контроль качества</h2></div></header>
          <a href="#admin/products"><span className="amber"><AlertTriangle size={18} /></span><div><b>Непроверенные товары</b><small>Проверьте данные, созданные после распознавания</small></div><strong>{unverifiedProducts}</strong></a>
          <a href="#admin/reports"><span className="red"><FileWarning size={18} /></span><div><b>Репорты сборщиков</b><small>Не на месте, отсутствует, повреждено</small></div><strong>{data.reports.length}</strong></a>
          <a href="#admin/warehouse"><span className="green"><MapIcon size={18} /></span><div><b>Геометрия склада</b><small>Источник: warehouse-layout.json</small></div><CheckCircle2 size={18} /></a>
        </section>
      </div>

      <section className="admin-quick-actions">
        <header><p className="eyebrow">БЫСТРЫЙ ДОСТУП</p><h2>Основные инструменты</h2></header>
        <div>
          <a href="#admin/warehouse"><MapIcon size={21} /><span><b>Конструктор склада</b><small>Геометрия, проходы и адреса</small></span><ArrowRight size={17} /></a>
          <a href="#admin/products"><Database size={21} /><span><b>База товаров</b><small>Карточки и верификация</small></span><ArrowRight size={17} /></a>
          <a href="#admin/workers"><UserCog size={21} /><span><b>Сборщики</b><small>Роли, смены и нагрузка</small></span><ArrowRight size={17} /></a>
        </div>
      </section>
    </div>
  )
}

function WarehouseConstructorTemplate() {
  return (
    <div className="admin-page">
      <AdminPageHeading eyebrow="КОНСТРУКТОР СКЛАДА" title="Геометрия и адреса" description="Редактор будет изменять только явную геометрию спецификации — без вывода координат из номеров рядов." actions={<><button className="admin-secondary-action" type="button" disabled><Wrench size={16} />Проверить схему</button><button className="admin-primary-action" type="button" disabled>Опубликовать</button></>} />
      <div className="admin-template-notice"><ShieldCheck size={19} /><div><b>Безопасный режим шаблона</b><span>Редактирование пока отключено. warehouse-layout.json остаётся единственным источником геометрии.</span></div></div>
      <div className="admin-constructor-layout">
        <aside className="admin-panel admin-object-library">
          <header><div><span>Библиотека</span><h2>Объекты схемы</h2></div></header>
          <button type="button" disabled><span><MapIcon size={18} /></span><div><b>Проход</b><small>Только измеренный сегмент</small></div></button>
          <button type="button" disabled><span><Boxes size={18} /></span><div><b>Стеллаж</b><small>Непроходимый объект</small></div></button>
          <button type="button" disabled><span><PackageCheck size={18} /></span><div><b>Адрес отбора</b><small>Ряд и сектор</small></div></button>
          <button type="button" disabled><span><Warehouse size={18} /></span><div><b>Ворота</b><small>Старт или финиш</small></div></button>
        </aside>
        <section className="admin-panel admin-constructor-canvas">
          <header><div><span>Рабочая область</span><h2>Схема склада</h2></div><div className="admin-canvas-tabs"><button className="active" type="button">Геометрия</button><button type="button" disabled>Граф проходов</button></div></header>
          <div className="admin-blueprint-placeholder"><MapIcon size={48} /><h3>Холст конструктора подготовлен</h3><p>На следующем этапе здесь будет отрисовываться текущая схема из warehouse-layout.json с проверкой пересечений и связности проходов.</p><span>Неизмеренные размеры не будут создаваться автоматически</span></div>
        </section>
        <aside className="admin-panel admin-properties-panel">
          <header><div><span>Инспектор</span><h2>Свойства объекта</h2></div></header>
          <div className="admin-empty-compact"><Search size={26} /><b>Объект не выбран</b><span>Выберите элемент схемы для просмотра точных координат и связей.</span></div>
        </aside>
      </div>
    </div>
  )
}

function AdminSettingsTemplate() {
  return (
    <div className="admin-page">
      <AdminPageHeading eyebrow="СИСТЕМА" title="Настройки и доступ" description="Параметры ролей, локального хранения и будущей синхронизации." />
      <div className="admin-settings-grid">
        <section className="admin-panel admin-settings-card"><header><span><ShieldCheck size={20} /></span><div><h2>Роли и права</h2><p>Сборщик и администратор</p></div></header><div className="admin-setting-row"><div><b>Cloudflare Access</b><small>Подтверждает email пользователя до входа в приложение</small></div><em className="ready">Активно</em></div><div className="admin-setting-row"><div><b>Роли Worker</b><small>Права проверяются сервером для каждого API-запроса</small></div><em className="ready">Активно</em></div></section>
        <section className="admin-panel admin-settings-card"><header><span><Database size={20} /></span><div><h2>Данные</h2><p>Общая и локальная части</p></div></header><div className="admin-setting-row"><div><b>Cloudflare D1</b><small>Товары, заказы, сотрудники, события и репорты</small></div><em className="ready">Активно</em></div><div className="admin-setting-row"><div><b>IndexedDB</b><small>Изолированный кэш пользователя и очередь синхронизации</small></div><em>Переходный этап</em></div></section>
        <section className="admin-panel admin-settings-card"><header><span><Bell size={20} /></span><div><h2>Уведомления</h2><p>Репорты и критические события</p></div></header><div className="admin-setting-row"><div><b>Репорты сборщиков</b><small>Центр уведомлений подготовлен</small></div><em>Шаблон</em></div><div className="admin-setting-row"><div><b>Push-уведомления</b><small>PWA на рабочих телефонах</small></div><em>Позже</em></div></section>
      </div>
    </div>
  )
}

export function AdminWorkspace({ user, intake }: AdminWorkspaceProps) {
  const [hash, setHash] = useState(() => adminHash(window.location.hash))
  const [drawer, setDrawer] = useState(false)
  const activeSection = adminSectionFromHash(hash)
  const navigationSection = activeSection === 'new-order' || activeSection === 'pallet' ? 'orders' : activeSection
  const orderId = activeSection === 'orders' ? hash.split('/')[2] || '' : ''
  const [data, setData] = useState<AdminData>(emptyData)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const updateSection = () => {
      const next = adminHash(window.location.hash)
      if (next !== window.location.hash) window.location.replace(next)
      setHash(next)
      setDrawer(false)
    }
    updateSection()
    window.addEventListener('hashchange', updateSection)
    return () => window.removeEventListener('hashchange', updateSection)
  }, [])

  useEffect(() => {
    let cancelled = false
    if (activeSection !== 'overview') { setIsLoading(false); return }
    const refresh = () => {
      setIsLoading(true)
      Promise.all([getAdminProductPage(), listOrders(), listFulfillmentSessions(), getReports()])
        .then(([productPage, orders, sessions, reports]) => { if (!cancelled) { setData({ products: productPage.items, productTotal: productPage.total, unverifiedProductTotal: productPage.unverified, orders, sessions, reports }); setError('') } })
        .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Не удалось обновить обзор.') })
        .finally(() => { if (!cancelled) setIsLoading(false) })
    }
    refresh(); const timer = setInterval(refresh, 30000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [activeSection])

  const content = activeSection === 'new-order' ? intake : activeSection === 'pallet' ? <Suspense fallback={<p className="page">Загрузка паллеты…</p>}><a className="operations-back" href="#admin/orders">← К заказам</a><PalletWorkspace /></Suspense> : activeSection === 'warehouse' ? <WarehouseConstructorTemplate />
    : activeSection === 'products' ? <SharedProductDatabase />
      : activeSection === 'workers' ? <AdminUsersPage currentUser={user} />
        : activeSection === 'orders' ? orderId ? <AdminOrderDetail key={orderId} orderId={orderId} /> : <OrderQueue user={user} />
          : activeSection === 'reports' ? <ReportsQueue role={user.role} />
            : activeSection === 'settings' ? <AdminSettingsTemplate />
              : <AdminOverview data={data} />

  return (
    <div className="app-shell admin-shell">
      <aside className="sidebar admin-sidebar">
        <div className="brand"><div className="brand-mark"><Warehouse size={22} strokeWidth={2.2} /></div><div><strong>Warehouse Pilot</strong><span>Панель администратора</span></div></div>
        <div className="admin-mode-badge"><ShieldCheck size={15} />Режим управления</div>
        <nav className="main-nav" aria-label="Навигация администратора">{adminNavigation.map(({ section, label, icon: Icon }) => <a className={navigationSection === section ? 'active' : ''} href={adminHref(section)} key={section}><Icon size={19} />{label}</a>)}</nav>
        <div className="sidebar-bottom"><div className="local-card"><span className="local-icon"><Database size={18} /></span><div><strong>Общая база D1</strong><span>Доступ проверяется на Worker</span></div></div><UserProfile user={user} /></div>
      </aside>
      <main className="main-content admin-main-content">
        <header className="topbar admin-topbar"><button className="mobile-menu-trigger" aria-label="Открыть меню администратора" aria-expanded={drawer} onClick={() => setDrawer(true)}><Menu size={20} /></button><div className="mobile-brand"><strong>Управление складом</strong></div><div className="admin-topbar-actions"><a className="admin-sync-state" href="#admin/reports"><Bell size={16} />Сообщения</a><UserProfile compact user={user} /></div></header>
        {isLoading && <div className="admin-loading-line" />}
        {error && activeSection === 'overview' && <p role="alert" className="operations-message">{error} Показатели могут быть неактуальны.</p>}
        {content}
      </main>
      <nav className="mobile-bottom-nav admin-mobile-nav" aria-label="Мобильная навигация администратора">{adminNavigation.filter(entry => ['overview', 'products', 'workers', 'orders', 'reports'].includes(entry.section)).map(({ section, label, icon: Icon }) => <a className={navigationSection === section ? 'active' : ''} href={adminHref(section)} key={section}><Icon size={20} /><span>{label === 'Контроль и репорты' ? 'Сообщения' : label === 'База товаров' ? 'Товары' : label}</span></a>)}</nav>
      {drawer && <div className="mobile-navigation-drawer open"><button className="mobile-drawer-backdrop" aria-label="Закрыть меню" onClick={() => setDrawer(false)} /><aside aria-label="Все разделы администратора"><header><div className="brand-mark"><Warehouse size={22} /></div><div><b>Управление</b><span>Администратор</span></div><button aria-label="Закрыть меню разделов" onClick={() => setDrawer(false)}><X size={20} /></button></header><nav>{adminNavigation.map(({ section, label, icon: Icon }) => <a className={navigationSection === section ? 'active' : ''} href={adminHref(section)} key={section}><Icon size={20} />{label}</a>)}</nav><UserProfile user={user} /></aside></div>}
    </div>
  )
}
