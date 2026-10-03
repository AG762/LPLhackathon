import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'

// The stage for the opening and the hero: one object under one light. A machined gate floats over a
// polished black floor; a file hovers in the beam above it. Scroll feeds the first file through the
// gate (it comes out as curling strips that drop to the floor); the second file is under a legal hold,
// so a sheet of light closes over the gate and pushes it back up.
//
// The opening is the same scene: the gate's light ignites in the dark, a studio light sweeps across
// its bevel, and the camera pulls back as the beam comes up. Every pose is a pure function of the
// opening clock and the scroll progress, so scrolling back plays everything in reverse.

export interface StageFile {
  name: string
  kind: string
  client?: string
  stamp?: string
}

export interface Stage {
  setProgress(p: number): void
  setActive(active: boolean): void
  skipIntro(): void
  resize(): void
  dispose(): void
}

interface Options {
  intro: boolean // play the opening from black; otherwise start already lit
  still: boolean // reduced motion: draw the end of the story once, no loop
  onIntroDone?: () => void
}

// Scene units. The floor is y = 0.
const GATE_W = 2.7
const GATE_D = 0.66
const GATE_T = 0.2
const GATE_Y = 1.72
const GT = GATE_Y + GATE_T / 2 + 0.02 // top of the gate, bevel included
const GB = GATE_Y - GATE_T / 2 - 0.02 // underside
const SLOT_W = 1.38
const DOC_W = 0.96
const DOC_H = 1.24
const HOVER_Y = GT + 0.16 + DOC_H / 2
const FED_Y = GB - DOC_H / 2 - 0.02
const STRIPS = 18
const INTRO_S = 3.4

const clamp01 = (t: number) => Math.min(Math.max(t, 0), 1)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const range = (p: number, a: number, b: number) => clamp01((p - a) / (b - a))
const easeOut = (t: number) => 1 - Math.pow(1 - clamp01(t), 3)
const easeIn = (t: number) => Math.pow(clamp01(t), 2)
const easeInOut = (t: number) => {
  const x = clamp01(t)
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}
const expoOut = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp01(t)))

// Seeded, so the pile of strips lands the same way on every visit.
function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

/* ---------- paper ---------- */

function drawPaper(c: CanvasRenderingContext2D, w: number, h: number, file: StageFile, seed: number) {
  const r = rng(seed)
  const g = c.createLinearGradient(0, 0, w, h)
  g.addColorStop(0, '#f7f8f9')
  g.addColorStop(1, '#e9ecef')
  c.fillStyle = g
  c.fillRect(0, 0, w, h)
  // Fibre: faint specks so the sheet doesn't read as flat plastic under the light.
  for (let i = 0; i < 2600; i++) {
    const v = 200 + r() * 55
    c.fillStyle = `rgba(${v},${v},${v + 4},${0.05 + r() * 0.06})`
    c.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2)
  }

  const m = w * 0.085
  const sans = '"Geist Variable", system-ui, sans-serif'
  c.fillStyle = '#7a828d'
  c.font = `500 ${w * 0.026}px ${sans}`
  c.fillText(file.kind, m, m * 1.05)
  c.textAlign = 'right'
  c.fillText('Branch drive', w - m, m * 1.05)
  c.textAlign = 'left'

  c.fillStyle = '#0d1014'
  let size = w * 0.05
  c.font = `600 ${size}px ${sans}`
  while (c.measureText(file.name).width > w - m * 2 && size > w * 0.03) {
    size -= 1
    c.font = `600 ${size}px ${sans}`
  }
  c.fillText(file.name, m, m * 1.05 + w * 0.08)
  if (file.client) {
    c.fillStyle = '#4d5560'
    c.font = `400 ${w * 0.032}px ${sans}`
    c.fillText(file.client, m, m * 1.05 + w * 0.135)
  }
  c.fillStyle = '#0d1014'
  c.fillRect(m, m + w * 0.2, w - m * 2, 3)

  // Body copy, drawn as grey lines of text.
  let y = m + w * 0.27
  const bottom = file.stamp ? h - w * 0.32 : h - m
  c.fillStyle = '#c3c9d0'
  while (y < bottom) {
    const lines = 3 + Math.floor(r() * 4)
    for (let l = 0; l < lines && y < bottom; l++) {
      const full = w - m * 2
      const len = l === lines - 1 ? full * (0.3 + r() * 0.45) : full * (0.86 + r() * 0.14)
      c.fillRect(m, y, len, w * 0.012)
      y += w * 0.036
    }
    y += w * 0.04
  }

  if (file.stamp) {
    const sh = w * 0.13
    const sy = h - m - sh
    c.font = `600 ${w * 0.042}px ${sans}`
    const tw = c.measureText(file.stamp).width
    c.strokeStyle = '#0d1014'
    c.lineWidth = w * 0.007
    c.beginPath()
    c.roundRect(m, sy, tw + w * 0.09, sh * 0.62, sh * 0.31)
    c.stroke()
    c.fillStyle = '#0d1014'
    c.fillText(file.stamp, m + w * 0.045, sy + sh * 0.43)
    c.fillStyle = '#4d5560'
    c.font = `400 ${w * 0.026}px ${sans}`
    c.fillText('Do not delete. Hold overrides every retention rule.', m, sy + sh * 0.95)
  }
}

