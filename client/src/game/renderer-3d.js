import * as THREE from 'three';
import { CONFIG, PLAYERS, getSeatPose } from '../../../shared/physics.js';
import { getHazardPolygons, getHazardWorldPosition, riverCenter } from '../../../shared/simulation.js';
const WORLD_SCALE = 0.045;

const HIPPO_COLORS = ['#3b83d5', '#f08b38', '#4ea960', '#8d6047'];
const QUALITY = { low: { pixelRatio: 0.72, trees: 50, reeds: 80, shadows: false }, medium: { pixelRatio: 1, trees: 100, reeds: 150, shadows: false }, high: { pixelRatio: 1.35, trees: 220, reeds: 300, shadows: true } };
const toWorld = (x, z) => new THREE.Vector3((x - 500) * WORLD_SCALE, 0, z * WORLD_SCALE);

function material(color, roughness = 0.82, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, ...extra });
}

function paintNameTag(canvas, name, color) {
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'rgba(24,55,53,.78)';
  context.beginPath();
  context.roundRect(12, 8, 232, 64, 20);
  context.fill();
  context.fillStyle = color;
  context.font = 'bold 29px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(name, 128, 40, 210);
}

function makeNameTag(name, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 80;
  paintNameTag(canvas, name, color);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(2.2, 0.66, 1);
  return sprite;
}

function makeRibbon(level, startY, endY, innerOffset, outerOffset, color, segments = 36) {
  const vertices = [];
  const indices = [];
  const uvs = [];
  for (let index = 0; index <= segments; index += 1) {
    const fraction = index / segments;
    const y = startY + (endY - startY) * fraction;
    const center = riverCenter(level, y);
    vertices.push((center + innerOffset) * WORLD_SCALE - 500 * WORLD_SCALE, -0.12, y * WORLD_SCALE);
    vertices.push((center + outerOffset) * WORLD_SCALE - 500 * WORLD_SCALE, -0.12, y * WORLD_SCALE);
    uvs.push(0, fraction, 1, fraction);
    if (index < segments) {
      const base = index * 2;
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material(color, 1, { side: THREE.DoubleSide }));
}

function makeWaterMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uLow: { value: new THREE.Color('#46b9bb') }, uHigh: { value: new THREE.Color('#72d3ca') } },
    vertexShader: `
      uniform float uTime;
      varying vec2 vUv;
      varying float vWave;
      void main() {
        vUv = uv;
        vec3 p = position;
        float waveA = sin(p.x * 0.32 + p.z * 0.16 + uTime * 1.25);
        float waveB = cos(p.x * 0.17 - p.z * 0.27 - uTime * 0.8);
        p.y += (waveA + waveB) * 0.035;
        vWave = waveA * 0.5 + waveB * 0.5;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uLow;
      uniform vec3 uHigh;
      varying vec2 vUv;
      varying float vWave;
      void main() {
        float current = sin(vUv.y * 100.0 - uTime * 2.8 + vUv.x * 9.0) * 0.5 + 0.5;
        float crossWave = cos(vUv.y * 53.0 + uTime * 1.7) * 0.5 + 0.5;
        vec3 water = mix(uLow, uHigh, 0.38 + current * 0.25 + vWave * 0.12);
        float edge = min(vUv.x, 1.0 - vUv.x);
        float foam = (1.0 - smoothstep(0.0, 0.055, edge)) * smoothstep(0.15, 0.8, crossWave);
        water = mix(water, vec3(0.84, 0.96, 0.86), foam * 0.65);
        gl_FragColor = vec4(water, 1.0);
      }
    `,
  });
}

function makeHippo(playerId) {
  const group = new THREE.Group();
  const skin = material(HIPPO_COLORS[playerId], 0.66);
  const muzzle = material('#f2b6a2', 0.78);
  const dark = material('#274044', 0.5);
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.62, 10, 8), skin);
  body.scale.set(1, 0.72, 1.18);
  body.position.y = 0.75;
  body.castShadow = true;
  group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.43, 10, 8), skin);
  head.scale.set(0.92, 0.9, 1.05);
  head.position.set(0, 1.08, 0.46);
  head.castShadow = true;
  group.add(head);
  const snout = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), muzzle);
  snout.scale.set(1.2, 0.72, 0.72);
  snout.position.set(0, 0.96, 0.8);
  group.add(snout);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), dark);
    eye.position.set(side * 0.18, 1.27, 0.76);
    group.add(eye);
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.11, 7, 5), skin);
    ear.scale.set(0.8, 1.3, 0.55);
    ear.position.set(side * 0.31, 1.4, 0.28);
    group.add(ear);
    for (const footZ of [-0.3, 0.62]) {
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.19, 7, 5), skin);
      foot.scale.set(0.85, 0.66, 1.15);
      foot.position.set(side * 0.4, 0.38, footZ);
      group.add(foot);
    }
  }
  group.add(makeNameTag(PLAYERS[playerId].label, '#ffffff'));
  group.children[group.children.length - 1].position.set(0, 2.55, 0.1);
  return group;
}

