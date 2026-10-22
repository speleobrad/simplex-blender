# Task 7 RED tests report

Added failing coverage for:

- Warning-mode result notices with a hot-overfill exceedance (measured pressure, applicable limit, and `Transfer 2` step), plus the no-crossing policy notice.
- Optimize flow with 100-bar cylinders, 0% hot overfill, exact `I KNOW WHAT I'M DOING` Warning unlock phrase, 99-bar target, and 40°C transfer gas; verifies feasibility, Warning/hot-overfill notices, and no cylinder-pressure automatic wait.
- What-if flow with a 100-bar cylinder, Warning mode, 110-bar start, and drain-to-20 recipe; verifies success and working-pressure exceedance notice.

Existing Hard stop coverage was preserved. No tests, build, lint, or formatting commands were run (controller owns RED verification).
