import {
  Activity,
  AlertTriangle,
  BarChart3,
  Boxes,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Flame,
  Footprints,
  Gauge,
  MapPinned,
  PackageCheck,
  Route,
  Scale,
  Timer,
  TrendingUp,
  Weight,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { listFulfillmentSessions } from '../fulfillment/storage'
import { listOrders } from '../orders/storage'
import { calculateOverviewAnalytics, calorieFormula, type AnalyticsPeriod } from './analytics'
import { OverviewHeatmap } from './OverviewHeatmap'

type PeriodPreset = 'today' | '7d' | '30d' | 'all' | 'custom'

const numberFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })
const integerFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })

function localDateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function startOfDay(value: string) {
  if (!value) return null
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day).getTime()
}

function endOfDay(value: string) {
  const start = startOfDay(value)
  return start === null ? null : start + 24 * 60 * 60 * 1_000 - 1
}

function periodFor(preset: PeriodPreset, customFrom: string, customTo: string, now = new Date()): AnalyticsPeriod {
  if (preset === 'all') return { from: null, to: null }
  if (preset === 'custom') return { from: startOfDay(customFrom), to: endOfDay(customTo) }
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - 1
  const days = preset === 'today' ? 1 : preset === '7d' ? 7 : 30
  return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate() - days + 1).getTime(), to: end }
}

function formatDuration(milliseconds: number | null) {
  if (milliseconds === null) return '—'
  const seconds = Math.round(milliseconds / 1_000)
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.floor(seconds % 3_600 / 60)
  const remainder = seconds % 60
  return hours ? `${hours} ч ${minutes} мин` : `${minutes} мин ${String(remainder).padStart(2, '0')} сек`
}

function formatCompactDuration(milliseconds: number | null) {
  if (milliseconds === null) return '—'
  const seconds = Math.round(milliseconds / 1_000)
  return seconds >= 60 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : `${seconds} сек`
}

