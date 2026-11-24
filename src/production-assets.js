// Shared by the HTTP server and release preparation, so source and packaged
// production starts expose the same frontend without development components.
export function productionAsset(pathname, value) {
  let source = String(value);
  if (pathname.endsWith('.js')) {
    source = source.replace(/^[\t ]*\/\/ @development-start\r?\n[\s\S]*?^[\t ]*\/\/ @development-end\r?\n?/gm, '');
    if (/@development-(?:start|end)/.test(source)) throw new Error('Unbalanced development section: ' + pathname);
  }
  if (pathname === '/game.js') {
    source = source.replace(', mountOpeningPreview', '')
      .replace(/developer\.value\('(introSpeed|battleSpeed)'\)/g, '1')
      .replace(/scenario: developer\.value\('[^']+'\), ?/g, '')
      .replace(/developer\.value\('[^']+'\)/g, 'undefined')
      .replace(/^[\t ]*developer\.sync\(\);\r?\n/gm, '')
      .replace("${state?.developer ? 'mode-developer' : ''}", '')
      .replace('let previewingIntro = false;\n', '')
      .replace('let previewingIntro = false;\r\n', '')
      .replace(/^[\t ]*previewingIntro = false;\r?\n/gm, '')
      .replace(', preview: previewingIntro', '');
    if (/DeveloperPanel|developer\.|developer-panel|\/api\/developer|hackmon-dev-return|mountOpeningPreview|window\.__t1|previewingIntro/.test(source)) {
      throw new Error('Development frontend remained in production');
    }
  }
  if (pathname.endsWith('.css')) {
    // Keep dev-flag: this historical class styles the actual victory reward.
    source = source.replace(/[^{}]*(?:#developer-root|\.dev-(?!flag\b)[\w-]+)[^{}]*\{[^{}]*\}/g, '');
  }
  return source;
}
