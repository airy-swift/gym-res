import { NextRequest } from 'next/server';

const internalToken = process.env.INTERNAL_API_TOKEN;

if (!internalToken) {
  console.warn('INTERNAL_API_TOKEN is not set. API routes will reject all requests.');
}

export const isAuthorizedRequest = (request: NextRequest): boolean => {
  if (!internalToken) {
    return false;
  }

  const headerToken = request.headers.get('api_token') ?? request.headers.get('API_TOKEN');

  return headerToken === internalToken;
};
