import type { ElectronApi } from '../../shared/contracts'

declare global {
  interface Window {
    electree: ElectronApi
  }
}

export {}
