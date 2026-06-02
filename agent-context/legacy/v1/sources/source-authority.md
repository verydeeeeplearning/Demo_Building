# Source Authority Policy

This file defines which external sources may back H-eduware canonical context data.

## Trust Tiers

1. `manufacturer-official`: official product pages, datasheets, schematics, pinouts, and processor datasheets.
2. `vendor-technical-guide`: technical guides from reputable education/component vendors such as Adafruit, SparkFun, Pololu, Seeed, and DFRobot.
3. `eda-library`: official KiCad libraries, manufacturer CAD, or vetted footprint libraries used only for physical dimensions and footprint hints.
4. `educational-reference`: beginner electronics explanations used for pedagogy and simplified breadboard behavior.
5. `h-eduware-derived`: internal simplified teaching model derived from higher-tier claims.

## Runtime Rule

Deepagents should consume canonical context data, not long source documents. Source claims exist for auditability, maintenance, and hardware support promotion.

## Claim Rule

Each claim must be atomic. Do not combine pin mapping, electrical limits, footprint geometry, and simulation assumptions in one claim.

## Quote Rule

Keep `evidenceQuote` short. Store only the shortest phrase needed to identify the sourced fact, and use `notes` for H-eduware interpretation.