function paperTexture(file: StageFile, seed: number, maxAniso: number) {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = Math.round((1024 * DOC_H) / DOC_W)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = maxAniso
  const paint = () => {
    drawPaper(canvas.getContext('2d')!, canvas.width, canvas.height, file, seed)
    tex.needsUpdate = true
  }
  paint()
  // Draw again once the web font is in, so the file name isn't set in a fallback face.
  document.fonts?.load('600 40px "Geist Variable"').then(paint, () => {})
  return tex
}

/* ---------- studio lighting for reflections ---------- */

function studioEnvironment(renderer: THREE.WebGLRenderer) {
  const env = new THREE.Scene()
  env.background = new THREE.Color(0x000000)
  const box = new THREE.BoxGeometry(1, 1, 1)
  const panel = (w: number, h: number, d: number, x: number, y: number, z: number, intensity: number) => {
    const m = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: new THREE.Color(intensity, intensity, intensity * 1.06) }))
    m.scale.set(w, h, d)
    m.position.set(x, y, z)
    env.add(m)
    return m
  }
  panel(5, 0.1, 3, 0, 6, 0, 3) // overhead softbox
  panel(0.1, 7, 1.2, -6, 1.5, 1, 9) // tall strip, left: the long highlight on the bevel
  panel(0.1, 5, 0.6, 6, 1, -1, 4) // narrower strip, right
  panel(7, 0.8, 0.1, 0, 0.6, -6, 2) // low rim from behind
  panel(9, 2.4, 0.1, 0, 2, 7, 0.3) // faint fill from the camera side
  const pmrem = new THREE.PMREMGenerator(renderer)
  const tex = pmrem.fromScene(env, 0.02).texture
  pmrem.dispose()
  box.dispose()
  env.traverse((o) => (o as THREE.Mesh).material && ((o as THREE.Mesh).material as THREE.Material).dispose())
  return tex
}

/* ---------- shaders ---------- */

const DITHER = /* glsl */ `
  float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
`

// The beam: a cone that is bright where you look through its middle and soft at its edges.
const beamShader = (color: THREE.Color) => ({
  uniforms: { uColor: { value: color }, uIntensity: { value: 0 }, uTime: { value: 0 } },
  vertexShader: /* glsl */ `
    varying vec3 vN; varying vec3 vV; varying float vY; varying vec2 vUv;
    void main(){
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * normal); vV = -mv.xyz; vUv = uv; vY = uv.y;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor; uniform float uIntensity; uniform float uTime;
    varying vec3 vN; varying vec3 vV; varying float vY; varying vec2 vUv;
    ${DITHER}
    void main(){
      float facing = abs(dot(normalize(vN), normalize(vV)));
      float core = pow(facing, 2.6);
      float fall = smoothstep(0.0, 0.5, vY) * mix(0.55, 1.0, vY);
      float streak = 0.82 + 0.18 * sin(vUv.x * 71.0 + uTime * 0.15) * sin(vUv.x * 29.0 - uTime * 0.1);
      float a = core * fall * streak * uIntensity;
      a += (hash12(gl_FragCoord.xy + uTime) - 0.5) / 255.0;
      gl_FragColor = vec4(uColor * a, 1.0);
    }`,
})

