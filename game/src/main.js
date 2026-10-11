import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import './style.css';

const canvas = document.querySelector('#game-canvas');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x080b0d);
scene.fog = new THREE.FogExp2(0x0b0d10, 0.028);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.16;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');

const clock = new THREE.Clock();
const world = new THREE.Group();
const effects = new THREE.Group();
const playerRig = new THREE.Group();
scene.add(world, effects, playerRig);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 120);
camera.position.set(0, 1.68, 0);
camera.rotation.order = 'YXZ';
playerRig.add(camera);

const game = {
  started: false,
  vr: false,
  time: 0,
  score: 0,
  wave: 1,
  health: 100,
  shake: 0,
  bodies: [],
  dummies: [],
  interactiveMeshes: [],
  bursts: [],
  decals: [],
  controllers: [],
  keys: new Set(),
  yaw: 0,
  pitch: 0,
  heldDesktop: null,
  feed: [],
  lastHudUpdate: 0,
  nextWaveAt: 0,
  waveInProgress: false,
};

const colors = {
  ink: 0x080b0d,
  deep: 0x11171a,
  sand: 0x886654,
  sandLight: 0xc1916a,
  orange: 0xff743b,
  acid: 0xd6ff55,
  cyan: 0x50d8cb,
  blood: 0xb82332,
  bloodBright: 0xff4a51,
  red: 0xff4a51,
  steel: 0x4e5a5a,
  white: 0xeaf3ec,
};

const tmpV1 = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpV3 = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const tmpMatrix = new THREE.Matrix4();
const raycaster = new THREE.Raycaster();
const centerRay = new THREE.Ray();
const cameraBase = new THREE.Vector3(0, 1.68, 0);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function random(min, max) {
  return min + Math.random() * (max - min);
}

function choose(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function damp(value, target, smoothing, dt) {
  return THREE.MathUtils.damp(value, target, smoothing, dt);
}

function removeFromArray(array, value) {
  const index = array.indexOf(value);
  if (index !== -1) array.splice(index, 1);
}

function markInteractive(object, entity) {
  object.userData.entity = entity;
  game.interactiveMeshes.push(object);
  return object;
}

function entityFromObject(object) {
  let current = object;
  while (current) {
    if (current.userData?.entity) return current.userData.entity;
    current = current.parent;
  }
  return null;
}

function setShadow(object, cast = true, receive = true) {
  object.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = cast;
      child.receiveShadow = receive;
    }
  });
  return object;
}

function createNoiseTexture(base = [105, 76, 61], accent = [190, 130, 82], size = 256) {
  const textureCanvas = document.createElement('canvas');
  textureCanvas.width = size;
  textureCanvas.height = size;
  const context = textureCanvas.getContext('2d');
  const image = context.createImageData(size, size);
  for (let index = 0; index < image.data.length; index += 4) {
    const n = Math.random();
    const blend = n > 0.82 ? (n - 0.82) * 5.5 : 0;
    image.data[index] = base[0] + (accent[0] - base[0]) * blend * 0.35;
    image.data[index + 1] = base[1] + (accent[1] - base[1]) * blend * 0.35;
    image.data[index + 2] = base[2] + (accent[2] - base[2]) * blend * 0.35;
    image.data[index + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

function makeCanvasTexture(draw, width = 1024, height = 256) {
  const textureCanvas = document.createElement('canvas');
  textureCanvas.width = width;
  textureCanvas.height = height;
  const context = textureCanvas.getContext('2d');
  draw(context, width, height);
  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.userData.canvas = textureCanvas;
  texture.userData.context = context;
  return texture;
}

function textPlane(text, options = {}) {
  const {
    width = 1024,
    height = 256,
    color = '#edf4ee',
    accent = '#ff743b',
    fontSize = 110,
    small = '',
  } = options;
  const texture = makeCanvasTexture((context, w, h) => {
    context.clearRect(0, 0, w, h);
    context.textBaseline = 'middle';
    context.font = `900 ${fontSize}px Arial Narrow, Arial, sans-serif`;
    context.fillStyle = color;
    context.fillText(text, 30, h * 0.55);
    if (small) {
      context.font = '700 23px monospace';
      context.fillStyle = accent;
      context.letterSpacing = '8px';
      context.fillText(small, 34, h * 0.88);
    }
  }, width, height);
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(options.planeWidth ?? 5.5, options.planeHeight ?? 1.38), material);
  return mesh;
}

function createLightStrip(position, size, color, rotation = 0, intensity = 2.4) {
  const material = new THREE.MeshBasicMaterial({ color });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
  mesh.position.set(...position);
  mesh.rotation.y = rotation;
  world.add(mesh);
  const light = new THREE.PointLight(color, intensity, 6, 2);
  light.position.copy(mesh.position);
  world.add(light);
  return mesh;
}

function addStaticBox(position, size, material, rotation = [0, 0, 0]) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  setShadow(mesh);
  world.add(mesh);
  return mesh;
}

function addStaticCylinder(position, radius, height, material, rotation = [0, 0, 0]) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.03, height, 16), material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  setShadow(mesh);
  world.add(mesh);
  return mesh;
}