function makeTreeInstances(scene, level, count, quality) {
  const treeGroup = new THREE.Group();
  const trunkGeometry = new THREE.CylinderGeometry(0.13, 0.22, 1.5, 5);
  const crownGeometry = new THREE.ConeGeometry(0.9, 2.8, 5);
  const trunk = new THREE.InstancedMesh(trunkGeometry, material('#8c6344'), count);
  const crown = new THREE.InstancedMesh(crownGeometry, material('#458b58'), count);
  const matrix = new THREE.Matrix4();
  let seed = level.id * 8459 + 73;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const divisions = Math.floor(count / 2);
  for (let index = 0; index < count; index += 1) {
    const side = index < divisions ? -1 : 1;
    const y = 130 + random() * Math.max(1, level.length - 260);
    const sideOffset = level.riverWidth / 2 + 90 + random() * 260;
    const x = riverCenter(level, y) + side * sideOffset;
    const height = 0.75 + random() * 0.7;
    const yaw = random() * Math.PI * 2;
    const scale = new THREE.Vector3(0.8 + random() * 0.7, height, 0.8 + random() * 0.7);
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
    matrix.compose(toWorld(x, y).setY(0.15), rotation, scale);
    trunk.setMatrixAt(index, matrix);
    const crownPosition = toWorld(x, y).setY(1.45 * height);
    matrix.compose(crownPosition, rotation, new THREE.Vector3(scale.x * 1.15, scale.y, scale.z * 1.15));
    crown.setMatrixAt(index, matrix);
  }
  trunk.count = count;
  crown.count = count;
  trunk.castShadow = quality.shadows;
  crown.castShadow = quality.shadows;
  treeGroup.add(trunk, crown);
  scene.add(treeGroup);
  return treeGroup;
}

function makeReeds(scene, level, count) {
  const geometry = new THREE.ConeGeometry(0.08, 0.7, 4);
  const reed = new THREE.InstancedMesh(geometry, material('#459b79'), count);
  const matrix = new THREE.Matrix4();
  let seed = level.id * 377 + 19;
  const random = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
  for (let index = 0; index < count; index += 1) {
    const y = 50 + random() * Math.max(1, level.length - 100);
    const side = index % 2 ? -1 : 1;
    const x = riverCenter(level, y) + side * (level.riverWidth / 2 - 1 + random() * 5);
    const pose = toWorld(x, y).setY(0.22);
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, random() * Math.PI, random() * 0.2));
    matrix.compose(pose, rotation, new THREE.Vector3(1, 0.7 + random() * 0.8, 1));
    reed.setMatrixAt(index, matrix);
  }
  scene.add(reed);
  return reed;
}

function makeSpikedBall(radius, color = '#f16c70') {
  const group = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.62, 8, 6), material('#9b544c'));
  group.add(core);
  const spikeGeometry = new THREE.ConeGeometry(radius * 0.22, radius * 0.74, 5);
  const spikes = new THREE.InstancedMesh(spikeGeometry, material(color), 10);
  const matrix = new THREE.Matrix4();
  for (let index = 0; index < 10; index += 1) {
    const angle = index / 10 * Math.PI * 2;
    const direction = new THREE.Vector3(Math.cos(angle), 0.35, Math.sin(angle)).normalize();
    const position = direction.clone().multiplyScalar(radius * 0.75);
    const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    matrix.compose(position, rotation, new THREE.Vector3(1, 1, 1));
    spikes.setMatrixAt(index, matrix);
  }
  const topSpike = new THREE.Mesh(spikeGeometry, material(color));
  topSpike.position.y = radius * 0.76;
  group.add(spikes, topSpike);
  return group;
}

function createArrowPad(width, length) {
  const group = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(width, 0.12, length), material('#d84f46', 0.62));
  base.position.y = 0.08;
  group.add(base);
  for (let index = -1; index <= 1; index += 1) {
    const arrow = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, length * 0.42), material('#ffe58c'));
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.55, 3), material('#ffe58c'));
    shaft.position.z = 0.05;
    head.rotation.x = Math.PI / 2;
    head.position.z = length * 0.22;
    arrow.add(shaft, head);
    arrow.position.x = index * width * 0.28;
    arrow.position.y = 0.17;
    group.add(arrow);
  }
  return group;
}

