import { createContext, useContext } from 'react'
import { AppData } from './types'
import { defaultSettings, seedData } from './seed'

const KEY = 'workout-tracker-v1'

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return seedData()
    const parsed = JSON.parse(raw) as AppData
    // Backfill any settings fields added in later versions
    parsed.settings = { ...defaultSettings(), ...parsed.settings }
    parsed.sessions ||= []
    parsed.workouts ||= []
    parsed.exercises ||= []
    return parsed
  } catch {
    return seedData()
  }
}

export function saveData(data: AppData) {
  localStorage.setItem(KEY, JSON.stringify(data))
}

export interface Store {
  data: AppData
  update: (fn: (d: AppData) => AppData) => void
}

export const StoreCtx = createContext<Store>(null!)
export const useStore = () => useContext(StoreCtx)