function buildArena() {
  const sandTexture = createNoiseTexture([79, 57, 48], [187, 121, 74], 256);
  sandTexture.repeat.set(14, 14);
  const floorMaterial = new THREE.MeshStandardMaterial({
    map: sandTexture,
    color: 0xb37858,
    roughness: 1,
    metalness: 0,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(52, 52), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  world.add(floor);

  const grid = new THREE.GridHelper(42, 42, colors.cyan, colors.orange);
  grid.position.y = 0.012;
  grid.material.transparent = true;
  grid.material.opacity = 0.12;
  world.add(grid);

  const centerPadMaterial = new THREE.MeshStandardMaterial({ color: 0x242b2c, roughness: 0.72, metalness: 0.48 });
  const centerPad = new THREE.Mesh(new THREE.CylinderGeometry(5.8, 6.15, 0.16, 64), centerPadMaterial);
  centerPad.position.y = 0.08;
  centerPad.receiveShadow = true;
  world.add(centerPad);
  const padRing = new THREE.Mesh(new THREE.TorusGeometry(5.55, 0.035, 8, 96), new THREE.MeshBasicMaterial({ color: colors.orange }));
  padRing.rotation.x = Math.PI / 2;
  padRing.position.y = 0.18;
  world.add(padRing);

  const darkWall = new THREE.MeshStandardMaterial({ color: 0x1a2123, roughness: 0.7, metalness: 0.48 });
  const steelWall = new THREE.MeshStandardMaterial({ color: 0x344144, roughness: 0.58, metalness: 0.78 });
  const orangeMaterial = new THREE.MeshStandardMaterial({ color: 0x602c23, emissive: colors.orange, emissiveIntensity: 0.24, roughness: 0.7 });
  const tealMaterial = new THREE.MeshStandardMaterial({ color: 0x1e4544, emissive: colors.cyan, emissiveIntensity: 0.21, roughness: 0.7 });

  addStaticBox([0, 2.3, -15], [32, 4.6, 0.5], darkWall);
  addStaticBox([-15, 2.3, -3], [0.5, 4.6, 25], darkWall);
  addStaticBox([15, 2.3, -3], [0.5, 4.6, 25], darkWall);
  addStaticBox([-11.7, 1.3, -14.4], [3.8, 2.6, 0.35], steelWall, [0, 0.1, 0]);
  addStaticBox([11.7, 1.3, -14.4], [3.8, 2.6, 0.35], steelWall, [0, -0.1, 0]);
  addStaticBox([-11.6, 2.6, -14.45], [0.32, 5.2, 0.35], orangeMaterial);
  addStaticBox([11.6, 2.6, -14.45], [0.32, 5.2, 0.35], tealMaterial);

  for (let x = -12; x <= 12; x += 4) {
    addStaticBox([x, 0.15, -14.65], [2.3, 0.08, 0.03], x % 8 === 0 ? orangeMaterial : tealMaterial);
  }
  for (const x of [-12.8, 12.8]) {
    addStaticBox([x, 3.25, -10], [0.9, 0.15, 0.6], x < 0 ? orangeMaterial : tealMaterial);
    addStaticBox([x, 2.3, -5], [0.9, 0.15, 0.6], x < 0 ? tealMaterial : orangeMaterial);
  }

  // Industrial frames and sand-scuffed silhouettes make the space read at a glance in VR.
  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x303b3d, roughness: 0.45, metalness: 0.8 });
  for (const x of [-10, 10]) {
    addStaticBox([x, 2.6, -8.9], [0.28, 5.2, 0.28], frameMaterial);
    addStaticBox([x, 5.05, -8.9], [3.9, 0.28, 0.28], frameMaterial);
    addStaticBox([x + (x < 0 ? 1.35 : -1.35), 2.6, -8.9], [0.08, 4.8, 0.08], x < 0 ? orangeMaterial : tealMaterial);
  }
  for (let index = 0; index < 11; index += 1) {
    const x = -13 + index * 2.6;
    const dune = new THREE.Mesh(new THREE.ConeGeometry(random(0.5, 1.05), random(0.32, 0.78), 7), new THREE.MeshStandardMaterial({ color: choose([0x79584b, 0x9d6c4e, 0x6c5046]), roughness: 1 }));
    dune.position.set(x, dune.geometry.parameters.height / 2, random(-13.5, -11.2));
    dune.rotation.y = random(0, Math.PI);
    dune.scale.z = random(1.2, 2.8);
    setShadow(dune);
    world.add(dune);
  }

  createLightStrip([-7.5, 0.28, -8.55], [4.6, 0.045, 0.045], colors.orange, 0.04, 1.9);
  createLightStrip([7.5, 0.28, -8.55], [4.6, 0.045, 0.045], colors.cyan, -0.04, 1.9);
  createLightStrip([0, 0.24, -14.4], [12, 0.045, 0.045], colors.acid, 0, 1.6);

  const sign = textPlane('SANDGLITCH', { planeWidth: 4.8, planeHeight: 1.08, fontSize: 118, color: '#edf4ee', accent: '#d6ff55', small: 'BREAK ZONE // 07' });
  sign.position.set(-2.4, 3.85, -14.35);
  sign.scale.x = 1.1;
  world.add(sign);

  // Destructible cover: a wall of individually simulated slabs.
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 7; column += 1) {
      const x = -4.2 + column * 1.4 + (row ? 0.7 : 0);
      createBreakable('wall', [x, 0.95 + row * 1.35, -8.1], [1.24, 1.2, 0.62], {
        color: row ? 0x5c5f58 : 0x464f4d,
        health: row ? 30 : 36,
        mass: 2.8,
        accent: row ? colors.cyan : colors.orange,
      });
    }
  }

  // Throwables sit close enough to the starting position to teach the interaction loop.
  createCrate([-4.8, 0.55, 1.3], 0.95, 0xff8a4c);
  createCrate([-3.25, 0.55, 0.2], 0.95, 0xc8784a);
  createCrate([4.1, 0.55, 0.9], 0.95, 0x6eaaa0);
  createCrate([5.1, 1.55, 0.2], 0.95, 0xc8784a);
  createBarrel([-1.7, 0.72, 2.8], colors.orange);
  createBarrel([1.4, 0.72, 1.5], colors.cyan);
  createBarrel([6.1, 0.72, -1.3], colors.orange);
  createRock([7.2, 0.58, 2.4], 0.72, 0x665650);
  createRock([-7.0, 0.58, -1.7], 0.7, 0x5a5551);

  createDummy([-2.3, 0, -3.8], colors.orange, 0);
  createDummy([1.0, 0, -4.8], colors.cyan, 1.3);
  createDummy([4.3, 0, -3.1], colors.acid, 2.2);
}

function addPhysicsBody(mesh, options = {}) {
  const body = new PhysicsBody(mesh, options);
  return body;
}

class PhysicsBody {
  constructor(mesh, options = {}) {
    this.mesh = mesh;
    this.mass = options.mass ?? 1;
    this.radius = options.radius ?? 0.5;
    this.half = options.half ?? new THREE.Vector3(this.radius, this.radius, this.radius);
    this.restitution = options.restitution ?? 0.28;
    this.friction = options.friction ?? 0.82;
    this.gravity = options.gravity ?? true;
    this.dynamic = options.dynamic ?? true;
    this.grabbable = options.grabbable ?? true;
    this.kind = options.kind ?? 'prop';
    this.health = options.health ?? 1;
    this.maxHealth = this.health;
    this.accent = options.accent ?? colors.orange;
    this.active = true;
    this.heldBy = null;
    this.life = options.life ?? Infinity;
    this.velocity = new THREE.Vector3();
    this.angularVelocity = new THREE.Vector3();
    this.flash = 0;
    this.lastImpact = -10;
    this.mesh.userData.physicsBody = this;
    game.bodies.push(this);
  }

  applyImpulse(impulse, point = this.mesh.position) {
    if (!this.active) return;
    this.velocity.addScaledVector(impulse, 1 / this.mass);
    tmpV1.copy(point).sub(this.mesh.getWorldPosition(tmpV2));
    this.angularVelocity.add(tmpV3.copy(tmpV1).cross(impulse).multiplyScalar(0.17 / this.mass));
    this.velocity.clampLength(0, 22);
    this.angularVelocity.clampLength(0, 15);
  }

  update(dt) {
    if (!this.active || this.heldBy || !this.dynamic) return;
    if (this.gravity) this.velocity.y -= 10.8 * dt;
    this.mesh.position.addScaledVector(this.velocity, dt);
    this.mesh.rotation.x += this.angularVelocity.x * dt;
    this.mesh.rotation.y += this.angularVelocity.y * dt;
    this.mesh.rotation.z += this.angularVelocity.z * dt;
    this.velocity.x *= Math.pow(this.friction, dt * 7);
    this.velocity.z *= Math.pow(this.friction, dt * 7);
    this.angularVelocity.multiplyScalar(Math.pow(0.25, dt));

    const floorY = this.half.y + 0.08;
    if (this.mesh.position.y < floorY) {
      const impactSpeed = Math.abs(this.velocity.y);
      this.mesh.position.y = floorY;
      if (this.velocity.y < 0) {
        this.velocity.y = -this.velocity.y * this.restitution;
        this.velocity.x *= 0.82;
        this.velocity.z *= 0.82;
        if (impactSpeed > 4 && game.time - this.lastImpact > 0.22) {
          this.lastImpact = game.time;
          spawnDust(this.mesh.position, Math.min(9, impactSpeed));
          if (impactSpeed > 8 && this.kind === 'breakable') {
            damageEntity(this, impactSpeed * 1.35, this.mesh.position, new THREE.Vector3(0, impactSpeed * 0.8, 0), 'impact');
          }
        }
      }
    }

    const limit = 14.3;
    if (this.mesh.position.x < -limit || this.mesh.position.x > limit) {
      this.mesh.position.x = clamp(this.mesh.position.x, -limit, limit);
      this.velocity.x *= -0.55;
    }
    if (this.mesh.position.z < -14.2 || this.mesh.position.z > 11.8) {
      this.mesh.position.z = clamp(this.mesh.position.z, -14.2, 11.8);
      this.velocity.z *= -0.55;
    }

    if (this.life !== Infinity) {
      this.life -= dt;
      if (this.life <= 0) removePhysicsBody(this);
    }
    this.flash = Math.max(0, this.flash - dt * 5);
    updateBodyMaterials(this);
  }
}

