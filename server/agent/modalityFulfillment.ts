// Intent-modality fulfillment taxonomy (single source of truth).
//
// A request's IntentSpec declares BOTH a generic output/input modality (e.g. `display`, `motion`,
// `digital-input`) AND its specific variant(s) (e.g. `spi-display`, `switched-load`,
// `rotary-encoder`). The intent-fulfillment gate requires every declared modality to be covered by
// a part in the final circuit. The bug this module fixes (RC-A, trace-confirmed): the generic
// modality had no part mapped to it, so a CORRECT circuit — tft-18 wired over SPI, a DC motor on a
// low-side switch, a 7-seg display, a joystick — was wrongly marked INTENT_OUTPUT/INPUT_NOT_FULFILLED.
//
// The rule here: a GENERIC modality is satisfied by ANY of its specific variants. The mapping is
// driven by part CAPABILITIES (the catalog vocabulary), not by ad-hoc id substrings, so it
// generalizes to new parts that carry the same capability. Both the validation gate
// (server/agent/circuitTools.ts) and composition selection
// (server/context/compositionSelection.ts) consume these predicates — one taxonomy, no duplicate
// vocabularies.

import type { PartCapability } from './schemas.ts';

/** Input modalities that a runnable circuit must physically include a part for. */
export function requiresConcreteInputFulfillment(modality: string): boolean {
  return [
    'analog',
    'analog-sensor',
    'button',
    'digital-input',
    'digital-sensor',
    'joystick',
    'light-sensor',
    'matrix-input',
    'potentiometer',
    'rotary-encoder',
    'temperature-humidity-sensor'
  ].includes(modality);
}

/** Output modalities that a runnable circuit must physically include a part for. */
export function requiresConcreteOutputFulfillment(modality: string): boolean {
  return [
    'addressable-led-display',
    'bare-seven-segment-display',
    'display',
    'hbridge-motor',
    'led-array-display',
    'light',
    'motion',
    'relay-output',
    'sound',
    'spi-display',
    'stepper-motion',
    'switched-load'
  ].includes(modality);
}

export function partFulfillsInputModality(part: PartCapability, modality: string): boolean {
  const capabilities = new Set(part.capabilities);
  const protocols = new Set(part.protocols);
  const aliases = part.aliases.join(' ').toLowerCase();

  switch (modality) {
    case 'analog':
      return part.kind === 'input' && protocols.has('analog-input');
    case 'analog-sensor':
      return capabilities.has('analog-sensor')
        || capabilities.has('resistive-sensor')
        || capabilities.has('light-sensor')
        || (part.kind === 'input' && protocols.has('analog-input') && capabilities.has('threshold-input'));
    case 'button':
      return part.id === 'button-tactile' || capabilities.has('digital-input-switch') || aliases.includes('button');
    case 'digital-input':
      // Generic digital input ⊇ mechanical switches AND the digital channel of richer user-input
      // devices (joystick push, rotary-encoder quadrature/push, keypad rows). RC-A: joystick/rotary
      // declare `digital-input` but carry `digital-button-input` / `quadrature-input-source`, which
      // the original switch-only map missed.
      return part.kind === 'input' && (
        capabilities.has('digital-input-switch')
        || capabilities.has('digital-input-state-source')
        || capabilities.has('digital-output-sensor')
        || capabilities.has('powered-digital-sensor')
        || capabilities.has('digital-button-input')
        || capabilities.has('quadrature-input-source')
        || capabilities.has('rotary-encoder-source')
        || capabilities.has('joystick-input-source')
        || capabilities.has('matrix-input-source')
        || capabilities.has('multi-switch-input')
      );
    case 'digital-sensor':
      return part.kind === 'input' && (
        capabilities.has('digital-sensor')
        || capabilities.has('powered-digital-sensor')
        || capabilities.has('digital-output-sensor')
        || capabilities.has('temperature-humidity-sensor')
        || capabilities.has('protocol-sensor')
      );
    case 'joystick':
      return part.id === 'joystick-module' || capabilities.has('joystick') || capabilities.has('joystick-input-source');
    case 'light-sensor':
      return capabilities.has('light-sensor');
    case 'matrix-input':
      return part.id.includes('keypad') || capabilities.has('matrix-input') || capabilities.has('matrix-input-source');
    case 'potentiometer':
      return part.id.includes('pot') || aliases.includes('potentiometer') || aliases.includes('trimmer');
    case 'rotary-encoder':
      return part.id === 'rotary-encoder' || capabilities.has('rotary-encoder') || capabilities.has('rotary-encoder-source');
    case 'temperature-humidity-sensor':
      return capabilities.has('temperature-humidity-sensor');
    default:
      return false;
  }
}

