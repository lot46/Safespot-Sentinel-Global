/**
 * JWT Adapter wrapping jose to simplify testing (mockable in Jest)
 */
import { SignJWT, jwtVerify } from 'jose';

export async function signJWT(payload: any, secret: string, expSeconds: number, subject: string): Promise<string> {
  const key = new TextEncoder().encode(secret);
  const jwt = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expSeconds)
    .setSubject(subject)
    .sign(key);
  return jwt;
}

export async function verifyJWT(token: string, secret: string): Promise<any> {
  const key = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, key);
  return payload as any;
}