function updateBodyMaterials(body) {
  if (!body.materials) return;
  for (const material of body.materials) {
    material.emissiveIntensity = body.flash > 0 ? 0.75 + body.flash * 2.2 : material.userData.baseEmissive ?? 0.05;
  }
}

function createBreakable(kind, position, size, options = {}) {
  const group = new THREE.Group();
  group.position.set(...position);
  const material = new THREE.MeshStandardMaterial({
    color: options.color ?? 0x59615f,
    roughness: 0.78,
    metalness: kind === 'wall' ? 0.42 : 0.2,
    emissive: options.accent ?? colors.orange,
    emissiveIntensity: 0.06,
  });
  material.userData.baseEmissive = 0.06;
  const block = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  group.add(block);
  const bevel = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(...size)), new THREE.LineBasicMaterial({ color: options.accent ?? colors.orange, transparent: true, opacity: 0.28 }));
  group.add(bevel);
  setShadow(group);
  world.add(group);
  const body = addPhysicsBody(group, {
    mass: options.mass ?? 1.4,
    half: new THREE.Vector3(size[0] / 2, size[1] / 2, size[2] / 2),
    radius: Math.max(size[0], size[1], size[2]) * 0.58,
    health: options.health ?? 24,
    accent: options.accent ?? colors.orange,
    kind: 'breakable',
  });
  body.materials = [material];
  body.visualKind = kind;
  markInteractive(block, body);
  markInteractive(bevel, body);
  return body;
}

function createCrate(position, size, color) {
  const group = new THREE.Group();
  group.position.set(...position);
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.08, emissive: color, emissiveIntensity: 0.05 });
  material.userData.baseEmissive = 0.05;
  const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), material);
  group.add(bodyMesh);
  const slatMaterial = new THREE.MeshStandardMaterial({ color: 0x3a2520, roughness: 0.95, metalness: 0.03 });
  for (const y of [-0.26, 0.26]) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(size * 0.88, 0.075, size * 1.02), slatMaterial);
    slat.position.y = y;
    slat.rotation.z = y > 0 ? -0.04 : 0.04;
    group.add(slat);
    markInteractive(slat, null);
  }
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size, size, size)), new THREE.LineBasicMaterial({ color: colors.acid, transparent: true, opacity: 0.25 }));
  group.add(edge);
  setShadow(group);
  world.add(group);
  const body = addPhysicsBody(group, {
    mass: 1.5,
    half: new THREE.Vector3(size / 2, size / 2, size / 2),
    radius: size * 0.83,
    health: 26,
    accent: colors.orange,
    kind: 'breakable',
  });
  body.materials = [material];
  body.visualKind = 'crate';
  body.grabbable = true;
  bodyMesh.userData.entity = body;
  edge.userData.entity = body;
  for (const child of group.children) child.userData.entity = body;
  game.interactiveMeshes.push(bodyMesh, edge);
  return body;
}

function createBarrel(position, color) {
  const group = new THREE.Group();
  group.position.set(...position);
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.62, emissive: color, emissiveIntensity: 0.045 });
  material.userData.baseEmissive = 0.045;
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.46, 1.28, 20), material);
  group.add(drum);
  const ringMaterial = new THREE.MeshStandardMaterial({ color: 0x202a2b, roughness: 0.38, metalness: 0.85 });
  for (const y of [-0.42, 0.42]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.045, 8, 24), ringMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    group.add(ring);
  }
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.025, 16), new THREE.MeshStandardMaterial({ color: 0x162020, metalness: 0.9, roughness: 0.3 }));
  cap.rotation.x = Math.PI / 2;
  cap.position.set(0, 0.64, 0);
  group.add(cap);
  setShadow(group);
  world.add(group);
  const body = addPhysicsBody(group, {
    mass: 1.8,
    half: new THREE.Vector3(0.47, 0.64, 0.47),
    radius: 0.62,
    health: 20,
    accent: color,
    kind: 'breakable',
  });
  body.materials = [material];
  body.visualKind = 'barrel';
  for (const child of group.children) child.userData.entity = body;
  game.interactiveMeshes.push(...group.children);
  return body;
}

function createRock(position, size, color) {
  const material = new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0.05 });
  const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 1), material);
  mesh.position.set(...position);
  mesh.rotation.set(random(-0.3, 0.3), random(0, Math.PI), random(-0.25, 0.25));
  setShadow(mesh);
  world.add(mesh);
  const body = addPhysicsBody(mesh, {
    mass: 2.4,
    half: new THREE.Vector3(size, size, size),
    radius: size,
    health: 18,
    accent: colors.sandLight,
    kind: 'breakable',
  });
  body.materials = [material];
  body.visualKind = 'rock';
  markInteractive(mesh, body);
  return body;
}

class RagdollDummy {
  constructor(position, accent, phase = 0) {
    this.group = new THREE.Group();
    this.group.position.set(...position);
    world.add(this.group);
    this.accent = accent;
    this.phase = phase;
    this.health = 100;
    this.ragdoll = false;
    this.active = true;
    this.scored = false;
    this.parts = [];
    this.materials = [];
    this.createParts();
  }

