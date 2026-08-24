import { describe, expect, it } from 'vitest'
import { addressNodeId, resolveAddress } from './geometry'
import { buildWarehouseGraph } from './graph'
import { validateWarehouseLayout, warehouseLayout } from './layout'
import { distance } from './shortestPath'
import type { Address } from './types'

function nodeId(row: number, sector: Address['sector']) {
  return addressNodeId({ row, sector, canonical: `${row}.${sector}` })
}

describe('warehouse measured geometry', () => {
  it('is internally consistent', () => {
    expect(validateWarehouseLayout()).toEqual([])
  })

  it('keeps adjacent sector centers 2.4 m apart', () => {
    const result = distance('23.A', '23.B')
    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') expect(result.distance).toBeCloseTo(2.4)
  })

  it('maps rows 23 and 24 to the same walking axis between their picking faces', () => {
    const result = distance('23.F', '24.F')
    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') expect(result.distance).toBeCloseTo(0)
  })

  it('does not connect back-to-back rows 24 and 25 directly', () => {
    const result = buildWarehouseGraph()
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    const directTargets = result.graph.adjacency.get(nodeId(24, 'F'))?.map((edge) => edge.to) ?? []
    expect(directTargets).not.toContain(nodeId(25, 'F'))
  })

  it('maps rows 25 and 26 to the same walking axis between their picking faces', () => {
    const result = distance('25.F', '26.F')
    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') expect(result.distance).toBeCloseTo(0)
  })

  it('connects rows 23 and 1 to the same central X coordinate', () => {
    const upper = resolveAddress('23.A')
    const lower = resolveAddress('1.A')
    expect(upper.status).toBe('resolved')
    expect(lower.status).toBe('resolved')
    if (upper.status === 'resolved' && lower.status === 'resolved') expect(upper.point.x).toBe(lower.point.x)
  })

  it('resolves sector H for every upper row from 21 through 32', () => {
    for (let row = 21; row <= 32; row += 1) {
      expect(resolveAddress(`${row}.H`)).toMatchObject({ status: 'resolved', address: { canonical: `${row}.H` } })
    }
    expect(distance('26.G', '26.H')).toMatchObject({ status: 'resolved', distance: 2.4 })
  })

  it('resolves 40.B on the measured top aisle', () => {
    expect(resolveAddress('40.B')).toMatchObject({ status: 'resolved', point: { x: 8, y: 21.4 } })
  })

  it('records the 2 m top aisle and measured Zone 40 positions', () => {
    expect(warehouseLayout.zone40.topCrossAisle).toMatchObject({ exists: true, traversable: true, measured: true, width: 2, centerY: 21.4 })
    expect(warehouseLayout.zone40.positions['40.A'].oppositeRackBlock).toEqual([24, 25])
    expect(warehouseLayout.zone40.positions['40.B'].oppositeRackBlock).toEqual([26, 27])
    expect(warehouseLayout.zone40.positions['40.D']).toMatchObject({ role: 'finish', oppositeRackBlock: [28, 29], x: 12.4, y: 21.4 })
    expect(resolveAddress('40.D')).toMatchObject({ status: 'resolved', point: { x: 12.4, y: 21.4 } })
  })

  it('routes from an upper address through the top aisle to Zone 40', () => {
    const result = distance('24.H', '40.A')
    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') expect(result.distance).toBeCloseTo(4.4)
  })

  it('does not create rows 11-20', () => {
    const result = buildWarehouseGraph()
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    for (let row = 11; row <= 20; row += 1) {
      expect([...result.graph.nodes.values()].some((node) => node.address?.startsWith(`${row}.`))).toBe(false)
    }
  })

  it('does not add a wall-side cross aisle', () => {
    const result = buildWarehouseGraph()
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(warehouseLayout.lowerArea.wallCrossAisle?.exists).toBeNull()
    const directTargets = result.graph.adjacency.get(nodeId(2, 'H'))?.map((edge) => edge.to) ?? []
    expect(directTargets).not.toContain(nodeId(3, 'H'))
  })
})
