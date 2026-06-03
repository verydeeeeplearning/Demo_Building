// Pure decision for the on-demand stage render loop: should another animation
// frame be scheduled? True while the run simulation is playing, the orbit
// rotation is still easing toward its target, or a recent interaction window
// (activeUntil) is still open. When all three are false the loop goes idle so a
// static circuit does not keep the GPU/compositor busy.
export function shouldRenderNextFrame({
  running,
  rotationDelta,
  now,
  activeUntil,
  epsilon = 0.0005
}) {
  return Boolean(running) || Math.abs(rotationDelta) > epsilon || now < activeUntil;
}
