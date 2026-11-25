// The 3D layer behind the glass UI: one refractive "hero" object that morphs per page,
// and a few glossy, iridescent spheres that drift to a new arrangement on every page change.
// Loaded lazily (its own chunk) and skipped for prefers-reduced-motion.
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, MeshTransmissionMaterial } from '@react-three/drei';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Route } from '../routes';

type V3 = [number, number, number];
interface Layout {
	blobs: Array<{ p: V3; s: number; c: string }>;
}

const LIGHT: Record<Route, Layout> = {
	pregled: { blobs: [{ p: [-3.2, 1.6, -3], s: 1.5, c: '#7aa2ff' }, { p: [3.6, -1.8, -4], s: 1.9, c: '#ff8fc7' }, { p: [-1.4, -2.4, -2], s: 0.9, c: '#9b8cff' }, { p: [1.2, 2.6, -5], s: 1.1, c: '#7fe3ff' }, { p: [-4.4, -0.6, -5], s: 0.7, c: '#ffd27a' }] },
	predmeti: { blobs: [{ p: [3.4, 1.8, -3.5], s: 1.6, c: '#8cf0c4' }, { p: [-3.6, -1.4, -3], s: 1.7, c: '#6fb3ff' }, { p: [0.6, -2.8, -2.5], s: 0.9, c: '#b7a3ff' }, { p: [-1.6, 2.4, -5], s: 1.0, c: '#7fe3ff' }, { p: [4.4, -0.4, -5], s: 0.8, c: '#ffb4a8' }] },
	kalendar: { blobs: [{ p: [-3.0, -1.8, -3], s: 1.6, c: '#ffb36b' }, { p: [3.2, 1.6, -4], s: 1.8, c: '#ff8fb1' }, { p: [1.6, -2.6, -2.5], s: 0.9, c: '#ffd27a' }, { p: [-2.2, 2.4, -5], s: 1.0, c: '#a5b8ff' }, { p: [4.6, -1.2, -5], s: 0.7, c: '#ffa7d8' }] },
	ispiti: { blobs: [{ p: [3.0, -1.6, -3], s: 1.7, c: '#ff7f9e' }, { p: [-3.4, 1.4, -4], s: 1.7, c: '#a28bff' }, { p: [-1.0, -2.6, -2.5], s: 1.0, c: '#ffb36b' }, { p: [1.6, 2.6, -5], s: 1.0, c: '#7aa2ff' }, { p: [-4.6, -0.8, -5], s: 0.7, c: '#ff9fd0' }] },
};
// Same arrangement, deeper colours for the dark theme.
const deepen = (hex: string) => '#' + new THREE.Color(hex).multiplyScalar(0.72).getHexString();
const DARK: Record<Route, Layout> = Object.fromEntries(
	Object.entries(LIGHT).map(([k, v]) => [k, { blobs: v.blobs.map((b) => ({ ...b, c: deepen(b.c) })) }])
) as Record<Route, Layout>;

const INTRO_S = 1.7;
const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function useGeometries() {
	return useMemo<Record<Route, THREE.BufferGeometry>>(
		() => ({
			pregled: new THREE.TorusKnotGeometry(0.62, 0.24, 260, 40),
			predmeti: new THREE.IcosahedronGeometry(1.0, 0),
			kalendar: new THREE.TorusGeometry(0.78, 0.32, 72, 160),
			ispiti: new THREE.OctahedronGeometry(1.05, 0),
		}),
		[]
	);
}

function Hero({ route, dark }: { route: Route; dark: boolean }) {
	const geos = useGeometries();
	const mesh = useRef<THREE.Mesh>(null);
	const state = useRef({ shown: route, scale: 0, spin: 0, born: -1 });
	const { viewport } = useThree();

	useFrame(({ clock }, dt) => {
		const m = mesh.current;
		if (!m) return;
		const s = state.current;
		const t = clock.elapsedTime;
		if (s.born < 0) s.born = t;
		const intro = Math.min(1, (t - s.born) / INTRO_S);

		// Page change: shrink while spinning up, swap the shape, grow back.
		const target = s.shown === route ? 1 : 0;
		s.scale = THREE.MathUtils.damp(s.scale, target, s.shown === route ? 5 : 9, dt);
		if (s.shown !== route && s.scale < 0.04) {
			s.shown = route;
			m.geometry = geos[route];
		}
		s.spin += dt * (0.35 + (1 - s.scale) * 6);

		// Intro: from the middle of the screen, big, to its resting place top-right.
		const wide = viewport.aspect > 1.05;
		const rest = new THREE.Vector3(wide ? viewport.width / 2 - 1.6 : 0, wide ? viewport.height / 2 - 1.35 : viewport.height / 2 - 1.2, 0);
		const k = easeInOut(Math.min(1, Math.max(0, (intro - 0.35) / 0.65)));
		const p = new THREE.Vector3(0, 0, 1).lerp(rest, k);
		m.position.set(p.x, p.y + Math.sin(t * 0.9) * 0.08, p.z);
		const introScale = THREE.MathUtils.lerp(easeOutExpo(Math.min(1, intro / 0.45)) * 1.7, 1, k);
		m.scale.setScalar(Math.max(0.0001, introScale * s.scale * (wide ? 1 : 0.7)));
		m.rotation.set(Math.sin(t * 0.3) * 0.4 + s.spin * 0.6, s.spin, Math.cos(t * 0.2) * 0.2);
	});

	return (
		<mesh ref={mesh} geometry={geos[route]}>
			<MeshTransmissionMaterial
				samples={6}
				resolution={512}
				thickness={0.7}
				roughness={0.04}
				transmission={1}
				ior={1.32}
				chromaticAberration={0.08}
				anisotropy={0.25}
				distortion={0.35}
				distortionScale={0.4}
				temporalDistortion={0.08}
				backside
				backsideThickness={0.4}
				background={new THREE.Color(dark ? '#2a2f52' : '#f4f2ff')}
				color={dark ? '#dfe4ff' : '#ffffff'}
				attenuationColor={dark ? '#8f9cff' : '#f3f0ff'}
				attenuationDistance={1.5}
			/>
		</mesh>
	);
}

