import { createContext, useContext } from 'react'

export type View =
  | { name: 'home' }
  | { name: 'session'; sessionId: string }
  | { name: 'editWorkout'; workoutId: string }
  | { name: 'editExercise'; exerciseId: string | null; back: View; addToWorkoutId?: string; addToSessionId?: string }
  | { name: 'exercises' }
  | { name: 'history' }
  | { name: 'progress'; exerciseId?: string }
  | { name: 'settings' }

export const NavCtx = createContext<{ view: View; go: (v: View) => void }>(null!)
export const useNav = () => useContext(NavCtx)
