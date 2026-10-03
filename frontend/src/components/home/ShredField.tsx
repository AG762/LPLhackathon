import { useEffect, useRef } from 'react'
import type { MotionValue } from 'motion/react'
import * as THREE from 'three'

// WebGL backdrop for the hero: paper strips drifting in deep space under a cold light.
// More strips appear as the scroll story shreds its file; the camera leans toward the pointer.
// Pauses when off screen or in a hidden tab; draws one still frame for reduced motion.

const MAX = 320
const BASE = 70

interface Props {
  progress: MotionValue<number>
  still?: boolean
}

export default function ShredField({ progress, still = false }: Props) {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = host.current
    if (!el) return

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
    } catch {
      return // no WebGL: the CSS gradient behind it is enough
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    renderer.setClearColor(0x000000, 0)
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.fog = new THREE.Fog(0x070b12, 6, 22)
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 60)
    camera.position.set(0, 0, 9)

    scene.add(new THREE.AmbientLight(0x8fa3bf, 0.55))
    const key = new THREE.DirectionalLight(0xdbe8ff, 1.6)
    key.position.set(4, 7, 6)
    scene.add(key)
    const rim = new THREE.PointLight(0xcfe2ff, 30, 30)
    rim.position.set(3, 4, 2)
    scene.add(rim)

    // A strip of paper with faint ruled lines, drawn once into a small texture.
    const canvas = document.createElement('canvas')
    canvas.width = 32
    canvas.height = 256
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#eef1f5'
    ctx.fillRect(0, 0, 32, 256)
    ctx.fillStyle = '#c3cbd6'
    for (let y = 10; y < 256; y += 12) ctx.fillRect(0, y, 32, 1.5)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace

    const geometry = new THREE.PlaneGeometry(0.14, 1.1, 1, 6)
    // Give each strip a gentle curl so it catches the light like paper.
    const pos = geometry.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i)
      pos.setZ(i, Math.sin(y * 2.4) * 0.08)
    }
    geometry.computeVertexNormals()

    const material = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.7,
      metalness: 0.05,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    })
    const mesh = new THREE.InstancedMesh(geometry, material, MAX)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    scene.add(mesh)

    const rand = (a: number, b: number) => a + Math.random() * (b - a)
    const strips = Array.from({ length: MAX }, () => ({
      x: rand(-9, 9),
      y: rand(-6, 6),
      z: rand(-12, 3),
      rx: rand(0, Math.PI * 2),
      ry: rand(0, Math.PI * 2),
      rz: rand(0, Math.PI * 2),
      vy: rand(0.12, 0.35),
      vr: rand(-0.6, 0.6),
      sway: rand(0, Math.PI * 2),
      scale: rand(0.6, 1.25),
    }))

    const dummy = new THREE.Object3D()
    const pointer = { x: 0, y: 0 }
    const onPointer = (e: PointerEvent) => {
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1
      pointer.y = (e.clientY / window.innerHeight) * 2 - 1
    }
    window.addEventListener('pointermove', onPointer, { passive: true })

    const resize = () => {
      const w = el.clientWidth || 1
      const h = el.clientHeight || 1
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    resize()

    let visible = true
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      if (visible && !still) loop()
    })
    io.observe(el)

    let last = performance.now()
    const delta = () => {
      const now = performance.now()
      const d = (now - last) / 1000
      last = now
      return d
    }
    let frame = 0
    let t = 0

    const draw = (dt: number) => {
      const p = progress.get()
      // Shredding (0.13–0.5 of the hero) releases more strips and stirs them up.
      const released = Math.min(1, Math.max(0, (p - 0.12) / 0.4))
      mesh.count = Math.round(BASE + released * (MAX - BASE))
      const stir = 1 + Math.max(0, 1 - Math.abs(p - 0.32) / 0.2) * 1.6
      t += dt * stir

      for (let i = 0; i < mesh.count; i++) {
        const s = strips[i]
        s.y -= s.vy * dt * stir
        if (s.y < -6.5) {
          s.y = 6.5
          s.x = rand(-9, 9)
        }
        dummy.position.set(s.x + Math.sin(t * 0.5 + s.sway) * 0.35, s.y, s.z)
        dummy.rotation.set(s.rx + t * s.vr * 0.6, s.ry + t * s.vr, s.rz + t * s.vr * 0.4)
        dummy.scale.setScalar(s.scale)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
      }
      mesh.instanceMatrix.needsUpdate = true

      camera.position.x += (pointer.x * 0.8 - camera.position.x) * 0.04
      camera.position.y += (-pointer.y * 0.5 - camera.position.y) * 0.04
      camera.lookAt(0, 0, 0)
      renderer.render(scene, camera)
    }

    const loop = () => {
      cancelAnimationFrame(frame)
      const tick = () => {
        if (!visible || document.hidden) return
        draw(Math.min(delta(), 0.05))
        frame = requestAnimationFrame(tick)
      }
      delta()
      frame = requestAnimationFrame(tick)
    }

    const onVisibility = () => {
      if (!document.hidden && !still) loop()
    }
    document.addEventListener('visibilitychange', onVisibility)

    if (still) draw(0)
    else loop()

    return () => {
      cancelAnimationFrame(frame)
      io.disconnect()
      ro.disconnect()
      window.removeEventListener('pointermove', onPointer)
      document.removeEventListener('visibilitychange', onVisibility)
      geometry.dispose()
      material.dispose()
      texture.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [progress, still])

  return <div className="hs-field" ref={host} aria-hidden="true" />
}
