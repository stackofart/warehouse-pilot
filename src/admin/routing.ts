import type { AdminSection } from './AdminWorkspace'

export function adminSectionFromHash(hash: string): AdminSection {
  const section = hash.replace(/^#admin\/?/, '').split('/')[0]
  if (section === 'warehouse' || section === 'products' || section === 'workers' || section === 'orders' || section === 'reports' || section === 'settings' || section === 'new-order' || section === 'pallet') return section
  return 'overview'
}

export function adminHash(hash: string) {
  if (/^#(?:work|route)\//.test(hash)) return hash.replace(/^#(?:work|route)\//, '#admin/orders/')
  if (/^#pallet(?:\/|$)/.test(hash)) return hash.replace(/^#pallet/, '#admin/pallet')
  return hash.startsWith('#admin') ? hash : '#admin'
}