  createParts() {
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x343f40, roughness: 0.64, metalness: 0.35, emissive: this.accent, emissiveIntensity: 0.08 });
    const limbMaterial = new THREE.MeshStandardMaterial({ color: 0x536160, roughness: 0.72, metalness: 0.25 });
    const visorMaterial = new THREE.MeshStandardMaterial({ color: this.accent, emissive: this.accent, emissiveIntensity: 1.2, roughness: 0.26, metalness: 0.35 });
    this.materials.push(bodyMaterial, limbMaterial, visorMaterial);
    const definitions = [
      { name: 'torso', geometry: new THREE.BoxGeometry(0.56, 0.82, 0.34), position: [0, 1.43, 0], radius: 0.36, mass: 2.6, material: bodyMaterial },
      { name: 'head', geometry: new THREE.SphereGeometry(0.235, 16, 12), position: [0, 2.08, 0], radius: 0.24, mass: 1.0, material: bodyMaterial },
      { name: 'left-arm', geometry: new THREE.BoxGeometry(0.17, 0.64, 0.18), position: [-0.43, 1.46, 0], rotation: [0, 0, -0.12], radius: 0.3, mass: 0.65, material: limbMaterial },
      { name: 'right-arm', geometry: new THREE.BoxGeometry(0.17, 0.64, 0.18), position: [0.43, 1.46, 0], rotation: [0, 0, 0.12], radius: 0.3, mass: 0.65, material: limbMaterial },
      { name: 'left-leg', geometry: new THREE.BoxGeometry(0.2, 0.76, 0.22), position: [-0.18, 0.61, 0], radius: 0.34, mass: 1.0, material: limbMaterial },
      { name: 'right-leg', geometry: new THREE.BoxGeometry(0.2, 0.76, 0.22), position: [0.18, 0.61, 0], radius: 0.34, mass: 1.0, material: limbMaterial },
    ];
    for (const definition of definitions) {
      const mesh = new THREE.Mesh(definition.geometry, definition.material);
      mesh.position.set(...definition.position);
      if (definition.rotation) mesh.rotation.set(...definition.rotation);
      mesh.userData.entity = this;
      mesh.userData.dummyPart = definition.name;
      setShadow(mesh);
      this.group.add(mesh);
      game.interactiveMeshes.push(mesh);
      const part = {
        name: definition.name,
        mesh,
        base: mesh.position.clone(),
        baseRotation: mesh.rotation.clone(),
        radius: definition.radius,
        mass: definition.mass,
        velocity: new THREE.Vector3(),
        angularVelocity: new THREE.Vector3(),
      };
      this.parts.push(part);
    }
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.065, 0.035), visorMaterial);
    visor.position.set(0, 2.08, 0.212);
    visor.userData.entity = this;
    setShadow(visor, true, false);
    this.group.add(visor);
    game.interactiveMeshes.push(visor);
    this.visor = visor;
    const chestMark = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.018), visorMaterial);
    chestMark.position.set(0, 1.52, 0.18);
    chestMark.userData.entity = this;
    this.group.add(chestMark);
    game.interactiveMeshes.push(chestMark);
  }

  hit(amount, point, direction, impulse) {
    if (!this.active) return;
    const localPoint = this.group.worldToLocal(point.clone());
    let closest = this.parts[0];
    let closestDistance = Infinity;
    for (const part of this.parts) {
      const distance = part.mesh.position.distanceTo(localPoint);
      if (distance < closestDistance) {
        closest = part;
        closestDistance = distance;
      }
    }
    this.health = Math.max(0, this.health - amount);
    closest.velocity.addScaledVector(impulse, 1 / closest.mass);
    closest.velocity.addScaledVector(direction, amount * 0.018);
    this.group.traverse((child) => {
      if (child.isMesh && child.material?.emissive) child.material.emissiveIntensity = 1.2;
    });
    spawnBlood(point, amount > 30 ? 18 : 9);
    game.shake = Math.max(game.shake, Math.min(0.35, amount / 100));
    if (!this.ragdoll && (amount >= 13 || this.health <= 0)) this.activateRagdoll(direction, impulse, closest);
    if (this.health <= 0 && !this.scored) {
      this.scored = true;
      game.score += 250;
      addFeed('DUMMY // RAGDOLL CONFIRMED', colors.bloodBright);
    }
  }

  activateRagdoll(direction, impulse, hitPart) {
    this.ragdoll = true;
    this.health = 0;
    for (const part of this.parts) {
      part.velocity.set(random(-1.4, 1.4), random(1.3, 3.5), random(-1.4, 1.4));
      part.velocity.addScaledVector(impulse, 1 / part.mass);
      part.velocity.addScaledVector(direction, random(0.8, 2.2));
      if (part === hitPart) part.velocity.addScaledVector(direction, 5.5);
      part.angularVelocity.set(random(-7, 7), random(-7, 7), random(-7, 7));
    }
    spawnBurst(this.group.position.clone().add(new THREE.Vector3(0, 1.2, 0)), colors.orange, 20, { speed: 3.8, size: 0.055, life: 0.75 });
    addFeed('IMPACT // JOINTS UNLOCKED', colors.orange);
  }

  update(dt) {
    if (!this.active) return;
    if (!this.ragdoll) {
      const bob = Math.sin(game.time * 2.7 + this.phase) * 0.024;
      const sway = Math.sin(game.time * 1.9 + this.phase) * 0.04;
      const torso = this.parts[0];
      torso.mesh.position.y = torso.base.y + bob;
      torso.mesh.rotation.z = torso.baseRotation.z + sway * 0.18;
      this.parts[1].mesh.position.y = this.parts[1].base.y + bob;
      this.parts[2].mesh.rotation.z = -0.12 + sway * 0.2;
      this.parts[3].mesh.rotation.z = 0.12 + sway * 0.2;
      this.visor.position.y = 2.08 + bob;
      return;
    }
    for (const part of this.parts) {
      part.velocity.y -= 10.8 * dt;
      part.mesh.position.addScaledVector(part.velocity, dt);
      part.mesh.rotation.x += part.angularVelocity.x * dt;
      part.mesh.rotation.y += part.angularVelocity.y * dt;
      part.mesh.rotation.z += part.angularVelocity.z * dt;
      part.velocity.x *= Math.pow(0.72, dt * 4);
      part.velocity.z *= Math.pow(0.72, dt * 4);
      part.angularVelocity.multiplyScalar(Math.pow(0.25, dt));
      if (part.mesh.position.y < part.radius + 0.08) {
        part.mesh.position.y = part.radius + 0.08;
        if (part.velocity.y < 0) part.velocity.y *= -0.32;
        part.velocity.x *= 0.78;
        part.velocity.z *= 0.78;
      }
      part.mesh.position.x = clamp(part.mesh.position.x, -10.4, 10.4);
      part.mesh.position.z = clamp(part.mesh.position.z, -10.5, 7.8);
    }
    this.visor.position.lerp(this.parts[1].mesh.position.clone().add(new THREE.Vector3(0, 0, 0.22)), 0.42);
    this.visor.quaternion.copy(this.parts[1].mesh.quaternion);
  }
}

function createDummy(position, accent, phase) {
  const dummy = new RagdollDummy(position, accent, phase);
  game.dummies.push(dummy);
  return dummy;
}

function removePhysicsBody(body) {
  if (!body || !body.active) return;
  body.active = false;
  removeFromArray(game.bodies, body);
  body.mesh.traverse((child) => removeFromArray(game.interactiveMeshes, child));
  if (body.heldBy) {
    if (body.heldBy.userData) body.heldBy.userData.heldBody = null;
    body.heldBy = null;
  }
  if (body.mesh.parent) body.mesh.parent.remove(body.mesh);
}

