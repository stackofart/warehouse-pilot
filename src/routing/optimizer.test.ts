import { describe, expect, it } from 'vitest'
import type { RecognizedOrderItem } from '../recognition/ocr'
import { optimizeOrderRoute } from './optimizer'

function item(row: number, address: string): RecognizedOrderItem {
  return { row, address, sku: String(1000 + row), barcode: String(7290000000000 + row), description: `Product ${row}`, quantity: '1', unitsPerBox: '1', boxCount: '1', confidence: 100, warnings: [] }
}

describe('order route optimizer', () => {
  it('uses exact Held-Karp and chooses the shortest open route', () => {
    const result = optimizeOrderRoute([item(1, '24.F'), item(2, '23.F')])
    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') return
    expect(result.algorithm).toBe('held-karp')
    expect(result.stops.map((stop) => stop.address)).toEqual(['23.F', '24.F'])
    expect(result.totalDistance).toBeCloseTo(15.8)
  })

  it('includes Zone 40 addresses through the measured top aisle', () => {
    const result = optimizeOrderRoute([item(1, '23.F'), item(2, '40.B')])
    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') return
    expect(result.stops.map((stop) => stop.address)).toEqual(['23.F', '40.B'])
    expect(result.unresolved).toEqual([])
  })

  it('keeps the selected loading gate fixed after every picking stop', () => {
    const result = optimizeOrderRoute([item(1, '23.B'), item(2, '24.H')], {
      startAddress: '23.A',
      finishAddress: '40.A',
    })
    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') return
    expect(result.finishAddress).toBe('40.A')
    expect(result.stops.at(-1)?.address).toBe('24.H')
    expect(result.distanceToFinish).toBeCloseTo(4.4)
    expect(result.totalDistance).toBeCloseTo(result.stops.reduce((total, stop) => total + stop.distanceFromPrevious, 0) + result.distanceToFinish!)
    expect(result.pathPoints.at(-1)).toEqual({ x: 3.6, y: 21.4 })
  })

  it('routes directly to the loading gate when no picking stops remain', () => {
    const result = optimizeOrderRoute([], { startAddress: '26.H', finishAddress: '40.B' })
    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') return
    expect(result.stops).toEqual([])
    expect(result.distanceToFinish).toBeCloseTo(4.4)
    expect(result.totalDistance).toBeCloseTo(4.4)
  })

  it('switches to Nearest Neighbor plus 2-opt above 12 stops', () => {
    const addresses = ['21.A','21.B','21.C','21.D','21.E','21.F','21.G','22.A','22.B','22.C','22.D','22.E','22.F']
    const result = optimizeOrderRoute(addresses.map((address, index) => item(index + 1, address)))
    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') return
    expect(result.algorithm).toBe('nearest-neighbor-2opt')
    expect(result.stops).toHaveLength(13)
  })

  it('recalculates the remaining route from an actual warehouse address', () => {
    const result = optimizeOrderRoute([item(1, '24.F'), item(2, '23.F')], { startAddress: '24.F' })
    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') return
    expect(result.startAddress).toBe('24.F')
    expect(result.stops.map((stop) => stop.address)).toEqual(['24.F', '23.F'])
    expect(result.stops[0].distanceFromPrevious).toBe(0)
  })

  it('accepts sector H as an actual start for upper rows', () => {
    const result = optimizeOrderRoute([item(1, '24.F')], { startAddress: '26.H' })
    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') expect(result.startAddress).toBe('26.H')
  })

  it('rejects an unknown loading gate', () => {
    expect(optimizeOrderRoute([item(1, '24.F')], { finishAddress: '40.H' })).toEqual({
      status: 'invalid',
      reason: 'FINISH_ADDRESS_UNRESOLVED',
    })
  })
})