export function partFulfillsOutputModality(part: PartCapability, modality: string): boolean {
  const capabilities = new Set(part.capabilities);

  switch (modality) {
    case 'addressable-led-display':
      return capabilities.has('addressable-led-display') || part.id.includes('neopixel') || part.id.includes('ws2812');
    case 'bare-seven-segment-display':
      return part.id === '7seg-1digit' || capabilities.has('bare-seven-segment-display');
    case 'led-array-display':
      // A 7-seg / numeric display is an LED array too (RC-A: bare-seven-segment-output declares
      // `led-array-display`, which the matrix/tm1637-only map missed for the 1-digit 7-seg).
      return capabilities.has('led-array-display')
        || capabilities.has('matrix-display')
        || capabilities.has('numeric-display')
        || capabilities.has('bare-seven-segment-display')
        || part.id.includes('matrix')
        || part.id.includes('tm1637');
    case 'spi-display':
      return capabilities.has('spi-display') || ['tft-18', 'nokia-5110', 'epaper-213'].includes(part.id);
    case 'display':
      // Generic display ⊇ EVERY concrete display variant: text, SPI/graphic, LED-array, 7-seg,
      // addressable. RC-A: tft-18 / 7-seg / neopixel declare `display` but only carry their specific
      // capability, so the display-text-only map falsely rejected correct circuits.
      return capabilities.has('display-text')
        || capabilities.has('display-output')
        || capabilities.has('graphic-display')
        || capabilities.has('color-display')
        || capabilities.has('monochrome-display')
        || capabilities.has('epaper-display')
        || partFulfillsOutputModality(part, 'spi-display')
        || partFulfillsOutputModality(part, 'led-array-display')
        || partFulfillsOutputModality(part, 'bare-seven-segment-display')
        || partFulfillsOutputModality(part, 'addressable-led-display');
    case 'hbridge-motor':
      return capabilities.has('hbridge-driver')
        || (part.id.includes('driver') && (part.id.includes('l298') || part.id.includes('l293')));
    case 'stepper-motion':
      return part.id.includes('stepper')
        || part.id.includes('uln2003')
        || capabilities.has('stepper-motor')
        || capabilities.has('stepper-driver');
    case 'switched-load':
      // A switched load: motor/fan/pump/solenoid drives AND logic-controlled relay contacts (RC-A:
      // relay-low-voltage declares `switched-load`, fulfilled by the relay module itself).
      return capabilities.has('switched-load')
        || capabilities.has('low-side-switched-load')
        || capabilities.has('motor-output')
        || capabilities.has('relay-module')
        || capabilities.has('logic-controlled-switch')
        || part.id.includes('motor')
        || part.id.includes('fan')
        || part.id.includes('pump')
        || part.id.includes('solenoid');
    case 'motion':
      // Generic motion ⊇ servo, DC-motor drives, steppers, and h-bridge drives. RC-A: the original
      // map only accepted servos, so DC-motor / stepper / h-bridge circuits were falsely rejected.
      return (part.kind === 'output' && (
        part.id.includes('servo')
        || capabilities.has('servo-actuator')
        || capabilities.has('motion-output')
        || capabilities.has('pwm-controlled-actuator')
        || capabilities.has('motor-output')
      ))
        || partFulfillsOutputModality(part, 'stepper-motion')
        || partFulfillsOutputModality(part, 'hbridge-motor');
    case 'light':
      return part.kind === 'output' && (
        capabilities.has('visual-indicator')
        || capabilities.has('digital-output-load')
        || capabilities.has('powered-light-module')
        || capabilities.has('rgb-light-output')
      );
    case 'relay-output':
      return part.id.includes('relay') || capabilities.has('relay-module');
    case 'sound':
      return part.kind === 'output' && (part.id.includes('buzzer') || capabilities.has('sound-output'));
    default:
      return false;
  }
}