function Blobs({ route, dark }: { route: Route; dark: boolean }) {
	const group = useRef<THREE.Group>(null);
	const born = useRef(-1);
	const layout = (dark ? DARK : LIGHT)[route];
	const colors = useMemo(() => layout.blobs.map(() => new THREE.Color()), [layout]);

	useFrame(({ clock }, dt) => {
		const g = group.current;
		if (!g) return;
		const t = clock.elapsedTime;
		if (born.current < 0) born.current = t;
		const age = t - born.current;
		g.children.forEach((child, i) => {
			const m = child as THREE.Mesh;
			const b = layout.blobs[i];
			const target = new THREE.Vector3(b.p[0] + Math.sin(t * 0.25 + i) * 0.35, b.p[1] + Math.cos(t * 0.2 + i * 1.7) * 0.3, b.p[2]);
			m.position.lerp(target, 1 - Math.exp(-dt * 1.4));
			// Intro: each sphere pops in a little after the previous one.
			const grow = easeOutExpo(Math.min(1, Math.max(0, (age - 0.25 - i * 0.12) / 1.1)));
			m.scale.setScalar(Math.max(0.0001, THREE.MathUtils.damp(m.scale.x, b.s * grow, 3, dt)));
			const mat = m.material as THREE.MeshPhysicalMaterial;
			colors[i].set(b.c);
			mat.color.lerp(colors[i], 1 - Math.exp(-dt * 2));
		});
	});

	return (
		<group ref={group}>
			{layout.blobs.map((b, i) => (
				<mesh key={i} position={b.p} scale={0.0001}>
					<sphereGeometry args={[1, 64, 64]} />
					<meshPhysicalMaterial color={b.c} roughness={0.12} metalness={0.05} clearcoat={1} clearcoatRoughness={0.08} iridescence={0.7} iridescenceIOR={1.4} sheen={0.4} sheenColor="#ffffff" />
				</mesh>
			))}
		</group>
	);
}

/** Gentle parallax: the camera leans toward the pointer. */
function Rig() {
	useFrame(({ camera, pointer }, dt) => {
		camera.position.x = THREE.MathUtils.damp(camera.position.x, pointer.x * 0.45, 2.5, dt);
		camera.position.y = THREE.MathUtils.damp(camera.position.y, pointer.y * 0.3, 2.5, dt);
		camera.lookAt(0, 0, -1);
	});
	return null;
}

export default function Scene({ route, dark }: { route: Route; dark: boolean }) {
	return (
		<Canvas className="scene" dpr={[1, 1.75]} gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }} camera={{ position: [0, 0, 6], fov: 42 }}>
			<ambientLight intensity={dark ? 0.5 : 0.7} />
			<directionalLight position={[3, 4, 5]} intensity={dark ? 1.2 : 1.8} />
			<Blobs route={route} dark={dark} />
			<Hero route={route} dark={dark} />
			<Rig />
			{/* Procedural studio lighting for the reflections: no HDR download. */}
			<Environment resolution={256} frames={1}>
				<Lightformer form="rect" intensity={dark ? 3 : 3} position={[0, 4, -2]} scale={[10, 2, 1]} rotation-x={Math.PI / 2} />
				<Lightformer form="rect" intensity={2} position={[-5, 1, 2]} scale={[2, 6, 1]} rotation-y={Math.PI / 2} color="#bcd0ff" />
				<Lightformer form="rect" intensity={2} position={[5, -1, 2]} scale={[2, 6, 1]} rotation-y={-Math.PI / 2} color="#ffc7e6" />
				<Lightformer form="circle" intensity={4} position={[2, 3, 4]} scale={1.5} />
			</Environment>
		</Canvas>
	);
}
