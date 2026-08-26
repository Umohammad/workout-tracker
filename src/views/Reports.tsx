import { useState } from 'react'
import Progress from './Progress'
import Volume from './Volume'

type Tab = 'volume' | 'exercise'

// Two ways to read the same history: Volume answers "how much am I training?"
// across everything, Exercise drills into one movement. Arriving here from an
// exercise (Progress link on a session tile) opens straight into the drill-down.
export default function Reports({ initialExerciseId }: { initialExerciseId?: string }) {
  const [tab, setTab] = useState<Tab>(initialExerciseId ? 'exercise' : 'volume')

  return (
    <>
      <header className="pagehead">
        <h1>Progress</h1>
      </header>
      <div className="choicegrid two reporttabs">
        <button className={'choice' + (tab === 'volume' ? ' active' : '')} onClick={() => setTab('volume')}>
          Volume
        </button>
        <button className={'choice' + (tab === 'exercise' ? ' active' : '')} onClick={() => setTab('exercise')}>
          By exercise
        </button>
      </div>
      {tab === 'volume' ? <Volume /> : <Progress initialExerciseId={initialExerciseId} />}
    </>
  )
}
