"use client";

// 3D character stage — renders the provided .glb figurines with gentle
// procedural motion (floating + slow rotation). The models have no rigs or
// animations, so all movement is generated here and stays subtle.
//
// The camera auto-fits: it measures the container (via useThree) and pulls
// back just enough for every character to fit — no more edge cut-offs on any
// screen size.
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGLTF, ContactShadows } from "@react-three/drei";
import { getCharacter } from "@/lib/characters";

interface StageCharacter {
  id: string;
  x?: number;
  scale?: number;
  spin?: boolean;
}

function Figurine({ id, x = 0, scale = 1, spin = true }: StageCharacter) {
  const char = getCharacter(id);
  const group = useRef<THREE.Group>(null);
  const { scene } = useGLTF(char.model);

  const prepared = useMemo(() => {
    // Clone so each stage instance has its own transformable scene.
    const clone = scene.clone(true);
    const box = new THREE.Box3().setFromObject(clone);
    const size = new THREE.Vector3();
    box.getSize(size);
    const height = Math.max(size.y, 0.0001);
    const factor = 1 / height; // normalize to height 1
    clone.scale.setScalar(factor);
    const box2 = new THREE.Box3().setFromObject(clone);
    const center = new THREE.Vector3();
    box2.getCenter(center);
    clone.position.x -= center.x;
    clone.position.z -= center.z;
    clone.position.y -= box2.min.y; // sit on the platform
    return clone;
  }, [scene]);

  useFrame((state) => {
    if (!group.current) return;
    const t = state.clock.elapsedTime;
    group.current.position.y = Math.sin(t * 1.4 + (x || 0) * 2.1) * 0.045;
    if (spin) {
      group.current.rotation.y = t * 0.55 + (x || 0);
    }
  });

  return (
    <group position={[x, 0.09, 0]}>
      <group ref={group} scale={scale}>
        <primitive object={prepared} />
      </group>
    </group>
  );
}

function Platform({ id, x = 0 }: { id: string; x?: number }) {
  const char = getCharacter(id);
  return (
    <mesh position={[x, 0.045, 0]} receiveShadow>
      <cylinderGeometry args={[0.52, 0.56, 0.09, 40]} />
      <meshStandardMaterial color={char.color} roughness={0.65} metalness={0.05} />
    </mesh>
  );
}

/**
 * Keeps the camera far enough away that `spanWidth` world units (plus a
 * margin) fit inside the viewport, whatever the container's aspect ratio.
 * Recomputes automatically on resize.
 */
function CameraFit({
  spanWidth,
  minHeight,
  baseZ,
}: {
  spanWidth: number;
  minHeight: number;
  baseZ: number;
}) {
  const { camera, size } = useThree();
  const margin = 0.85; // platform radius + breathing room (world units)
  const halfW = spanWidth / 2 + margin;

  useFrame(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const aspect = size.width / Math.max(1, size.height);
    const vFov = (cam.fov * Math.PI) / 180;
    const tanV = Math.tan(vFov / 2);
    // Horizontal half-extent visible at distance z: z * tanV * aspect.
    const zForWidth = halfW / Math.max(0.1, tanV * aspect);
    // Vertical half-extent visible at distance z: z * tanV.
    const zForHeight = minHeight / 2 / Math.max(0.05, tanV);
    const z = Math.max(baseZ, zForWidth, zForHeight);
    cam.position.set(0, 0.85, z);
    cam.lookAt(0, 0.4, 0);
    cam.updateProjectionMatrix();
  });
  return null;
}

export default function CharacterStage({
  characters,
  className,
  cameraZ = 2.35,
}: {
  characters: StageCharacter[];
  className?: string;
  cameraZ?: number;
}) {
  const positioned = useMemo(() => {
    if (characters.length === 1) return [{ ...characters[0], x: 0 }];
    const gap = 1.25;
    return characters.map((c, i) => ({
      ...c,
      x: (i - (characters.length - 1) / 2) * gap,
      scale: (c.scale ?? 1) * (characters.length > 2 ? 0.8 : 0.92),
    }));
  }, [characters]);

  // Total row width (platforms included) used for camera fitting.
  const spanWidth = useMemo(
    () => Math.max(1.3, (positioned.length - 1) * 1.25 + 1.05),
    [positioned.length]
  );

  return (
    <div className={className} aria-label="3D character stage">
      <Canvas
        camera={{ position: [0, 0.85, cameraZ], fov: 32 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        style={{ background: "transparent" }}
      >
        <CameraFit spanWidth={spanWidth} minHeight={1.5} baseZ={cameraZ * 0.85} />
        <ambientLight intensity={0.85} />
        <directionalLight position={[2.5, 4, 2.5]} intensity={1.6} castShadow />
        <directionalLight position={[-3, 2, -2]} intensity={0.5} color="#D9CCFF" />
        <Suspense fallback={null}>
          {positioned.map((c) => (
            <group key={`${c.id}-${c.x}`}>
              <Platform id={c.id} x={c.x} />
              <Figurine id={c.id} x={c.x} scale={c.scale ?? 1} />
            </group>
          ))}
          <ContactShadows position={[0, 0, 0]} opacity={0.35} scale={4} blur={2.4} far={1.5} />
        </Suspense>
      </Canvas>
    </div>
  );
}
