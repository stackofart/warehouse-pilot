import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bell,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Clock,
  Database,
  FileWarning,
  LayoutDashboard,
  Map as MapIcon,
  PackageCheck,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  UserCog,
  Users,
  Warehouse,
  Wrench,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { RoleSwitcher } from '../auth/RoleSwitcher'
import type { AppRole } from '../auth/roles'
import { listFulfillmentSessions } from '../fulfillment/storage'
import type { FulfillmentSession } from '../fulfillment/workflow'
import { listOrders, type SavedOrder } from '../orders/storage'
import { ProductDatabase } from '../products/ProductDatabase'
import { isProductVerified, listProducts, type Product } from '../products/storage'
import { adminSectionFromHash } from './routing'

export type AdminSection = 'overview' | 'warehouse' | 'products' | 'workers' | 'orders' | 'reports' | 'settings'

type AdminWorkspaceProps = {
  role: AppRole
  onRoleChange: (role: AppRole) => void
}

type AdminData = {
  products: Product[]
  orders: SavedOrder[]
  sessions: FulfillmentSession[]
}

const emptyData: AdminData = { products: [], orders: [], sessions: [] }

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

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

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
  const unverifiedProducts = data.products.filter((product) => !isProductVerified(product)).length
  const completedSessions = data.sessions.filter((session) => session.status === 'completed').length

  return (
    <div className="admin-page">
      <AdminPageHeading eyebrow="АДМИНИСТРИРОВАНИЕ" title="Центр управления складом" description="Состояние операций, справочников и команды в одном интерфейсе." actions={<a className="admin-primary-action" href="#admin/reports"><AlertTriangle size={17} />Открыть контроль</a>} />

      <section className="admin-kpi-grid" aria-label="Показатели склада">
        <article><span className="green"><Activity size={20} /></span><div><small>Активные сборки</small><strong>{activeSessions}</strong><em>{pausedSessions ? `${pausedSessions} на паузе` : 'Без задержек'}</em></div></article>
        <article><span className="blue"><ClipboardList size={20} /></span><div><small>Заказы в базе</small><strong>{data.orders.length}</strong><em>{completedSessions} завершено</em></div></article>
        <article><span className="violet"><Boxes size={20} /></span><div><small>Товаров</small><strong>{data.products.length}</strong><em>{unverifiedProducts} требуют проверки</em></div></article>
        <article><span className="amber"><FileWarning size={20} /></span><div><small>Открытые репорты</small><strong>0</strong><em>Модуль подготовлен</em></div></article>
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
                return <article key={session.orderId}><span className={`admin-status-dot ${session.status}`} /><div><b>{order?.orderNumber || 'Заказ без номера'}</b><small>Алексей Морозов · {session.currentAddress || 'Центральный вход'}</small><i><span style={{ width: `${percent}%` }} /></i></div><strong>{percent}%</strong></article>
              })}
            </div>
          ) : <div className="admin-empty-compact"><PackageCheck size={28} /><b>Активных сборок пока нет</b><span>Они появятся после запуска заказа сборщиком.</span></div>}
        </section>

        <section className="admin-panel admin-attention-panel">
          <header><div><span>Требует внимания</span><h2>Контроль качества</h2></div></header>
          <a href="#admin/products"><span className="amber"><AlertTriangle size={18} /></span><div><b>Непроверенные товары</b><small>Проверьте данные, созданные после распознавания</small></div><strong>{unverifiedProducts}</strong></a>
          <a href="#admin/reports"><span className="red"><FileWarning size={18} /></span><div><b>Репорты сборщиков</b><small>Не на месте, отсутствует, повреждено</small></div><strong>0</strong></a>
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

function WorkersTemplate({ data }: { data: AdminData }) {
  const active = data.sessions.filter((session) => session.status === 'in-progress').length
  const completed = data.sessions.filter((session) => session.status === 'completed').length
  return (
    <div className="admin-page">
      <AdminPageHeading eyebrow="КОМАНДА" title="Сборщики и смены" description="Управление ролями, текущими заданиями и рабочей нагрузкой." actions={<button className="admin-primary-action" type="button" disabled><Plus size={17} />Добавить сотрудника</button>} />
      <div className="admin-template-notice"><UserCog size={19} /><div><b>Шаблон локального профиля</b><span>До появления backend здесь отображается один локальный пользователь. Структура готова для команд и ролей.</span></div></div>
      <section className="admin-team-summary"><article><small>На смене</small><strong>1</strong><span>из 1 сотрудника</span></article><article><small>Активных заказов</small><strong>{active}</strong><span>в локальной базе</span></article><article><small>Завершено</small><strong>{completed}</strong><span>за всё время</span></article></section>
      <section className="admin-panel admin-table-panel">
        <header><div><span>Сотрудники</span><h2>Доступ и состояние</h2></div><label><Search size={16} /><input aria-label="Поиск сотрудника" placeholder="Поиск по имени" disabled /></label></header>
        <div className="admin-data-table"><div className="admin-data-row admin-data-head"><span>Сотрудник</span><span>Роль</span><span>Статус</span><span>Текущая задача</span><span>Последняя активность</span></div><div className="admin-data-row"><span className="admin-worker-cell"><i>АМ</i><span><b>Алексей Морозов</b><small>Локальный профиль</small></span></span><span><em className="admin-role-pill">Сборщик</em></span><span><em className="admin-state-pill active">На смене</em></span><span>{active ? 'Сборка заказа' : 'Свободен'}</span><span>Сейчас</span></div></div>
      </section>
    </div>
  )
}

