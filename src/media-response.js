// Media players probe the end of Ogg files before playback. Honor byte ranges so
// a slow connection does not have to deliver the entire song before it starts.
export function sendMedia(req, res, data, type) {
  const size = data.length;
  const headers = { 'content-type': type, 'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=3600', 'x-content-type-options': 'nosniff' };
  let start = 0, end = size - 1, status = 200;
  const range = req.method === 'HEAD' ? null : req.headers.range;
  // Multiple/unknown range forms may be ignored; single byte ranges are enough
  // for browsers. If-Range without a matching validator falls back to full data.
  const parts = !req.headers['if-range'] && range?.match(/^bytes=(\d*)-(\d*)$/);
  if (parts && (parts[1] || parts[2])) {
    if (!parts[1]) start = Math.max(0, size - Number(parts[2]));
    else { start = Number(parts[1]); if (parts[2]) end = Math.min(end, Number(parts[2])); }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
      res.writeHead(416, { ...headers, 'content-range': `bytes */${size}`, 'content-length': 0 });
      return res.end();
    }
    status = 206;
    headers['content-range'] = `bytes ${start}-${end}/${size}`;
  }
  res.writeHead(status, { ...headers, 'content-length': end - start + 1 });
  res.end(req.method === 'HEAD' ? undefined : data.subarray(start, end + 1));
}
