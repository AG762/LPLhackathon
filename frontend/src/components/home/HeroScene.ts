import * as THREE from 'three'
import { SLOT_Y, UNDER_Y, buildVault, clamp01, createFilm, ease, easeIn, lerp, paperTexture } from './vault'

// The hero, in the same vault as the opening shot, driven by scroll progress p (0..1):
//   0.10–0.40  file A sinks into the slot; its strips rain out under the shredder and settle on the floor
//   0.44–0.66  file B (legal hold) comes down, a beam of light closes over the slot, and B is pushed back
// Everything is a pure function of p, so scrolling back plays it in reverse.

export interface HeroFileSpec {
  name: string
  lines: string[]
  stamp?: string
}

export interface HeroScene {
  setProgress(p: number): void
  setActive(active: boolean): void
  resize(): void
  dispose(): void
}

const STRIPS = 26
const STRIP_W = 1.5 / STRIPS

export function createHeroScene(host: HTMLElement, a: HeroFileSpec, b: HeroFileSpec): HeroScene {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  host.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 120)
  const vault = buildVault(renderer, scene)
  const film = createFilm(renderer, scene, camera)
  vault.spot.intensity = 240
  vault.beam.opacity = 1
  vault.dustMaterial.opacity = 0.8
  vault.sweep.intensity = 5

  const texA = paperTexture(a.name, a.lines, a.stamp)
  const texB = paperTexture(b.name, b.lines, b.stamp)
  const geo = new THREE.PlaneGeometry(1.5, 2)
  const docA = new THREE.Mesh(geo, vault.paperMaterial(texA))
  const docB = new THREE.Mesh(geo, vault.paperMaterial(texB))
  docA.castShadow = docB.castShadow = true
  scene.add(docA, docB)

  // Strips: thin slices of file A's own texture, so the shreds carry its lines.
  const stripGeo = new THREE.PlaneGeometry(STRIP_W * 0.92, 2)
  const stripMats: THREE.MeshStandardMaterial[] = []
  const strips: { mesh: THREE.Mesh; release: number; x: number; z: number; spin: number; tilt: number; land: number }[] = []
  for (let i = 0; i < STRIPS; i++) {
    const tex = texA.clone()
    tex.repeat.set(1 / STRIPS, 1)
    tex.offset.set(i / STRIPS, 0)
    tex.needsUpdate = true
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, side: THREE.DoubleSide })
    stripMats.push(mat)
    const mesh = new THREE.Mesh(stripGeo, mat)
    mesh.castShadow = true
    scene.add(mesh)
    strips.push({
      mesh,
      release: 0.15 + (i / STRIPS) * 0.2 + Math.random() * 0.04,
      x: -0.75 + (i + 0.5) * STRIP_W,
      z: (Math.random() - 0.5) * 2.2,
      spin: (Math.random() - 0.5) * 2.4,
      tilt: (Math.random() - 0.5) * 0.5,
      land: (Math.random() - 0.5) * 1.6,
    })
  }

  // The legal-hold beam: a blade of light across the slot.
  const holdMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.9, 2.6), toneMapped: false, transparent: true })
  const hold = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.022, 0.022), holdMat)
  hold.position.set(0, SLOT_Y + 0.42, 0)
  scene.add(hold)
  const holdLight = new THREE.PointLight(0xbcd6ff, 0, 5, 1.6)
  holdLight.position.set(0, SLOT_Y + 0.55, 0.4)
  scene.add(holdLight)

  let p = 0
  let active = true
  let frame = 0
  const pointer = { x: 0, y: 0 }
  const onPointer = (e: PointerEvent) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1
  }
  window.addEventListener('pointermove', onPointer, { passive: true })

  const cam = new THREE.Vector3()
  const look = new THREE.Vector3(0, 2.6, 0)
  const glow = new THREE.Color()
  const start = performance.now()
  let narrow = false

  const render = () => {
    const t = (performance.now() - start) / 1000

    // File A: waits above the slot, then sinks through it.
    const aIn = ease((p - 0.1) / 0.3)
    docA.position.set(0, lerp(SLOT_Y + 1.25, SLOT_Y - 1.05, aIn) + Math.sin(t * 1.1) * 0.03 * (1 - aIn), 0)
    docA.rotation.y = Math.sin(t * 0.4) * 0.3 * (1 - aIn)
    docA.visible = aIn < 1

    // Strips fall from under the shredder and lie down on the floor.
    for (const s of strips) {
      const f = clamp01((p - s.release) / 0.14)
      s.mesh.visible = f > 0
      if (!f) continue
      const drop = easeIn(f)
      s.mesh.position.set(s.x + s.land * drop, lerp(UNDER_Y - 1.0, 0.02, drop), s.z * drop + 0.1)
      s.mesh.rotation.set(lerp(0, -Math.PI / 2, ease((f - 0.55) / 0.45)), s.spin * drop, s.tilt * drop)
    }

    // File B: arrives, the beam closes, B is pushed back up and tilts away.
    const bArrive = ease((p - 0.44) / 0.1)
    const bPush = ease((p - 0.6) / 0.06)
    const bY = lerp(SLOT_Y + 6, SLOT_Y + 1.1, bArrive) + lerp(0, 0.6, bPush)
    docB.position.set(lerp(0, -0.25, bPush), bY + Math.sin(t * 1.1) * 0.03 * bPush, lerp(0, -0.2, bPush))
    docB.rotation.set(0, Math.sin(t * 0.4) * 0.25 * bPush, lerp(0, 0.07, bPush))
    docB.visible = p > 0.43

    const beam = ease((p - 0.585) / 0.02)
    hold.scale.x = Math.max(beam, 0.0001)
    holdMat.opacity = beam
    holdLight.intensity = 4 * beam * (0.85 + 0.15 * Math.sin(t * 6))

    // Slot glow: brighter while shredding, cold and steady while the hold is up.
    const shredding = clamp01(1 - Math.abs(p - 0.27) / 0.15)
    const s = 0.35 + 0.15 * Math.sin(t * 2) + shredding * 1.6
    glow.setRGB(0.6 * s + 0.2, 0.75 * s + 0.25, 1.1 * s + 0.3)
    vault.slotGlow.color.copy(glow)
    vault.slotLight.intensity = 1.2 * s

    vault.sweep.position.set(Math.sin(t * 0.5) * 3.6, 2.9, 2.6 + Math.cos(t * 0.5) * 0.5)
    vault.tick(0)

    // Camera: a slow push in across the scroll, leaning toward the pointer.
    const push = ease(p)
    const offX = narrow ? 0 : -2.7 // shredder sits right of centre on wide screens
    cam.set(offX + pointer.x * 0.35 + lerp(0.3, -0.2, push), lerp(4.1, 3.7, push) - pointer.y * 0.2, lerp(11, 9.8, push))
    camera.position.lerp(cam, 0.08)
    look.set(offX, narrow ? 2.9 : 2.2, 0)
    camera.lookAt(look)

    film.render(t)
    if (active) frame = requestAnimationFrame(render)
  }

  const resize = () => {
    const w = host.clientWidth || window.innerWidth
    const h = host.clientHeight || window.innerHeight
    renderer.setSize(w, h, false)
    film.setSize(w, h)
    camera.aspect = w / h
    narrow = w / h < 1.05
    camera.fov = narrow ? 52 : 34
    camera.updateProjectionMatrix()
  }
  resize()
  camera.position.set(-2.7, 4.1, 11)
  frame = requestAnimationFrame(render)

  return {
    setProgress(next) {
      p = next
    },
    setActive(next) {
      if (next === active) return
      active = next
      cancelAnimationFrame(frame)
      if (active) frame = requestAnimationFrame(render)
    },
    resize,
    dispose() {
      active = false
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onPointer)
      stripMats.forEach((m) => {
        m.map?.dispose()
        m.dispose()
      })
      stripGeo.dispose()
      geo.dispose()
      texA.dispose()
      texB.dispose()
      holdMat.dispose()
      hold.geometry.dispose()
      vault.dispose()
      film.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
