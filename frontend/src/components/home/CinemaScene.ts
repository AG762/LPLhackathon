import * as THREE from 'three'
import { SLOT_Y, buildVault, createFilm, ease, easeIn, lerp, paperTexture } from './vault'

// The opening shot: the camera comes down out of the light to the shredder, where a client file
// rises from the glowing slot and turns in the beam. exit() sends the file down and dives after it.

export interface Cinema {
  play(): void
  exit(onDone: () => void): void
  resize(): void
  dispose(): void
}

export function createCinema(host: HTMLElement, fileName: string): Cinema {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  host.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 120)
  const vault = buildVault(renderer, scene)
  const film = createFilm(renderer, scene, camera)

  const paperTex = paperTexture(fileName, ['Client record', 'Margaret Whitaker'], 'LEGAL HOLD')
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2), vault.paperMaterial(paperTex))
  paper.castShadow = true
  scene.add(paper)

  const look = new THREE.Vector3()
  const glow = new THREE.Color()
  const start = performance.now()
  let exitAt = 0
  let onExit: (() => void) | null = null
  let frame = 0
  let running = false

  const render = () => {
    const now = performance.now()
    const t = (now - start) / 1000

    // Lights come up as the camera starts to move.
    const up = ease(t / 2.4)
    vault.spot.intensity = 240 * up
    vault.beam.opacity = up
    vault.dustMaterial.opacity = 0.8 * up
    vault.sweep.intensity = 5 * ease((t - 1.8) / 1.2)
    vault.sweep.position.set(Math.sin(t * 0.6) * 3.6, 2.9, 2.6 + Math.cos(t * 0.6) * 0.5)

    // Down out of the light to the shredder.
    const c = ease(t / 4.6)
    camera.position.set(lerp(1.6, 0.4, c), lerp(12, 3.2, c), lerp(14, 9.8, c))
    look.set(0, lerp(14, 3.25, c), 0)

    // The file rises out of the slot, then turns slowly.
    const rise = ease((t - 1.4) / 2.4)
    let py = lerp(SLOT_Y - 1.05, SLOT_Y + 1.22, rise) + Math.sin(t * 1.2) * 0.035
    paper.rotation.y = Math.sin(t * 0.4) * 0.38
    let slot = 0.35 + 0.15 * Math.sin(t * 2)

    if (exitAt) {
      const e = (now - exitAt) / 1000
      const sink = easeIn(e / 0.75)
      py = lerp(py, SLOT_Y - 1.1, sink)
      paper.rotation.y *= 1 - sink
      slot = lerp(slot, 4, ease(e / 0.6))
      const dive = easeIn(e / 1.15)
      camera.position.set(lerp(camera.position.x, 0, dive), lerp(camera.position.y, SLOT_Y + 0.35, dive), lerp(camera.position.z, 0.6, dive))
      look.set(0, lerp(look.y, SLOT_Y, dive), 0)
      if (e > 1.15 && onExit) {
        const done = onExit
        onExit = null
        done()
      }
    }
    paper.position.set(0, py, 0)
    vault.slotGlow.color.copy(glow.setRGB(0.6 * slot + 0.2, 0.75 * slot + 0.25, 1.1 * slot + 0.3))
    vault.slotLight.intensity = 1.2 * slot

    vault.tick(0)
    camera.lookAt(look)
    film.render(t)
    if (running) frame = requestAnimationFrame(render)
  }

  const resize = () => {
    const w = host.clientWidth || window.innerWidth
    const h = host.clientHeight || window.innerHeight
    renderer.setSize(w, h, false)
    film.setSize(w, h)
    camera.aspect = w / h
    camera.fov = w / h < 0.8 ? 60 : 36
    camera.updateProjectionMatrix()
  }
  resize()

  return {
    play() {
      if (running) return
      running = true
      frame = requestAnimationFrame(render)
    },
    exit(done) {
      if (exitAt) return
      exitAt = performance.now()
      onExit = done
    },
    resize,
    dispose() {
      running = false
      cancelAnimationFrame(frame)
      paper.geometry.dispose()
      paperTex.dispose()
      vault.dispose()
      film.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
