---
name: intent-analysis
description: Normalize vague student circuit requests into an IntentSpec.
---

# Intent Analysis

Extract a small, explicit IntentSpec:

- primary goal: the learner-facing outcome.
- output: display, led, buzzer, servo, or unsupported.
- input: button or none when absent.
- controller: default to Arduino Uno unless the student specifies another supported controller.
- behavior: what should happen when Run is pressed.

Ask a clarification only when the missing detail changes circuit topology or safety. Do not ask the student to choose a fixed product category; infer from language first.
