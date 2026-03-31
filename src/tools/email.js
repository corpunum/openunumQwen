/**
 * Email Tool - Gmail CLI Integration
 * Send emails via Google's Gmail CLI
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const execAsync = promisify(exec);

// Gmail CLI path (configurable)
const GMAIL_CLI_PATH = process.env.GMAIL_CLI_PATH || '/usr/bin/gmail';

export const EmailTool = {
  /**
   * Check if Gmail CLI is installed and authenticated
   */
  async checkStatus(args, config) {
    try {
      const { stdout } = await execAsync(`${GMAIL_CLI_PATH} --version`);
      return {
        success: true,
        installed: true,
        version: stdout.trim(),
        authenticated: await this.checkAuth()
      };
    } catch (e) {
      return {
        success: true,
        installed: false,
        error: 'Gmail CLI not found. Install with: npm install -g gmail-cli'
      };
    }
  },

  /**
   * Check OAuth authentication status
   */
  async checkAuth() {
    const authPath = join(process.env.HOME || '/root', '.gmail-cli', 'credentials.json');
    return existsSync(authPath);
  },

  /**
   * Send an email
   */
  async send(args, config) {
    const { to, subject, body, cc, bcc, attachments } = args;

    if (!to || !subject || !body) {
      throw new Error('to, subject, and body are required');
    }

    // Validate email format (basic)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to)) {
      throw new Error('Invalid email address');
    }

    // Build command
    let cmd = `${GMAIL_CLI_PATH} send`;
    cmd += ` --to "${to}"`;
    cmd += ` --subject "${subject.replace(/"/g, '\\"')}"`;
    cmd += ` --body "${body.replace(/"/g, '\\"')}"`;

    if (cc) {
      cmd += ` --cc "${cc}"`;
    }

    if (bcc) {
      cmd += ` --bcc "${bcc}"`;
    }

    if (attachments) {
      for (const attachment of attachments) {
        cmd += ` --attach "${attachment}"`;
      }
    }

    try {
      const { stdout, stderr } = await execAsync(cmd);
      return {
        success: true,
        sent: true,
        to,
        subject,
        message_id: this.extractMessageId(stdout),
        timestamp: new Date().toISOString()
      };
    } catch (e) {
      throw new Error(`Failed to send email: ${e.message}`);
    }
  },

  /**
   * Send email with HTML content
   */
  async sendHtml(args, config) {
    const { to, subject, htmlBody, textBody } = args;

    if (!to || !subject || (!htmlBody && !textBody)) {
      throw new Error('to, subject, and htmlBody or textBody are required');
    }

    // Create temp file for HTML
    const { writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const htmlFile = join(tmpdir(), `email_${Date.now()}.html`);
    writeFileSync(htmlFile, htmlBody || textBody);

    try {
      let cmd = `${GMAIL_CLI_PATH} send`;
      cmd += ` --to "${to}"`;
      cmd += ` --subject "${subject.replace(/"/g, '\\"')}"`;
      cmd += ` --html "${htmlFile}"`;

      if (textBody && !htmlBody) {
        cmd += ` --text "${textBody.replace(/"/g, '\\"')}"`;
      }

      const { stdout } = await execAsync(cmd);
      return {
        success: true,
        sent: true,
        to,
        subject,
        message_id: this.extractMessageId(stdout)
      };
    } finally {
      // Cleanup temp file
      const { unlinkSync } = await import('node:fs');
      try {
        unlinkSync(htmlFile);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  },

  /**
   * List recent emails
   */
  async list(args, config) {
    const { limit = 10, query } = args;

    let cmd = `${GMAIL_CLI_PATH} list --max ${limit}`;

    if (query) {
      cmd += ` --query "${query.replace(/"/g, '\\"')}"`;
    }

    try {
      const { stdout } = await execAsync(cmd);
      const emails = this.parseEmailList(stdout);
      return {
        success: true,
        count: emails.length,
        emails
      };
    } catch (e) {
      throw new Error(`Failed to list emails: ${e.message}`);
    }
  },

  /**
   * Read an email by ID
   */
  async read(args, config) {
    const { id } = args;

    if (!id) {
      throw new Error('Email ID required');
    }

    try {
      const { stdout } = await execAsync(`${GMAIL_CLI_PATH} read --id ${id}`);
      const email = this.parseEmail(stdout);
      return {
        success: true,
        email
      };
    } catch (e) {
      throw new Error(`Failed to read email: ${e.message}`);
    }
  },

  /**
   * Delete an email
   */
  async delete(args, config) {
    const { id } = args;

    if (!id) {
      throw new Error('Email ID required');
    }

    try {
      await execAsync(`${GMAIL_CLI_PATH} delete --id ${id}`);
      return {
        success: true,
        deleted: true,
        id
      };
    } catch (e) {
      throw new Error(`Failed to delete email: ${e.message}`);
    }
  },

  // Helper: Extract message ID from CLI output
  extractMessageId(output) {
    const match = output.match(/Message-ID: <([^>]+)>/i);
    return match ? match[1] : null;
  },

  // Helper: Parse email list output
  parseEmailList(output) {
    const lines = output.split('\n').filter(l => l.trim());
    return lines.map(line => {
      const match = line.match(/(\d+)\s+(.+?)\s+(.+?)\s+(.+)/);
      if (match) {
        return {
          id: match[1],
          from: match[2],
          subject: match[3],
          date: match[4]
        };
      }
      return { raw: line };
    });
  },

  // Helper: Parse single email output
  parseEmail(output) {
    const email = {};
    const lines = output.split('\n');

    for (const line of lines) {
      if (line.startsWith('From:')) {
        email.from = line.substring(5).trim();
      } else if (line.startsWith('To:')) {
        email.to = line.substring(3).trim();
      } else if (line.startsWith('Subject:')) {
        email.subject = line.substring(8).trim();
      } else if (line.startsWith('Date:')) {
        email.date = line.substring(5).trim();
      } else if (line.startsWith('Body:')) {
        email.body = line.substring(5).trim();
      }
    }

    return email;
  }
};