export function OverviewDashboard() {
  const today = useMemo(() => new Date(), [])
  const monthAgo = useMemo(() => new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29), [today])
  const [preset, setPreset] = useState<PeriodPreset>('30d')
  const [customFrom, setCustomFrom] = useState(localDateValue(monthAgo))
  const [customTo, setCustomTo] = useState(localDateValue(today))
  const [data, setData] = useState<Awaited<ReturnType<typeof loadOverviewData>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    loadOverviewData().then(setData).catch((reason) => {
      console.error(reason)
      setError('Не удалось загрузить статистику из локальной базы')
    }).finally(() => setLoading(false))
  }, [])

  const period = useMemo(() => periodFor(preset, customFrom, customTo), [customFrom, customTo, preset])
  const analytics = useMemo(() => data ? calculateOverviewAnalytics(data.orders, data.sessions, data.products, period) : null, [data, period])
  const hottest = analytics?.heatmap.slice(0, 6) ?? []
  const slowestProduct = analytics?.products.filter((product) => product.estimatedCollectionMs !== null).sort((left, right) => right.estimatedCollectionMs! - left.estimatedCollectionMs!)[0]
  const maximumDailyBoxes = Math.max(1, ...(analytics?.daily.map((day) => day.boxes) ?? [1]))

  if (loading) return <div className="page"><div className="orders-empty"><BarChart3 size={30} /><p>Собираем локальную статистику…</p></div></div>
  if (error || !analytics) return <div className="page"><div className="orders-empty"><AlertTriangle size={30} /><strong>{error || 'Статистика недоступна'}</strong></div></div>

  return (
    <div className="page overview-page">
      <div className="page-heading overview-heading">
        <div><p className="eyebrow">ОПЕРАЦИОННЫЙ ОБЗОР</p><h1>Статистика склада</h1><p>Заказы, фактическое время, маршрут и нагрузка — только из данных этого устройства.</p></div>
        <div className="overview-period-control">
          <span><CalendarDays size={15} />Период</span>
          <div className="overview-period-presets">
            {([['today', 'Сегодня'], ['7d', '7 дней'], ['30d', '30 дней'], ['all', 'Всё'], ['custom', 'Свой']] as Array<[PeriodPreset, string]>).map(([value, label]) => <button className={preset === value ? 'active' : ''} type="button" key={value} onClick={() => setPreset(value)}>{label}</button>)}
          </div>
          {preset === 'custom' && <div className="overview-custom-period"><label><span>С</span><input type="date" value={customFrom} max={customTo} onChange={(event) => setCustomFrom(event.target.value)} /></label><label><span>По</span><input type="date" value={customTo} min={customFrom} onChange={(event) => setCustomTo(event.target.value)} /></label></div>}
        </div>
      </div>

      {!analytics.orders ? (
        <section className="overview-empty"><BarChart3 size={35} /><h2>За выбранный период заказов нет</h2><p>Выберите другой период или начните новый заказ.</p><a className="primary-button" href="#new-order">Новый заказ</a></section>
      ) : <>
        <section className="overview-kpi-grid">
          <article><span className="overview-kpi-icon green"><PackageCheck size={19} /></span><div><small>Заказы</small><strong>{analytics.orders}</strong><p>{analytics.completedOrders} завершено · {analytics.activeOrders} в работе</p></div></article>
          <article><span className="overview-kpi-icon blue"><Boxes size={19} /></span><div><small>Коробок на заказ</small><strong>{numberFormatter.format(analytics.averageBoxesPerOrder)}</strong><p>{integerFormatter.format(analytics.boxes)} всего</p></div></article>
          <article><span className="overview-kpi-icon violet"><TrendingUp size={19} /></span><div><small>Товаров на заказ</small><strong>{numberFormatter.format(analytics.averageUnitsPerOrder)}</strong><p>{numberFormatter.format(analytics.averagePositionsPerOrder)} позиций</p></div></article>
          <article><span className="overview-kpi-icon amber"><Scale size={19} /></span><div><small>Вес заказа</small><strong>{analytics.weightOrderCount ? `${numberFormatter.format(analytics.averageWeightPerOrderKg)} кг` : '—'}</strong><p>{numberFormatter.format(analytics.totalWeightKg)} кг всего</p></div></article>
          <article><span className="overview-kpi-icon coral"><Clock3 size={19} /></span><div><small>Время заказа</small><strong>{formatDuration(analytics.averageOrderMs)}</strong><p>среднее завершённых</p></div></article>
          <article><span className="overview-kpi-icon teal"><Route size={19} /></span><div><small>Маршрут</small><strong>{numberFormatter.format(analytics.totalDistanceMeters)} м</strong><p>{analytics.averageSpeedMetersPerMinute ? `${numberFormatter.format(analytics.averageSpeedMetersPerMinute)} м/мин` : 'скорость пока неизвестна'}</p></div></article>
        </section>

        <div className="overview-two-column">
          <section className="overview-card overview-time-card">
            <header><div><Timer size={19} /><span><p className="section-kicker">ВРЕМЯ</p><h2>Из чего состоит заказ</h2></span></div><small>{Math.round(analytics.timeCoveragePercent)}% заказов завершено</small></header>
            <div className="overview-time-metrics">
              <div><span><Clock3 size={16} />Весь заказ</span><strong>{formatDuration(analytics.averageOrderMs)}</strong></div>
              <div><span><Boxes size={16} />Сборка</span><strong>{formatDuration(analytics.averageCollectionMs)}</strong></div>
              <div><span><Footprints size={16} />Переходы</span><strong>{formatDuration(analytics.averageTravelMs)}</strong></div>
            </div>
            <div className="overview-time-bar" aria-label="Соотношение времени сборки и переходов">
              <span className="collecting" style={{ width: `${analytics.averageOrderMs ? Math.min(100, (analytics.averageCollectionMs ?? 0) / analytics.averageOrderMs * 100) : 0}%` }} />
              <span className="travel" style={{ width: `${analytics.averageOrderMs ? Math.min(100, (analytics.averageTravelMs ?? 0) / analytics.averageOrderMs * 100) : 0}%` }} />
            </div>
            <div className="overview-time-legend"><span><i className="collecting" />Сборка</span><span><i className="travel" />Путь</span><span><i />Прочее и ожидание</span></div>
          </section>

          <section className="overview-card overview-load-card">
            <header><div><Weight size={19} /><span><p className="section-kicker">НАГРУЗКА</p><h2>Вес и энергозатраты</h2></span></div><span className="overview-estimate-badge">Оценка</span></header>
            <div className="overview-load-grid">
              <div><Weight size={17} /><span><small>Перемещено</small><strong>{numberFormatter.format(analytics.handledWeightKg)} кг</strong></span></div>
              <div><Activity size={17} /><span><small>Грузовая работа</small><strong>{integerFormatter.format(analytics.loadDistanceKgM)} кг·м</strong></span></div>
              <div><Flame size={17} /><span><small>Энергия</small><strong>≈ {integerFormatter.format(analytics.estimatedCalories)} ккал</strong></span></div>
            </div>
            <p className="overview-formula">Оценка: путь × ({calorieFormula.workerWeightKg} кг + переносимый груз) × {calorieFormula.walkingKcalPerKgKm} ккал/(кг·км) + обработанный вес × {calorieFormula.handlingKcalPerKg} ккал/кг. Это модель нагрузки, не медицинское измерение.</p>
          </section>
        </div>

        <section className="overview-card overview-trend-card">
          <header><div><BarChart3 size={19} /><span><p className="section-kicker">ДИНАМИКА</p><h2>Коробки по дням</h2></span></div><small>До 31 последнего дня с заказами</small></header>
          <div className="overview-daily-chart">
            {analytics.daily.map((day) => <div className="overview-day-column" key={day.date} title={`${day.label}: ${day.boxes} коробок, ${day.orders} заказов`}><span>{integerFormatter.format(day.boxes)}</span><div><i style={{ height: `${Math.max(5, day.boxes / maximumDailyBoxes * 100)}%` }} /></div><small>{day.label}</small></div>)}
          </div>
        </section>

        <div className="overview-heat-layout">
          <section className="overview-card overview-heat-card">
            <header><div><MapPinned size={19} /><span><p className="section-kicker">ТЕПЛОВАЯ КАРТА</p><h2>Где собирают чаще</h2></span></div><small>Интенсивность по числу коробок</small></header>
            <div className="overview-heatmap-wrap"><OverviewHeatmap entries={analytics.heatmap} /></div>
          </section>
          <aside className="overview-card overview-hot-addresses">
            <header><div><Flame size={18} /><span><p className="section-kicker">ТОП АДРЕСОВ</p><h2>Самые нагруженные</h2></span></div></header>
            <ol>{hottest.map((entry, index) => <li key={entry.address}><span>{index + 1}</span><div><b>{entry.address}</b><small>{entry.orderCount} заказов · {entry.lines} позиций</small></div><strong>{integerFormatter.format(entry.boxes)} кор.</strong></li>)}</ol>
          </aside>
        </div>

        <section className="overview-card overview-products-card">
          <header><div><Boxes size={19} /><span><p className="section-kicker">ТОВАРЫ</p><h2>Частота и расчётное время сборки</h2></span></div><small>Время остановки распределяется пропорционально коробкам</small></header>
          <div className="overview-products-table-wrap"><table><thead><tr><th>Товар</th><th>Адрес</th><th>Заказы</th><th>Коробки</th><th>Единицы</th><th>Ср. сборка</th><th>Вес</th></tr></thead><tbody>{analytics.products.slice(0, 12).map((product) => <tr key={product.key}><td><b dir="auto">{product.name}</b><small>{product.barcode || 'без штрихкода'}{product.missingCount ? ` · отсутствовал ${product.missingCount}×` : ''}</small></td><td><span className="overview-address-pill">{product.address || '—'}</span></td><td>{product.orderCount}</td><td>{numberFormatter.format(product.boxes)}</td><td>{numberFormatter.format(product.units)}</td><td>{formatCompactDuration(product.estimatedCollectionMs)}</td><td>{product.weightKg ? `${numberFormatter.format(product.weightKg)} кг` : '—'}</td></tr>)}</tbody></table></div>
        </section>

        <div className="overview-insight-grid">
          <article><Gauge size={18} /><div><small>Дефицит</small><strong>{numberFormatter.format(analytics.missingRatePercent)}%</strong><p>{analytics.missingItems} отсутствующих из {analytics.handledItems} обработанных</p></div></article>
          <article><CheckCircle2 size={18} /><div><small>Покрытие веса</small><strong>{Math.round(analytics.weightCoveragePercent)}%</strong><p>коробок связано с габаритами и весом</p></div></article>
          <article><Timer size={18} /><div><small>Самый медленный товар</small><strong dir="auto">{slowestProduct?.name || 'Недостаточно данных'}</strong><p>{slowestProduct ? `${formatCompactDuration(slowestProduct.estimatedCollectionMs)} расчётно` : 'Нужны завершённые остановки'}</p></div></article>
          <article><MapPinned size={18} /><div><small>Самая частая точка</small><strong>{hottest[0]?.address || '—'}</strong><p>{hottest[0] ? `${integerFormatter.format(hottest[0].boxes)} коробок` : 'Нет адресов'}</p></div></article>
        </div>

        {(analytics.weightCoveragePercent < 80 || analytics.timeCoveragePercent < 80 || analytics.ignoredTimingOutliers > 0) && <section className="overview-data-note"><AlertTriangle size={17} /><div><b>Точность дашборда можно повысить</b><p>{analytics.weightCoveragePercent < 80 ? `Вес известен для ${Math.round(analytics.weightCoveragePercent)}% коробок. Заполните вес коробок в базе товаров. ` : ''}{analytics.timeCoveragePercent < 80 ? `Корректное полное время есть для ${Math.round(analytics.timeCoveragePercent)}% заказов выбранного периода. ` : ''}{analytics.ignoredTimingOutliers > 0 ? `Исключено аномальных временных интервалов: ${analytics.ignoredTimingOutliers} (переход/сборка более 4 ч или заказ более 16 ч).` : ''}</p></div></section>}
      </>}
    </div>
  )
}

async function loadOverviewData() {
  const [orders, sessions] = await Promise.all([listOrders(), listFulfillmentSessions()])
  const products = orders.flatMap(order => order.productSnapshots || [])
  return { orders, sessions, products }
}
