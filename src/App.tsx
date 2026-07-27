import { useState } from 'react'
import { AppData } from './types'
import { loadData, saveData, StoreCtx } from './store'
import { NavCtx, View } from './nav'
import { TimerBar, TimerCtx, useTimerState } from './timer'
import Home from './views/Home'
import SessionView from './views/SessionView'
import WorkoutEditor from './views/WorkoutEditor'
import ExerciseEditor from './views/ExerciseEditor'
import ExercisesView from './views/Exercises'
import History from './views/History'
import Progress from './views/Progress'
import SettingsView from './views/Settings'

export default function App() {
  const [data, setData] = useState<AppData>(loadData)
  const update = (fn: (d: AppData) => AppData) => {
    setData(d => {
      const nd = fn(d)
      saveData(nd)
      return nd
    })
  }
  const [view, setView] = useState<View>({ name: 'home' })
  const timerApi = useTimerState()

  let content
  switch (view.name) {
    case 'home':
      content = <Home />
      break
    case 'session':
      content = <SessionView sessionId={view.sessionId} />
      break
    case 'editWorkout':
      content = <WorkoutEditor workoutId={view.workoutId} />
      break
    case 'editExercise':
      content = <ExerciseEditor exerciseId={view.exerciseId} back={view.back} addToWorkoutId={view.addToWorkoutId} addToSessionId={view.addToSessionId} />
      break
    case 'exercises':
      content = <ExercisesView />
      break
    case 'history':
      content = <History />
      break
    case 'progress':
      content = <Progress initialExerciseId={view.exerciseId} />
      break
    case 'settings':
      content = <SettingsView />
      break
  }

  const tab =
    view.name === 'progress' ? 'progress'
    : view.name === 'settings' ? 'settings'
    : view.name === 'history' ? 'history'
    : 'home'

  return (
    <StoreCtx.Provider value={{ data, update }}>
      <NavCtx.Provider value={{ view, go: setView }}>
        <TimerCtx.Provider value={timerApi}>
          <div className="app">
            <TimerBar />
            <main className="main">{content}</main>
            <nav className="bottomnav">
              <button className={tab === 'home' ? 'active' : ''} onClick={() => setView({ name: 'home' })}>
                <span className="navicon">🏋️</span>Train
              </button>
              <button className={tab === 'history' ? 'active' : ''} onClick={() => setView({ name: 'history' })}>
                <span className="navicon">🗓️</span>History
              </button>
              <button className={tab === 'progress' ? 'active' : ''} onClick={() => setView({ name: 'progress' })}>
                <span className="navicon">📈</span>Progress
              </button>
              <button className={tab === 'settings' ? 'active' : ''} onClick={() => setView({ name: 'settings' })}>
                <span className="navicon">⚙️</span>Settings
              </button>
            </nav>
          </div>
        </TimerCtx.Provider>
      </NavCtx.Provider>
    </StoreCtx.Provider>
  )
}