// A wall far behind, lit where the beam spills onto it, with a faint concrete grain.
const wallShader = {
  uniforms: { uIntensity: { value: 0 } },
  vertexShader: /* glsl */ `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: /* glsl */ `
    uniform float uIntensity; varying vec3 vW;
    ${DITHER}
    float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
      return mix(mix(hash12(i), hash12(i+vec2(1,0)), f.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), f.x), f.y); }
    float fbm(vec2 p){ float v = 0.0, a = 0.5; for(int i=0;i<5;i++){ v += a*noise(p); p *= 2.03; a *= 0.5; } return v; }
    void main(){
      vec2 q = vec2(vW.x / 8.5, (vW.y - 4.2) / 6.0);
      float glow = exp(-dot(q, q) * 1.6);
      float grain = 0.72 + 0.5 * fbm(vW.xy * 0.9) + 0.12 * fbm(vW.xy * 6.0);
      vec3 base = vec3(0.006, 0.007, 0.009);
      vec3 c = base + vec3(0.075, 0.08, 0.092) * glow * grain * uIntensity;
      c += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
      gl_FragColor = vec4(c, 1.0);
    }`,
}

// Polished floor: a softened mirror image that fades out away from the light.
const floorShader = {
  name: 'BlurredFloor',
  uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null }, uIntensity: { value: 0 } },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix; varying vec4 vUv; varying vec3 vW;
    void main(){ vUv = textureMatrix * vec4(position, 1.0); vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color; uniform sampler2D tDiffuse; uniform float uIntensity; varying vec4 vUv; varying vec3 vW;
    ${DITHER}
    void main(){
      vec2 uv = vUv.xy / vUv.w;
      // A jittered disc of taps: soft like brushed stone, with no ghost copies of thin bright lines.
      float r = 0.003 + 0.007 * smoothstep(0.0, 4.0, length(vW.xz));
      float ang = hash12(gl_FragCoord.xy) * 6.2831;
      vec3 acc = texture2D(tDiffuse, uv).rgb; float tot = 1.0;
      for (int i = 0; i < 16; i++) {
        float fi = float(i);
        float rr = sqrt((fi + 0.5) / 16.0) * r;
        float a = ang + fi * 2.39996;
        float w = 1.0 - (fi + 0.5) / 18.0;
        acc += texture2D(tDiffuse, uv + vec2(cos(a), sin(a) * 0.6) * rr).rgb * w; tot += w;
      }
      vec3 refl = acc / tot * color;
      float d = length(vW.xz * vec2(0.7, 1.0));
      float pool = exp(-d * d * 0.09);
      vec3 c = refl * mix(0.4, 1.0, pool) + vec3(0.03, 0.033, 0.04) * pool * pool * uIntensity;
      c += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
      gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
}

// Dust that only shows inside the beam.
const dustShader = {
  uniforms: { uTime: { value: 0 }, uIntensity: { value: 0 }, uScale: { value: 1 } },
  vertexShader: /* glsl */ `
    uniform float uTime; uniform float uScale; attribute vec4 seed; varying float vA;
    void main(){
      vec3 p = position;
      p.y = mod(p.y - uTime * (0.05 + seed.x * 0.06), 7.0) + 0.2;
      p.x += sin(uTime * 0.21 + seed.y * 6.28) * 0.25;
      p.z += cos(uTime * 0.17 + seed.z * 6.28) * 0.25;
      float coneR = mix(1.9, 0.6, clamp(p.y / 9.0, 0.0, 1.0));
      vA = smoothstep(coneR, coneR * 0.25, length(p.xz)) * (0.35 + 0.65 * seed.w);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_PointSize = max(1.0, uScale * (0.006 + 0.014 * seed.w) / -mv.z);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform float uIntensity; varying float vA;
    void main(){
      float d = length(gl_PointCoord - 0.5);
      float a = smoothstep(0.5, 0.1, d) * vA * uIntensity * 0.7;
      gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * a, 1.0);
    }`,
}

// Film finish: grain, a soft vignette and a slight lift in the blacks.
const finishShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uFade: { value: 1 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uFade; varying vec2 vUv;
    ${DITHER}
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      vec2 q = vUv - 0.5;
      c *= 1.0 - smoothstep(0.35, 0.95, length(q * vec2(1.0, 1.25))) * 0.65;
      float n = hash12(gl_FragCoord.xy + fract(uTime) * 917.0) - 0.5;
      c += n * 0.035;
      c = max(c, vec3(0.0)) * uFade;
      gl_FragColor = vec4(c, 1.0);
    }`,
}

/* ---------- geometry ---------- */

function roundedRect(w: number, h: number, r: number, path: THREE.Path) {
  const x = -w / 2
  const y = -h / 2
  path.moveTo(x + r, y)
  path.lineTo(x + w - r, y)
  path.quadraticCurveTo(x + w, y, x + w, y + r)
  path.lineTo(x + w, y + h - r)
  path.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  path.lineTo(x + r, y + h)
  path.quadraticCurveTo(x, y + h, x, y + h - r)
  path.lineTo(x, y + r)
  path.quadraticCurveTo(x, y, x + r, y)
  return path
}

