import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

// The shared set for the opening shot and the hero: a stone vault, a shaft of light from the ceiling,
// dust in the beam, and a floating black shredder with a glowing slot. Rendered with bloom, grain and
// a vignette so it reads like film rather than a web page.

export const SLOT_Y = 2.05 // top face of the shredder
export const UNDER_Y = 1.15 // bottom face of the shredder

export const ease = (t: number) => 1 - Math.pow(1 - clamp01(t), 3)
export const easeIn = (t: number) => Math.pow(clamp01(t), 2.2)
export const clamp01 = (t: number) => Math.min(Math.max(t, 0), 1)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export function canvasTexture(w: number, h: number, paint: (c: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  paint(canvas.getContext('2d')!)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

export function paperTexture(title: string, lines: string[], stamp?: string) {
  return canvasTexture(512, 680, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 680)
    g.addColorStop(0, '#fbfcfd')
    g.addColorStop(1, '#dfe4ea')
    c.fillStyle = g
    c.fillRect(0, 0, 512, 680)
    c.fillStyle = '#0a0e14'
    c.font = '600 30px "Geist Variable", system-ui, sans-serif'
    c.fillText(title.length > 26 ? title.slice(0, 25) + '…' : title, 40, 74)
    c.fillStyle = '#5b6573'
    c.font = '400 22px "Geist Variable", system-ui, sans-serif'
    lines.forEach((l, i) => c.fillText(l, 40, 110 + i * 30))
    c.fillStyle = '#c9d0d8'
    for (let y = 200; y < 540; y += 26) c.fillRect(40, y, y > 460 ? 260 : 432, 3)
    if (stamp) {
      c.strokeStyle = '#0a0e14'
      c.lineWidth = 3
      c.font = '600 18px "Geist Variable", system-ui, sans-serif'
      const w = c.measureText(stamp).width + 28
      c.strokeRect(40, 586, w, 42)
      c.fillStyle = '#0a0e14'
      c.fillText(stamp, 54, 614)
    }
  })
}

function rockTexture() {
  const tex = canvasTexture(512, 512, (c) => {
    c.fillStyle = '#15181d'
    c.fillRect(0, 0, 512, 512)
    for (let i = 0; i < 3200; i++) {
      const g = 14 + Math.random() * 60
      c.fillStyle = `rgba(${g},${g + 3},${g + 8},${0.2 + Math.random() * 0.45})`
      const r = 2 + Math.random() * 26
      c.beginPath()
      c.ellipse(Math.random() * 512, Math.random() * 512, r, r * (0.3 + Math.random()), Math.random() * 3, 0, Math.PI * 2)
      c.fill()
    }
  })
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(7, 2.5)
  return tex
}

export interface Vault {
  paperMaterial(tex: THREE.Texture): THREE.MeshStandardMaterial
  slotGlow: THREE.MeshBasicMaterial
  slotLight: THREE.PointLight
  sweep: THREE.PointLight
  spot: THREE.SpotLight
  beam: THREE.MeshBasicMaterial
  dust: THREE.Points
  dustMaterial: THREE.PointsMaterial
  shredder: THREE.Group
  tick(dt: number): void
  dispose(): void
}

