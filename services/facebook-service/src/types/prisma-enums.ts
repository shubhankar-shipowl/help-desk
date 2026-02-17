// Prisma enum constants - defined locally to avoid dependency on generated client path.
// These must match the enum values in packages/shared/prisma/schema.prisma.

export const Notification_type = {
  TICKET_ASSIGNED: 'TICKET_ASSIGNED',
  TICKET_UPDATED: 'TICKET_UPDATED',
  TICKET_REPLY: 'TICKET_REPLY',
  TICKET_STATUS_CHANGED: 'TICKET_STATUS_CHANGED',
  TICKET_MENTION: 'TICKET_MENTION',
  PRIORITY_ESCALATION: 'PRIORITY_ESCALATION',
  SLA_BREACH: 'SLA_BREACH',
  FACEBOOK_POST: 'FACEBOOK_POST',
  FACEBOOK_COMMENT: 'FACEBOOK_COMMENT',
  FACEBOOK_MESSAGE: 'FACEBOOK_MESSAGE',
} as const;

export type Notification_type = (typeof Notification_type)[keyof typeof Notification_type];

export const Ticket_source = {
  EMAIL: 'EMAIL',
  FACEBOOK_POST: 'FACEBOOK_POST',
  FACEBOOK_COMMENT: 'FACEBOOK_COMMENT',
  FACEBOOK_MESSAGE: 'FACEBOOK_MESSAGE',
  MANUAL: 'MANUAL',
  API: 'API',
} as const;

export type Ticket_source = (typeof Ticket_source)[keyof typeof Ticket_source];

export const Ticket_priority = {
  LOW: 'LOW',
  NORMAL: 'NORMAL',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
} as const;

export type Ticket_priority = (typeof Ticket_priority)[keyof typeof Ticket_priority];

export const Ticket_status = {
  NEW: 'NEW',
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  PENDING: 'PENDING',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED',
  INITIATE_REFUND: 'INITIATE_REFUND',
} as const;

export type Ticket_status = (typeof Ticket_status)[keyof typeof Ticket_status];
