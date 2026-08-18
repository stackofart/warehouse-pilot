import { Focus, Minus, Plus, RotateCcw, RotateCw, ScanSearch } from 'lucide-react'
import { type PointerEvent, type WheelEvent, useMemo, useRef, useState } from 'react'
import type { PalletPlacement } from './packing'

type Point3 = { x: number; y: number; z: number }
type Projected = { x: number; y: number; depth: number }
type Face = { key: string; points: Projected[]; depth: number; color: string; box?: PalletPlacement; pallet?: boolean }

const WIDTH = 860
const HEIGHT = 570
const PAD = 58
const FACE_INDICES = [[0,1,2,3],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]]

function vertices(x: number, y: number, z: number, length: number, width: number, height: number): Point3[] {
  return [
    { x, y, z }, { x: x + length, y, z }, { x: x + length, y: y + width, z }, { x, y: y + width, z },
    { x, y, z: z + height }, { x: x + length, y, z: z + height }, { x: x + length, y: y + width, z: z + height }, { x, y: y + width, z: z + height },
  ]
}

function rawProjection(point: Point3, yaw: number, pitch: number): Projected {
  const x = point.x - 60
  const y = point.y - 40
  const along = x * Math.sin(yaw) + y * Math.cos(yaw)
  return {
    x: x * Math.cos(yaw) - y * Math.sin(yaw),
    y: along * Math.sin(pitch) - point.z * Math.cos(pitch),
    depth: along * Math.cos(pitch) + point.z * Math.sin(pitch),
  }
}

function productColor(id: string) {
  const hash = [...id].reduce((total, character) => (total * 31 + character.charCodeAt(0)) % 360, 137)
  return `hsl(${hash} 52% 48%)`
}

function pointsAttribute(points: Projected[]) {
  return points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ')
}

export function PalletScene({ placements, selectedProductId = '', emptyLabel = 'Нет коробок для отображения' }: { placements: PalletPlacement[]; selectedProductId?: string; emptyLabel?: string }) {
  const [yaw, setYaw] = useState(-Math.PI / 4)
  const [pitch, setPitch] = useState(.62)
  const [zoom, setZoom] = useState(1)
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null)

  const scene = useMemo(() => {
    const boxes = [{ key: 'pallet', vertices: vertices(0, 0, -7, 120, 80, 7), color: '#b98a4b', pallet: true as const }, ...placements.map((box) => ({ key: box.id, vertices: vertices(box.x, box.y, box.z, box.lengthCm, box.widthCm, box.heightCm), color: productColor(box.productId), box }))]
    const rawPoints = boxes.flatMap((box) => box.vertices.map((point) => rawProjection(point, yaw, pitch)))
    const minX = Math.min(...rawPoints.map((point) => point.x))
    const maxX = Math.max(...rawPoints.map((point) => point.x))
    const minY = Math.min(...rawPoints.map((point) => point.y))
    const maxY = Math.max(...rawPoints.map((point) => point.y))
    const fit = Math.min((WIDTH - PAD * 2) / Math.max(1, maxX - minX), (HEIGHT - PAD * 2) / Math.max(1, maxY - minY)) * zoom
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2
    const project = (point: Point3) => {
      const raw = rawProjection(point, yaw, pitch)
      return { x: WIDTH / 2 + (raw.x - centerX) * fit, y: HEIGHT / 2 + (raw.y - centerY) * fit, depth: raw.depth }
    }
    const faces: Face[] = []
    for (const shape of boxes) {
      FACE_INDICES.forEach((indices, index) => {
        const projected = indices.map((vertex) => project(shape.vertices[vertex]))
        faces.push({ key: `${shape.key}:${index}`, points: projected, depth: projected.reduce((sum, point) => sum + point.depth, 0) / projected.length, color: shape.color, box: 'box' in shape ? shape.box : undefined, pallet: 'pallet' in shape })
      })
    }
    return faces.sort((left, right) => left.depth - right.depth)
  }, [placements, pitch, yaw, zoom])

  const reset = () => { setYaw(-Math.PI / 4); setPitch(.62); setZoom(1) }
  const pointerDown = (event: PointerEvent<SVGSVGElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, y: event.clientY, yaw, pitch }
  }
  const pointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!drag.current) return
    setYaw(drag.current.yaw + (event.clientX - drag.current.x) * .009)
    setPitch(Math.max(.14, Math.min(1.35, drag.current.pitch - (event.clientY - drag.current.y) * .007)))
  }
  const wheel = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault()
    setZoom((value) => Math.max(.55, Math.min(2.4, value * (event.deltaY > 0 ? .9 : 1.1))))
  }

  return (
    <div className="pallet-scene-shell">
      <div className="pallet-scene-controls" aria-label="Управление 3D-сценой">
        <button type="button" aria-label="Повернуть влево" onClick={() => setYaw((value) => value - Math.PI / 12)}><RotateCcw size={16} /></button>
        <button type="button" aria-label="Повернуть вправо" onClick={() => setYaw((value) => value + Math.PI / 12)}><RotateCw size={16} /></button>
        <button type="button" aria-label="Уменьшить" onClick={() => setZoom((value) => Math.max(.55, value * .85))}><Minus size={16} /></button>
        <button type="button" aria-label="Увеличить" onClick={() => setZoom((value) => Math.min(2.4, value * 1.15))}><Plus size={16} /></button>
        <button type="button" aria-label="Вписать всю паллету" onClick={reset}><Focus size={16} /></button>
      </div>
      <svg className="pallet-scene" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Интерактивная трёхмерная компоновка паллеты" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} onWheel={wheel}>
        {scene.map((face) => {
          const selected = Boolean(selectedProductId && face.box?.productId === selectedProductId)
          const dimmed = Boolean(selectedProductId && face.box && !selected)
          const fillOpacity = face.pallet ? .48 : selected ? .34 : dimmed ? .018 : .09
          const strokeOpacity = face.pallet ? .8 : selected ? 1 : dimmed ? .18 : .72
          return <polygon key={face.key} points={pointsAttribute(face.points)} fill={face.color} fillOpacity={fillOpacity} stroke={face.box?.fixed ? '#f0a526' : face.color} strokeOpacity={strokeOpacity} strokeWidth={selected || face.box?.fixed ? 2.4 : 1.05} vectorEffect="non-scaling-stroke"><title>{face.box ? `${face.box.name} · ${face.box.sku} · ${face.box.weightKg} кг · ${face.box.lengthCm}×${face.box.widthCm}×${face.box.heightCm} см` : 'Паллета 120×80 см'}</title></polygon>
        })}
      </svg>
      {!placements.length && <div className="pallet-scene-empty"><ScanSearch size={29} /><span>{emptyLabel}</span></div>}
      <div className="pallet-scene-hint">Тяните для вращения · колесо/жест для масштаба · все размеры в сантиметрах</div>
    </div>
  )
}