function OrdersAdminPage({ data }: { data: AdminData }) {
  const sessions = useMemo(() => new Map(data.sessions.map((session) => [session.orderId, session])), [data.sessions])
  return (
    <div className="admin-page">
      <AdminPageHeading eyebrow="ОПЕРАЦИИ" title="Заказы" description="Контроль очереди, назначения и фактического прогресса сборки." actions={<button className="admin-primary-action" type="button" disabled><Plus size={17} />Создать задание</button>} />
      <section className="admin-panel admin-table-panel">
        <header><div><span>Все заказы</span><h2>{data.orders.length} записей</h2></div><label><Search size={16} /><input aria-label="Поиск заказа" placeholder="Номер заказа" disabled /></label></header>
        {data.orders.length ? <div className="admin-data-table orders"><div className="admin-data-row admin-data-head"><span>Заказ</span><span>Состояние</span><span>Позиции</span><span>Исполнитель</span><span>Обновлён</span></div>{data.orders.map((order) => { const session = sessions.get(order.id); const status = session?.status ?? 'not-started'; return <div className="admin-data-row" key={order.id}><span><b>{order.orderNumber || 'Без номера'}</b><small>{order.notes || 'Без примечания'}</small></span><span><em className={`admin-state-pill ${status}`}>{status === 'completed' ? 'Завершён' : status === 'in-progress' ? 'В работе' : status === 'paused' ? 'Пауза' : 'Не начат'}</em></span><span>{order.items.length}</span><span>{session ? 'Алексей Морозов' : 'Не назначен'}</span><span>{formatDate(order.updatedAt)}</span></div> })}</div> : <div className="admin-empty-large"><ClipboardList size={34} /><h2>Заказов пока нет</h2><p>Сохранённые или импортированные заказы появятся в этой очереди.</p></div>}
      </section>
    </div>
  )
}

function ReportsTemplate() {
  return (
    <div className="admin-page">
      <AdminPageHeading eyebrow="КОНТРОЛЬ" title="Репорты и исключения" description="Единая очередь сообщений от сборщиков и задач для водителей погрузчиков." actions={<button className="admin-secondary-action" type="button" disabled>Настроить правила</button>} />
      <section className="admin-report-kpis"><article><FileWarning size={19} /><div><strong>0</strong><span>Ожидают решения</span></div></article><article><Clock size={19} /><div><strong>0</strong><span>Передано погрузчику</span></div></article><article><CheckCircle2 size={19} /><div><strong>0</strong><span>Закрыто сегодня</span></div></article></section>
      <div className="admin-report-grid">
        <section className="admin-panel admin-report-queue"><header><div><span>Очередь</span><h2>Открытые репорты</h2></div><div className="admin-canvas-tabs"><button className="active" type="button">Все</button><button type="button" disabled>Не на месте</button><button type="button" disabled>Отсутствует</button></div></header><div className="admin-empty-large"><FileWarning size={36} /><h2>Репортов пока нет</h2><p>Сборщик сможет сообщить, что товар отсутствует, повреждён или находится по другому адресу.</p></div></section>
        <aside className="admin-panel admin-report-flow"><header><div><span>Маршрут события</span><h2>Как будет работать</h2></div></header><ol><li><span>1</span><div><b>Сборщик создаёт репорт</b><small>Товар, адрес, тип проблемы и фото</small></div></li><li><span>2</span><div><b>Администратор проверяет</b><small>Подтверждает новый адрес или отклоняет</small></div></li><li><span>3</span><div><b>Команда получает обновление</b><small>Предупреждение видно всем сборщикам</small></div></li><li><span>4</span><div><b>Погрузчик получает задачу</b><small>При отсутствии товара в нижней ячейке</small></div></li></ol></aside>
      </div>
    </div>
  )
}

