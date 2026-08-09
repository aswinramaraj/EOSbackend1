import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import twilio from 'twilio';

// Twilio SDK errors carry a numeric `code` (their own error catalogue, not
// an HTTP status) plus an HTTP-like `status`. Mapped here so the frontend
// never has to know Twilio's error codes exist.
// https://www.twilio.com/docs/api/errors
const TWILIO_ERROR_MESSAGES: Record<number, { message: string; httpStatus: HttpStatus }> = {
  60200: { message: 'That phone number looks invalid.', httpStatus: HttpStatus.BAD_REQUEST },
  60203: {
    message: 'Maximum send attempts reached for this number. Try again later.',
    httpStatus: HttpStatus.TOO_MANY_REQUESTS,
  },
  60202: {
    message: 'Too many incorrect attempts for this code. Request a new one.',
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  60212: {
    message: 'Too many concurrent verification requests. Please wait and try again.',
    httpStatus: HttpStatus.TOO_MANY_REQUESTS,
  },
  60410: {
    message: 'Too many attempts. Please wait before trying again.',
    httpStatus: HttpStatus.TOO_MANY_REQUESTS,
  },
  60023: {
    message: 'This number cannot receive WhatsApp messages, or has not joined the WhatsApp sandbox yet.',
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  20429: { message: 'Too many requests. Please wait a moment and try again.', httpStatus: HttpStatus.TOO_MANY_REQUESTS },
  20404: {
    message: 'This code has expired or no verification is pending for this number. Send a new code.',
    httpStatus: HttpStatus.BAD_REQUEST,
  },
};

function toE164Indian(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  throw new BadRequestException('Enter a valid 10-digit Indian mobile number.');
}

@Injectable()
export class FacultyVerificationService {
  private readonly logger = new Logger(FacultyVerificationService.name);
  private client: ReturnType<typeof twilio> | null = null;
  private verifyServiceSid: string | null = null;

  // Validated lazily, on first actual use — not in the constructor. This
  // module is instantiated as part of every app boot (it's just another
  // provider in the DI graph), so throwing here would crash the entire app
  // for anyone without Twilio configured, even for people who never touch
  // faculty verification at all. Same lazy-client pattern already used by
  // WalletService.getRazorpay() and AttendanceCvService.getApiKey().
  private getClient(): { client: ReturnType<typeof twilio>; verifyServiceSid: string } {
    if (!this.client || !this.verifyServiceSid) {
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;

      if (!accountSid || !authToken || !verifyServiceSid) {
        throw new InternalServerErrorException(
          'Twilio Verify is not configured — TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_VERIFY_SERVICE_SID must all be set.',
        );
      }

      this.verifyServiceSid = verifyServiceSid;
      this.client = twilio(accountSid, authToken);
    }
    return { client: this.client, verifyServiceSid: this.verifyServiceSid };
  }

  /** POST /me/faculty-verification/send — starts a Twilio Verify verification. Twilio owns the OTP entirely. */
  async sendOtp(phone: string, channel: 'sms' | 'whatsapp') {
    const to = toE164Indian(phone);
    const { client, verifyServiceSid } = this.getClient();
    try {
      const verification = await client.verify.v2
        .services(verifyServiceSid)
        .verifications.create({ to, channel });

      return {
        status: verification.status,
        channel: verification.channel,
        to: verification.to,
      };
    } catch (err: unknown) {
      throw this.mapTwilioError(err, 'send');
    }
  }

  /**
   * POST /me/faculty-verification/check — asks Twilio whether `code`
   * matches. A wrong code is Twilio returning status "pending" on a normal
   * 200 response, not an error — only genuine failures (expired, malformed,
   * rate-limited) throw.
   */
  async checkOtp(phone: string, code: string) {
    const to = toE164Indian(phone);
    const { client, verifyServiceSid } = this.getClient();
    try {
      const check = await client.verify.v2
        .services(verifyServiceSid)
        .verificationChecks.create({ to, code });

      return {
        status: check.status,
        valid: check.status === 'approved',
      };
    } catch (err: unknown) {
      throw this.mapTwilioError(err, 'check');
    }
  }

  private mapTwilioError(err: unknown, action: 'send' | 'check'): HttpException {
    const twilioError = err as { code?: number; message?: string; status?: number } | null;
    const twilioCode = twilioError?.code;

    this.logger.warn(`Twilio Verify ${action} failed${twilioCode ? ` (code ${twilioCode})` : ''}: ${twilioError?.message}`);

    if (twilioCode !== undefined && TWILIO_ERROR_MESSAGES[twilioCode]) {
      const { message, httpStatus } = TWILIO_ERROR_MESSAGES[twilioCode];
      return new HttpException({ message, twilioCode }, httpStatus);
    }

    // Twilio's SDK surfaces its own HTTP-like 4xx for other client errors
    // (bad request shape, unknown service SID, etc.) — pass those through
    // as 400s rather than masking them as a generic 500.
    if (twilioError?.status && twilioError.status >= 400 && twilioError.status < 500) {
      return new BadRequestException(twilioError.message ?? 'The verification request was rejected.');
    }

    return new HttpException(
      'Could not reach the verification service. Please check your connection and try again.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