export function buildVault(renderer: THREE.WebGLRenderer, scene: THREE.Scene): Vault {
  const disposables: { dispose(): void }[] = []
  const keep = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x)

  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.85
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.localClippingEnabled = true

  scene.background = new THREE.Color(0x04060a)
  scene.fog = new THREE.FogExp2(0x04060a, 0.045)

  // Soft studio reflections for the metal, kept dim so the vault stays dark.
  const pmrem = keep(new THREE.PMREMGenerator(renderer))
  const envTex = keep(pmrem.fromScene(new RoomEnvironment(), 0.04).texture)
  scene.environment = envTex
  scene.environmentIntensity = 0.18

  const rock = keep(rockTexture())
  const walls = new THREE.Mesh(
    keep(new THREE.CylinderGeometry(14, 14, 24, 64, 1, true)),
    keep(new THREE.MeshStandardMaterial({ map: rock, bumpMap: rock, bumpScale: 4, roughness: 0.95, side: THREE.BackSide, color: 0xb8c2cf })),
  )
  walls.position.y = 10
  walls.receiveShadow = true
  scene.add(walls)

  const floor = new THREE.Mesh(
    keep(new THREE.CircleGeometry(14, 64)),
    keep(new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.16, metalness: 0.75 })),
  )
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  scene.add(floor)

  // Skylight and the shaft of light under it.
  const sky = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(6, 3.6)),
    keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.6, 3), toneMapped: false })),
  )
  sky.position.set(0, 21.9, 0)
  sky.rotation.x = Math.PI / 2
  scene.add(sky)

  const beamTex = keep(
    canvasTexture(4, 256, (c) => {
      const g = c.createLinearGradient(0, 0, 0, 256)
      g.addColorStop(0, 'rgba(225,235,255,0.16)')
      g.addColorStop(0.6, 'rgba(225,235,255,0.035)')
      g.addColorStop(1, 'rgba(225,235,255,0)')
      c.fillStyle = g
      c.fillRect(0, 0, 4, 256)
    }),
  )
  const beam = keep(
    new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  )
  const shaft = new THREE.Mesh(keep(new THREE.CylinderGeometry(2.4, 3.6, 22, 32, 1, true)), beam)
  shaft.position.y = 11
  scene.add(shaft)

  const DUST = 900
  const dustPos = new Float32Array(DUST * 3)
  for (let i = 0; i < DUST; i++) {
    const r = Math.sqrt(Math.random()) * 4.2
    const a = Math.random() * Math.PI * 2
    dustPos[i * 3] = Math.cos(a) * r
    dustPos[i * 3 + 1] = Math.random() * 18
    dustPos[i * 3 + 2] = Math.sin(a) * r
  }
  const dustGeo = keep(new THREE.BufferGeometry())
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3))
  const dustMaterial = keep(
    new THREE.PointsMaterial({ color: 0xe6eeff, size: 0.03, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
  )
  const dust = new THREE.Points(dustGeo, dustMaterial)
  scene.add(dust)

  // The shredder: a floating slab of black metal, a lit edge, a glowing slot.
  const shredder = new THREE.Group()
  const body = new THREE.Mesh(
    keep(new THREE.BoxGeometry(4.4, SLOT_Y - UNDER_Y, 2.4)),
    keep(new THREE.MeshStandardMaterial({ color: 0x0b0e13, roughness: 0.22, metalness: 0.9 })),
  )
  body.position.y = (SLOT_Y + UNDER_Y) / 2
  body.castShadow = body.receiveShadow = true
  shredder.add(body)

  const edgeMat = keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 1.4, 1.6), toneMapped: false }))
  const edge = new THREE.Mesh(keep(new THREE.BoxGeometry(4.42, 0.018, 0.018)), edgeMat)
  edge.position.set(0, SLOT_Y, 1.2)
  shredder.add(edge)
  const edgeLow = new THREE.Mesh(keep(new THREE.BoxGeometry(4.42, 0.012, 0.012)), keep(new THREE.MeshBasicMaterial({ color: 0x3a4658 })))
  edgeLow.position.set(0, UNDER_Y, 1.2)
  shredder.add(edgeLow)

  const slotGlow = keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 0.75, 1.1), toneMapped: false }))
  const slot = new THREE.Mesh(keep(new THREE.BoxGeometry(1.75, 0.012, 0.07)), slotGlow)
  slot.position.set(0, SLOT_Y + 0.004, 0)
  shredder.add(slot)
  const slotLight = new THREE.PointLight(0xbcd2ff, 0, 4, 2)
  slotLight.position.set(0, SLOT_Y + 0.15, 0.2)
  shredder.add(slotLight)

  // A faint cold light leaking from under the shredder onto the floor.
  const under = new THREE.PointLight(0x9fb8e0, 3, 5, 2)
  under.position.set(0, UNDER_Y - 0.3, 0)
  shredder.add(under)
  scene.add(shredder)

  scene.add(new THREE.AmbientLight(0x7d8ca3, 0.18))
  const spot = new THREE.SpotLight(0xe8f0ff, 0, 40, 0.38, 0.6, 1.1)
  spot.position.set(0, 21, 0)
  spot.target.position.set(0, 1.5, 0)
  spot.castShadow = true
  spot.shadow.mapSize.set(1024, 1024)
  spot.shadow.bias = -0.0004
  scene.add(spot, spot.target)

  // Cool rim lights grazing the stone so the room has walls.
  for (const [x, z] of [
    [-9, -6],
    [9, -5],
    [0, -11],
  ]) {
    const l = new THREE.PointLight(0x6f86a8, 14, 14, 1.6)
    l.position.set(x, 3.5, z)
    scene.add(l)
  }

  const sweep = new THREE.PointLight(0xffffff, 0, 9, 1.5)
  scene.add(sweep)

  return {
    paperMaterial(tex) {
      return keep(
        new THREE.MeshStandardMaterial({
          map: tex,
          roughness: 0.7,
          side: THREE.DoubleSide,
          emissive: 0x0b0e12,
          // Paper vanishes as it passes below the slot.
          clippingPlanes: [new THREE.Plane(new THREE.Vector3(0, 1, 0), -SLOT_Y)],
        }),
      )
    },
    slotGlow,
    slotLight,
    sweep,
    spot,
    beam,
    dust,
    dustMaterial,
    shredder,
    tick() {
      const pos = dustGeo.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < DUST; i++) {
        let y = pos.getY(i) - 0.0035
        if (y < 0) y = 18
        pos.setY(i, y)
      }
      pos.needsUpdate = true
    },
    dispose() {
      disposables.forEach((d) => d.dispose())
    },
  }
}

// Film look: grain, a soft vignette, and a slight cool grade, applied after bloom.
const FilmShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, grain: { value: 0.06 }, vignette: { value: 1.15 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time; uniform float grain; uniform float vignette; varying vec2 vUv;
    float rand(vec2 co){ return fract(sin(dot(co, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float d = distance(vUv, vec2(0.5));
      c.rgb *= smoothstep(0.85, 0.2, d * vignette);
      c.rgb += (rand(vUv * 1000.0 + time) - 0.5) * grain;
      c.rgb = mix(c.rgb, c.rgb * vec3(0.95, 0.98, 1.05), 0.6);
      gl_FragColor = c;
    }`,
}

export interface Film {
  render(time: number): void
  setSize(w: number, h: number): void
  dispose(): void
}

export function createFilm(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): Film {
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.45, 0.92)
  composer.addPass(bloom)
  composer.addPass(new OutputPass())
  const film = new ShaderPass(FilmShader)
  composer.addPass(film)
  return {
    render(time) {
      film.uniforms.time.value = time % 100
      composer.render()
    },
    setSize(w, h) {
      composer.setSize(w, h)
      bloom.resolution.set(w / 2, h / 2)
    },
    dispose() {
      composer.dispose()
      bloom.dispose()
    },
  }
}
