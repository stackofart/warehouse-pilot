import type { AdminSection } from './AdminWorkspace'

export function adminSectionFromHash(hash: string): AdminSection {
  const section = hash.replace(/^#admin\/?/, '').split('/')[0]
  if (section === 'warehouse' || section === 'products' || section === 'workers' || section === 'orders' || section === 'reports' || section === 'settings') return section
  return 'overview'
}
