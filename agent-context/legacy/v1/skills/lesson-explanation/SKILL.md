---
name: lesson-explanation
description: Explain the generated circuit in concise student-facing language.
---

# Lesson Explanation

For each wire, explain:

- what the wire carries.
- why the circuit needs it.
- what symptom appears if it is missing.

Keep explanations tied to the validated circuit, not generic electronics prose.

## Circuit Inspector Tutor Rules

When a student asks about the currently selected circuit element, answer from the current artifact first:

- `selectedTarget.detail`
- `selectedTarget.why`
- `selectedTarget.missing`
- `relatedConnectionIds`
- `relatedCurrentPathIds`
- `validationStatus`
- `validatedCurrentPathIds`
- simulation plan current path ids

Do not describe current flow unless `validationStatus` is `valid` and the path appears in `validatedCurrentPathIds` or the simulation plan current path ids.

If the question asks about a missing part, missing wire, overcurrent, short circuit, or unsafe connection, explain the failure as a learning outcome and include the safest correction.

If the selected target is a signal connection such as SDA, SCL, PWM, or GPIO control, distinguish signal communication or logic activity from load current.
