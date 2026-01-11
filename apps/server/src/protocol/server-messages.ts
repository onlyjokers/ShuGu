/**
 * Purpose: Server-side helpers to construct protocol-compliant messages and route them via MessageRouter.
 */
import type { ControlAction, ControlPayload, TargetSelector } from '@shugu/protocol';
import { createServerControlMessage } from '@shugu/protocol';
import type { MessageRouterService } from '../message-router/message-router.service.js';

export function sendServerControl(
  messageRouter: MessageRouterService,
  target: TargetSelector,
  action: ControlAction,
  payload: ControlPayload,
  executeAt?: number
): void {
  const message = createServerControlMessage(target, action, payload, executeAt);
  messageRouter.routeMessage(message, 'server');
}