function destroyBreakable(body, point, impulse) {
  if (!body.active) return;
  const center = body.mesh.getWorldPosition(new THREE.Vector3());
  const visualColor = body.visualKind === 'barrel' ? colors.orange : body.visualKind === 'crate' ? 0xffa261 : 0x9cafa5;
  const count = body.visualKind === 'wall' ? 8 : 12;
  removePhysicsBody(body);
  spawnBurst(center, visualColor, count, { speed: 4.2, size: 0.065, life: 0.85 });
  spawnDust(center, 10);
  game.shake = Math.max(game.shake, 0.24);
  game.score += body.visualKind === 'wall' ? 75 : 100;
  addFeed(`${body.visualKind.toUpperCase()} // STRUCTURE FAILED`, colors.orange);
  for (let index = 0; index < count; index += 1) {
    const size = random(0.11, 0.26);
    const debrisMaterial = new THREE.MeshStandardMaterial({ color: visualColor, roughness: 0.82, metalness: body.visualKind === 'wall' ? 0.35 : 0.08 });
    const debris = new THREE.Mesh(new THREE.BoxGeometry(size * random(0.75, 1.5), size * random(0.65, 1.25), size * random(0.7, 1.3)), debrisMaterial);
    debris.position.copy(center).add(new THREE.Vector3(random(-0.25, 0.25), random(-0.15, 0.25), random(-0.25, 0.25)));
    debris.rotation.set(random(0, Math.PI), random(0, Math.PI), random(0, Math.PI));
    setShadow(debris);
    world.add(debris);
    const shard = addPhysicsBody(debris, {
      mass: random(0.18, 0.55),
      half: new THREE.Vector3(size * 0.7, size * 0.6, size * 0.7),
      radius: size * 1.2,
      health: 1,
      kind: 'debris',
      life: random(5, 9),
      accent: visualColor,
    });
    shard.grabbable = false;
    shard.velocity.set(random(-3, 3), random(1, 5), random(-3, 3));
    shard.velocity.addScaledVector(impulse, 0.12 / shard.mass);
    shard.angularVelocity.set(random(-8, 8), random(-8, 8), random(-8, 8));
  }
}

function damageEntity(entity, amount, point, impulse, source = 'strike') {
  if (!entity) return;
  const direction = impulse.clone().normalize();
  if (entity instanceof RagdollDummy) {
    entity.hit(amount, point, direction, impulse);
    game.score += source === 'strike' ? 25 : 5;
    return;
  }
  if (!(entity instanceof PhysicsBody) || !entity.active || entity.kind !== 'breakable') return;
  entity.health -= amount;
  entity.flash = 1;
  entity.applyImpulse(impulse, point);
  spawnBurst(point, entity.accent, Math.min(8, Math.round(amount / 5)), { speed: 2.2, size: 0.035, life: 0.34 });
  game.shake = Math.max(game.shake, Math.min(0.22, amount / 130));
  if (entity.health <= 0) {
    destroyBreakable(entity, point, impulse);
  } else if (source === 'strike') {
    addFeed(`${entity.visualKind.toUpperCase()} // ${Math.ceil(entity.health)}% STRUCTURAL`, colors.acid);
  }
}

function resolveBodyCollisions() {
  for (let firstIndex = 0; firstIndex < game.bodies.length; firstIndex += 1) {
    const first = game.bodies[firstIndex];
    if (!first.active || !first.dynamic || first.heldBy) continue;
    for (let secondIndex = firstIndex + 1; secondIndex < game.bodies.length; secondIndex += 1) {
      const second = game.bodies[secondIndex];
      if (!second.active || !second.dynamic || second.heldBy) continue;
      const delta = tmpV1.copy(second.mesh.position).sub(first.mesh.position);
      const distance = delta.length();
      const minimum = first.radius + second.radius;
      if (distance === 0 || distance >= minimum) continue;
      const normal = delta.multiplyScalar(1 / distance);
      const overlap = minimum - distance;
      const inverseMass = 1 / first.mass + 1 / second.mass;
      first.mesh.position.addScaledVector(normal, -overlap * (1 / first.mass) / inverseMass);
      second.mesh.position.addScaledVector(normal, overlap * (1 / second.mass) / inverseMass);
      const relative = tmpV2.copy(second.velocity).sub(first.velocity);
      const speed = relative.dot(normal);
      if (speed < 0) {
        const impulseStrength = -(1 + Math.min(first.restitution, second.restitution)) * speed / inverseMass;
        const collisionImpulse = tmpV3.copy(normal).multiplyScalar(impulseStrength);
        first.velocity.addScaledVector(collisionImpulse, -1 / first.mass);
        second.velocity.addScaledVector(collisionImpulse, 1 / second.mass);
        if (Math.abs(speed) > 3.2 && game.time - first.lastImpact > 0.18) {
          first.lastImpact = game.time;
          const contact = first.mesh.position.clone().addScaledVector(normal, first.radius);
          if (first.kind === 'breakable') damageEntity(first, Math.abs(speed) * 1.8, contact, collisionImpulse.clone().multiplyScalar(-0.7), 'impact');
          if (second.kind === 'breakable') damageEntity(second, Math.abs(speed) * 1.8, contact, collisionImpulse.clone().multiplyScalar(0.7), 'impact');
          spawnDust(contact, Math.min(7, Math.abs(speed)));
        }
      }
    }
  }
}

function getCenterRay() {
  camera.getWorldPosition(centerRay.origin);
  camera.getWorldDirection(centerRay.direction);
  return centerRay;
}

function targetFromRay(ray, maxDistance = 5) {
  raycaster.ray.copy(ray);
  const hits = raycaster.intersectObjects(game.interactiveMeshes.filter((mesh) => mesh.parent), false);
  for (const hit of hits) {
    if (hit.distance > maxDistance) break;
    const entity = entityFromObject(hit.object);
    if (!entity) continue;
    if (entity instanceof PhysicsBody && !entity.active) continue;
    if (entity instanceof RagdollDummy && !entity.active) continue;
    return { ...hit, entity };
  }
  return null;
}

function grabBody(body, holder = null) {
  if (!(body instanceof PhysicsBody) || !body.active || !body.grabbable || body.kind === 'debris') return false;
  if (body.heldBy) return false;
  body.heldBy = holder;
  body.velocity.set(0, 0, 0);
  body.angularVelocity.set(0, 0, 0);
  if (holder?.userData) holder.userData.heldBody = body;
  game.heldDesktop = holder ? game.heldDesktop : body;
  addFeed(`${body.visualKind.toUpperCase()} // GRABBED`, colors.cyan);
  return true;
}

function releaseBody(body, throwVelocity = new THREE.Vector3()) {
  if (!body || !body.active) return;
  body.heldBy = null;
  body.velocity.copy(throwVelocity).clampLength(0, 22);
  body.angularVelocity.set(random(-3, 3), random(-3, 3), random(-3, 3));
  if (game.heldDesktop === body) game.heldDesktop = null;
  for (const controller of game.controllers) {
    if (controller.userData.heldBody === body) controller.userData.heldBody = null;
  }
  addFeed(`${body.visualKind.toUpperCase()} // RELEASED`, colors.white);
}

function updateHeldObjects() {
  for (const controller of game.controllers) {
    const body = controller.userData.heldBody;
    if (!body?.active) {
      controller.userData.heldBody = null;
      continue;
    }
    controller.getWorldPosition(tmpV1);
    controller.getWorldDirection(tmpV2);
    body.mesh.position.copy(tmpV1).addScaledVector(tmpV2, -0.55);
    controller.getWorldQuaternion(tmpQuat);
    body.mesh.quaternion.slerp(tmpQuat, 0.8);
  }
  if (game.heldDesktop?.active) {
    const body = game.heldDesktop;
    getCenterRay();
    body.mesh.position.copy(centerRay.origin).addScaledVector(centerRay.direction, 1.25);
    body.mesh.position.y = Math.max(body.mesh.position.y, body.half.y + 0.18);
    body.mesh.rotation.x += 0.012;
    body.mesh.rotation.y += 0.02;
  } else if (game.heldDesktop && !game.heldDesktop.active) {
    game.heldDesktop = null;
  }
}

