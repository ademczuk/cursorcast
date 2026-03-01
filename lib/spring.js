/**
 * Spring physics simulation for smooth cursor movement and zoom animation.
 * Ported verbatim from open-screenstudio/src/processing/spring.ts
 *
 * Implements a damped harmonic oscillator: F = -k*x - c*v
 */

export const DEFAULT_SPRING_CONFIG = {
  stiffness: 800,
  damping: 80,
  mass: 1,
};

export const ZOOM_SPRING_CONFIG = {
  stiffness: 200,
  damping: 30,
  mass: 1,
};

export function createSpringState(initial) {
  return { position: initial, velocity: 0 };
}

/**
 * Advance the spring simulation by dt seconds toward the target.
 * Uses damped harmonic oscillator: F = -k*x - c*v
 */
export function stepSpring(state, target, config, dt) {
  const displacement = state.position - target;
  const springForce = -config.stiffness * displacement;
  const dampingForce = -config.damping * state.velocity;
  const acceleration = (springForce + dampingForce) / config.mass;

  const newVelocity = state.velocity + acceleration * dt;
  const newPosition = state.position + newVelocity * dt;

  return { position: newPosition, velocity: newVelocity };
}

export function isSpringSettled(state, target, threshold = 0.1) {
  return (
    Math.abs(state.position - target) < threshold &&
    Math.abs(state.velocity) < threshold
  );
}

export function createSpring2D(x, y) {
  return {
    x: createSpringState(x),
    y: createSpringState(y),
  };
}

export function stepSpring2D(state, targetX, targetY, config, dt) {
  return {
    x: stepSpring(state.x, targetX, config, dt),
    y: stepSpring(state.y, targetY, config, dt),
  };
}

export function getSpring2DPosition(state) {
  return { x: state.x.position, y: state.y.position };
}

export function isSpring2DSettled(state, targetX, targetY, threshold = 0.1) {
  return (
    isSpringSettled(state.x, targetX, threshold) &&
    isSpringSettled(state.y, targetY, threshold)
  );
}
