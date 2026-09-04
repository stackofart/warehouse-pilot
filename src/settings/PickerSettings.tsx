import { Menu, PanelBottom } from 'lucide-react'

export type MobileNavigationMode = 'bottom' | 'drawer'

type PickerSettingsProps = {
  navigationMode: MobileNavigationMode
  onNavigationModeChange: (mode: MobileNavigationMode) => void
}

export function PickerSettings({ navigationMode, onNavigationModeChange }: PickerSettingsProps) {
  return (
    <div className="page picker-settings-page">
      <div className="page-heading"><div><p className="eyebrow">НАСТРОЙКИ</p><h1>Интерфейс комплектовщика</h1><p>Выберите, как открывать основные разделы на телефоне.</p></div></div>
      <section className="picker-settings-card">
        <header><span>Мобильная навигация</span><h2>Расположение меню</h2></header>
        <div className="navigation-mode-options" role="radiogroup" aria-label="Расположение мобильного меню">
          <button className={navigationMode === 'bottom' ? 'active' : ''} type="button" role="radio" aria-checked={navigationMode === 'bottom'} onClick={() => onNavigationModeChange('bottom')}>
            <span><PanelBottom size={24} /></span><div><b>Панель снизу</b><small>Все разделы всегда видны внизу экрана.</small></div><i />
          </button>
          <button className={navigationMode === 'drawer' ? 'active' : ''} type="button" role="radio" aria-checked={navigationMode === 'drawer'} onClick={() => onNavigationModeChange('drawer')}>
            <span><Menu size={24} /></span><div><b>Боковое меню</b><small>Меню открывается кнопкой слева в верхней панели.</small></div><i />
          </button>
        </div>
        <p>Настройка сохраняется только для этого браузера и устройства.</p>
      </section>
    </div>
  )
}
