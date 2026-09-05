import { describe, expect, it } from 'vitest'
import { prepareReportDraft } from './draft'

describe('report inputs', () => {
  it('accepts a new address without a comment and normalizes it', () => {
    expect(prepareReportDraft('moved', '', ' 24f ')).toEqual({ error: '', kind: 'moved', note: '', suggestedAddress: '24.F' })
  })
  it('requires an address only for a moved report and text only for comments', () => {
    expect(prepareReportDraft('moved', 'Found nearby', '').error).not.toBe('')
    expect(prepareReportDraft('comment', '  ').error).not.toBe('')
    expect(prepareReportDraft('missing', '').error).toBe('')
    expect(prepareReportDraft('damaged', '').error).toBe('')
    expect(prepareReportDraft('comment', 'Broken seal', '24.F').suggestedAddress).toBeUndefined()
  })
})
