import fs from 'node:fs';
import { Readable } from 'node:stream';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { contentTypeFor, parseRange, resolveAssetPath } from '#lib/server/assets.js';

export const GET: RequestHandler = ({ params, request }) => {
  const file = resolveAssetPath(params.path);
  if (!file) error(404, 'Asset not found');

  const stat = fs.statSync(file);
  const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const headers: Record<string, string> = {
    'Content-Type': contentTypeFor(file),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=3600',
    ETag: etag
  };

  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });

  const range = parseRange(request.headers.get('range'), stat.size);
  if (request.headers.get('range') && !range) {
    return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${stat.size}` } });
  }
  if (range) {
    const stream = Readable.toWeb(fs.createReadStream(file, { start: range.start, end: range.end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: {
        ...headers,
        'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`,
        'Content-Length': String(range.end - range.start + 1)
      }
    });
  }
  const stream = Readable.toWeb(fs.createReadStream(file)) as ReadableStream;
  return new Response(stream, { headers: { ...headers, 'Content-Length': String(stat.size) } });
};
