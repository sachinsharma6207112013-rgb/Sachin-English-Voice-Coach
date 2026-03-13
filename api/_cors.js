const DEFAULT_ALLOWED_HEADERS = ['Content-Type', 'Authorization'];
const DEFAULT_ALLOWED_METHODS = ['GET', 'POST', 'OPTIONS'];

function getAllowedOrigins() {
  const raw = process.env.ALLOWED_ORIGIN || '*';

  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function resolveAllowedOrigin(requestOrigin) {
  const allowedOrigins = getAllowedOrigins();

  if (allowedOrigins.includes('*')) {
    return '*';
  }

  if (!requestOrigin) {
    return allowedOrigins[0] || '*';
  }

  return allowedOrigins.includes(requestOrigin) ? requestOrigin : null;
}

export function applyCors(req, res, { methods = DEFAULT_ALLOWED_METHODS, headers } = {}) {
  const requestOrigin = req.headers?.origin;
  const allowedOrigin = resolveAllowedOrigin(requestOrigin);

  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  }

  res.setHeader('Vary', 'Origin, Access-Control-Request-Headers');
  res.setHeader('Access-Control-Allow-Methods', methods.join(', '));

  const requestHeaders = req.headers?.['access-control-request-headers'];
  const allowedHeaders =
    typeof requestHeaders === 'string' && requestHeaders.trim()
      ? requestHeaders
      : (headers || DEFAULT_ALLOWED_HEADERS).join(', ');

  res.setHeader('Access-Control-Allow-Headers', allowedHeaders);
  res.setHeader('Access-Control-Max-Age', '86400');
}
