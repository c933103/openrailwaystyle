# Mainline dataset reuse validation evidence

Base source: d8b70d02adf9babf72eb33c9d4ce2ba16ec9d3f0.
Local runtime: Node v24.19.0, npm 11.9.0, Linux. CI uses Node 22.

Final source checks:
- npm test: 1,525 passed, 0 failed, skipped or cancelled.
- node --experimental-vm-modules --test tests/mainline*.test.mjs: 95 passed.
- npm run build: passed; committed world.style.json unchanged.
- Changed script syntax checks, workflow YAML parsing and git diff --check: passed.
- Independent review: 35 focused tests passed, no remaining blocker.

The source manifest binds the tested source files. The patch is a convenience diff; the source branch remains authoritative. The published-reference proof is an offline planner replay over a connector-read immutable manifest. It does not claim downloaded data, fresh 840+18 renderer checks or measured hosted acquisition savings. No provider acquisition was initiated locally. The mandatory full reference renderer gate remains to run in hosted CI.
