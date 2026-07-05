/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { useAppContext } from '../context/AppContext';

// Types for the Combat System
interface Enemy {
  id: string;
  pos: [number, number, number]; // World space X, Y, Z
  rot: [number, number, number]; // Orbit/spin rotation
  type: 'scout' | 'interceptor' | 'leviathan';
  health: number;
  maxHealth: number;
  size: number;
  color: string;
  speed: number;
  behaviorTimer: number;
  phase: number;
  lastShotTime: number;
}

interface Laser {
  id: string;
  pos: [number, number, number]; // World space X, Y, Z
  dir: [number, number, number]; // Normalized forward direction
  speed: number;
  isEnemy: boolean;
  color: string;
  size: number;
  life: number; // decreases over time
}

interface Particle {
  id: string;
  pos: [number, number, number];
  vel: [number, number, number];
  color: string;
  size: number;
  life: number;
  maxLife: number;
}

interface DamageText {
  id: string;
  text: string;
  pos: [number, number, number];
  color: string;
  life: number;
  maxLife: number;
}

// 3D Geometry Models for Vector Enemies
const SCOUT_VERTICES: [number, number, number][] = [
  [0, 0, 1.4],     // 0: Nose front
  [0, 0, -1.0],    // 1: Tail back
  [-1.2, -0.2, -0.4], // 2: Wing Left
  [1.2, -0.2, -0.4],  // 3: Wing Right
  [0, 0.6, -0.6],   // 4: Top Fin
  [-0.4, 0, 0],    // 5: Body Left
  [0.4, 0, 0],     // 6: Body Right
];

const SCOUT_FACES: number[][] = [
  [0, 5, 4], [0, 4, 6], // Top nose faces
  [5, 1, 4], [6, 4, 1], // Top tail faces
  [0, 2, 5], [0, 6, 3], // Wing front flaps
  [2, 1, 5], [3, 6, 1], // Wing back flaps
  [0, 5, 2], [0, 3, 6], // Under belly front
  [1, 2, 5], [1, 6, 3], // Under belly back
];

const INTERCEPTOR_VERTICES: [number, number, number][] = [
  [0, 0, 2.0],        // 0: Long sleek nose
  [0, -0.1, -1.2],     // 1: Engine nozzle
  [-1.8, -0.1, 0.6],   // 2: Swept forward wing tip L
  [1.8, -0.1, 0.6],    // 3: Swept forward wing tip R
  [-0.6, 0.1, -0.4],   // 4: Wing connection L
  [0.6, 0.1, -0.4],    // 5: Wing connection R
  [0, 0.5, -0.2],      // 6: Cockpit canopy top
  [0, -0.3, 0],        // 7: Ventral stabilizing fin
];

const INTERCEPTOR_FACES: number[][] = [
  [0, 6, 4], [0, 5, 6], // Cockpit slopes
  [6, 1, 4], [6, 5, 1], // Spine slants
  [0, 4, 2], [0, 3, 5], // Wing sweeps
  [4, 1, 2], [5, 3, 1], // Wing trailings
  [0, 7, 4], [0, 5, 7], // Ventral structures
  [7, 1, 4], [7, 5, 1], // Keel lines
];

const LEVIATHAN_VERTICES: [number, number, number][] = [
  [0, 0, 3.5],        // 0: Heavy nose core
  [-1.5, 1.2, 1.5],   // 1: Top port ridge
  [1.5, 1.2, 1.5],    // 2: Top starboard ridge
  [-1.5, -1.2, 1.5],  // 3: Bottom port ridge
  [1.5, -1.2, 1.5],   // 4: Bottom starboard ridge
  [-2.2, 0, -1.5],    // 5: Port outrigger stabilizer
  [2.2, 0, -1.5],     // 6: Starboard outrigger stabilizer
  [0, 0.8, -2.5],     // 7: Command tower deck
  [0, -0.8, -2.5],    // 8: Lower reactor core
];

const LEVIATHAN_FACES: number[][] = [
  [0, 1, 2], [0, 2, 4], [0, 4, 3], [0, 3, 1], // Front shield plating
  [1, 5, 7], [2, 7, 6], [3, 8, 5], [4, 6, 8], // Armored flanks
  [5, 1, 7], [6, 7, 2], [5, 8, 3], [6, 4, 8], // Structural braces
  [7, 5, 8], [7, 8, 6], // Back bulkhead
];

// Helper to rotate a 3D coordinate vector
function rotate3D(p: [number, number, number], rx: number, ry: number, rz: number): [number, number, number] {
  let [x, y, z] = p;
  // Rotate Z (roll)
  if (rz !== 0) {
    const c = Math.cos(rz), s = Math.sin(rz);
    const tx = x * c - y * s;
    const ty = x * s + y * c;
    x = tx; y = ty;
  }
  // Rotate X (pitch)
  if (rx !== 0) {
    const c = Math.cos(rx), s = Math.sin(rx);
    const ty = y * c - z * s;
    const tz = y * s + z * c;
    y = ty; z = tz;
  }
  // Rotate Y (yaw)
  if (ry !== 0) {
    const c = Math.cos(ry), s = Math.sin(ry);
    const tx = x * c + z * s;
    const tz = -x * s + z * c;
    x = tx; z = tz;
  }
  return [x, y, z];
}