function gateGeometry() {
  const shape = roundedRect(GATE_W, GATE_D, 0.12, new THREE.Shape()) as THREE.Shape
  shape.holes.push(roundedRect(SLOT_W, 0.05, 0.022, new THREE.Path()))
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: GATE_T - 0.04,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.02,
    bevelSegments: 8,
    curveSegments: 20,
  })
  geo.rotateX(-Math.PI / 2)
  geo.computeBoundingBox()
  const bb = geo.boundingBox!
  geo.translate(0, -(bb.min.y + bb.max.y) / 2, 0)
  geo.computeVertexNormals()
  return geo
}

interface Strip {
  geo: THREE.BufferGeometry
  base: Float32Array
  mesh: THREE.Mesh
  cx: number
  spread: number
  twist: number
  bend: number
  phase: number
  release: number
  px: number
  pz: number
  yaw: number
  lift: number
  waves: number
  layer: number
}

/* ---------- the stage ---------- */

export function createStage(host: HTMLElement, cleared: StageFile, held: StageFile, opts: Options): Stage {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.localClippingEnabled = true
  host.appendChild(renderer.domElement)

  const disposables: { dispose(): void }[] = []
  const keep = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x020304)
  const envTex = keep(studioEnvironment(renderer))
  scene.environment = envTex
  scene.environmentIntensity = 0

  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 80)

  // Wall, floor and the lit pool under the beam.
  const wallMat = keep(new THREE.ShaderMaterial(wallShader))
  const wall = new THREE.Mesh(keep(new THREE.PlaneGeometry(60, 26)), wallMat)
  wall.position.set(0, 8, -11)
  scene.add(wall)

  const floor = new Reflector(keep(new THREE.PlaneGeometry(60, 60)), {
    textureWidth: 1024,
    textureHeight: 1024,
    color: 0x9aa0a8,
    shader: floorShader,
    multisample: 0,
  })
  floor.rotation.x = -Math.PI / 2
  scene.add(floor)
  const floorMat = floor.material as THREE.ShaderMaterial

  const shade = new THREE.Mesh(keep(new THREE.PlaneGeometry(14, 14)), keep(new THREE.ShadowMaterial({ opacity: 0.28, color: 0x000000 })))
  shade.rotation.x = -Math.PI / 2
  shade.position.y = 0.002
  shade.receiveShadow = true
  scene.add(shade)


  // The beam: two nested cones, a soft outer one and a brighter core.
  const beamColor = new THREE.Color(0.62, 0.68, 0.8)
  const beams = [
    { r0: 0.35, r1: 2.1, k: 0.06 },
    { r0: 0.2, r1: 1.25, k: 0.075 },
  ].map(({ r0, r1, k }) => {
    const mat = keep(
      new THREE.ShaderMaterial({ ...beamShader(beamColor), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    )
    const m = new THREE.Mesh(keep(new THREE.CylinderGeometry(r0, r1, 11, 96, 1, true)), mat)
    m.position.y = 5.5
    scene.add(m)
    return { mat, k }
  })

  const DUST = 320
  const dr = rng(7)
  const dustPos = new Float32Array(DUST * 3)
  const dustSeed = new Float32Array(DUST * 4)
  for (let i = 0; i < DUST; i++) {
    const a = dr() * Math.PI * 2
    const rad = Math.sqrt(dr()) * 2
    dustPos.set([Math.cos(a) * rad, dr() * 7, Math.sin(a) * rad], i * 3)
    dustSeed.set([dr(), dr(), dr(), dr()], i * 4)
  }
  const dustGeo = keep(new THREE.BufferGeometry())
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3))
  dustGeo.setAttribute('seed', new THREE.BufferAttribute(dustSeed, 4))
  const dustMat = keep(new THREE.ShaderMaterial({ ...dustShader, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
  const dust = new THREE.Points(dustGeo, dustMat)
  dust.frustumCulled = false
  scene.add(dust)

  // Lights. Everything starts dark; the opening brings them up.
  const spot = new THREE.SpotLight(0xf1f4fa, 0, 0, 0.3, 0.85, 2)
  spot.position.set(0, 11.5, 0.8)
  spot.target.position.set(0, 1.4, 0)
  spot.castShadow = true
  spot.shadow.mapSize.set(2048, 2048)
  spot.shadow.bias = -0.0002
  spot.shadow.normalBias = 0.01
  spot.shadow.radius = 6
  spot.shadow.camera.near = 6
  spot.shadow.camera.far = 16
  scene.add(spot, spot.target)

  const key = new THREE.DirectionalLight(0xdfe6f2, 0)
  key.position.set(-4, 3, 6)
  scene.add(key)

  // The gate.
  const gateMat = keep(
    new THREE.MeshPhysicalMaterial({ color: 0x24272d, metalness: 1, roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.18 }),
  )
  const gate = new THREE.Mesh(keep(gateGeometry()), gateMat)
  gate.position.y = GATE_Y
  gate.castShadow = true
  gate.receiveShadow = true
  scene.add(gate)

  // The light inside the slot, and a hairline inlay along the gate's front face.
  const slotMat = keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 5.6, 7), toneMapped: false }))
  const slot = new THREE.Mesh(keep(new THREE.PlaneGeometry(SLOT_W - 0.05, 0.022)), slotMat)
  slot.rotation.x = -Math.PI / 2
  slot.position.y = GATE_Y + 0.01
  scene.add(slot)
  const slotUnder = new THREE.Mesh(slot.geometry, slotMat)
  slotUnder.rotation.x = Math.PI / 2
  slotUnder.position.y = GB + 0.005
  scene.add(slotUnder)
  const slotLight = new THREE.PointLight(0xc8d6ff, 0, 3, 2)
  slotLight.position.set(0, GT + 0.12, 0.15)
  scene.add(slotLight)
  const underLight = new THREE.PointLight(0xc8d6ff, 0, 3, 2)
  underLight.position.set(0, GB - 0.25, 0.25)
  scene.add(underLight)

  const inlayMat = keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.55, 0.65), toneMapped: false }))
  const inlay = new THREE.Mesh(keep(new THREE.PlaneGeometry(GATE_W - 0.5, 0.0045)), inlayMat)
  inlay.position.set(0, GATE_Y, GATE_D / 2 + 0.0205)
  scene.add(inlay)

  // The hold: a sheet of light that closes over the gate.
  const holdTexCanvas = document.createElement('canvas')
  holdTexCanvas.width = 256
  holdTexCanvas.height = 64
  {
    const c = holdTexCanvas.getContext('2d')!
    const g = c.createRadialGradient(128, 32, 0, 128, 32, 128)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.5, 'rgba(255,255,255,0.35)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    c.fillStyle = g
    c.fillRect(0, 0, 256, 64)
  }
  const holdTex = keep(new THREE.CanvasTexture(holdTexCanvas))
  const holdSheetMat = keep(
    new THREE.MeshBasicMaterial({
      map: holdTex,
      color: new THREE.Color(0.9, 1, 1.3),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  )
  const holdSheet = new THREE.Mesh(keep(new THREE.PlaneGeometry(GATE_W + 0.9, 0.6)), holdSheetMat)
  holdSheet.rotation.x = -Math.PI / 2
  holdSheet.position.y = GT + 0.05
  scene.add(holdSheet)
  const holdLineMat = keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 4.4, 5.4), toneMapped: false, transparent: true, opacity: 0 }))
  const holdLine = new THREE.Mesh(keep(new THREE.BoxGeometry(GATE_W - 0.1, 0.008, 0.008)), holdLineMat)
  holdLine.position.set(0, GT + 0.05, 0)
  scene.add(holdLine)
  const holdLight = new THREE.PointLight(0xd4e0ff, 0, 4, 2)
  holdLight.position.set(0, GT + 0.3, 0.5)
  scene.add(holdLight)

  // Paper.
  const aniso = renderer.capabilities.getMaxAnisotropy()
  const texA = keep(paperTexture(cleared, 11, aniso))
  const texB = keep(paperTexture(held, 23, aniso))
  const edgeMat = keep(new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.9 }))
  const backMat = keep(new THREE.MeshStandardMaterial({ color: 0xe7eaee, roughness: 0.92 }))
  const keepAbove = new THREE.Plane(new THREE.Vector3(0, 1, 0), -GT)
  const keepBelow = new THREE.Plane(new THREE.Vector3(0, -1, 0), GB)
  const faceA = keep(new THREE.MeshStandardMaterial({ map: texA, roughness: 0.88, clippingPlanes: [keepAbove], transparent: true }))
  const faceB = keep(new THREE.MeshStandardMaterial({ map: texB, roughness: 0.88 }))
  const edgeClip = keep(edgeMat.clone())
  edgeClip.clippingPlanes = [keepAbove]
  edgeClip.transparent = true
  const backClip = keep(backMat.clone())
  backClip.clippingPlanes = [keepAbove]
  backClip.transparent = true

  const docGeo = (geo: THREE.BufferGeometry) => ({ geo, base: Float32Array.from(geo.attributes.position.array) })
  const docA = docGeo(keep(new THREE.BoxGeometry(DOC_W, DOC_H, 0.006, 1, 32, 1)))
  const docB = docGeo(keep(new THREE.BoxGeometry(DOC_W, DOC_H, 0.006, 1, 32, 1)))
  const meshA = new THREE.Mesh(docA.geo, [edgeClip, edgeClip, edgeClip, edgeClip, faceA, backClip])
  const meshB = new THREE.Mesh(docB.geo, [edgeMat, edgeMat, edgeMat, edgeMat, faceB, backMat])
  meshA.castShadow = meshB.castShadow = true
  scene.add(meshA, meshB)

  // Strips: slices of file A's own sheet, so the shreds carry its lines of text.
  const stripMat = keep(new THREE.MeshStandardMaterial({ map: texA, roughness: 0.85, side: THREE.DoubleSide, clippingPlanes: [keepBelow] }))
  const sw = DOC_W / STRIPS
  const sr = rng(41)
  const strips: Strip[] = []
  for (let i = 0; i < STRIPS; i++) {
    const geo = keep(new THREE.BoxGeometry(sw * 0.9, DOC_H, 0.004, 1, 36, 1))
    const uv = geo.attributes.uv as THREE.BufferAttribute
    for (let k = 0; k < uv.count; k++) uv.setX(k, (i + uv.getX(k)) / STRIPS)
    const mesh = new THREE.Mesh(geo, stripMat)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.frustumCulled = false
    scene.add(mesh)
    const cx = -DOC_W / 2 + (i + 0.5) * sw
    const side = cx / (DOC_W / 2)
    strips.push({
      geo,
      base: Float32Array.from(geo.attributes.position.array),
      mesh,
      cx,
      spread: side * 0.09 + (sr() - 0.5) * 0.08,
      twist: (sr() - 0.5) * 2.2,
      bend: (sr() - 0.5) * 0.5,
      phase: sr() * Math.PI * 2,
      release: sr() * 0.42,
      px: side * 0.75 + (sr() - 0.5) * 0.7,
      pz: 0.1 + (sr() - 0.5) * 0.9,
      yaw: (sr() - 0.5) * Math.PI * 0.9 + (sr() < 0.5 ? 0 : Math.PI),
      lift: 0.02 + sr() * 0.07,
      waves: 0.5 + sr() * 1.4,
      layer: i,
    })
  }

  /* ---------- post ---------- */

  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 })
  const composer = new EffectComposer(renderer, target)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.5, 1.05)
  composer.addPass(bloom)
  composer.addPass(new OutputPass())
  const finish = new ShaderPass(finishShader)
  composer.addPass(finish)

  /* ---------- per-frame posing ---------- */

  const pos = new THREE.Vector3()
  const look = new THREE.Vector3()
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 }
  let width = 1
  let height = 1
  let narrow = false

  function bendDoc(d: { geo: THREE.BufferGeometry; base: Float32Array }, curl: number, flutter: number, t: number) {
    const arr = d.geo.attributes.position.array as Float32Array
    for (let k = 0; k < arr.length; k += 3) {
      const y = d.base[k + 1] / DOC_H + 0.5 // 0 bottom, 1 top
      const x = d.base[k] / DOC_W
      arr[k] = d.base[k]
      arr[k + 1] = d.base[k + 1]
      arr[k + 2] = d.base[k + 2] + curl * (y - 0.5) * (y - 0.5) * 0.5 + flutter * Math.sin(t * 1.3 + y * 3 + x) * 0.012
    }
    d.geo.attributes.position.needsUpdate = true
    d.geo.computeVertexNormals()
  }

  function poseStrips(docY: number, fallP: number, t: number) {
    const anyFed = docY - DOC_H / 2 < GB
    for (const s of strips) {
      s.mesh.visible = anyFed
      if (!anyFed) continue
      const f = easeInOut(clamp01((fallP - s.release) / 0.58))
      const arr = s.geo.attributes.position.array as Float32Array
      const sway = Math.sin(t * 0.9 + s.phase) * 0.06 * (1 - f)
      const cy = Math.cos(s.yaw)
      const sy = Math.sin(s.yaw)
      for (let k = 0; k < arr.length; k += 3) {
        const bx = s.base[k]
        const by = s.base[k + 1]
        const bz = s.base[k + 2]
        // Hanging under the gate.
        const yf = docY + by
        const d = Math.max(0, GB - yf)
        const a = s.twist * d + sway * d
        const hx = s.cx + bx * Math.cos(a) - bz * Math.sin(a) + s.spread * d * d
        const hz = bx * Math.sin(a) + bz * Math.cos(a) + s.bend * d * d + sway * d * 0.5
        const hy = yf + Math.abs(s.bend) * d * d * 0.15
        if (f <= 0) {
          arr[k] = hx
          arr[k + 1] = hy
          arr[k + 2] = hz
          continue
        }
        // Lying in the pile on the floor, curled.
        const v = by / DOC_H + 0.5
        const lift = s.lift * Math.pow(Math.sin(v * Math.PI * s.waves + s.phase * 0.2), 2)
        const lx = by
        const lz = bx
        const fx = s.px + lx * cy - lz * sy
        const fz = s.pz + lx * sy + lz * cy
        const fy = 0.006 + s.layer * 0.0009 + lift + bz
        // Fall with a slight arc rather than a straight morph.
        const arc = Math.sin(f * Math.PI) * 0.12
        arr[k] = lerp(hx, fx, f)
        arr[k + 1] = lerp(hy, fy, easeIn(f) * 0.6 + f * 0.4) + arc * (1 - v) * 0.3
        arr[k + 2] = lerp(hz, fz, f)
      }
      s.geo.attributes.position.needsUpdate = true
      s.geo.computeVertexNormals()
    }
    // Once the strips are below the gate, they no longer need clipping (and can't be seen inside it).
    stripMat.clippingPlanes = fallP > 0 ? [] : [keepBelow]
  }

  let progress = 0
  let introT = opts.intro && !opts.still ? 0 : INTRO_S
  let introDone = !opts.intro || opts.still
  let skipping = false

  function frame(t: number) {
    const p = opts.still ? 0.95 : progress
    const k = clamp01(introT / INTRO_S)

    /* light levels (the opening brings them up) */
    const ignite = expoOut((introT - 0.15) / 1.0)
    const envUp = easeOut((introT - 0.45) / 1.7)
    const beamUp = easeOut((introT - 0.9) / 1.6)
    scene.environmentIntensity = 0.95 * envUp
    scene.environmentRotation.y = lerp(-1.25, 0.3, easeInOut((introT - 0.2) / 2.8)) + Math.sin(t * 0.12) * 0.12 * k + p * 0.35
    spot.intensity = 300 * beamUp
    key.intensity = 0.35 * envUp
    for (const b of beams) {
      b.mat.uniforms.uIntensity.value = b.k * beamUp
      b.mat.uniforms.uTime.value = t
    }
    dustMat.uniforms.uIntensity.value = beamUp
    dustMat.uniforms.uTime.value = t
    wallMat.uniforms.uIntensity.value = 0.6 * beamUp
    floorMat.uniforms.uIntensity.value = beamUp

    /* file A: arrives in the opening, then is fed through the gate */
    const arrive = easeOut((introT - 1.5) / 1.8)
    const feed = easeInOut(range(p, 0.13, 0.33))
    const bob = Math.sin(t * 0.9) * 0.025 * (1 - feed)
    const aY = lerp(lerp(HOVER_Y + 0.7, HOVER_Y, arrive), FED_Y, feed) + bob
    for (const m of [faceA, edgeClip, backClip]) m.opacity = clamp01(arrive * 1.4)
    meshA.position.set(0, aY, 0)
    meshA.rotation.set(0, Math.sin(t * 0.35) * 0.22 * (1 - feed) * arrive, Math.sin(t * 0.5) * 0.01 * (1 - feed))
    meshA.visible = feed < 1 && arrive > 0
    if (meshA.visible) bendDoc(docA, 0.18 * (1 - feed), 1 - feed, t)
    poseStrips(aY, range(p, 0.31, 0.43), t)

    /* file B: comes down, meets the sheet of light, is pushed back up and held there */
    const bArrive = easeOut(range(p, 0.43, 0.55))
    const bPress = easeInOut(range(p, 0.55, 0.59))
    const bPush = easeOut(range(p, 0.6, 0.7))
    const touchY = GT + 0.06 + DOC_H / 2
    const bY = lerp(HOVER_Y + 4, HOVER_Y, bArrive) + lerp(0, touchY - HOVER_Y, bPress) + lerp(0, HOVER_Y - touchY, bPush)
    meshB.visible = p > 0.43
    meshB.position.set(0, bY + Math.sin(t * 0.9) * 0.02 * bPush, 0)
    meshB.rotation.set(0, Math.sin(t * 0.35) * 0.2 * bPush + (1 - bArrive) * 0.4, Math.sin(t * 0.5) * 0.012 * bPush)
    if (meshB.visible) bendDoc(docB, 0.18, bPush, t)

    const hold = easeOut(range(p, 0.575, 0.6))
    const holdFlash = Math.exp(-Math.max(0, p - 0.6) * 40) * hold
    holdSheetMat.opacity = hold * (0.16 + 0.22 * holdFlash + 0.03 * Math.sin(t * 2.2))
    holdLineMat.opacity = hold
    holdLine.scale.x = Math.max(0.001, hold)
    holdLight.intensity = hold * (0.15 + 0.5 * holdFlash)

    /* the slot: ignites in the opening, flares while shredding */
    const shredding = clamp01(1 - Math.abs(p - 0.24) / 0.12)
    const s = ignite * (0.8 + 0.12 * Math.sin(t * 1.7) + shredding * 1.6)
    slot.scale.x = Math.max(0.001, ignite)
    slotUnder.scale.x = slot.scale.x
    slotMat.color.setRGB(5 * s, 5.6 * s, 7 * s)
    slotLight.intensity = 0.12 * s
    underLight.intensity = 0.25 * s + shredding * 0.35
    inlayMat.color.setRGB(0.5 * envUp, 0.55 * envUp, 0.65 * envUp)

    /* camera: the opening pulls back from the slot; scroll then drifts it slowly round */
    pointer.sx += (pointer.x - pointer.sx) * 0.05
    pointer.sy += (pointer.y - pointer.sy) * 0.05
    const c = easeInOut(introT / (INTRO_S - 0.2))
    const orbit = lerp(0, -0.32, easeInOut(range(p, 0.1, 1)))
    const dist = lerp(narrow ? 14 : 13.2, narrow ? 13.2 : 12.2, easeInOut(range(p, 0.05, 1)))
    const camY = lerp(narrow ? 3.7 : 4.3, narrow ? 3.3 : 3.8, easeInOut(range(p, 0, 1)))
    const heroPos = new THREE.Vector3(Math.sin(orbit) * dist, camY, Math.cos(orbit) * dist)
    const lookY = narrow ? 1.95 : 2.52
    const near = narrow ? 1.7 : 1
    pos.set(lerp(1.0 * near, heroPos.x, c), lerp(GATE_Y + 1.0 * near, heroPos.y, c), lerp(2.6 * near, heroPos.z, c))
    pos.x += pointer.sx * 0.25 * k
    pos.y -= pointer.sy * 0.12 * k
    look.set(lerp(0.2, 0, c), lerp(GATE_Y, lookY, c), 0)
    camera.position.copy(pos)
    camera.lookAt(look)

    // On wide screens the last beat moves the object right, to leave room for the words on the left.
    const shift = narrow ? 0 : easeInOut(range(p, 0.74, 0.86)) * 0.2
    if (shift > 0.0005) camera.setViewOffset(width, height, -width * shift, 0, width, height)
    else camera.clearViewOffset()

    finish.uniforms.uTime.value = t
    finish.uniforms.uFade.value = opts.intro ? easeOut(introT / 0.5) * 0.6 + 0.4 : 1
  }

  /* ---------- loop ---------- */

  const start = performance.now()
  let last = start
  let raf = 0
  let active = false

  const render = () => {
    const now = performance.now()
    const dt = Math.min((now - last) / 1000, 0.1)
    last = now
    if (!introDone) {
      introT += dt * (skipping ? 5 : 1)
      if (introT >= INTRO_S) {
        introT = INTRO_S
        introDone = true
        opts.onIntroDone?.()
      }
    }
    frame((now - start) / 1000)
    composer.render()
    if (active) raf = requestAnimationFrame(render)
  }

  const resize = () => {
    width = host.clientWidth || window.innerWidth
    height = host.clientHeight || window.innerHeight
    renderer.setSize(width, height, false)
    composer.setSize(width, height)
    bloom.resolution.set(width / 2, height / 2)
    camera.aspect = width / height
    narrow = width / height < 1.1
    // Keep the gate (and a margin) in frame on tall screens.
    const half = narrow ? 2.05 : 2.2
    const hfov = 2 * Math.atan(half / (narrow ? 13 : 10.2))
    camera.fov = Math.max(26, (2 * Math.atan(Math.tan(hfov / 2) / camera.aspect) * 180) / Math.PI)
    camera.updateProjectionMatrix()
    dustMat.uniforms.uScale.value = (height * renderer.getPixelRatio()) / (2 * Math.tan(((camera.fov / 2) * Math.PI) / 180))
    if (!active) render()
  }

  const onPointer = (e: PointerEvent) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1
  }
  if (!opts.still) window.addEventListener('pointermove', onPointer, { passive: true })

  resize()
  if (opts.still) {
    render()
  }

  return {
    setProgress(next) {
      progress = next
      if (next > 0.004 && !introDone) skipping = true
      if (!active) render()
    },
    setActive(next) {
      if (opts.still || next === active) return
      active = next
      cancelAnimationFrame(raf)
      if (active) {
        last = performance.now()
        raf = requestAnimationFrame(render)
      }
    },
    skipIntro() {
      if (!introDone) skipping = true
    },
    resize,
    dispose() {
      active = false
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onPointer)
      disposables.forEach((d) => d.dispose())
      floor.dispose()
      target.dispose()
      composer.dispose()
      bloom.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
