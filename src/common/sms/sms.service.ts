import { Injectable, Logger } from '@nestjs/common';

export interface SmsSendResult {
  sent: boolean;
  /** Human-readable reason, always present — shown to the admin either way so the UI never silently implies delivery that didn't happen. */
  note: string;
}

/**
 * Provider-agnostic SMS gateway.
 *
 * No real provider is wired up yet (see SMS_PROVIDER below) — every call to
 * send() is a safe no-op until one is: it logs, returns
 * { sent: false, note }, and never throws. Callers (e.g.
 * SoaApplicationsService.perfectEntry) always await this and must never let
 * its result fail the caller's own operation — an SMS gateway being
 * unconfigured/down is not a reason to fail admitting a student.
 *
 * To wire up a real provider later: add its case to the switch below (e.g.
 * 'twilio', 'msg91', 'textlocal'), reading whatever credentials it needs from
 * its own env vars, and set SMS_PROVIDER to that name. Every existing caller
 * of send() keeps working unchanged.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  // Not `async` — every branch today resolves synchronously (nothing to
  // await yet). Wrap a branch's body in `async`/`await` once it calls a
  // real provider's SDK; the Promise<SmsSendResult> return type doesn't
  // need to change either way.
  send(to: string, message: string): Promise<SmsSendResult> {
    const provider = process.env.SMS_PROVIDER?.trim().toLowerCase();

    if (!provider) {
      this.logger.warn(
        `SMS not sent to ${to} — SMS_PROVIDER is not set yet. Message would have been: "${message}"`,
      );
      return Promise.resolve({
        sent: false,
        note: 'No SMS provider configured yet — message was not sent.',
      });
    }

    try {
      switch (provider) {
        // case 'twilio':
        //   return this.sendViaTwilio(to, message);
        // case 'msg91':
        //   return this.sendViaMsg91(to, message);
        default:
          this.logger.warn(
            `SMS_PROVIDER is set to unrecognized value '${provider}' — SMS not sent to ${to}`,
          );
          return Promise.resolve({
            sent: false,
            note: `Unrecognized SMS_PROVIDER '${provider}' — message was not sent.`,
          });
      }
    } catch (err) {
      // A broken provider integration must never fail the caller's own
      // operation (e.g. admitting a student) — log it and report failure
      // through the return value instead of throwing.
      this.logger.error(`SMS send to ${to} failed`, err);
      return Promise.resolve({
        sent: false,
        note: 'SMS send failed — see server logs.',
      });
    }
  }
}
