/**
 * @rewloy/node — the official Node.js and TypeScript library for the Rewloy API.
 *
 * ```ts
 * import { Rewloy } from '@rewloy/node';
 * const rewloy = new Rewloy({ apiKey: process.env.REWLOY_API_KEY! });
 * ```
 */

export { Rewloy, DEFAULT_BASE_URL, parseRateLimit } from './client.ts';
export type { RewloyOptions } from './client.ts';
export { RewloyError, RateLimitError, RewloyConnectionError, RewloyTimeoutError } from './errors.ts';
export type { RewloyErrorInit } from './errors.ts';
export { EventStream, SseParser } from './sse.ts';
export type { ServerSentEvent } from './sse.ts';
export { verifyWebhook, signWebhook, WebhookSignatureError } from './webhooks.ts';
export type { WebhookEvent, PassEventData, PassExtendedData, LocationEventData, VerifyWebhookOptions, SignWebhookOptions, WebhookSignatureReason } from './webhooks.ts';
export { OPERATIONS, ERROR_TITLES, API_VERSION } from './generated/operations.ts';
export type { ApiResponse, AuthKind, HttpMethod, OperationMeta, Page, RateLimitInfo, RequestOptions, ResponseKind, StreamOptions } from './types.ts';
export type * from './generated/types.ts';
export { VERSION } from './version.ts';

import { Rewloy } from './client.ts';
export default Rewloy;
