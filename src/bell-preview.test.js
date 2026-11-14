import { expect, it, vi } from 'vitest'
import { createBellPreview } from './bell-preview.js'
import { scheduleBell } from './bells.js'
import { generateBellTimbre } from './bell-timbre.js'
import { BELL_TIMBRE } from './constants.js'

vi.mock('./bells.js', () => ({
  scheduleBell: vi.fn(() => ({ ended: false, update: vi.fn(), stop: vi.fn() })),
}))

it('keeps one sustained bank, morphs it without retriggering, and fades on release', () => {
  scheduleBell.mockClear()
  const context = { currentTime: 0, state: 'running' }
  const preview = createBellPreview(() => context)
  const first = generateBellTimbre({ x: 0.2, y: 0.3 })
  preview.begin(first)
  expect(scheduleBell).toHaveBeenCalledOnce()
  expect(scheduleBell.mock.calls[0][3]).toEqual({ sustain: true })
  expect(scheduleBell.mock.calls[0][2].partials[0][1]).toBe(
    first.partials[0][1] * BELL_TIMBRE.previewGain,
  )
  const voice = scheduleBell.mock.results[0].value
  context.currentTime = 60
  for (let i = 0; i < 20; i++) preview.update(generateBellTimbre({ x: i / 20, y: 0.5 }))
  expect(scheduleBell).toHaveBeenCalledOnce()
  expect(voice.update).toHaveBeenCalledTimes(20)
  preview.release()
  expect(voice.stop).toHaveBeenCalledWith(BELL_TIMBRE.previewReleaseSeconds)
  preview.stop()
  expect(voice.stop).toHaveBeenLastCalledWith(undefined)
})

it('does not start while suspended, and stops an interrupted sustained preview', () => {
  scheduleBell.mockClear()
  const context = { state: 'suspended', currentTime: 0 }
  const preview = createBellPreview(() => context)
  const sound = generateBellTimbre({ x: 0.5, y: 0.5 })
  preview.begin(sound)
  expect(scheduleBell).not.toHaveBeenCalled()
  context.state = 'running'
  preview.begin(sound)
  const voice = scheduleBell.mock.results[0].value
  context.state = 'suspended'
  preview.update(sound)
  expect(voice.stop).toHaveBeenCalledOnce()
})