function AdminSettingsTemplate() {
  return (
    <div className="admin-page">
      <AdminPageHeading eyebrow="СИСТЕМА" title="Настройки и доступ" description="Параметры ролей, локального хранения и будущей синхронизации." />
      <div className="admin-settings-grid">
        <section className="admin-panel admin-settings-card"><header><span><ShieldCheck size={20} /></span><div><h2>Роли и права</h2><p>Сборщик, водитель погрузчика и администратор</p></div></header><div className="admin-setting-row"><div><b>Переключение ролей</b><small>Сейчас доступно в демонстрационном режиме</small></div><em>Прототип</em></div><div className="admin-setting-row"><div><b>Настоящая авторизация</b><small>Потребует backend и управления пользователями</small></div><em>Позже</em></div></section>
        <section className="admin-panel admin-settings-card"><header><span><Database size={20} /></span><div><h2>Данные</h2><p>Локальная база этого устройства</p></div></header><div className="admin-setting-row"><div><b>IndexedDB</b><small>Товары, заказы и прогресс сборки</small></div><em className="ready">Активно</em></div><div className="admin-setting-row"><div><b>Синхронизация</b><small>Общая база между устройствами</small></div><em>Нужен backend</em></div></section>
        <section className="admin-panel admin-settings-card"><header><span><Bell size={20} /></span><div><h2>Уведомления</h2><p>Репорты и критические события</p></div></header><div className="admin-setting-row"><div><b>Репорты сборщиков</b><small>Центр уведомлений подготовлен</small></div><em>Шаблон</em></div><div className="admin-setting-row"><div><b>Push-уведомления</b><small>PWA на рабочих телефонах</small></div><em>Позже</em></div></section>
      </div>
    </div>
  )
}

export function AdminWorkspace({ role, onRoleChange }: AdminWorkspaceProps) {
  const [activeSection, setActiveSection] = useState<AdminSection>(() => adminSectionFromHash(window.location.hash))
  const [data, setData] = useState<AdminData>(emptyData)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!window.location.hash.startsWith('#admin')) window.location.hash = 'admin'
    const updateSection = () => setActiveSection(adminSectionFromHash(window.location.hash))
    window.addEventListener('hashchange', updateSection)
    return () => window.removeEventListener('hashchange', updateSection)
  }, [])

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    Promise.all([listProducts(), listOrders(), listFulfillmentSessions()])
      .then(([products, orders, sessions]) => { if (!cancelled) setData({ products, orders, sessions }) })
      .catch(console.error)
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [activeSection])

  const content = activeSection === 'warehouse' ? <WarehouseConstructorTemplate />
    : activeSection === 'products' ? <ProductDatabase />
      : activeSection === 'workers' ? <WorkersTemplate data={data} />
        : activeSection === 'orders' ? <OrdersAdminPage data={data} />
          : activeSection === 'reports' ? <ReportsTemplate />
            : activeSection === 'settings' ? <AdminSettingsTemplate />
              : <AdminOverview data={data} />

  return (
    <div className="app-shell admin-shell">
      <aside className="sidebar admin-sidebar">
        <div className="brand"><div className="brand-mark"><Warehouse size={22} strokeWidth={2.2} /></div><div><strong>Warehouse Pilot</strong><span>Панель администратора</span></div></div>
        <div className="admin-mode-badge"><ShieldCheck size={15} />Режим управления</div>
        <nav className="main-nav" aria-label="Навигация администратора">{adminNavigation.map(({ section, label, icon: Icon }) => <a className={activeSection === section ? 'active' : ''} href={adminHref(section)} key={section}><Icon size={19} />{label}</a>)}</nav>
        <div className="sidebar-bottom"><div className="local-card"><span className="local-icon"><Database size={18} /></span><div><strong>Локальный прототип</strong><span>Роли пока не ограничивают доступ технически</span></div></div><RoleSwitcher role={role} onRoleChange={onRoleChange} /></div>
      </aside>
      <main className="main-content admin-main-content">
        <header className="topbar admin-topbar"><div className="mobile-brand"><div className="brand-mark"><Warehouse size={20} /></div><strong>Warehouse Pilot</strong></div><div className="admin-topbar-actions"><span className="admin-sync-state"><i />Локальные данные</span><button type="button" aria-label="Уведомления администратора"><Bell size={18} /><i /></button><RoleSwitcher compact role={role} onRoleChange={onRoleChange} /></div></header>
        {isLoading && <div className="admin-loading-line" />}
        {content}
      </main>
      <nav className="mobile-bottom-nav admin-mobile-nav" aria-label="Мобильная навигация администратора">{adminNavigation.map(({ section, label, icon: Icon }) => <a className={activeSection === section ? 'active' : ''} href={adminHref(section)} key={section}><Icon size={20} /><span>{label === 'Конструктор склада' ? 'Склад' : label === 'Контроль и репорты' ? 'Репорты' : label === 'База товаров' ? 'Товары' : label}</span></a>)}</nav>
    </div>
  )
}
