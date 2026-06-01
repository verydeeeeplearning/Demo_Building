# Calculation Recipes

## LED Series Path

Apply `I = (Vsupply - Vforward) / R` only when there is one known DC supply, one LED model, one or more known series resistors, valid polarity, and a return path to ground.

## Module Current

For black-box modules, use registry `nominalCurrentMilliamp` and compare it against board and pin limits.

## Unsupported Cases

Return unsupported when the model includes mains, batteries under charge, RF, unknown power, arbitrary motors without drivers, or analog transients.