export const CombatOverlay: React.FC = () => {
  const { cameraRef, soundConfig, currentSessionId, viewMode } = useAppContext();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // High performance game state refs
  const enemiesRef = useRef<Enemy[]>([]);
  const lasersRef = useRef<Laser[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const damageTextsRef = useRef<DamageText[]>([]);
  const nextEnemyIdRef = useRef<number>(1);
  const nextLaserIdRef = useRef<number>(1);

  // Score & Health stats
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(() => {
    try {
      return Number(localStorage.getItem('craftwarz_highscore') || '2500');
    } catch {
      return 2500;
    }
  });
  const [playerShield, setPlayerShield] = useState(100);
  const [playerArmor, setPlayerArmor] = useState(100);
  const [comboMultiplier, setComboMultiplier] = useState(1);
  const [comboTimer, setComboTimer] = useState(0);
  const [flashScreen, setFlashScreen] = useState<'red' | 'white' | 'none'>('none');
  const [isGameOver, setIsGameOver] = useState(false);
  const [isGameStarted, setIsGameStarted] = useState(false);

  // Stable references for scoring and sound triggering inside animation loop
  const scoreRef = useRef(0);
  const multiplierRef = useRef(1);
  const playerShieldRef = useRef(100);
  const playerArmorRef = useRef(100);
  const lastShootTimeRef = useRef(0);

  // --- AUDIO SYNTH EFFECTS ---
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);

  const initLocalAudio = () => {
    if (audioCtxRef.current) return;
    const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtxClass) return;
    const ctx = new AudioCtxClass();
    audioCtxRef.current = ctx;
    const gain = ctx.createGain();
    gain.gain.value = soundConfig.masterVolume * 0.7; // slightly softer to blend nicely
    gain.connect(ctx.destination);
    masterGainRef.ref = gain; // Wait, ref is standard property on refs, let's assign directly to .current
    masterGainRef.current = gain;
  };

  const playLocalSynth = (type: 'laser' | 'enemy_laser' | 'hit' | 'explosion' | 'shield_down') => {
    if (!soundConfig.enabled) return;
    try {
      // Re-use host context if available, or fall back to local context
      const ctx = (window as any).AudioContext ? (audioCtxRef.current || new ((window as any).AudioContext)()) : null;
      if (!ctx) return;
      if (!audioCtxRef.current) {
        audioCtxRef.current = ctx;
        const gain = ctx.createGain();
        gain.gain.value = soundConfig.masterVolume * 0.6;
        gain.connect(ctx.destination);
        masterGainRef.current = gain;
      }

      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const now = ctx.currentTime;
      const master = masterGainRef.current || ctx.destination;

      if (type === 'laser') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(650, now);
        osc.frequency.exponentialRampToValueAtTime(80, now + 0.12);
        
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        
        osc.connect(gain);
        gain.connect(master);
        osc.start(now);
        osc.stop(now + 0.13);
      } else if (type === 'enemy_laser') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.exponentialRampToValueAtTime(60, now + 0.2);
        
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        
        osc.connect(gain);
        gain.connect(master);
        osc.start(now);
        osc.stop(now + 0.21);
      } else if (type === 'hit') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.setValueAtTime(280, now + 0.02);
        
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        
        osc.connect(gain);
        gain.connect(master);
        osc.start(now);
        osc.stop(now + 0.06);
      } else if (type === 'explosion') {
        const osc = ctx.createOscillator();
        const noiseFilter = ctx.createBiquadFilter();
        const noiseGain = ctx.createGain();
        
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(100, now);
        osc.frequency.exponentialRampToValueAtTime(20, now + 0.4);

        noiseFilter.type = 'lowpass';
        noiseFilter.frequency.setValueAtTime(250, now);
        noiseFilter.frequency.exponentialRampToValueAtTime(30, now + 0.45);

        noiseGain.gain.setValueAtTime(0.35, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

        // Procedural white noise buffer
        const bufferSize = ctx.sampleRate * 0.5;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = Math.random() * 2 - 1;
        }
        const noiseNode = ctx.createBufferSource();
        noiseNode.buffer = buffer;

        noiseNode.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(master);

        const oscGain = ctx.createGain();
        oscGain.gain.setValueAtTime(0.2, now);
        oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
        osc.connect(oscGain);
        oscGain.connect(master);

        osc.start(now);
        noiseNode.start(now);
        osc.stop(now + 0.5);
        noiseNode.stop(now + 0.5);
      } else if (type === 'shield_down') {
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.type = 'sawtooth';
        osc2.type = 'sine';
        osc1.frequency.setValueAtTime(220, now);
        osc1.frequency.linearRampToValueAtTime(110, now + 0.3);
        osc2.frequency.setValueAtTime(225, now);
        osc2.frequency.linearRampToValueAtTime(112, now + 0.3);

        gain.gain.setValueAtTime(0.25, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.35);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(master);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 0.4);
        osc2.stop(now + 0.4);
      }
    } catch (err) {
      console.warn("Local synth fail", err);
    }
  };

  // --- CONTROLS: Player Shooting ---
  const firePlayerLasers = () => {
    if (isGameOver || !isGameStarted) return;
    const now = performance.now();
    if (now - lastShootTimeRef.current < 160) return; // rate limit: ~6 shots per sec
    lastShootTimeRef.current = now;

    const cam = cameraRef.current;
    const pitch = cam.rotation[0];
    const yaw = cam.rotation[1];
    const roll = cam.roll || 0;

    // Calculate normalized forward vector
    // Standard pitch/yaw conversion based on useAppStore math
    // Remember: pitch > 0 is looking/tilting DOWN in this shader setup, so dirY is inverted
    const dirX = Math.sin(yaw) * Math.cos(pitch - 0.1);
    const dirY = -Math.sin(pitch - 0.1);
    const dirZ = Math.cos(yaw) * Math.cos(pitch - 0.1);

    // Normalize forward vector
    const len = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ);
    const fwdX = dirX / len;
    const fwdY = dirY / len;
    const fwdZ = dirZ / len;

    // Calculate right vector to offset lasers from wing tips
    const rightX = Math.cos(yaw);
    const rightY = 0;
    const rightZ = -Math.sin(yaw);

    // Left and Right wingtip spawn positions
    const wingSpread = 1.4;
    const spawnL: [number, number, number] = [
      cam.position[0] + rightX * -wingSpread + fwdX * 2.0,
      cam.position[1] + rightY * -wingSpread + fwdY * 2.0,
      cam.position[2] + rightZ * -wingSpread + fwdZ * 2.0,
    ];
    const spawnR: [number, number, number] = [
      cam.position[0] + rightX * wingSpread + fwdX * 2.0,
      cam.position[1] + rightY * wingSpread + fwdY * 2.0,
      cam.position[2] + rightZ * wingSpread + fwdZ * 2.0,
    ];

    const speed = 120.0; // very fast laser bolts
    const idL = `pl-${nextLaserIdRef.current++}`;
    const idR = `pl-${nextLaserIdRef.current++}`;

    lasersRef.current.push(
      {
        id: idL,
        pos: spawnL,
        dir: [fwdX, fwdY, fwdZ],
        speed,
        isEnemy: false,
        color: '#ff2255', // Bright red neon
        size: 0.8,
        life: 1.5,
      },
      {
        id: idR,
        pos: spawnR,
        dir: [fwdX, fwdY, fwdZ],
        speed,
        isEnemy: false,
        color: '#ff2255',
        size: 0.8,
        life: 1.5,
      }
    );

    playLocalSynth('laser');
  };

  // Listen to keyboard event specifically for fire actions
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches('input, textarea, select')) return;
      if (e.key.toLowerCase() === 'f' || e.key === 'Enter') {
        firePlayerLasers();
      }
    };
    
    // Listen to our custom event dispatched by touch controls!
    const handleTouchFire = () => {
      firePlayerLasers();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('fire-lasers', handleTouchFire);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('fire-lasers', handleTouchFire);
    };
  }, [isGameStarted, isGameOver]);

  // Restart Game Handler
  const handleStartOrRestart = () => {
    initLocalAudio();
    enemiesRef.current = [];
    lasersRef.current = [];
    particlesRef.current = [];
    damageTextsRef.current = [];
    setScore(0);
    scoreRef.current = 0;
    setComboMultiplier(1);
    multiplierRef.current = 1;
    setPlayerShield(100);
    playerShieldRef.current = 100;
    setPlayerArmor(100);
    playerArmorRef.current = 100;
    setIsGameOver(false);
    setIsGameStarted(true);

    // Initial spawn
    spawnProceduralEnemy(true);
    spawnProceduralEnemy(true);
  };

  // Spawns an enemy procedurally around the player, facing them
  const spawnProceduralEnemy = (forceClose = false) => {
    const cam = cameraRef.current;
    const pitch = cam.rotation[0];
    const yaw = cam.rotation[1];

    // Compute player forward vector
    const dirX = Math.sin(yaw) * Math.cos(pitch - 0.1);
    const dirY = -Math.sin(pitch - 0.1);
    const dirZ = Math.cos(yaw) * Math.cos(pitch - 0.1);

    const len = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ);
    const fwdX = dirX / len;
    const fwdY = dirY / len;
    const fwdZ = dirZ / len;

    // Distance to spawn: between 35 and 75 units ahead (close enough to see and fight)
    const distance = forceClose ? (25 + Math.random() * 15) : (45 + Math.random() * 40);

    // Random conical offsets around the forward vector so they spread out nicely
    const spread = 12.0;
    const randOffset: [number, number, number] = [
      (Math.random() - 0.5) * spread,
      (Math.random() - 0.5) * spread - 1.0, // slight drop to align with scenery
      (Math.random() - 0.5) * spread,
    ];

    const worldPos: [number, number, number] = [
      cam.position[0] + fwdX * distance + randOffset[0],
      cam.position[1] + fwdY * distance + randOffset[1],
      cam.position[2] + fwdZ * distance + randOffset[2],
    ];

    // Pick enemy class procedurally
    const randType = Math.random();
    let type: 'scout' | 'interceptor' | 'leviathan' = 'scout';
    let health = 40;
    let size = 1.0;
    let color = '#00ffff'; // Neon cyan scout
    let speed = 10 + Math.random() * 8;

    if (randType > 0.85) {
      type = 'leviathan';
      health = 150;
      size = 2.4;
      color = '#e033ff'; // Neon heavy purple boss
      speed = 4 + Math.random() * 3;
    } else if (randType > 0.5) {
      type = 'interceptor';
      health = 75;
      size = 1.4;
      color = '#ffaa00'; // Neon orange fast attack jet
      speed = 18 + Math.random() * 10;
    }

    enemiesRef.current.push({
      id: `en-${nextEnemyIdRef.current++}`,
      pos: worldPos,
      rot: [Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI],
      type,
      health,
      maxHealth: health,
      size,
      color,
      speed,
      behaviorTimer: 0,
      phase: Math.random() * Math.PI * 2,
      lastShotTime: 0,
    });
  };

  // Explode enemy in 3D
  const triggerExplosion = (pos: [number, number, number], enemyColor: string, isBig = false) => {
    playLocalSynth('explosion');
    
    // Spawn glowing debris particle shockwaves
    const count = isBig ? 60 : 30;
    for (let i = 0; i < count; i++) {
      const angle1 = Math.random() * Math.PI * 2;
      const angle2 = Math.random() * Math.PI;
      const speedVal = (isBig ? 15 : 8) * (0.3 + Math.random() * 1.2);
      
      const vel: [number, number, number] = [
        Math.sin(angle2) * Math.cos(angle1) * speedVal,
        Math.sin(angle2) * Math.sin(angle1) * speedVal,
        Math.cos(angle2) * speedVal,
      ];

      particlesRef.current.push({
        id: `p-${Math.random()}`,
        pos: [pos[0], pos[1], pos[2]],
        vel,
        color: Math.random() > 0.5 ? enemyColor : '#ff5522', // mix enemy core and flame colors
        size: 0.15 + Math.random() * 0.25,
        life: 0.6 + Math.random() * 0.8,
        maxLife: 1.5,
      });
    }

    // Floating text feedback in 3D
    const scoreVal = isBig ? 250 : 100;
    const newMult = Math.min(5, multiplierRef.current + 1);
    multiplierRef.current = newMult;
    setComboMultiplier(newMult);
    setComboTimer(5.0); // 5 seconds combo window

    const addedScore = scoreVal * newMult;
    scoreRef.current += addedScore;
    setScore(scoreRef.current);

    damageTextsRef.current.push({
      id: `txt-${Math.random()}`,
      text: `+${addedScore} PTS`,
      pos: [pos[0], pos[1] + 2.0, pos[2]],
      color: '#00ffaa',
      life: 1.0,
      maxLife: 1.0,
    });
  };

  // Main game logic loop
  useEffect(() => {
    let animId = 0;
    let lastTime = performance.now();

    const loop = (timestamp: number) => {
      const dt = Math.min((timestamp - lastTime) / 1000.0, 0.1);
      lastTime = timestamp;

      const canvas = canvasRef.current;
      if (!canvas) {
        animId = requestAnimationFrame(loop);
        return;
      }

      // Sync canvas dimensions
      if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        animId = requestAnimationFrame(loop);
        return;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Grab shared player details
      const cam = cameraRef.current;
      const playerPos = cam.position;
      const playerRot = cam.rotation; // [pitch, yaw]
      const playerRoll = cam.roll || 0;

      const width = canvas.width;
      const height = canvas.height;
      const cx = width / 2;
      const cy = height / 2;
      const fovFactor = Math.min(width, height) * 0.8;

      // Combo depletion
      if (isGameStarted && !isGameOver) {
        setComboTimer(prev => {
          if (prev <= 0) {
            if (multiplierRef.current > 1) {
              multiplierRef.current = 1;
              setComboMultiplier(1);
            }
            return 0;
          }
          return Math.max(0, prev - dt);
        });
      }

      // --- 1. SPENDING SPAWN LOGIC ---
      if (isGameStarted && !isGameOver && enemiesRef.current.length < 4) {
        // Proc spawn
        if (Math.random() < 0.02) {
          spawnProceduralEnemy();
        }
      }

      // --- 2. UPDATE LASERS ---
      const activeLasers = lasersRef.current;
      for (let i = activeLasers.length - 1; i >= 0; i--) {
        const laser = activeLasers[i];
        laser.pos[0] += laser.dir[0] * laser.speed * dt;
        laser.pos[1] += laser.dir[1] * laser.speed * dt;
        laser.pos[2] += laser.dir[2] * laser.speed * dt;
        laser.life -= dt;

        // Collision: Laser with Player (if enemy laser)
        if (laser.isEnemy && !isGameOver && isGameStarted) {
          const dx = laser.pos[0] - playerPos[0];
          const dy = laser.pos[1] - playerPos[1];
          const dz = laser.pos[2] - playerPos[2];
          const distToPlayer = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (distToPlayer < 4.0) {
            // Hit player!
            laser.life = -1; // remove
            triggerScreenFlash('red');
            playLocalSynth('shield_down');
            
            // Damage calculation
            if (playerShieldRef.current > 0) {
              const nextShield = Math.max(0, playerShieldRef.current - 15);
              playerShieldRef.current = nextShield;
              setPlayerShield(nextShield);
            } else {
              const nextArmor = Math.max(0, playerArmorRef.current - 20);
              playerArmorRef.current = nextArmor;
              setPlayerArmor(nextArmor);
              if (nextArmor <= 0) {
                // Game Over!
                setIsGameOver(true);
                playLocalSynth('explosion');
                // Highscore check
                if (scoreRef.current > highScore) {
                  setHighScore(scoreRef.current);
                  try {
                    localStorage.setItem('craftwarz_highscore', String(scoreRef.current));
                  } catch {}
                }
              }
            }
          }
        }

        // Delete expired lasers
        if (laser.life <= 0) {
          activeLasers.splice(i, 1);
        }
      }

      // --- 3. UPDATE PARTICLES ---
      const activeParticles = particlesRef.current;
      for (let i = activeParticles.length - 1; i >= 0; i--) {
        const p = activeParticles[i];
        p.pos[0] += p.vel[0] * dt;
        p.pos[1] += p.vel[1] * dt;
        p.pos[2] += p.vel[2] * dt;
        p.life -= dt;

        if (p.life <= 0) {
          activeParticles.splice(i, 1);
        }
      }

      // --- 4. UPDATE DAMAGE TEXTS ---
      const activeTexts = damageTextsRef.current;
      for (let i = activeTexts.length - 1; i >= 0; i--) {
        const t = activeTexts[i];
        t.pos[1] += 2.5 * dt; // Float up
        t.life -= dt;

        if (t.life <= 0) {
          activeTexts.splice(i, 1);
        }
      }

      // --- 5. UPDATE & DRAW ENEMIES ---
      const activeEnemies = enemiesRef.current;
      for (let i = activeEnemies.length - 1; i >= 0; i--) {
        const enemy = activeEnemies[i];

        // Advanced 3D Flying AI Behavior
        enemy.behaviorTimer += dt;
        enemy.rot[0] += 1.5 * dt; // Rotate vector structures
        enemy.rot[1] += 1.0 * dt;
        enemy.rot[2] += 0.5 * dt;

        // Vector math to player:
        const toPlayerX = playerPos[0] - enemy.pos[0];
        const toPlayerY = playerPos[1] - enemy.pos[1];
        const toPlayerZ = playerPos[2] - enemy.pos[2];
        const distToPlayer = Math.sqrt(toPlayerX * toPlayerX + toPlayerY * toPlayerY + toPlayerZ * toPlayerZ);

        // Movement behavior:
        if (enemy.type === 'interceptor') {
          // Swift hit and run. Charges straight, then spirals away
          const chargePhase = Math.sin(enemy.behaviorTimer * 1.5);
          if (chargePhase > -0.2 && distToPlayer > 15.0) {
            // Move toward player
            enemy.pos[0] += (toPlayerX / distToPlayer) * enemy.speed * dt;
            enemy.pos[1] += (toPlayerY / distToPlayer) * enemy.speed * dt;
            enemy.pos[2] += (toPlayerZ / distToPlayer) * enemy.speed * dt;
          } else {
            // Spiral dodge maneuver
            const circleX = Math.cos(enemy.behaviorTimer * 4) * 15;
            const circleY = Math.sin(enemy.behaviorTimer * 4) * 15;
            enemy.pos[0] += (toPlayerX / distToPlayer + circleX * 0.05) * (enemy.speed * 0.4) * dt;
            enemy.pos[1] += (toPlayerY / distToPlayer + circleY * 0.05) * (enemy.speed * 0.4) * dt;
            enemy.pos[2] += (toPlayerZ / distToPlayer) * (enemy.speed * 0.4) * dt;
          }
        } else if (enemy.type === 'scout') {
          // Weave sine-waves horizontally and orbit
          const orbitAngle = enemy.behaviorTimer * 0.5 + enemy.phase;
          const targetOrbitX = playerPos[0] + Math.cos(orbitAngle) * 35.0;
          const targetOrbitZ = playerPos[2] + Math.sin(orbitAngle) * 35.0;
          const targetOrbitY = playerPos[1] + Math.sin(enemy.behaviorTimer * 2.0) * 8.0;

          enemy.pos[0] += (targetOrbitX - enemy.pos[0]) * 1.5 * dt;
          enemy.pos[1] += (targetOrbitY - enemy.pos[1]) * 1.5 * dt;
          enemy.pos[2] += (targetOrbitZ - enemy.pos[2]) * 1.5 * dt;
        } else {
          // Heavy Dreadnought: slowly crawls forward, locking position close in front
          const targetDreadX = playerPos[0] + Math.sin(playerRot[1]) * 45.0;
          const targetDreadZ = playerPos[2] + Math.cos(playerRot[1]) * 45.0;
          const targetDreadY = playerPos[1] - 4.0;

          enemy.pos[0] += (targetDreadX - enemy.pos[0]) * 0.8 * dt;
          enemy.pos[1] += (targetDreadY - enemy.pos[1]) * 0.8 * dt;
          enemy.pos[2] += (targetDreadZ - enemy.pos[2]) * 0.8 * dt;
        }

        // Enemy Shooting AI
        if (isGameStarted && !isGameOver && distToPlayer < 75.0) {
          const shootInterval = enemy.type === 'scout' ? 1.8 : enemy.type === 'interceptor' ? 1.1 : 2.5;
          const nowSec = timestamp / 1000.0;
          if (nowSec - enemy.lastShotTime > shootInterval && Math.random() < 0.6) {
            enemy.lastShotTime = nowSec;
            
            // Aim vector with leading offset
            const aimDirX = toPlayerX / distToPlayer;
            const aimDirY = toPlayerY / distToPlayer;
            const aimDirZ = toPlayerZ / distToPlayer;

            lasersRef.current.push({
              id: `en-las-${nextLaserIdRef.current++}`,
              pos: [enemy.pos[0], enemy.pos[1], enemy.pos[2]],
              dir: [aimDirX, aimDirY, aimDirZ],
              speed: enemy.type === 'interceptor' ? 60.0 : enemy.type === 'leviathan' ? 30.0 : 45.0,
              isEnemy: true,
              color: enemy.type === 'leviathan' ? '#aa33ff' : '#00ff33', // custom colors
              size: enemy.type === 'leviathan' ? 1.6 : 0.7,
              life: 3.0,
            });

            playLocalSynth('enemy_laser');
          }
        }

        // --- Collision Check: Player Lasers striking Enemy ---
        for (let j = activeLasers.length - 1; j >= 0; j--) {
          const laser = activeLasers[j];
          if (!laser.isEnemy) {
            const edx = laser.pos[0] - enemy.pos[0];
            const edy = laser.pos[1] - enemy.pos[1];
            const edz = laser.pos[2] - enemy.pos[2];
            const distHit = Math.sqrt(edx * edx + edy * edy + edz * edz);

            if (distHit < enemy.size * 1.5 + 1.2) {
              // HIT ENEMY!
              activeLasers.splice(j, 1); // delete laser
              enemy.health -= 25; // Laser damage
              playLocalSynth('hit');

              // Create tiny sparks on contact
              for (let k = 0; k < 6; k++) {
                particlesRef.current.push({
                  id: `spk-${Math.random()}`,
                  pos: [laser.pos[0], laser.pos[1], laser.pos[2]],
                  vel: [
                    (Math.random() - 0.5) * 6,
                    (Math.random() - 0.5) * 6,
                    (Math.random() - 0.5) * 6,
                  ],
                  color: '#ffffff',
                  size: 0.1,
                  life: 0.2 + Math.random() * 0.2,
                  maxLife: 0.4,
                });
              }

              // Show floating score damage text
              damageTextsRef.current.push({
                id: `dmg-${Math.random()}`,
                text: '25',
                pos: [enemy.pos[0] + (Math.random() - 0.5) * 2, enemy.pos[1] + enemy.size, enemy.pos[2]],
                color: '#ffaa00',
                life: 0.6,
                maxLife: 0.6,
              });

              if (enemy.health <= 0) {
                // Destroyed!
                triggerExplosion(enemy.pos, enemy.color, enemy.type === 'leviathan');
                activeEnemies.splice(i, 1);
                break; // break laser loop since enemy is dead
              }
            }
          }
        }
      }

      // --- 6. PERSPECTIVE RENDERING 3D PROJECTED GEOMETRY ---

      // Draw active particles in 3D
      particlesRef.current.forEach(p => {
        const dx = p.pos[0] - playerPos[0];
        const dy = p.pos[1] - playerPos[1];
        const dz = p.pos[2] - playerPos[2];

        const cosY = Math.cos(-playerRot[1]);
        const sinY = Math.sin(-playerRot[1]);
        const rx = dx * cosY - dz * sinY;
        const rz_temp = dx * sinY + dz * cosY;

        const cosP = Math.cos(-playerRot[0]);
        const sinP = Math.sin(-playerRot[0]);
        const ry = dy * cosP - rz_temp * sinP;
        const rz = dy * sinP + rz_temp * cosP;

        const cosR = Math.cos(-playerRoll);
        const sinR = Math.sin(-playerRoll);
        const lx = rx * cosR - ry * sinR;
        const ly = rx * sinR + ry * cosR;
        const lz = rz;

        const distFront = -lz;
        if (distFront > 0.2) {
          const sx = cx + (lx / distFront) * fovFactor;
          const sy = cy - (ly / distFront) * fovFactor;
          const sz = (p.size / distFront) * fovFactor;

          if (sx > 0 && sx < width && sy > 0 && sy < height) {
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(sx, sy, Math.max(1, sz), 0, Math.PI * 2);
            ctx.fill();
          }
        }
      });

      // Draw active lasers in 3D
      lasersRef.current.forEach(l => {
        // Draw laser as a projected 3D line from laser pos to laser pos - forward * size
        const p1 = l.pos;
        const p2: [number, number, number] = [
          l.pos[0] - l.dir[0] * 3.5,
          l.pos[1] - l.dir[1] * 3.5,
          l.pos[2] - l.dir[2] * 3.5,
        ];

        // Project p1
        const dx1 = p1[0] - playerPos[0];
        const dy1 = p1[1] - playerPos[1];
        const dz1 = p1[2] - playerPos[2];

        let cosY = Math.cos(-playerRot[1]), sinY = Math.sin(-playerRot[1]);
        let rx1 = dx1 * cosY - dz1 * sinY, rz_temp1 = dx1 * sinY + dz1 * cosY;
        let cosP = Math.cos(-playerRot[0]), sinP = Math.sin(-playerRot[0]);
        let ry1 = dy1 * cosP - rz_temp1 * sinP, rz1 = dy1 * sinP + rz_temp1 * cosP;
        let cosR = Math.cos(-playerRoll), sinR = Math.sin(-playerRoll);
        let lx1 = rx1 * cosR - ry1 * sinR, ly1 = rx1 * sinR + ry1 * cosR, lz1 = rz1;

        // Project p2
        const dx2 = p2[0] - playerPos[0];
        const dy2 = p2[1] - playerPos[1];
        const dz2 = p2[2] - playerPos[2];

        let rx2 = dx2 * cosY - dz2 * sinY, rz_temp2 = dx2 * sinY + dz2 * cosY;
        let ry2 = dy2 * cosP - rz_temp2 * sinP, rz2 = dy2 * sinP + rz_temp2 * cosP;
        let lx2 = rx2 * cosR - ry2 * sinR, ly2 = rx2 * sinR + ry2 * cosR, lz2 = rz2;

        const df1 = -lz1;
        const df2 = -lz2;

        if (df1 > 0.1 && df2 > 0.1) {
          const sx1 = cx + (lx1 / df1) * fovFactor;
          const sy1 = cy - (ly1 / df1) * fovFactor;
          const sx2 = cx + (lx2 / df2) * fovFactor;
          const sy2 = cy - (ly2 / df2) * fovFactor;

          // Draw the neon laser beam line
          ctx.strokeStyle = l.color;
          ctx.lineWidth = Math.max(1, (l.size / df1) * fovFactor);
          ctx.beginPath();
          ctx.moveTo(sx1, sy1);
          ctx.lineTo(sx2, sy2);
          ctx.stroke();
        }
      });

      // Draw active enemies in 3D
      enemiesRef.current.forEach(e => {
        const dx = e.pos[0] - playerPos[0];
        const dy = e.pos[1] - playerPos[1];
        const dz = e.pos[2] - playerPos[2];

        // Transform core position to camera space
        const cosY = Math.cos(-playerRot[1]);
        const sinY = Math.sin(-playerRot[1]);
        const rx = dx * cosY - dz * sinY;
        const rz_temp = dx * sinY + dz * cosY;

        const cosP = Math.cos(-playerRot[0]);
        const sinP = Math.sin(-playerRot[0]);
        const ry = dy * cosP - rz_temp * sinP;
        const rz = dy * sinP + rz_temp * cosP;

        const cosR = Math.cos(-playerRoll);
        const sinR = Math.sin(-playerRoll);
        const lx = rx * cosR - ry * sinR;
        const ly = rx * sinR + ry * cosR;
        const lz = rz;

        const distFront = -lz;
        if (distFront > 0.5) {
          // Screen center of enemy
          const esx = cx + (lx / distFront) * fovFactor;
          const esy = cy - (ly / distFront) * fovFactor;

          // Decide vertices and faces based on enemy type
          let verts = SCOUT_VERTICES;
          let faces = SCOUT_FACES;
          if (e.type === 'interceptor') {
            verts = INTERCEPTOR_VERTICES;
            faces = INTERCEPTOR_FACES;
          } else if (e.type === 'leviathan') {
            verts = LEVIATHAN_VERTICES;
            faces = LEVIATHAN_FACES;
          }

          // Project and rotate all vertices of the enemy model
          const projVerts: [number, number][] = [];
          const inBounds = verts.every(v => {
            // 1. Rotate locally around enemy axis
            const rotV = rotate3D(v, e.rot[0], e.rot[1], e.rot[2]);
            // 2. Scale by enemy size
            const sv: [number, number, number] = [
              rotV[0] * e.size,
              rotV[1] * e.size,
              rotV[2] * e.size,
            ];
            // 3. Add enemy world position
            const wp: [number, number, number] = [
              e.pos[0] + sv[0],
              e.pos[1] + sv[1],
              e.pos[2] + sv[2],
            ];

            // 4. Translate relative to camera and rotate into camera space
            const edx = wp[0] - playerPos[0];
            const edy = wp[1] - playerPos[1];
            const edz = wp[2] - playerPos[2];

            const erx = edx * cosY - edz * sinY;
            const erz_temp = edx * sinY + edz * cosY;
            const ery = edy * cosP - erz_temp * sinP;
            const erz = edy * sinP + erz_temp * cosP;

            const elx = erx * cosR - ery * sinR;
            const ely = erx * sinR + ery * cosR;
            const elz = erz;

            const edistFront = -elz;
            if (edistFront < 0.1) return false;

            const vx = cx + (elx / edistFront) * fovFactor;
            const vy = cy - (ely / edistFront) * fovFactor;
            projVerts.push([vx, vy]);
            return true;
          });

          // Draw the 3D projected faces
          if (inBounds && projVerts.length === verts.length) {
            // Draw vector faces with translucent filling
            ctx.lineWidth = Math.max(1, 1.5 - distFront * 0.01);
            
            faces.forEach(face => {
              ctx.beginPath();
              ctx.moveTo(projVerts[face[0]][0], projVerts[face[0]][1]);
              for (let fIdx = 1; fIdx < face.length; fIdx++) {
                ctx.lineTo(projVerts[face[fIdx]][0], projVerts[face[fIdx]][1]);
              }
              ctx.closePath();

              // Translucent holographic wireframe fills
              ctx.fillStyle = `${e.color}18`; // very translucent
              ctx.fill();

              ctx.strokeStyle = e.color;
              ctx.stroke();
            });

            // Draw floating red HP bar above enemy
            const hpBarW = Math.max(15, (25 / distFront) * fovFactor);
            const hpBarH = 3;
            const hpX = esx - hpBarW / 2;
            const hpY = esy - Math.max(15, (20 / distFront) * fovFactor);

            ctx.fillStyle = '#ff333333';
            ctx.fillRect(hpX, hpY, hpBarW, hpBarH);
            ctx.fillStyle = e.color;
            ctx.fillRect(hpX, hpY, hpBarW * (e.health / e.maxHealth), hpBarH);

            // Red target reticle overlay if looking directly at it
            const targetDist = Math.sqrt((esx - cx) * (esx - cx) + (esy - cy) * (esy - cy));
            if (targetDist < 45.0) {
              ctx.strokeStyle = '#ff3333';
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.arc(esx, esy, Math.max(12, (15 / distFront) * fovFactor), 0, Math.PI * 2);
              ctx.stroke();

              // Crosshairs on the target lock
              ctx.beginPath();
              ctx.moveTo(esx - 4, esy); ctx.lineTo(esx - 8, esy);
              ctx.moveTo(esx + 4, esy); ctx.lineTo(esx + 8, esy);
              ctx.moveTo(esx, esy - 4); ctx.lineTo(esx, esy - 8);
              ctx.moveTo(esx, esy + 4); ctx.lineTo(esx, esy + 8);
              ctx.stroke();

              ctx.fillStyle = '#ff3333';
              ctx.font = '8px monospace';
              ctx.textAlign = 'center';
              ctx.fillText(`${e.type.toUpperCase()} LCK`, esx, hpY - 6);
            }
          }
        }
      });

      // Draw floating damage/text indicators in 3D
      damageTextsRef.current.forEach(t => {
        const dx = t.pos[0] - playerPos[0];
        const dy = t.pos[1] - playerPos[1];
        const dz = t.pos[2] - playerPos[2];

        const cosY = Math.cos(-playerRot[1]);
        const sinY = Math.sin(-playerRot[1]);
        const rx = dx * cosY - dz * sinY;
        const rz_temp = dx * sinY + dz * cosY;

        const cosP = Math.cos(-playerRot[0]);
        const sinP = Math.sin(-playerRot[0]);
        const ry = dy * cosP - rz_temp * sinP;
        const rz = dy * sinP + rz_temp * cosP;

        const cosR = Math.cos(-playerRoll);
        const sinR = Math.sin(-playerRoll);
        const lx = rx * cosR - ry * sinR;
        const ly = rx * sinR + ry * cosR;
        const lz = rz;

        const distFront = -lz;
        if (distFront > 0.5) {
          const sx = cx + (lx / distFront) * fovFactor;
          const sy = cy - (ly / distFront) * fovFactor;

          if (sx > 0 && sx < width && sy > 0 && sy < height) {
            ctx.fillStyle = t.color;
            ctx.font = `bold ${Math.max(10, Math.round((14 / distFront) * fovFactor))}px monospace`;
            ctx.textAlign = 'center';
            ctx.fillText(t.text, sx, sy);
          }
        }
      });

      // Shield warning emergency alerts on UI
      if (playerShieldRef.current <= 30 && isGameStarted && !isGameOver) {
        if (Math.floor(timestamp / 300) % 2 === 0) {
          ctx.strokeStyle = '#ff333388';
          ctx.lineWidth = 4;
          ctx.strokeRect(2, 2, width - 4, height - 4);

          ctx.fillStyle = '#ff2222';
          ctx.font = 'bold 14px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('CRITICAL DAMAGE WARNING', cx, 90);
        }
      }

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [isGameStarted, isGameOver]);

  const triggerScreenFlash = (color: 'red' | 'white') => {
    setFlashScreen(color);
    setTimeout(() => {
      setFlashScreen('none');
    }, 150);
  };

  // Regeneration of shields slowly over time
  useEffect(() => {
    if (!isGameStarted || isGameOver) return;
    const interval = setInterval(() => {
      if (playerShieldRef.current < 100) {
        const next = Math.min(100, playerShieldRef.current + 2);
        playerShieldRef.current = next;
        setPlayerShield(next);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [isGameStarted, isGameOver]);

  return (
    <div className="absolute inset-0 pointer-events-none z-15 select-none overflow-hidden">
      
      {/* 3D Combat Vector Graphics Canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ zIndex: 16 }}
      />

      {/* Screen flash overlays */}
      {flashScreen === 'red' && (
        <div className="absolute inset-0 bg-red-600/30 backdrop-blur-xs transition-opacity duration-150 z-20 pointer-events-none" />
      )}
      {flashScreen === 'white' && (
        <div className="absolute inset-0 bg-white/40 transition-opacity duration-150 z-20 pointer-events-none" />
      )}

      {/* Game GUI & HUD Elements */}
      <div className="absolute inset-x-0 bottom-40 top-16 flex flex-col justify-between p-4 z-20 pointer-events-none">
        
        {/* Top: Score, Highscore, Waves and Multipliers */}
        <div className="flex justify-between items-start w-full pointer-events-auto">
          {/* Left stats */}
          <div className="bg-gray-900/80 backdrop-blur-md border border-cyan-500/30 p-3 rounded-lg text-left flex flex-col gap-1 min-w-[140px] shadow-lg shadow-cyan-950/20">
            <span className="text-[10px] text-cyan-400 font-mono tracking-widest uppercase">CRAFTWARZ HUD</span>
            <div className="flex justify-between font-mono text-sm">
              <span className="text-gray-400">SCORE:</span>
              <span className="text-white font-bold text-cyan-200">{score}</span>
            </div>
            <div className="flex justify-between font-mono text-[11px]">
              <span className="text-gray-500">HI-SCORE:</span>
              <span className="text-gray-300 font-semibold">{highScore}</span>
            </div>
            
            {/* Combo tracker */}
            {comboMultiplier > 1 && (
              <div className="mt-2 pt-1.5 border-t border-cyan-500/20 flex flex-col gap-0.5">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-amber-400 font-bold animate-pulse font-mono">{comboMultiplier}X COMBO</span>
                  <span className="text-[9px] text-amber-500 font-mono font-bold">WAVE SPEED++</span>
                </div>
                {/* Visual duration bar */}
                <div className="w-full h-1 bg-gray-800 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-amber-400" 
                    style={{ width: `${(comboTimer / 5.0) * 100}%`, transition: 'width 100ms linear' }} 
                  />
                </div>
              </div>
            )}
          </div>

          {/* Center Brand Title */}
          <div className="hidden md:flex flex-col items-center bg-black/40 backdrop-blur-sm border border-white/5 py-1 px-4 rounded-full select-none">
            <span className="text-xs font-mono font-black text-transparent bg-clip-text bg-gradient-to-r from-red-500 via-orange-400 to-yellow-300 tracking-[0.2em] uppercase">
              CRAFTWARZ
            </span>
            <span className="text-[7px] text-gray-400 font-mono tracking-widest -mt-0.5 uppercase">
              By the TUCCICYBERNATION
            </span>
          </div>

          {/* Right: Shield & Armor indicators */}
          {isGameStarted && (
            <div className="bg-gray-900/80 backdrop-blur-md border border-red-500/30 p-3 rounded-lg text-left flex flex-col gap-2 min-w-[150px] shadow-lg shadow-red-950/20">
              <span className="text-[10px] text-red-400 font-mono tracking-widest uppercase">SYSTEM SHIELDS</span>
              
              {/* Shield Bar */}
              <div className="flex flex-col gap-1">
                <div className="flex justify-between font-mono text-[10px]">
                  <span className={playerShield < 30 ? 'text-red-400 font-bold animate-pulse' : 'text-cyan-400'}>
                    SHIELDS: {playerShield}%
                  </span>
                </div>
                <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div 
                    className={`h-full ${playerShield < 30 ? 'bg-red-500 animate-pulse' : 'bg-cyan-500'}`}
                    style={{ width: `${playerShield}%`, transition: 'width 200ms ease-out' }} 
                  />
                </div>
              </div>

              {/* Armor Bar */}
              <div className="flex flex-col gap-1">
                <div className="flex justify-between font-mono text-[10px]">
                  <span className={playerArmor < 40 ? 'text-red-500 font-black animate-pulse' : 'text-amber-500'}>
                    ARMOR: {playerArmor}%
                  </span>
                </div>
                <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div 
                    className={`h-full ${playerArmor < 40 ? 'bg-red-600 animate-pulse' : 'bg-amber-500'}`}
                    style={{ width: `${playerArmor}%`, transition: 'width 200ms ease-out' }} 
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Center: Shooting reticle and warning lock overlay */}
        {!isGameOver && isGameStarted && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none select-none">
            {/* Custom 3D tactical combat HUD crosshair */}
            <div className="relative w-16 h-16 flex items-center justify-center">
              <div className="absolute inset-0 border border-cyan-400/20 rounded-full animate-[spin_20s_linear_infinite]" />
              <div className="absolute inset-2 border-2 border-dashed border-cyan-400/35 rounded-full animate-[spin_8s_linear_infinite_reverse]" />
              {/* Outer aiming corners */}
              <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-cyan-300" />
              <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-cyan-300" />
              <div className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-cyan-300" />
              <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-cyan-300" />
              
              {/* Inner tiny dot */}
              <div className="w-1.5 h-1.5 bg-red-500 rounded-full" />
            </div>
            
            {/* Keyboard shortcut help */}
            <div className="absolute mt-24 text-[9px] text-gray-500 font-mono tracking-widest whitespace-nowrap bg-black/40 py-0.5 px-2 rounded-full uppercase">
              CLICK SCREEN or PRESS [F] / [ENTER] TO ATTACK
            </div>
          </div>
        )}

        {/* Dialog state templates */}
        {(!isGameStarted || isGameOver) && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-md z-30 pointer-events-auto p-4 select-text">
            <div className="bg-gray-900 border-2 border-cyan-500/50 p-6 rounded-2xl max-w-sm w-full text-center flex flex-col items-center gap-4 shadow-2xl shadow-cyan-950/40">
              
              {/* Android app icon */}
              <div className="w-16 h-16 bg-gradient-to-br from-cyan-400 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-cyan-500/20 animate-pulse">
                <svg className="w-9 h-9 text-white fill-current" viewBox="0 0 24 24">
                  <path d="M12 2L2 22h20L12 2zm0 3.8L18.4 18H5.6L12 5.8zM12 11c-.6 0-1 .4-1 1v2c0 .6.4 1 1 1s1-.4 1-1v-2c0-.6-.4-1-1-1zm0 5c-.3 0-.5.1-.7.3-.2.2-.3.4-.3.7s.1.5.3.7c.2.2.4.3.7.3s.5-.1.7-.3c.2-.2.3-.4.3-.7s-.1-.5-.3-.7c-.2-.2-.4-.3-.7-.3z"/>
                </svg>
              </div>

              <div className="flex flex-col gap-0.5">
                <h1 className="text-2xl font-black tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-teal-300 to-emerald-400 uppercase font-sans">
                  CRAFTWARZ
                </h1>
                <p className="text-[9px] text-cyan-300 font-mono tracking-[0.2em] font-bold uppercase">
                  By the TUCCICYBERNATION
                </p>
                <div className="w-16 h-0.5 bg-cyan-500/30 mx-auto mt-2" />
              </div>

              {!isGameStarted ? (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-gray-400 font-mono leading-relaxed">
                    A premium Android Space Combat simulation. Fly through procedurally rendered vector canyons, destroy hostile drones, and defend the cybernation.
                  </p>
                  <button
                    onClick={handleStartOrRestart}
                    className="mt-2 w-full py-3 px-6 bg-cyan-500 hover:bg-cyan-400 active:bg-cyan-600 text-black font-bold rounded-xl transition-all transform hover:scale-105 active:scale-95 shadow-lg shadow-cyan-500/30 font-sans tracking-wide uppercase"
                  >
                    Launch Spacecraft
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-3 w-full">
                  <div className="flex flex-col gap-0.5">
                    <p className="text-red-500 font-bold font-mono text-sm uppercase">MISSION CRITICAL FAIL</p>
                    <p className="text-[10px] text-gray-500 font-mono uppercase">SPACECRAFT WAS RECLAIMED</p>
                  </div>

                  <div className="bg-black/40 border border-white/5 rounded-lg p-2.5 flex flex-col gap-1 w-full font-mono text-xs">
                    <div className="flex justify-between text-gray-400">
                      <span>FINAL SCORE:</span>
                      <span className="text-cyan-400 font-bold">{score} PTS</span>
                    </div>
                    <div className="flex justify-between text-gray-500">
                      <span>HIGH SCORE:</span>
                      <span className="text-amber-500 font-bold">{highScore} PTS</span>
                    </div>
                  </div>

                  <button
                    onClick={handleStartOrRestart}
                    className="w-full py-3 px-6 bg-red-500 hover:bg-red-400 active:bg-red-600 text-white font-bold rounded-xl transition-all transform hover:scale-105 active:scale-95 shadow-lg shadow-red-500/30 font-sans tracking-wide uppercase"
                  >
                    Re-deploy System
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
