export function NumField({
  label,
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  suffix,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
}) {
  const clamp = (v: number) => {
    let r = Math.round(v * 100) / 100
    if (r < min) r = min
    if (max !== undefined && r > max) r = max
    return r
  }
  return (
    <div className="numfield">
      <label className="fieldlabel">{label}</label>
      <div className="numfield-row">
        <button className="stepbtn small" onClick={() => onChange(clamp(value - step))}>−</button>
        <input
          inputMode="decimal"
          value={value}
          onChange={e => {
            const n = parseFloat(e.target.value)
            if (!isNaN(n)) onChange(clamp(n))
            else if (e.target.value === '') onChange(min)
          }}
        />
        <button className="stepbtn small" onClick={() => onChange(clamp(value + step))}>＋</button>
      </div>
      {suffix && <span className="sub">{suffix}</span>}
    </div>
  )
}