function punch(ray, strength = 6.5) {
  if (!game.started) return;
  const target = targetFromRay(ray, 4.6);
  const impulse = ray.direction.clone().multiplyScalar(strength);
  const point = target?.point ?? ray.origin.clone().addScaledVector(ray.direction, 2.2);
  if (target) {
    damageEntity(target.entity, target.entity instanceof RagdollDummy ? 36 : 10, point, impulse, 'strike');
    addFeed(target.entity instanceof RagdollDummy ? 'CONTACT // DUMMY HIT' : 'CONTACT // IMPACT REGISTERED', colors.orange);
  } else {
    spawnBurst(point, colors.acid, 4, { speed: 1.2, size: 0.025, life: 0.2 });
  }
  game.shake = Math.max(game.shake, 0.16);
}

function tryGrabFromCenter() {
  const target = targetFromRay(getCenterRay(), 3.6);
  if (!target || !(target.entity instanceof PhysicsBody)) {
    addFeed('GRAB // NO VALID MASS IN RANGE', colors.red);
    return false;
  }
  if (!grabBody(target.entity)) {
    addFeed('GRAB // OBJECT LOCKED', colors.red);
    return false;
  }
  return true;
}

function handleControllerSelect(controller) {
  if (!game.started) {
    startGame();
    return;
  }
  const ray = controllerRay(controller);
  const target = targetFromRay(ray, 3.8);
  if (target?.entity instanceof PhysicsBody && target.distance < 2.7 && target.entity.grabbable) {
    grabBody(target.entity, controller);
    controller.userData.didGrab = true;
  } else {
    controller.userData.didGrab = false;
    punch(ray, 7.5);
  }
}

function handleControllerRelease(controller) {
  const body = controller.userData.heldBody;
  if (!body) return;
  const velocity = controller.userData.velocity?.clone() ?? new THREE.Vector3();
  releaseBody(body, velocity.multiplyScalar(1.5));
}

function controllerRay(controller) {
  tmpMatrix.identity().extractRotation(controller.matrixWorld);
  const ray = new THREE.Ray();
  ray.origin.setFromMatrixPosition(controller.matrixWorld);
  ray.direction.set(0, 0, -1).applyMatrix4(tmpMatrix).normalize();
  return ray;
}

function setupControllers() {
  for (let index = 0; index < 2; index += 1) {
    const controller = renderer.xr.getController(index);
    controller.userData.index = index;
    controller.addEventListener('connected', (event) => {
      controller.userData.inputSource = event.data;
      controller.visible = true;
    });
    controller.addEventListener('disconnected', () => {
      if (controller.userData.heldBody) handleControllerRelease(controller);
      controller.userData.inputSource = null;
      controller.visible = false;
    });
    controller.addEventListener('selectstart', () => handleControllerSelect(controller));
    controller.addEventListener('selectend', () => handleControllerRelease(controller));
    const lineMaterial = new THREE.LineBasicMaterial({ color: colors.cyan, transparent: true, opacity: 0.58 });
    const lineGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -3.5)]);
    const line = new THREE.Line(lineGeometry, lineMaterial);
    line.name = 'interaction-ray';
    controller.add(line);
    controller.visible = false;
    playerRig.add(controller);
    game.controllers.push(controller);
  }
}

function updateControllers(dt) {
  for (const controller of game.controllers) {
    if (!controller.visible) continue;
    controller.getWorldPosition(tmpV1);
    if (controller.userData.lastPosition) {
      controller.userData.velocity = tmpV2.copy(tmpV1).sub(controller.userData.lastPosition).multiplyScalar(1 / Math.max(dt, 0.001)).clone().clampLength(0, 18);
    } else {
      controller.userData.velocity = new THREE.Vector3();
    }
    controller.userData.lastPosition = tmpV1.clone();
    const line = controller.getObjectByName('interaction-ray');
    if (line) {
      const target = targetFromRay(controllerRay(controller), 3.5);
      line.material.color.set(target ? (target.entity instanceof RagdollDummy ? colors.bloodBright : colors.acid) : colors.cyan);
      line.material.opacity = target ? 0.88 : 0.42;
      line.scale.z = target ? Math.max(0.2, target.distance / 3.5) : 1;
    }
    if (controller.userData.heldBody) controller.userData.heldBody.flash = 0.45;

    const source = controller.userData.inputSource;
    const axes = source?.gamepad?.axes;
    if (axes && axes.length >= 4 && game.started) {
      const x = Math.abs(axes[2]) > 0.12 ? axes[2] : axes[0];
      const z = Math.abs(axes[3]) > 0.12 ? axes[3] : axes[1];
      if (Math.abs(x) > 0.12 || Math.abs(z) > 0.12) moveVrRig(x, z, dt);
    }
  }
}

function moveVrRig(horizontal, vertical, dt) {
  const headDirection = camera.getWorldDirection(tmpV1);
  headDirection.y = 0;
  if (headDirection.lengthSq() < 0.001) headDirection.set(0, 0, -1);
  headDirection.normalize();
  const right = tmpV2.set(-headDirection.z, 0, headDirection.x);
  playerRig.position.addScaledVector(right, horizontal * dt * 3.4);
  playerRig.position.addScaledVector(headDirection, -vertical * dt * 3.4);
  playerRig.position.x = clamp(playerRig.position.x, -11.4, 11.4);
  playerRig.position.z = clamp(playerRig.position.z, -1.4, 9.5);
}

function updateDesktopPlayer(dt) {
  if (game.vr || !game.started) return;
  const forward = tmpV1.set(Math.sin(game.yaw), 0, -Math.cos(game.yaw));
  const right = tmpV2.set(Math.cos(game.yaw), 0, Math.sin(game.yaw));
  const move = tmpV3.set(0, 0, 0);
  if (game.keys.has('KeyW') || game.keys.has('ArrowUp')) move.add(forward);
  if (game.keys.has('KeyS') || game.keys.has('ArrowDown')) move.sub(forward);
  if (game.keys.has('KeyD') || game.keys.has('ArrowRight')) move.add(right);
  if (game.keys.has('KeyA') || game.keys.has('ArrowLeft')) move.sub(right);
  if (move.lengthSq() > 0) {
    move.normalize().multiplyScalar(dt * (game.keys.has('ShiftLeft') ? 5.7 : 3.8));
    playerRig.position.add(move);
  }
  playerRig.position.x = clamp(playerRig.position.x, -11.4, 11.4);
  playerRig.position.z = clamp(playerRig.position.z, -1.0, 9.5);
  camera.position.lerp(cameraBase, 0.18);
  camera.rotation.x = game.pitch;
  camera.rotation.y = game.yaw;
  camera.rotation.z = 0;
}

function updateCameraShake(dt) {
  game.shake = Math.max(0, game.shake - dt * 1.7);
  if (!game.vr && game.shake > 0) {
    camera.position.x = cameraBase.x + random(-game.shake, game.shake) * 0.08;
    camera.position.y = cameraBase.y + random(-game.shake, game.shake) * 0.06;
    camera.position.z = cameraBase.z + random(-game.shake, game.shake) * 0.04;
  }
}

function spawnBurst(position, color, count = 12, options = {}) {
  const burst = new ParticleBurst(position, color, count, options);
  effects.add(burst.points);
  game.bursts.push(burst);
}

function spawnDust(position, intensity = 5) {
  spawnBurst(position, choose([0xc9956b, 0xe2b27f, 0x9c7056]), Math.round(4 + intensity * 1.5), { speed: 1.3 + intensity * 0.16, size: 0.08, life: 0.8, gravity: 1.8 });
}

