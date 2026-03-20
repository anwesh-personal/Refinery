import * as net from 'net';

// ═══════════════════════════════════════════════════════════════
// SMTP Probe — Raw TCP SMTP verification (no email sent)
//
// Protocol flow:
//   Connect → Read 220 banner → EHLO → MAIL FROM → RCPT TO → QUIT
//
// Response classification:
//   250        → valid (mailbox exists)
//   550-559    → invalid (mailbox does not exist)
//   450-459    → risky (greylisting, temporary rejection)
//   Other/Timeout → unknown
//
// Security:
//   - Never sends actual email (stops after RCPT TO)
//   - Configurable HELO domain (must have valid rDNS)
//   - Proper socket cleanup on all code paths
// ═══════════════════════════════════════════════════════════════

export interface SmtpProbeResult {
  status: 'valid' | 'invalid' | 'risky' | 'greylisted' | 'mailbox_full' | 'unknown';
  code: number;
  response: string;
  /** Whether the server advertised STARTTLS support */
  starttls: boolean;
}

export interface SmtpProbeOptions {
  /** Domain to announce in EHLO (must have valid reverse DNS in production) */
  heloDomain: string;
  /** Envelope FROM address */
  fromEmail: string;
  /** Connection + read timeout in ms */
  timeout: number;
  /** SMTP port (default 25) */
  port: number;
}

const DEFAULT_OPTIONS: SmtpProbeOptions = {
  heloDomain: 'mail.refinery.local',
  fromEmail: 'verify@refinery.local',
  timeout: 15_000,
  port: 25,
};

/**
 * Probe an email address via SMTP on the specified MX host.
 * Does NOT send any email — only performs the RCPT TO check.
 */
export function probeEmail(
  mxHost: string,
  targetEmail: string,
  opts: Partial<SmtpProbeOptions> = {},
): Promise<SmtpProbeResult> {
  const options = { ...DEFAULT_OPTIONS, ...opts };

  return new Promise((resolve) => {
    let resolved = false;
    let buffer = '';
    let step: 'banner' | 'ehlo' | 'mail_from' | 'rcpt_to' = 'banner';
    let starttlsSupported = false;

    const socket = new net.Socket();

    // ── Global timeout ──
    const timer = setTimeout(() => {
      finish({ status: 'unknown', code: 0, response: 'Connection timeout', starttls: starttlsSupported });
    }, options.timeout);

    // ── Clean finish helper ──
    function finish(result: SmtpProbeResult): void {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);

      // Best-effort QUIT before closing
      try {
        socket.write('QUIT\r\n');
      } catch {
        // Socket may already be dead
      }

      socket.destroy();
      resolve(result);
    }

    // ── Error handling ──
    socket.on('error', (err: Error) => {
      finish({ status: 'unknown', code: 0, response: `Socket error: ${err.message}`, starttls: starttlsSupported });
    });

    socket.on('close', () => {
      if (!resolved) {
        finish({ status: 'unknown', code: 0, response: 'Connection closed unexpectedly', starttls: starttlsSupported });
      }
    });

    socket.on('timeout', () => {
      finish({ status: 'unknown', code: 0, response: 'Socket timeout', starttls: starttlsSupported });
    });

    // Helper: always produce a complete SmtpProbeResult
    const mkResult = (status: SmtpProbeResult['status'], code: number, response: string): SmtpProbeResult =>
      ({ status, code, response, starttls: starttlsSupported });

    // ── Data handler (SMTP state machine) ──
    socket.on('data', (data: Buffer) => {
      buffer += data.toString('utf-8');

      // SMTP responses end with \r\n. Multi-line responses use "code-" prefix
      // on intermediate lines and "code " (with space) on the final line.
      const response = extractCompleteResponse(buffer);
      if (!response) return; // Wait for more data

      buffer = ''; // Reset buffer after processing a complete response

      const { code, text } = response;

      switch (step) {
        case 'banner':
          if (code >= 200 && code < 300) {
            step = 'ehlo';
            socket.write(`EHLO ${options.heloDomain}\r\n`);
          } else {
            finish(mkResult('unknown', code, `Server rejected connection: ${text}`));
          }
          break;

        case 'ehlo':
          if (code >= 200 && code < 300) {
            // Detect STARTTLS support from EHLO response
            if (text.toUpperCase().includes('STARTTLS')) {
              starttlsSupported = true;
            }
            step = 'mail_from';
            socket.write(`MAIL FROM:<${options.fromEmail}>\r\n`);
          } else {
            finish(mkResult('unknown', code, `EHLO rejected: ${text}`));
          }
          break;

        case 'mail_from':
          if (code >= 200 && code < 300) {
            step = 'rcpt_to';
            socket.write(`RCPT TO:<${targetEmail}>\r\n`);
          } else {
            finish(mkResult('unknown', code, `MAIL FROM rejected: ${text}`));
          }
          break;

        case 'rcpt_to':
          if (code >= 200 && code < 300) {
            finish(mkResult('valid', code, text));
          } else if (code >= 500 && code < 600) {
            finish(mkResult('invalid', code, text));
          } else if (code === 452) {
            finish(mkResult('mailbox_full', code, text));
          } else if (code === 450 || code === 451) {
            finish(mkResult('greylisted', code, text));
          } else if (code >= 400 && code < 500) {
            finish(mkResult('risky', code, text));
          } else {
            finish(mkResult('unknown', code, text));
          }
          break;
      }
    });

    // ── Connect ──
    socket.setTimeout(options.timeout);
    socket.connect(options.port, mxHost);
  });
}

// ─── SMTP Response Parser ───

interface ParsedResponse {
  code: number;
  text: string;
}

/**
 * Parse a (potentially multi-line) SMTP response.
 * Multi-line format:  250-First line\r\n250-Second line\r\n250 Last line\r\n
 * Single-line format: 250 OK\r\n
 *
 * Returns null if the response is incomplete (still waiting for final line).
 */
function extractCompleteResponse(buffer: string): ParsedResponse | null {
  // Must have at least one complete line
  if (!buffer.includes('\r\n')) return null;

  const lines = buffer.split('\r\n').filter((l) => l.length > 0);
  if (lines.length === 0) return null;

  // Check if the last complete line is the final line (code followed by space, not dash)
  const lastLine = lines[lines.length - 1];
  const match = /^(\d{3})([\s-])(.*)$/.exec(lastLine);
  if (!match) return null;

  const delimiter = match[2];
  if (delimiter === '-') {
    // Multi-line response not yet complete
    return null;
  }

  // Final line found — extract code and concatenate all response text
  const code = parseInt(match[1], 10);
  const text = lines
    .map((line) => {
      const m = /^\d{3}[\s-](.*)$/.exec(line);
      return m ? m[1] : line;
    })
    .join(' ');

  return { code, text };
}
