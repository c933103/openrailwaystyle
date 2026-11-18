// Run the same signed-height and framebuffer gates with native512 land.
process.argv.push('--native512');
await import('./check-terrain-3d-browser.mjs');
