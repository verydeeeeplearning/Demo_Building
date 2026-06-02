# Hardware Context Collection Playbook

Use this checklist before moving a hardware request from `planned` or `visual-only` to `supported`.

## Required Collection Steps

1. Identify the student capability, not only the part name.
2. Collect manufacturer-official or vendor-technical-guide sources for pin map, voltage/current limits, protocol support, and required passives.
3. Create atomic `SourceClaim` records for each critical canonical field.
4. Add or update `part-capabilities.json`.
5. Add pin aliases in `ontology/pin-aliases.json`.
6. Add validation rules or topology support.
7. Add simulation primitive or map to an existing primitive.
8. Add render footprint with pin anchors and placement rules.
9. Add supported eval prompt and unsupported counterexample.
10. Add browser-visible verification evidence.
11. Add or update the `HardwareSupportBundle`.
12. Run `npm run audit:sources`, `npm run audit:capabilities`, `npm run eval:generalization:report`, and `npm run check`.

## Promotion Rule

The app may answer unsupported or planned questions with safe guidance before a full bundle exists. It may not generate build-ready wiring, PCB rendering, or current-flow simulation until the bundle audit passes.
