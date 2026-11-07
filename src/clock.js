// Derive elapsed time from timestamps so delayed browser ticks do not cause drift.
export function createClock(duration = null, now = Date.now) {
  let accumulated = 0
  let startedAt = null

  function read() {
    const elapsed = accumulated + (startedAt === null ? 0 : Math.max(0, now() - startedAt))
    return {
      elapsed: duration === null ? elapsed : Math.min(duration, elapsed),
      complete: duration !== null && elapsed >= duration,
    }
  }

  return {
    read,
    resume() {
      if (startedAt === null && !read().complete) startedAt = now()
    },
    pause() {
      accumulated = read().elapsed
      startedAt = null
    },
  }
}

export function formatTime(milliseconds, roundUp = false) {
  const total = Math.max(0, (roundUp ? Math.ceil : Math.floor)(milliseconds / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor(total / 60) % 60
  const seconds = total % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