export class RiverRenderer3D {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.settings = settings;
    this.quality = settings.renderQuality || 'medium';
    this.qualityOptions = QUALITY[this.quality] || QUALITY.medium;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.quality === 'high', powerPreference: 'high-performance', alpha: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = this.qualityOptions.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#9bd6dc');
    this.scene.fog = new THREE.Fog('#9bd6dc', 50, 260);
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 500);
    this.camera.position.set(0, 8, -15);
    this.scene.add(new THREE.HemisphereLight('#d9f5f1', '#648b5d', 2.0));
    this.sun = new THREE.DirectionalLight('#fff2d2', 3.2);
    this.sun.position.set(-35, 65, -20);
    this.sun.castShadow = this.qualityOptions.shadows;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.left = -42;
    this.sun.shadow.camera.right = 42;
    this.sun.shadow.camera.top = 70;
    this.sun.shadow.camera.bottom = -70;
    this.scene.add(this.sun, this.sun.target);
    this.sunBall = new THREE.Mesh(new THREE.SphereGeometry(3, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffe5a0' }));
    this.sunBall.position.set(-55, 48, 95);
    this.scene.add(this.sunBall);
    this.courseGroup = new THREE.Group();
    this.scene.add(this.courseGroup);
    this.worldGroup = new THREE.Group();
    this.scene.add(this.worldGroup);
    this.debugGroup = new THREE.Group();
    this.scene.add(this.debugGroup);
    this.debugElement = canvas.closest('.app-shell')?.querySelector('#physics-debug');
    this.raftGroup = this.createRaft();
    this.scene.add(this.raftGroup);
    this.hippos = PLAYERS.map((_, playerId) => {
      const hippo = makeHippo(playerId);
      this.raftGroup.add(hippo);
      return hippo;
    });
    this.particles = [];
    this.particleMeshes = [];
    this.hazards = [];
    this.seenBurstKeys = new Set(); // tracks burst keys (playerId+startAge) to fire fart sound once
    this.currentLevelId = null;
    this.cameraPosition = new THREE.Vector3();
    this.cameraLook = new THREE.Vector3();
    this.previousTimestamp = null;
    this.fps = 0;
    this.ready = import('./physics3d.js').then(({ PlanarRapierBody }) => PlanarRapierBody.create({ mass: CONFIG.mass, radius: CONFIG.raftRadius })).then((body) => {
      this.planarBody = body;
      this.resize();
      return true;
    });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  resize() {
    const bounds = this.canvas.getBoundingClientRect();
    const pixelRatio = Math.min(window.devicePixelRatio || 1, this.qualityOptions.pixelRatio);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(Math.max(1, bounds.width), Math.max(1, bounds.height), false);
    this.camera.aspect = Math.max(1, bounds.width) / Math.max(1, bounds.height);
    this.camera.updateProjectionMatrix();
  }

    setMySeat(mySeat) {
    this.hippos.forEach((hippo, playerId) => {
      const tag = hippo.children.find((child) => child.isSprite);
      const isMe = playerId === mySeat;
      paintNameTag(tag.material.map.image, isMe ? 'YOU' : PLAYERS[playerId].label, isMe ? '#ffe27a' : '#ffffff');
      tag.material.map.needsUpdate = true;
    });
  }
  
  resetCamera() {
    this.cameraPosition.set(0, 0, 0);
    this.cameraLook.set(0, 0, 0);
  }

  setQuality(quality) {
    if (!QUALITY[quality] || quality === this.quality) return;
    this.quality = quality;
    this.qualityOptions = QUALITY[quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.qualityOptions.pixelRatio));
    this.renderer.shadowMap.enabled = this.qualityOptions.shadows;
    this.sun.castShadow = this.qualityOptions.shadows;
    if (this.level) this.buildCourse(this.level);
  }

  createRaft() {
    const group = new THREE.Group();
    const radius = CONFIG.raftRadius * WORLD_SCALE;
  const raftMaterial = material('#efb16b', 0.45);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.86, radius * 0.98, 0.54, 24), raftMaterial);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    const bumper = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.91, 0.16, 8, 32), material('#d94f46', 0.38));
    bumper.rotation.x = Math.PI / 2;
    bumper.position.y = 0.22;
    group.add(bumper);
    const inner = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.55, 20), material('#d9945c'));
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = 0.28;
    group.add(inner);
    for (let index = 0; index < 4; index += 1) {
      const angle = index * Math.PI / 2;
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.075, 6, 10), material('#c63f3d'));
      handle.rotation.x = Math.PI / 2;
      handle.position.set(Math.cos(angle) * radius * 0.94, 0.28, Math.sin(angle) * radius * 0.94);
      group.add(handle);
    }
    return group;
  }

  buildCourse(level) {
    this.level = level;
    this.currentLevelId = level.id;
    this.clearGroup(this.courseGroup);
    this.clearGroup(this.worldGroup);
    this.hazards = [];
    const span = level.length * WORLD_SCALE;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(180, span + 100), material('#86b961'));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.54, span / 2);
    ground.receiveShadow = true;
    this.courseGroup.add(ground);
    const shore = new THREE.Mesh(new THREE.PlaneGeometry(180, span + 100), material('#a3c96b'));
    shore.rotation.x = -Math.PI / 2;
    shore.position.set(0, -0.58, span / 2);
    shore.receiveShadow = true;
    this.courseGroup.add(shore);
    const water = new THREE.Mesh(this.makeRiverGeometry(level), makeWaterMaterial());
    water.receiveShadow = true;
    water.userData.waterMaterial = water.material;
    this.courseGroup.add(water);
    this.addBanks(level);
    makeTreeInstances(this.courseGroup, level, this.qualityOptions.trees, this.qualityOptions);
    makeReeds(this.courseGroup, level, this.qualityOptions.reeds);
    this.addClouds(level);
    for (let index = 0; index < level.hazards.length; index += 1) this.addHazard(level, level.hazards[index], index);
    this.finishLine = this.makeFinishLine(level);
    this.courseGroup.add(this.finishLine);
  }

  makeRiverGeometry(level) {
    const sampleStep = 36;
    const rows = Math.ceil(level.length / sampleStep) + 1;
    const vertices = [];
    const uvs = [];
    const indices = [];
    for (let row = 0; row < rows; row += 1) {
      const y = Math.min(level.length, row * sampleStep);
      const center = riverCenter(level, y);
      const half = level.riverWidth / 2;
      vertices.push((center - half - 500) * WORLD_SCALE, -0.22, y * WORLD_SCALE);
      vertices.push((center + half - 500) * WORLD_SCALE, -0.22, y * WORLD_SCALE);
      uvs.push(0, y / level.length, 1, y / level.length);
      if (row < rows - 1) {
        const base = row * 2;
        indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  addBanks(level) {
    const half = level.riverWidth / 2;
    for (const side of [-1, 1]) {
      this.courseGroup.add(makeRibbon(level, 0, level.length, side * half, side * (half + 8), '#78a951'));
      const spikeZones = level.spikeBanks.filter((zone) => (zone.side === 'left' ? -1 : 1) === side);
      for (const zone of spikeZones) {
        this.courseGroup.add(makeRibbon(level, zone.start, zone.end, side * (half + 0.3), side * (half + 3.8), '#e98a91', 20));
        for (let y = zone.start; y < zone.end; y += 18) {
          const spike = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.8, 4), material('#fff0d0'));
          spike.position.copy(toWorld(riverCenter(level, y) + side * (half + 1.7), y));
          spike.position.y = 0.25;
          spike.rotation.z = side * Math.PI / 2;
          this.courseGroup.add(spike);
        }
      }
    }
  }

  addClouds(level) {
    for (let index = 0; index < 9; index += 1) {
      const cloud = new THREE.Group();
      const cloudMaterial = new THREE.MeshStandardMaterial({ color: '#fffaf0', roughness: 1, transparent: true, opacity: 0.82 });
      const x = (index % 2 ? -1 : 1) * (30 + (index % 3) * 8);
      const z = (index + 1) * level.length / 10 * WORLD_SCALE;
      for (let ball = 0; ball < 4; ball += 1) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(1.2 + (ball % 2) * 0.35, 7, 5), cloudMaterial);
        puff.position.set((ball - 1.5) * 0.9, ball % 2 * 0.35, 0);
        cloud.add(puff);
      }
      cloud.position.set(x, 15 + index % 3 * 2, z);
      this.courseGroup.add(cloud);
    }
  }

  addHazard(level, hazard, index) {
    const position = getHazardWorldPosition(level, hazard, 0);
    const group = new THREE.Group();
    group.position.copy(toWorld(position.x, position.y));
    const size = (hazard.radius || hazard.thickness || 36) * WORLD_SCALE;
    let mesh;
    if (hazard.kind === 'rapid') {
      mesh = createArrowPad(Math.max(5, size * 2.1), 4.2);
      group.position.y = -0.06;
    } else if (hazard.kind === 'whirlpool') {
      for (let ring = 0; ring < 3; ring += 1) {
        const torus = new THREE.Mesh(new THREE.TorusGeometry(size * (0.45 + ring * 0.22), 0.055, 6, 24), material(ring === 0 ? '#e4f4ce' : '#65b8b2', 0.55));
        torus.rotation.x = Math.PI / 2;
        torus.position.y = 0.12 + ring * 0.015;
        group.add(torus);
      }
      mesh = group;
    } else if (hazard.kind === 'rock') {
      mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), material('#84938a'));
      mesh.scale.set(1.05, 0.72, 0.82);
      mesh.position.y = 0.25;
      mesh.castShadow = true;
    } else if (hazard.kind === 'log') {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.45, size * 0.5, size * 2.3, 8), material('#956a47'));
      mesh.rotation.z = Math.PI / 2;
      mesh.position.y = 0.34;
      mesh.castShadow = true;
    } else if (hazard.kind === 'mine' || hazard.kind === 'spike' || hazard.kind === 'moving-spike') {
      mesh = makeSpikedBall(size, hazard.kind === 'mine' ? '#ed594e' : '#f0717b');
      mesh.position.y = 0.55;
    } else if (hazard.kind === 'checkpoint') {
      mesh = this.makeCheckpoint(level);
    } else if (hazard.kind === 'rotating-bar') {
      mesh = this.makeBar(hazard.length * WORLD_SCALE, hazard.thickness * WORLD_SCALE, hazard.spiked);
      mesh.position.y = 1.15;
    } else if (hazard.kind === 'swinging-hammer') {
      mesh = this.makeHammer(hazard);
      mesh.position.y = 2.8;
    } else if (['gate', 'moving-spike-wall', 'swinging-door'].includes(hazard.kind)) {
      mesh = new THREE.Group();
      for (let panel = 0; panel < 2; panel += 1) {
        const segment = new THREE.Mesh(new THREE.BoxGeometry(1, 0.8, Math.max(0.4, hazard.thickness * WORLD_SCALE)), material(hazard.spiked || hazard.kind === 'moving-spike-wall' ? '#e86258' : '#956e4b'));
        segment.position.y = 0.55;
        mesh.add(segment);
      }
    } else if (hazard.kind === 'swinging-door') {
      mesh = this.makeBar(size * 2.4, 0.55, true);
    } else {
      mesh = makeSpikedBall(size, '#f0717b');
    }
    if (mesh !== group) group.add(mesh);
    this.worldGroup.add(group);
    this.hazards.push({ group, mesh, hazard, index, baseX: position.x, baseZ: position.y });
  }

  makeBar(length, thickness, spiked = true) {
    const group = new THREE.Group();
    const bar = new THREE.Mesh(new THREE.BoxGeometry(length, thickness, thickness * 0.9), material('#d84f46'));
    bar.castShadow = true;
    group.add(bar);
    if (spiked) {
      const spikeGeometry = new THREE.ConeGeometry(0.18, 0.55, 4);
      for (let index = -3; index <= 3; index += 1) {
        const spike = new THREE.Mesh(spikeGeometry, material('#fff1cf'));
        spike.position.set(index * length / 7, thickness * 0.7, 0);
        group.add(spike);
      }
    }
    return group;
  }

    makeHammer(hazard) {
    const group = new THREE.Group();
    // Unit-length arm: it runs from the head (z = 0) to z = 1 and is stretched to the right length every frame.
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 1), material('#9b7151'));
    arm.position.z = 0.5;
    arm.castShadow = true;
    group.add(arm);
    // The head sits at the group's origin, which is the real hit position.
    const head = makeSpikedBall(hazard.radius * WORLD_SCALE, '#e86b66');
    head.position.y = -0.3;
    group.add(head);
    return group;
  }

  makeCheckpoint(level) {
    const group = new THREE.Group();
    const half = level.riverWidth * WORLD_SCALE * 0.38;
    const postMaterial = material('#f1e7c7');
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 4, 6), postMaterial);
      post.position.set(side * half, 2, 0);
      post.castShadow = true;
      group.add(post);
    }
    const banner = new THREE.Mesh(new THREE.BoxGeometry(half * 2, 0.55, 0.12), material('#e86a5d'));
    banner.position.y = 3.35;
    group.add(banner);
    return group;
  }

  makeFinishLine(level) {
    const group = new THREE.Group();
    const centerX = riverCenter(level, level.length - 95);
    const half = level.goalRange * WORLD_SCALE;
    const finish = new THREE.Mesh(new THREE.BoxGeometry(half * 2, 0.07, 0.5), material('#f1e8c9'));
    finish.position.set((centerX - 500) * WORLD_SCALE, 0.05, (level.length - 95) * WORLD_SCALE);
    group.add(finish);
    return group;
  }

  clearGroup(group) {
    while (group.children.length) {
      const child = group.children.pop();
      child.traverse((object) => {
        if (object.geometry && !object.geometry.userData.sharedGeometry) object.geometry.dispose();
        if (object.material) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((entry) => { if (!entry.userData.sharedMaterial) entry.dispose(); });
        }
      });
    }
  }

  updateHazards(state) {
    const time = state.elapsed;
    for (const record of this.hazards) {
      const { hazard, group, mesh, index } = record;
      if ((state.hazardRespawns?.[index] || 0) > state.elapsed) {
        group.visible = false;
        continue;
      }
      group.visible = true;
      const position = getHazardWorldPosition(this.level, hazard, time);
      if (hazard.kind === 'rotating-bar') {
        group.position.set((position.x - 500) * WORLD_SCALE, 1.15, position.y * WORLD_SCALE);
        mesh.rotation.y = -((hazard.angle || 0) + time * hazard.spinSpeed);
       } else if (hazard.kind === 'swinging-hammer') {
        // The head sits exactly at the physics hit position; the arm stretches from the head back to the bank anchor.
        const headPos = toWorld(position.x, position.y);
        headPos.y = 0;
        group.position.copy(headPos);
        const pivotX = (riverCenter(this.level, hazard.y) - this.level.riverWidth / 2 + 1 - 500) * WORLD_SCALE;
        const pivotZ = hazard.y * WORLD_SCALE;
        const dx = headPos.x - pivotX;
        const dz = headPos.z - pivotZ;
        mesh.rotation.y = Math.atan2(-dx, -dz);
        const arm = mesh.children[0];
        arm.scale.z = Math.max(0.1, Math.hypot(dx, dz));
        arm.position.z = arm.scale.z / 2;
      } else if (['gate', 'moving-spike-wall', 'swinging-door'].includes(hazard.kind)) {
        group.position.set((riverCenter(this.level, hazard.y) - 500) * WORLD_SCALE, 0, hazard.y * WORLD_SCALE);
        const panels = getHazardPolygons(this.level, hazard, time);
        mesh.visible = panels.length > 0;
        panels.forEach((polygon, panelIndex) => {
          const child = mesh.children[panelIndex];
          const xs = polygon.map((point) => point.x);
          const center = (Math.min(...xs) + Math.max(...xs)) / 2;
          const width = Math.max(0.1, Math.max(...xs) - Math.min(...xs)) * WORLD_SCALE;
          child.position.x = (center - riverCenter(this.level, hazard.y)) * WORLD_SCALE;
          child.scale.x = width;
        });
      } else {
        group.position.set((position.x - 500) * WORLD_SCALE, hazard.kind === 'rapid' ? -0.06 : 0, position.y * WORLD_SCALE);
        if (hazard.kind === 'whirlpool') mesh.rotation.y = time * 1.3;
        if (hazard.kind === 'mine' || hazard.kind.includes('spike')) mesh.rotation.y = time * 0.35;
      }
    }
  }

  emit(type, playerId = 0, count = 12, raftState = null) {
    const isFart = type === 'fart';
    const seat = isFart && raftState ? getSeatPose(raftState, playerId) : null;
    const direction = seat?.direction || { x: 0, y: -1 };
    const outwardX = -direction.x;
    const outwardZ = -direction.y;
    const originX = seat ? (seat.position.x - 500) * WORLD_SCALE : this.raftGroup.position.x;
    const originZ = seat ? seat.position.y * WORLD_SCALE : this.raftGroup.position.z;
    for (let index = 0; index < count; index += 1) {
      this.particles.push({
        type,
        playerId,
        x: originX + outwardX * 0.25 + (Math.random() - 0.5) * 0.12,
        y: this.raftGroup.position.y + 0.8,
        z: originZ + outwardZ * 0.25 + (Math.random() - 0.5) * 0.12,
        vx: outwardX * (isFart ? 1.8 : 0) + (Math.random() - 0.5) * 0.7,
        vy: isFart ? 0.8 + Math.random() * 1.2 : 0.5 + Math.random() * 2,
        vz: outwardZ * (isFart ? 1.8 : 0) + (Math.random() - 0.5) * 0.7,
        life: isFart ? 0.85 + Math.random() * 0.2 : 0.45 + Math.random() * 0.5,
        maxLife: isFart ? 1 : 0.95,
        size: isFart ? 0.18 + Math.random() * 0.18 : 0.12 + Math.random() * 0.22,
      });
    }
    if (this.particles.length > 500) this.particles.splice(0, this.particles.length - 500);
  }

  updateParticles(dt) {
    this.particles = this.particles.filter((particle) => particle.life > 0);
    while (this.particleMeshes.length < this.particles.length) {
      const material = new THREE.MeshBasicMaterial({ color: '#72d94f', transparent: true, opacity: 0.82, depthWrite: false });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 6, 5), material);
      this.scene.add(mesh);
      this.particleMeshes.push(mesh);
    }
    for (let index = 0; index < this.particleMeshes.length; index += 1) {
      const mesh = this.particleMeshes[index];
      const particle = this.particles[index];
      if (!particle) { mesh.visible = false; continue; }
      mesh.visible = true;
      particle.life -= dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.z += particle.vz * dt;
      particle.vy -= 1.2 * dt;
      const growth = particle.type === 'fart' ? 0.55 + (1 - particle.life / particle.maxLife) * 1.25 : 1;
      mesh.position.set(particle.x, particle.y, particle.z);
      mesh.scale.setScalar(particle.size * growth);
      mesh.material.color.set(particle.type === 'fart' ? '#72d94f' : '#cce9c8');
      mesh.material.opacity = Math.max(0, particle.life / particle.maxLife) * 0.78;
    }
  }

  updateHippos(state) {
    for (let playerId = 0; playerId < this.hippos.length; playerId += 1) {
      const hippo = this.hippos[playerId];
      const seat = getSeatPose({ x: 0, y: 0, angle: 0 }, playerId);
      const burst = state.bursts?.find((item) => item.playerId === playerId && item.age < item.duration);
      const pulse = Math.sin(state.elapsed * 2.4 + playerId) * 0.035;
      hippo.position.set(seat.offset.x * WORLD_SCALE, 0.12 + pulse, seat.offset.y * WORLD_SCALE);
      hippo.rotation.y = Math.atan2(seat.direction.x, seat.direction.y);
      const squash = burst ? 1 + Math.sin((burst.age / burst.duration) * Math.PI) * 0.18 : 1;
      hippo.scale.set(1 / squash, squash, 1 / squash);
    }
  }

  updateCamera(state, dt, boostActive) {
    const raft = this.raftGroup.position;
    const speed = Math.hypot(state.raft.vx, state.raft.vy);
    const portrait = THREE.MathUtils.clamp((0.86 - this.camera.aspect) / 0.42, 0, 1);
    const ahead = Math.min(5, speed * 0.08);
    const targetFov = 58 + portrait * 9 + Math.min(13, speed / CONFIG.maxSpeed * 13) + (boostActive ? 4 : 0);
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 3);
    this.camera.updateProjectionMatrix();
    if (this.settings.partyCamera) {
      this.camera.up.set(0, 0, -1);
      this.cameraPosition.set(raft.x, raft.y + 45, raft.z + ahead);
      this.cameraLook.set(raft.x, 0, raft.z + ahead);
    } else {
      this.camera.up.set(0, 1, 0);
      this.cameraPosition.set(raft.x, raft.y + 8.4 + portrait * 2.5, raft.z - 15.5 - portrait * 6 + ahead);
      this.cameraLook.set(raft.x + state.raft.vx * 0.02, raft.y + 0.8, raft.z + 2.2 + ahead);
    }
    const alpha = 1 - Math.exp(-4.5 * dt);
    if (this.cameraPosition.lengthSq() === 0) this.camera.position.copy(this.cameraPosition);
    else this.camera.position.lerp(this.cameraPosition, alpha);
    this.camera.lookAt(this.cameraLook);
    if (this.settings.screenShake && state.shake > 0) {
      const shake = state.shake * 0.14;
      this.camera.position.x += (Math.random() - 0.5) * shake;
      this.camera.position.y += (Math.random() - 0.5) * shake;
    }
  }

  updateDebug(state, level, fps, enabled) {
    if (!this.debugElement) return;
    this.debugElement.hidden = !enabled;
    this.clearGroup(this.debugGroup);
    if (!enabled) return;
    const speed = Math.hypot(state.raft.vx, state.raft.vy);
    this.debugElement.textContent = `FPS ${fps} | SPEED ${speed.toFixed(1)} | SPIN ${state.raft.angularVelocity.toFixed(2)} | FLOW ${state.flowVelocity?.x.toFixed(1) || '0'}, ${(state.flowVelocity?.y || 0).toFixed(1)}`;
    const origin = this.raftGroup.position.clone();
    origin.y += 0.9;
    const addArrow = (x, z, color, multiplier = 1) => {
      const direction = new THREE.Vector3(x, 0, z);
      const length = direction.length();
      if (length < 1e-4) return;
      direction.normalize();
      this.debugGroup.add(new THREE.ArrowHelper(direction, origin, Math.min(9, length * multiplier), color, 0.55, 0.35));
    };
    addArrow(state.raft.vx, state.raft.vy, '#ffe75b', 0.06);
    for (const force of state.lastFartForces || []) addArrow(force.force.x, force.force.y, PLAYERS[force.playerId].color, 0.035);
    if (state.flowVelocity) addArrow(state.flowVelocity.x, state.flowVelocity.y, '#7ff5db', 0.08);
    if (state.lastCollision?.normal) addArrow(state.lastCollision.normal.x, state.lastCollision.normal.y, '#ff5b58', 2.4);
    for (let offset = -2; offset <= 2; offset += 1) {
      const y = state.raft.y + offset * 100;
      const x = riverCenter(level, y);
      const position = toWorld(x, y);
      this.debugGroup.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), position, 1.2, '#86f2d0', 0.25, 0.18));
    }
  }

  draw(state, level, timestamp, options = {}) {
    if (!this.planarBody || !state || !level) return;
    if (this.currentLevelId !== level.id) this.buildCourse(level);
    const dt = this.previousTimestamp === null ? 1 / 60 : Math.min(0.05, (timestamp - this.previousTimestamp) / 1000);
    this.previousTimestamp = timestamp;
    const pose = this.planarBody.syncFromPlanar(state.raft, Math.max(1 / 120, dt));
    this.raftGroup.position.set((pose.x - 500) * WORLD_SCALE, 0.38 + Math.sin(timestamp * 0.0024) * 0.08, pose.y * WORLD_SCALE);
    this.raftGroup.rotation.y = -pose.angle;
    this.updateHippos(state);
    this.updateHazards(state);
    // Drive fart particles from state.bursts so all players (including remote + bots) get particles.
    // Also fire the fart sound once per burst via seenBurstKeys.
    const _worldPos = new THREE.Vector3();
    const activeBurstKeys = new Set();
    for (const burst of state.bursts || []) {
      if (burst.age >= burst.duration) continue;
      // Key = playerId + burst start time (age rounds back to ~0 at creation)
      const key = `${burst.playerId}:${(burst.duration - burst.age).toFixed(3)}`;
      activeBurstKeys.add(key);
      const hippo = this.hippos[burst.playerId];
      if (hippo) {
        hippo.getWorldPosition(_worldPos);
        // Emit a small trickle of particles each frame while the burst is active
        const seatAngle = pose.angle + ([-Math.PI / 2, 0, Math.PI / 2, Math.PI][burst.playerId] ?? 0);
        const outX = Math.cos(seatAngle);
        const outZ = Math.sin(seatAngle);
        for (let p = 0; p < 2; p += 1) {
          this.particles.push({
            type: 'fart',
            playerId: burst.playerId,
            x: _worldPos.x + outX * 0.25 + (Math.random() - 0.5) * 0.12,
            y: _worldPos.y + 0.8,
            z: _worldPos.z + outZ * 0.25 + (Math.random() - 0.5) * 0.12,
            vx: outX * 1.8 + (Math.random() - 0.5) * 0.7,
            vy: 0.8 + Math.random() * 1.2,
            vz: outZ * 1.8 + (Math.random() - 0.5) * 0.7,
            life: 0.85 + Math.random() * 0.2,
            maxLife: 1,
            size: 0.18 + Math.random() * 0.18,
          });
        }
      }
    }
    // Clean up burst keys that are no longer active
    for (const key of this.seenBurstKeys) { if (!activeBurstKeys.has(key)) this.seenBurstKeys.delete(key); }
    if (this.particles.length > 500) this.particles.splice(0, this.particles.length - 500);
    this.updateDebug(state, level, options.fps || 0, options.debug);
    const water = this.courseGroup.children.find((child) => child.userData.waterMaterial)?.userData.waterMaterial;
    if (water) water.uniforms.uTime.value = timestamp / 1000;
    this.updateParticles(dt);
    this.updateCamera(state, dt, state.boostActive);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.resizeObserver?.disconnect();
    this.planarBody?.dispose();
    this.renderer.dispose();
    this.clearGroup(this.courseGroup);
    this.clearGroup(this.worldGroup);
  }
}