function spawnBlood(position, amount = 12) {
  spawnBurst(position, colors.bloodBright, amount, { speed: 2.4, size: 0.06, life: 0.7, gravity: 5.5 });
  spawnBurst(position, colors.blood, Math.round(amount * 0.55), { speed: 1.7, size: 0.09, life: 1.2, gravity: 5.5 });
  const splat = new THREE.Mesh(new THREE.CircleGeometry(random(0.16, 0.34), 9), new THREE.MeshBasicMaterial({ color: colors.blood, transparent: true, opacity: 0.68, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  splat.rotation.x = -Math.PI / 2;
  splat.rotation.z = random(0, Math.PI);
  splat.position.set(position.x + random(-0.12, 0.12), 0.022, position.z + random(-0.12, 0.12));
  effects.add(splat);
  game.decals.push({ mesh: splat, life: 17, maxLife: 17 });
}

class ParticleBurst {
  constructor(position, color, count, options = {}) {
    this.life = options.life ?? 0.75;
    this.maxLife = this.life;
    this.gravity = options.gravity ?? 3.5;
    this.size = options.size ?? 0.05;
    this.count = count;
    this.positions = new Float32Array(count * 3);
    this.velocities = [];
    for (let index = 0; index < count; index += 1) {
      this.positions[index * 3] = position.x + random(-0.04, 0.04);
      this.positions[index * 3 + 1] = position.y + random(-0.04, 0.04);
      this.positions[index * 3 + 2] = position.z + random(-0.04, 0.04);
      const direction = new THREE.Vector3(random(-1, 1), random(-0.25, 1), random(-1, 1)).normalize();
      this.velocities.push(direction.multiplyScalar(random(options.speed ?? 2, (options.speed ?? 2) * 1.8)));
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    const material = new THREE.PointsMaterial({ color, size: this.size, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    this.points = new THREE.Points(geometry, material);
  }

  update(dt) {
    this.life -= dt;
    for (let index = 0; index < this.count; index += 1) {
      const offset = index * 3;
      const velocity = this.velocities[index];
      velocity.y -= this.gravity * dt;
      this.positions[offset] += velocity.x * dt;
      this.positions[offset + 1] += velocity.y * dt;
      this.positions[offset + 2] += velocity.z * dt;
      if (this.positions[offset + 1] < 0.04) {
        this.positions[offset + 1] = 0.04;
        velocity.y *= -0.22;
        velocity.x *= 0.72;
        velocity.z *= 0.72;
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.material.opacity = clamp(this.life / this.maxLife, 0, 1) * 0.9;
    return this.life > 0;
  }

  dispose() {
    effects.remove(this.points);
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}

function addFeed(message, color = colors.white) {
  game.feed.unshift({ message, color: `#${color.toString(16).padStart(6, '0')}` });
  game.feed = game.feed.slice(0, 3);
  const feedElement = document.querySelector('#event-feed');
  feedElement.innerHTML = game.feed.map((item) => `<span class="feed-line" style="color:${item.color}">${item.message}</span>`).join('');
}

function updateEffects(dt) {
  for (let index = game.bursts.length - 1; index >= 0; index -= 1) {
    const burst = game.bursts[index];
    if (!burst.update(dt)) {
      burst.dispose();
      game.bursts.splice(index, 1);
    }
  }
  for (let index = game.decals.length - 1; index >= 0; index -= 1) {
    const decal = game.decals[index];
    decal.life -= dt;
    decal.mesh.material.opacity = Math.min(0.68, decal.life / 3);
    if (decal.life <= 0) {
      effects.remove(decal.mesh);
      decal.mesh.geometry.dispose();
      decal.mesh.material.dispose();
      game.decals.splice(index, 1);
    }
  }
}

function updateHud() {
  const score = String(Math.max(0, Math.floor(game.score))).padStart(6, '0');
  document.querySelector('#score-value').textContent = score;
  document.querySelector('#wave-value').textContent = String(game.wave).padStart(2, '0');
  const health = Math.round(game.health);
  document.querySelector('#health-value').textContent = health;
  const meter = document.querySelector('#health-meter');
  meter.style.width = `${health}%`;
  meter.style.background = health < 35 ? 'var(--red)' : 'var(--acid)';
  updateWorldHud();
}

const worldHudCanvas = document.createElement('canvas');
worldHudCanvas.width = 640;
worldHudCanvas.height = 180;
const worldHudContext = worldHudCanvas.getContext('2d');
const worldHudTexture = new THREE.CanvasTexture(worldHudCanvas);
worldHudTexture.colorSpace = THREE.SRGBColorSpace;
const worldHud = new THREE.Mesh(new THREE.PlaneGeometry(0.94, 0.265), new THREE.MeshBasicMaterial({ map: worldHudTexture, transparent: true, depthWrite: false }));
worldHud.position.set(0, -0.49, -1.18);
worldHud.renderOrder = 30;
worldHud.visible = false;
camera.add(worldHud);

function updateWorldHud() {
  const context = worldHudContext;
  context.clearRect(0, 0, worldHudCanvas.width, worldHudCanvas.height);
  context.fillStyle = 'rgba(7, 13, 14, .78)';
  context.fillRect(0, 0, 640, 180);
  context.strokeStyle = '#50d8cb';
  context.lineWidth = 3;
  context.strokeRect(3, 3, 634, 174);
  context.fillStyle = '#d6ff55';
  context.font = '700 25px monospace';
  context.fillText('SANDGLITCH // SECTOR 07', 26, 38);
  context.fillStyle = '#edf4ee';
  context.font = '700 23px monospace';
  context.fillText(`WAVE ${String(game.wave).padStart(2, '0')}    SCORE ${String(Math.floor(game.score)).padStart(6, '0')}`, 26, 77);
  context.fillStyle = '#b2c1b9';
  context.font = '700 18px monospace';
  context.fillText(`SUIT INTEGRITY ${String(Math.round(game.health)).padStart(3, '0')}%`, 26, 116);
  context.fillStyle = game.health < 35 ? '#ff4a51' : '#ff743b';
  context.fillRect(26, 135, 588 * clamp(game.health / 100, 0, 1), 10);
  context.fillStyle = '#2c3b3a';
  context.fillRect(26 + 588 * clamp(game.health / 100, 0, 1), 135, 588 * (1 - clamp(game.health / 100, 0, 1)), 10);
  worldHudTexture.needsUpdate = true;
}

function checkWave() {
  const activeDummies = game.dummies.filter((dummy) => dummy.active && !dummy.ragdoll).length;
  if (activeDummies === 0 && !game.waveInProgress && game.time > 4) {
    game.waveInProgress = true;
    game.nextWaveAt = game.time + 3.2;
    addFeed('WAVE CLEAR // RESETTING TARGETS', colors.acid);
  }
  if (game.waveInProgress && game.time > game.nextWaveAt) {
    game.wave += 1;
    game.waveInProgress = false;
    const positions = [[-3.6, 0, -3.8], [0, 0, -5.1], [3.8, 0, -3.6]];
    for (let index = 0; index < positions.length; index += 1) {
      const position = positions[(index + game.wave) % positions.length];
      createDummy(position, choose([colors.orange, colors.cyan, colors.acid]), random(0, 3));
    }
    addFeed(`WAVE ${String(game.wave).padStart(2, '0')} // DUMMIES DEPLOYED`, colors.orange);
  }
}

function startGame() {
  if (game.started) return;
  game.started = true;
  document.querySelector('#intro-screen').classList.add('is-hidden');
  document.querySelector('#hud').classList.remove('is-hidden');
  document.querySelector('#reticle').classList.remove('is-hidden');
  introGroup.visible = false;
  playerRig.position.set(0, 0, 7.8);
  game.yaw = 0;
  game.pitch = -0.04;
  camera.rotation.set(game.pitch, game.yaw, 0);
  addFeed('SYSTEM // SANDBOX ONLINE', colors.acid);
  addFeed('MISSION // BREAK THE ROOM', colors.orange);
  updateHud();
}

function resetPlayer() {
  game.health = 100;
  playerRig.position.set(0, 0, 7.8);
  game.yaw = 0;
  game.pitch = -0.04;
  addFeed('SUIT // EMERGENCY RESET', colors.cyan);
}

function applyPlayerHazardDamage() {
  if (!game.started || game.time % 0.3 > 0.03) return;
  const playerPosition = playerRig.position.clone().add(camera.position);
  for (const body of game.bodies) {
    if (!body.active || body.heldBy) continue;
    if (body.velocity.length() < 7) continue;
    const distance = body.mesh.position.distanceTo(playerPosition);
    if (distance < body.radius + 0.7) {
      game.health = Math.max(0, game.health - Math.min(12, body.velocity.length() * 0.7));
      body.velocity.multiplyScalar(0.45);
      game.shake = 0.3;
      addFeed('WARNING // KINETIC IMPACT', colors.red);
      if (game.health <= 0) resetPlayer();
    }
  }
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  game.time += dt;
  if (game.started) {
    updateDesktopPlayer(dt);
    updateControllers(dt);
    updateHeldObjects();
    for (const body of [...game.bodies]) body.update(dt);
    resolveBodyCollisions();
    for (const dummy of game.dummies) dummy.update(dt);
    applyPlayerHazardDamage();
    checkWave();
    updateCameraShake(dt);
    if (game.time - game.lastHudUpdate > 0.08) {
      game.lastHudUpdate = game.time;
      updateHud();
    }
  }
  updateEffects(dt);
  renderer.render(scene, camera);
}

// Intro hologram: the menu exists in the scene as well as on the screen, so an HMD never
// starts in a blank canvas. Trigger in VR starts the sandbox immediately.
const introGroup = new THREE.Group();
scene.add(introGroup);
const introTitle = textPlane('SANDGLITCH', { planeWidth: 6.5, planeHeight: 1.48, fontSize: 148, color: '#edf4ee', accent: '#ff743b', small: 'PHYSICS // CHAOS // SURVIVE' });
introTitle.position.set(0, 3.4, -3.4);
introGroup.add(introTitle);
const introRing = new THREE.Mesh(new THREE.TorusGeometry(3.3, 0.018, 8, 96), new THREE.MeshBasicMaterial({ color: colors.orange, transparent: true, opacity: 0.75 }));
introRing.position.set(0, 2.8, -3.42);
introGroup.add(introRing);
const introRing2 = new THREE.Mesh(new THREE.TorusGeometry(2.72, 0.008, 8, 96), new THREE.MeshBasicMaterial({ color: colors.cyan, transparent: true, opacity: 0.65 }));
introRing2.position.set(0, 2.8, -3.42);
introRing2.rotation.z = Math.PI / 3;
introGroup.add(introRing2);
for (let index = -4; index <= 4; index += 1) {
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.018, 3.8, 0.018), new THREE.MeshBasicMaterial({ color: index % 2 ? colors.cyan : colors.orange, transparent: true, opacity: 0.3 }));
  bar.position.set(index * 0.72, 2.25, -3.4);
  bar.rotation.z = random(-0.06, 0.06);
  introGroup.add(bar);
}

function setupLighting() {
  const hemisphere = new THREE.HemisphereLight(0xc4e6db, 0x201418, 1.45);
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight(0xffc8a6, 3.8);
  sun.position.set(-7, 12, 7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -18;
  sun.shadow.camera.right = 18;
  sun.shadow.camera.top = 18;
  sun.shadow.camera.bottom = -18;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 40;
  scene.add(sun);
  const orangeLight = new THREE.PointLight(colors.orange, 9, 12, 2);
  orangeLight.position.set(-7, 3, -6);
  scene.add(orangeLight);
  const cyanLight = new THREE.PointLight(colors.cyan, 8, 12, 2);
  cyanLight.position.set(8, 3, -8);
  scene.add(cyanLight);
}

function setupEvents() {
  const startButton = document.querySelector('#start-game');
  const helpButton = document.querySelector('#how-to');
  const helpPanel = document.querySelector('#help-panel');
  const closeHelp = document.querySelector('#close-help');
  startButton.addEventListener('click', () => {
    startGame();
    if (!game.vr) canvas.requestPointerLock?.();
  });
  helpButton.addEventListener('click', () => helpPanel.classList.remove('is-hidden'));
  closeHelp.addEventListener('click', () => helpPanel.classList.add('is-hidden'));
  canvas.addEventListener('click', () => {
    if (!game.started) return;
    if (!game.vr && document.pointerLockElement !== canvas) {
      canvas.requestPointerLock?.();
      return;
    }
    if (!game.vr) punch(getCenterRay(), 6.8);
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement !== canvas && game.started && !game.vr) addFeed('MOUSE // CLICK CANVAS TO RE-LOCK', colors.soft ?? colors.white);
  });
  document.addEventListener('mousemove', (event) => {
    if (!game.started || game.vr || document.pointerLockElement !== canvas) return;
    game.yaw -= event.movementX * 0.00225;
    game.pitch = clamp(game.pitch - event.movementY * 0.0021, -1.28, 1.28);
  });
  document.addEventListener('keydown', (event) => {
    game.keys.add(event.code);
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
    if (!game.started) return;
    if (event.code === 'KeyE' && !event.repeat) {
      if (game.heldDesktop) releaseBody(game.heldDesktop, getCenterRay().direction.clone().multiplyScalar(7));
      else tryGrabFromCenter();
    }
    if (event.code === 'KeyR' && !event.repeat) resetPlayer();
  });
  document.addEventListener('keyup', (event) => game.keys.delete(event.code));
  renderer.xr.addEventListener('sessionstart', () => {
    game.vr = true;
    worldHud.visible = true;
    document.querySelector('#vr-status').classList.remove('is-hidden');
    document.querySelector('#reticle').classList.add('is-hidden');
    document.querySelector('#intro-screen').classList.add('is-hidden');
    if (!game.started) startGame();
    document.querySelector('#hud').classList.add('is-hidden');
    addFeed('XR // IMMERSIVE SESSION ACTIVE', colors.cyan);
  });
  renderer.xr.addEventListener('sessionend', () => {
    game.vr = false;
    worldHud.visible = false;
    document.querySelector('#vr-status').classList.add('is-hidden');
    if (game.started) {
      document.querySelector('#hud').classList.remove('is-hidden');
      document.querySelector('#reticle').classList.remove('is-hidden');
    }
    for (const controller of game.controllers) {
      if (controller.userData.heldBody) handleControllerRelease(controller);
      controller.visible = false;
    }
  });
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

setupLighting();
buildArena();
setupControllers();
setupEvents();
updateHud();
renderer.setAnimationLoop(animate);
