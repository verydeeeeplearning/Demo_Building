# Breadboard Coordinate System

Breadboard coordinates use rail names and row/column style anchors. Rails are `+ rail` and `- rail`. Tie points in the same row group share electrical continuity.

The compiler may convert logical anchors to 3D coordinates, but the agent should reason with logical rows and rails.
